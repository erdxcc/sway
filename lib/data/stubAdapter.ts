import {
  type BeliefAdapter,
  type BeliefEvent,
  type BeliefTick,
  type FixtureMeta,
  deriveFavorite,
} from "./contract";

/**
 * StubAdapter — a scripted, deterministic belief stream with no network.
 *
 * It replays one hero arc (the comeback the whole demo is built around) so the
 * WebGL field, HUD and capture pipeline can be developed and recorded before
 * auth/SSE exist. It emits the same {@link BeliefTick} shape as the live and
 * replay adapters, so nothing downstream knows it isn't real.
 *
 * The fixture identity is a placeholder ("Home"/"Away", competition flagged as
 * a stub) — the real fixture is bound on day 1 without touching this engine.
 */

/** One scripted point on the belief arc. Values between keyframes are smoothly
 * interpolated for ambient drift; events snap (after a brief suspension). */
interface Keyframe {
  /** Match minute this keyframe sits at. */
  minute: number;
  /** Home win-probability at this point (de-margined-style, 0..1). */
  pHome: number;
  /** Away win-probability at this point. pDraw is the remainder. */
  pAway: number;
  scoreHome: number;
  scoreAway: number;
  /** Labelled cause that fires when the clock reaches this keyframe. */
  event?: Extract<BeliefEvent, "goal" | "red" | "pen" | "var" | "whistle">;
  /** Wall-clock ms the market freezes (suspends) before this event snaps in. */
  suspendMs?: number;
  /** Explicit drama for the snap, 0..1 (overrides the jump-size default). */
  magnitude?: number;
}

/**
 * The hero comeback. A pre-match favourite (home) goes ahead, looks
 * comfortable, then the underdog scores twice late — belief flips home→away and
 * the 86' winner is the single verifiable datapoint the demo mints on camera.
 */
const HERO_SCRIPT: readonly Keyframe[] = [
  { minute: 0, pHome: 0.55, pAway: 0.18, scoreHome: 0, scoreAway: 0 },
  // Home strikes first and the market is sure of them.
  { minute: 12, pHome: 0.79, pAway: 0.07, scoreHome: 1, scoreAway: 0, event: "goal", suspendMs: 1100, magnitude: 0.7 }, // prettier-ignore
  { minute: 35, pHome: 0.82, pAway: 0.06, scoreHome: 1, scoreAway: 0 },
  // A VAR check rattles the field but the score stands.
  { minute: 62, pHome: 0.74, pAway: 0.1, scoreHome: 1, scoreAway: 0, event: "var", suspendMs: 600, magnitude: 0.28 }, // prettier-ignore
  { minute: 70, pHome: 0.66, pAway: 0.16, scoreHome: 1, scoreAway: 0 },
  // Underdog pulls one back — belief narrows hard.
  { minute: 78, pHome: 0.42, pAway: 0.3, scoreHome: 1, scoreAway: 1, event: "goal", suspendMs: 1200, magnitude: 0.85 }, // prettier-ignore
  // Momentum carries the market across: favourite flips home → away.
  { minute: 83, pHome: 0.34, pAway: 0.44, scoreHome: 1, scoreAway: 1 },
  // THE MOMENT — 86' winner. Biggest swing; this is what gets captured.
  { minute: 86, pHome: 0.12, pAway: 0.72, scoreHome: 1, scoreAway: 2, event: "goal", suspendMs: 1400, magnitude: 1 }, // prettier-ignore
  { minute: 90, pHome: 0.1, pAway: 0.78, scoreHome: 1, scoreAway: 2 },
  // Final whistle on the comeback.
  { minute: 94, pHome: 0.08, pAway: 0.8, scoreHome: 1, scoreAway: 2, event: "whistle", magnitude: 0.5 }, // prettier-ignore
] as const;

const HERO_FIXTURE: FixtureMeta = {
  fixtureId: "stub-hero",
  home: "Home",
  away: "Away",
  competition: "Knockout (stub)",
};

export interface StubOptions {
  /** Compressed match duration in ms (full 94' maps to this). Default 180_000. */
  durationMs?: number;
  /** Emit cadence in ms. Default 100 (~10 ticks/s, sub-second like the feed). */
  tickMs?: number;
  /** Loop back to kickoff a beat after the whistle. Default true (idle demo). */
  loop?: boolean;
  /** Override the placeholder fixture identity (real fixture binds here). */
  fixture?: FixtureMeta;
}

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smoothstep = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Resolved per-tick state before event/magnitude classification. */
interface Resolved {
  pHome: number;
  pAway: number;
  scoreHome: number;
  scoreAway: number;
  minute: number;
  /** Which keyframe segment we're approaching (the "b" of an a→b segment). */
  nextIndex: number;
  phase: "drift" | "hold" | "suspend";
}

export class StubAdapter implements BeliefAdapter {
  readonly fixture: FixtureMeta;

  private readonly durationMs: number;
  private readonly tickMs: number;
  private readonly loop: boolean;
  private readonly msPerMinute: number;
  /** Ms held after the whistle before a loop resets, so full-time can read. */
  private readonly holdMs = 2500;

