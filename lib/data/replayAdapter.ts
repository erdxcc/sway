import {
  type BeliefAdapter,
  type BeliefEvent,
  type BeliefTick,
  type FixtureMeta,
  type MerkleProof,
} from "./contract";
import { BeliefEngine, type DecimalOdds } from "./beliefEngine";

/**
 * ReplayAdapter — plays a recorded fixture back through the real
 * {@link BeliefEngine}, emitting the same {@link BeliefTick} stream as the live
 * adapter. This is the demo's de-risk backbone: it doesn't depend on a live
 * match being available while recording, and it exercises the full odds →
 * de-margin → smooth → magnitude pipeline (which the stub bypasses).
 *
 * Sparse recorded odds keyframes are interpolated at a fine cadence to simulate
 * the sub-second feed; interpolation never crosses a suspension, so goals snap.
 *
 * Proof pinning: a real recording stores the Merkle proof of each odds update at
 * record time (so "provably real" survives the feed's retention window). A
 * *synthetic* fixture carries no proofs, so its cards honestly read
 * "verification pending" — we never fake a ✓.
 */

export interface ReplayOddsEvent {
  tMs: number;
  kind: "odds";
  messageId: string;
  home: number;
  draw: number;
  away: number;
  minute: number;
}
export interface ReplaySuspendEvent {
  tMs: number;
  kind: "suspend";
  minute: number;
}
export interface ReplayScoreEvent {
  tMs: number;
  kind: "score";
  scoreHome: number;
  scoreAway: number;
  minute: number;
}
export interface ReplayWhistleEvent {
  tMs: number;
  kind: "whistle";
  minute: number;
}
export type ReplayEvent =
  | ReplayOddsEvent
  | ReplaySuspendEvent
  | ReplayScoreEvent
  | ReplayWhistleEvent;

export interface ReplayFixture {
  fixture: FixtureMeta;
  events: ReplayEvent[];
  /** Pinned Merkle proofs by odds messageId (empty for synthetic fixtures). */
  proofs?: Record<string, MerkleProof>;
}

