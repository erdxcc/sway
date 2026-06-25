import {
  type BeliefEvent,
  type Favorite,
  deriveFavorite,
} from "./contract";

/**
 * Belief engine — turns raw market odds into the smoothed win-probability curve
 * and the drama signal that drives Sway's visual.
 *
 * Pipeline: decimal odds → implied probability (1/odd) → de-margin (remove the
 * bookmaker overround so the three outcomes sum to 1) → one-euro smoothing (cut
 * jitter, preserve sharp jumps) → magnitude + event detection. A market
 * suspension followed by a reopen is the built-in moment detector: the size of
 * the reopen step is the drama.
 *
 * This is the shared core the live and replay adapters use; the stub bypasses it
 * (it scripts probabilities directly).
 */

export interface DecimalOdds {
  home: number;
  draw: number;
  away: number;
}

export interface Probabilities {
  pHome: number;
  pDraw: number;
  pAway: number;
}

const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

/** Raw implied probabilities (1/odd) — these sum to > 1 by the overround. */
export function impliedProbabilities(o: DecimalOdds): Probabilities {
  return { pHome: 1 / o.home, pDraw: 1 / o.draw, pAway: 1 / o.away };
}

/** Bookmaker overround (margin): how much the implied probabilities exceed 1. */
export function overround(o: DecimalOdds): number {
  return 1 / o.home + 1 / o.draw + 1 / o.away - 1;
}

/**
 * De-margin by proportional normalisation: pᵢ = (1/oddᵢ) / Σ(1/oddⱼ). Cheap and
 * robust; Shin / power methods are a documented optional upgrade.
 */
export function deMargin(o: DecimalOdds): Probabilities {
  const h = o.home > 0 ? 1 / o.home : 0;
  const d = o.draw > 0 ? 1 / o.draw : 0;
  const a = o.away > 0 ? 1 / o.away : 0;
  const s = h + d + a || 1;
  return { pHome: h / s, pDraw: d / s, pAway: a / s };
}

const TWO_PI = Math.PI * 2;

/** Smoothing factor for a low-pass step of duration `dt` at the given cutoff. */
function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * One-euro filter (Casiez et al.) for a scalar signal. Adapts its cutoff to the
 * signal's speed: heavy smoothing while steady (kills jitter), light smoothing
 * during fast moves (preserves a goal's sharp swing).
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.6,
    private readonly dCutoff = 1.0,
  ) {}

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = 0;
  }

  filter(x: number, tSec: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.tPrev);
    this.tPrev = tSec;

    const dx = (x - this.xPrev) / dt;
    const dxHat = this.dxPrev + alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    this.dxPrev = dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const xHat = this.xPrev + alpha(cutoff, dt) * (x - this.xPrev);
    this.xPrev = xHat;
    return xHat;
  }
}

export interface BeliefEngineInput {
  /** De-margin-able decimal odds, or null while the market is suspended. */
  odds: DecimalOdds | null;
  tMs: number;
  suspended: boolean;
  scoreHome: number;
  scoreAway: number;
}

export interface BeliefEngineOutput extends Probabilities {
  magnitude: number;
  event: BeliefEvent;
  favorite: Favorite;
}

/**
 * Stateful processor: feed it raw odds/score ticks in order, it emits smoothed
 * probabilities plus the drama signal and detected event.
 */
export class BeliefEngine {
  private readonly fHome = new OneEuroFilter();
  private readonly fDraw = new OneEuroFilter();
  private readonly fAway = new OneEuroFilter();

  private lastP: Probabilities | null = null;
  private preSuspendP: Probabilities | null = null;
  private wasSuspended = false;
  private prevScoreHome = 0;
  private prevScoreAway = 0;

  process(input: BeliefEngineInput): BeliefEngineOutput {
    const tSec = input.tMs / 1000;

    // --- Suspended: hold the last value, no drama until it reopens ----------
    if (input.suspended || !input.odds) {
      if (!this.wasSuspended) this.preSuspendP = this.lastP;
      this.wasSuspended = true;
      const p = this.lastP ?? { pHome: 0.4, pDraw: 0.25, pAway: 0.35 };
      return {
        ...p,
        magnitude: 0,
        event: "suspend",
        favorite: deriveFavorite(p.pHome, p.pAway),
      };
    }

    // --- Odds → de-margined → smoothed → renormalised -----------------------
    const raw = deMargin(input.odds);
    let pHome = this.fHome.filter(raw.pHome, tSec);
    let pDraw = this.fDraw.filter(raw.pDraw, tSec);
    let pAway = this.fAway.filter(raw.pAway, tSec);
    const s = pHome + pDraw + pAway || 1;
    pHome /= s;
    pDraw /= s;
    pAway /= s;
    const p: Probabilities = { pHome, pDraw, pAway };

    const firstTick = this.lastP === null;
    const reopened = this.wasSuspended;
    this.wasSuspended = false;
    const scoreChanged =
      !firstTick &&
      (this.prevScoreHome !== input.scoreHome ||
        this.prevScoreAway !== input.scoreAway);

    let event: BeliefEvent = "drift";
    let magnitude: number;

    if (firstTick) {
      magnitude = 0;
    } else if (reopened) {
      // The reopen step (vs. the pre-suspension value) is the drama.
      const base = this.preSuspendP ?? this.lastP ?? p;
      const jump = Math.max(
        Math.abs(p.pHome - base.pHome),
        Math.abs(p.pAway - base.pAway),
        Math.abs(p.pDraw - base.pDraw),
      );
      event = scoreChanged ? "goal" : "reopen";
      magnitude = clamp(jump * 3.0, 0, 1);
      this.preSuspendP = null;
    } else if (scoreChanged) {
      const base = this.lastP ?? p;
      const jump =
        Math.abs(p.pHome - base.pHome) + Math.abs(p.pAway - base.pAway);
      event = "goal";
      magnitude = clamp(jump * 2.0 + 0.4, 0, 1);
    } else {
      // Ambient drift drama from the local rate of change.
      const base = this.lastP ?? p;
      const jump =
        Math.abs(p.pHome - base.pHome) + Math.abs(p.pAway - base.pAway);
      magnitude = clamp(jump * 8.0, 0, 0.4);
    }

    this.lastP = p;
    this.prevScoreHome = input.scoreHome;
    this.prevScoreAway = input.scoreAway;

    return { ...p, magnitude, event, favorite: deriveFavorite(pHome, pAway) };
  }
}