  constructor(opts: StubOptions = {}) {
    this.fixture = opts.fixture ?? HERO_FIXTURE;
    this.durationMs = opts.durationMs ?? 180_000;
    this.tickMs = opts.tickMs ?? 100;
    this.loop = opts.loop ?? true;
    const lastMinute = HERO_SCRIPT[HERO_SCRIPT.length - 1].minute;
    this.msPerMinute = this.durationMs / lastMinute;
  }

  private triggerMs(index: number): number {
    return HERO_SCRIPT[index].minute * this.msPerMinute;
  }

  /** Pure resolve of the scripted state at a wall-clock offset. */
  private resolve(elapsed: number): Resolved {
    const e = clamp(elapsed, 0, this.durationMs);
    const minute = e / this.msPerMinute;

    // Find segment [i, i+1] with triggerMs(i) <= e < triggerMs(i+1).
    let i = 0;
    while (i < HERO_SCRIPT.length - 1 && this.triggerMs(i + 1) <= e) i++;
    const a = HERO_SCRIPT[i];
    const b = HERO_SCRIPT[Math.min(i + 1, HERO_SCRIPT.length - 1)];
    const nextIndex = Math.min(i + 1, HERO_SCRIPT.length - 1);

    // Approaching an event keyframe: hold the pre-event value, freeze for the
    // last `suspendMs`, then the snap happens when e crosses triggerMs(b).
    if (b !== a && b.suspendMs) {
      const tB = this.triggerMs(nextIndex);
      const suspendStart = tB - b.suspendMs;
      const phase: Resolved["phase"] = e >= suspendStart ? "suspend" : "hold";
      return {
        pHome: a.pHome,
        pAway: a.pAway,
        scoreHome: a.scoreHome,
        scoreAway: a.scoreAway,
        minute,
        nextIndex,
        phase,
      };
    }

    // Normal ambient drift: smooth interpolation a → b.
    const tA = this.triggerMs(i);
    const tB = this.triggerMs(nextIndex);
    const u = tB > tA ? smoothstep((e - tA) / (tB - tA)) : 1;
    return {
      pHome: lerp(a.pHome, b.pHome, u),
      pAway: lerp(a.pAway, b.pAway, u),
      scoreHome: a.scoreHome,
      scoreAway: a.scoreAway,
      minute,
      nextIndex,
      phase: "drift",
    };
  }

  start(onTick: (tick: BeliefTick) => void): () => void {
    const hasPerf =
      typeof performance !== "undefined" &&
      typeof performance.now === "function";
    const now = () => (hasPerf ? performance.now() : Date.now());

    let t0 = now();
    let prevPHome = HERO_SCRIPT[0].pHome;
    const firedEvents = new Set<number>();

    const emit = () => {
      let elapsed = now() - t0;

      // Loop: a beat after the whistle, rewind to kickoff for an idle demo.
      if (this.loop && elapsed >= this.durationMs + this.holdMs) {
        t0 = now();
        elapsed = 0;
        prevPHome = HERO_SCRIPT[0].pHome;
        firedEvents.clear();
      }

      const r = this.resolve(elapsed);
      const pDraw = clamp(1 - r.pHome - r.pAway, 0, 1);

      let event: BeliefEvent = "drift";
      let suspended = false;
      let magnitude: number;

      if (r.phase === "suspend") {
        // Market frozen: desaturate/hold downstream, no drama until it snaps.
        suspended = true;
        event = "suspend";
        magnitude = 0;
      } else {
        // Did we just cross an event keyframe this tick? Fire it exactly once.
        const k = r.nextIndex;
        const kf = HERO_SCRIPT[k];
        const crossed =
          kf.event != null &&
          elapsed >= this.triggerMs(k) &&
          !firedEvents.has(k);
        if (crossed) {
          firedEvents.add(k);
          event = kf.event!;
          magnitude = kf.magnitude ?? clamp(Math.abs(kf.pAway - prevPHome) * 2.5, 0, 1); // prettier-ignore
        } else {
          // Ambient drama from the curve's local slope.
          magnitude = clamp(Math.abs(r.pHome - prevPHome) * 26, 0, 0.3);
        }
      }

      const minuteInt = Math.floor(r.minute);
      const oddsMessageId =
        event === "drift" || event === "suspend"
          ? `stub-d-${Math.floor(elapsed / 1000)}`
          : `stub-${event}-${r.scoreHome}-${r.scoreAway}-${minuteInt}`;

      const tick: BeliefTick = {
        tMs: elapsed,
        minute: r.minute,
        pHome: r.pHome,
        pDraw,
        pAway: r.pAway,
        magnitude,
        suspended,
        event,
        scoreHome: r.scoreHome,
        scoreAway: r.scoreAway,
        favorite: deriveFavorite(r.pHome, r.pAway),
        oddsMessageId,
      };

      prevPHome = r.pHome;
      onTick(tick);
    };

    emit(); // emit immediately so the field is never blank on mount
    const timer = setInterval(emit, this.tickMs);
    return () => clearInterval(timer);
  }
}