export interface ReplayOptions {
  /** Real wall-clock duration the whole recording compresses into. Default 180s. */
  durationMs?: number;
  /** Emit cadence in ms. Default 120 (~8 ticks/s, interpolated). */
  tickMs?: number;
  /** Loop back to kickoff a beat after the whistle. Default true. */
  loop?: boolean;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export class ReplayAdapter implements BeliefAdapter {
  readonly fixture: FixtureMeta;

  private readonly events: ReplayEvent[];
  private readonly proofs: Record<string, MerkleProof>;
  private readonly oddsKeys: ReplayOddsEvent[];
  private readonly suspends: ReplaySuspendEvent[];
  private readonly scores: ReplayScoreEvent[];
  private readonly whistles: ReplayWhistleEvent[];
  private readonly lastTMs: number;
  private readonly durationMs: number;
  private readonly tickMs: number;
  private readonly loop: boolean;
  private readonly holdMs = 2500;

  constructor(data: ReplayFixture, opts: ReplayOptions = {}) {
    this.fixture = data.fixture;
    this.events = [...data.events].sort((a, b) => a.tMs - b.tMs);
    this.proofs = data.proofs ?? {};
    this.oddsKeys = this.events.filter(
      (e): e is ReplayOddsEvent => e.kind === "odds",
    );
    this.suspends = this.events.filter(
      (e): e is ReplaySuspendEvent => e.kind === "suspend",
    );
    this.scores = this.events.filter(
      (e): e is ReplayScoreEvent => e.kind === "score",
    );
    this.whistles = this.events.filter(
      (e): e is ReplayWhistleEvent => e.kind === "whistle",
    );
    this.lastTMs = this.events.length
      ? this.events[this.events.length - 1].tMs
      : 1;
    this.durationMs = opts.durationMs ?? 180_000;
    this.tickMs = opts.tickMs ?? 120;
    this.loop = opts.loop ?? true;
  }

  /** Pinned Merkle proof for a captured odds messageId, if the recording has one. */
  getProof(oddsMessageId: string): MerkleProof | null {
    return this.proofs[oddsMessageId] ?? null;
  }

  start(onTick: (tick: BeliefTick) => void): () => void {
    const hasPerf =
      typeof performance !== "undefined" &&
      typeof performance.now === "function";
    const now = () => (hasPerf ? performance.now() : Date.now());
    // Recorded ms per real ms.
    const scale = this.lastTMs / this.durationMs;

    let engine = new BeliefEngine();
    let t0 = now();
    let whistled = false;

    const emit = () => {
      let elapsedReal = now() - t0;
      if (this.loop && elapsedReal >= this.durationMs + this.holdMs) {
        t0 = now();
        elapsedReal = 0;
        engine = new BeliefEngine();
        whistled = false;
      }
      const recT = Math.min(elapsedReal * scale, this.lastTMs);

      const a = this.lastOddsBefore(recT);
      const b = this.firstOddsAfter(recT);
      const suspended = this.isSuspended(recT);
      const score = this.scoreAt(recT);

      let odds: DecimalOdds | null;
      let minute: number;
      let messageId: string;

      if (suspended) {
        odds = null;
        minute = this.activeSuspendMinute(recT, a);
        messageId = a ? a.messageId : "";
      } else if (a && b && !this.suspendBetween(a.tMs, b.tMs)) {
        const span = b.tMs - a.tMs || 1;
        const u = (recT - a.tMs) / span;
        odds = {
          home: lerp(a.home, b.home, u),
          draw: lerp(a.draw, b.draw, u),
          away: lerp(a.away, b.away, u),
        };
        minute = lerp(a.minute, b.minute, u);
        messageId = a.messageId;
      } else if (a) {
        odds = { home: a.home, draw: a.draw, away: a.away };
        minute = a.minute;
        messageId = a.messageId;
      } else {
        odds = null;
        minute = 0;
        messageId = "";
      }

      const out = engine.process({
        odds,
        tMs: elapsedReal,
        suspended,
        scoreHome: score.home,
        scoreAway: score.away,
      });

      let event: BeliefEvent = out.event;
      if (!whistled && this.whistleReached(recT)) {
        event = "whistle";
        whistled = true;
      }

      onTick({
        tMs: elapsedReal,
        minute,
        pHome: out.pHome,
        pDraw: out.pDraw,
        pAway: out.pAway,
        magnitude: out.magnitude,
        suspended,
        event,
        scoreHome: score.home,
        scoreAway: score.away,
        favorite: out.favorite,
        oddsMessageId: messageId,
      });
    };

    emit();
    const timer = setInterval(emit, this.tickMs);
    return () => clearInterval(timer);
  }

  // ----------------------------------------------------------------------- //
  // Timeline lookups (events are pre-sorted by tMs)
  // ----------------------------------------------------------------------- //

  private lastOddsBefore(t: number): ReplayOddsEvent | null {
    let found: ReplayOddsEvent | null = null;
    for (const o of this.oddsKeys) {
      if (o.tMs <= t) found = o;
      else break;
    }
    return found;
  }

  private firstOddsAfter(t: number): ReplayOddsEvent | null {
    for (const o of this.oddsKeys) if (o.tMs > t) return o;
    return null;
  }

  private isSuspended(t: number): boolean {
    let s: ReplaySuspendEvent | null = null;
    for (const sus of this.suspends) {
      if (sus.tMs <= t) s = sus;
      else break;
    }
    if (!s) return false;
    const reopen = this.oddsKeys.find((o) => o.tMs > s!.tMs);
    return reopen ? reopen.tMs > t : true;
  }

  private activeSuspendMinute(t: number, a: ReplayOddsEvent | null): number {
    let s: ReplaySuspendEvent | null = null;
    for (const sus of this.suspends) {
      if (sus.tMs <= t) s = sus;
      else break;
    }
    return s ? s.minute : a ? a.minute : 0;
  }

  private suspendBetween(t0: number, t1: number): boolean {
    return this.suspends.some((s) => s.tMs > t0 && s.tMs < t1);
  }

  private scoreAt(t: number): { home: number; away: number } {
    let home = 0;
    let away = 0;
    for (const sc of this.scores) {
      if (sc.tMs <= t) {
        home = sc.scoreHome;
        away = sc.scoreAway;
      } else break;
    }
    return { home, away };
  }

  private whistleReached(t: number): boolean {
    return this.whistles.some((wsl) => wsl.tMs <= t);
  }
}
