import {
  type BeliefAdapter,
  type BeliefEvent,
  type BeliefTick,
  type FixtureMeta,
  deriveFavorite,
} from "./contract";

/**
 * ManualAdapter — a no-feed "sandbox" source for testing the belief graph.
 *
 * It walks the match clock forward with a gently-living flat belief, and exposes
 * {@link goal} so a test button can inject a goal: the market suspends briefly,
 * then reopens with a repriced jump + a score for the chosen side. Emits the
 * same {@link BeliefTick} shape as the stub/replay/live adapters.
 */

type Side = "home" | "away";

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

export class ManualAdapter implements BeliefAdapter {
  readonly fixture: FixtureMeta;

  private cb: ((t: BeliefTick) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private t0 = 0;

  private pHome = 0.45;
  private pDraw = 0.27;
  private pAway = 0.28;
  private scoreHome = 0;
  private scoreAway = 0;

  private suspendUntil = 0;
  private pending: Side | null = null;

  /** Compressed match length (full 94' maps to this many ms). */
  private readonly durationMs = 180_000;

  constructor(fixture?: FixtureMeta) {
    this.fixture = fixture ?? {
      fixtureId: "sandbox",
      home: "Spain",
      away: "Netherlands",
      competition: "Sandbox",
    };
  }

  /** Inject a test goal for the given side (suspend → reopen with a jump). */
  goal(side: Side): void {
    this.pending = side;
    this.suspendUntil = this.nowMs() + 800;
  }

  private nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  start(onTick: (tick: BeliefTick) => void): () => void {
    this.cb = onTick;
    this.t0 = this.nowMs();

    const emit = () => {
      const now = this.nowMs();
      const elapsed = now - this.t0;
      const minute = Math.min(94, (elapsed / this.durationMs) * 94);

      let event: BeliefEvent = "drift";
      let suspended = false;
      let magnitude = 0.05;

      if (now < this.suspendUntil) {
        suspended = true;
        event = "suspend";
        magnitude = 0;
      } else if (this.pending) {
        const side = this.pending;
        this.pending = null;
        if (side === "home") {
          this.scoreHome += 1;
          this.pHome = clamp(this.pHome + 0.28, 0.06, 0.9);
          this.pAway = clamp(this.pAway - 0.16, 0.04, 0.88);
        } else {
          this.scoreAway += 1;
          this.pAway = clamp(this.pAway + 0.28, 0.06, 0.9);
          this.pHome = clamp(this.pHome - 0.16, 0.04, 0.88);
        }
        this.renorm();
        event = "goal";
        magnitude = 0.9;
      }

      this.cb?.({
        tMs: elapsed,
        minute,
        pHome: this.pHome,
        pDraw: this.pDraw,
        pAway: this.pAway,
        magnitude,
        suspended,
        event,
        scoreHome: this.scoreHome,
        scoreAway: this.scoreAway,
        favorite: deriveFavorite(this.pHome, this.pAway),
        oddsMessageId: `manual-${this.scoreHome}-${this.scoreAway}-${Math.floor(minute)}`,
      });
    };

    emit();
    this.timer = setInterval(emit, 150);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }

  private renorm(): void {
    const s = this.pHome + this.pDraw + this.pAway || 1;
    this.pHome /= s;
    this.pDraw /= s;
    this.pAway /= s;
  }
}
