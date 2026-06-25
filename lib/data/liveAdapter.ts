import {
  type BeliefAdapter,
  type BeliefTick,
  type FixtureMeta,
} from "./contract";
import { BeliefEngine, type DecimalOdds } from "./beliefEngine";

/**
 * LiveAdapter — connects to our SSE relay (which holds the API token
 * server-side) and turns the multiplexed odds + score feed into BeliefTicks via
 * the shared {@link BeliefEngine}. Emits the same shape as the stub and replay
 * adapters, so the field/HUD don't change.
 *
 * The two parse shapes below are the single alignment point for the real TxLINE
 * message schema — adjust them once the live payloads are confirmed. On a relay
 * error the adapter goes quiet so the page can fall back to replay/stub.
 */

export interface LiveOptions {
  /** Override the relay URL (defaults to our own /api/stream). */
  relayUrl?: string;
}

/** Shape we expect from an `odds` SSE event (align with the real schema). */
interface OddsMsg {
  messageId: string;
  home: number;
  draw: number;
  away: number;
  suspended?: boolean;
  minute?: number;
}

/** Shape we expect from a `score` SSE event. */
interface ScoreMsg {
  scoreHome: number;
  scoreAway: number;
  minute?: number;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class LiveAdapter implements BeliefAdapter {
  readonly fixture: FixtureMeta;
  private readonly relayUrl: string;
  private readonly engine = new BeliefEngine();

  private scoreHome = 0;
  private scoreAway = 0;
  private minute = 0;
  private startedAt = 0;

  constructor(fixture: FixtureMeta, opts: LiveOptions = {}) {
    this.fixture = fixture;
    this.relayUrl =
      opts.relayUrl ??
      `/api/stream?fixtureId=${encodeURIComponent(fixture.fixtureId)}`;
  }

  start(onTick: (tick: BeliefTick) => void): () => void {
    if (typeof EventSource === "undefined") return () => {};
    this.startedAt = performance.now();
    const es = new EventSource(this.relayUrl);

    const emit = (
      odds: DecimalOdds | null,
      suspended: boolean,
      messageId: string,
    ) => {
      const tMs = performance.now() - this.startedAt;
      const out = this.engine.process({
        odds,
        tMs,
        suspended,
        scoreHome: this.scoreHome,
        scoreAway: this.scoreAway,
      });
      onTick({
        tMs,
        minute: this.minute,
        pHome: out.pHome,
        pDraw: out.pDraw,
        pAway: out.pAway,
        magnitude: out.magnitude,
        suspended,
        event: out.event,
        scoreHome: this.scoreHome,
        scoreAway: this.scoreAway,
        favorite: out.favorite,
        oddsMessageId: messageId,
      });
    };

    es.addEventListener("odds", (e) => {
      const m = safeParse<OddsMsg>((e as MessageEvent).data);
      if (!m) return;
      if (m.minute != null) this.minute = m.minute;
      const suspended = Boolean(m.suspended);
      const odds = suspended
        ? null
        : { home: m.home, draw: m.draw, away: m.away };
      emit(odds, suspended, m.messageId);
    });

    es.addEventListener("score", (e) => {
      const m = safeParse<ScoreMsg>((e as MessageEvent).data);
      if (!m) return;
      this.scoreHome = m.scoreHome;
      this.scoreAway = m.scoreAway;
      if (m.minute != null) this.minute = m.minute;
    });

    // Relay/upstream error: stop quietly; the page decides on a fallback.
    es.addEventListener("error", () => {
      /* no-op — EventSource auto-retries; caller may swap adapters */
    });

    return () => es.close();
  }
}
