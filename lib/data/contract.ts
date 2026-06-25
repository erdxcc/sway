/**
 * Sway internal data contract.
 *
 * This is the seam that decouples the *visual* from the *data source*. Every
 * adapter — `StubAdapter` (scripted drama), `LiveAdapter` (TxLINE SSE) and
 * `ReplayAdapter` (recorded fixture) — emits the exact same {@link BeliefTick}
 * stream, so the WebGL field and the capture pipeline only ever know about this
 * contract, never about an API. That lets the whole visual system be built and
 * proven against the stub before any network call exists.
 */

/** Number of samples in the belief curve (data-texture width + card curve). */
export const SAMPLE_COUNT = 512;

/** Which side the market currently favours. Always paired with a visible label
 * (team name + score + win-prob %) so the signal is never colour-only (a11y). */
export type Favorite = "home" | "away" | "level";

/**
 * Discrete dramatic-state classification for a tick. Most ticks are `drift`
 * (ambient repricing). The market freezing then repricing — `suspend` followed
 * by a labelled cause (`goal`/`red`/`pen`) or a bare `reopen` — is the built-in
 * moment detector: we don't invent drama, it lives in the suspension→reopen.
 */
export type BeliefEvent =
  | "drift" // ambient repricing, no discrete event
  | "goal" // a goal was scored (market reopened with a repriced jump)
  | "red" // red card
  | "pen" // penalty awarded
  | "var" // VAR check in progress / resolved
  | "suspend" // market suspended (frozen) — a discrete event is resolving
  | "reopen" // market reopened after a suspension with no labelled cause
  | "whistle"; // full-time / final whistle

/**
 * One normalised real-time tick. Emitted identically by all adapters; this is
 * the only shape the renderer and HUD consume.
 */
export interface BeliefTick {
  /** Wall-clock ms since adapter start — monotonic, drives the renderer clock. */
  tMs: number;
  /** Match minute (0..90+) — the belief curve's x-axis. */
  minute: number;
  /** De-margined win probabilities. `pHome + pDraw + pAway ≈ 1`. */
  pHome: number;
  pDraw: number;
  pAway: number;
  /** 0..1 drama — rate-of-change + jump size; spikes on events, ~0 while frozen. */
  magnitude: number;
  /** Sustained state: the market is currently suspended (frozen). */
  suspended: boolean;
  /** Momentary classification of this tick. */
  event: BeliefEvent;
  scoreHome: number;
  scoreAway: number;
  favorite: Favorite;
  /**
   * Stable id of the underlying odds update — the key we Merkle-prove against
   * the on-chain root. This is what makes a captured moment verifiable.
   */
  oddsMessageId: string;
}

/**
 * Merkle proof for a single odds update, fetched by `oddsMessageId` and checked
 * against the on-chain root. A captured moment is "provably real" iff this
 * verifies: a fake datapoint has no valid proof and cannot be minted.
 */
export interface MerkleProof {
  messageId: string;
  /** Hex hash of the odds message — the leaf. */
  leaf: string;
  /** Sibling hashes from the leaf up to the root. */
  proof: string[];
  /** The on-chain Merkle root this proof resolves to. */
  root: string;
  /** Leaf index — encodes left/right ordering at each level. */
  index: number;
}

/** Static identity of a fixture, independent of live state. */
export interface FixtureMeta {
  fixtureId: string;
  home: string;
  away: string;
  competition: string;
  /** Unix ms kickoff, if known. */
  kickoff?: number;
}

/**
 * Frozen single-source-of-truth snapshot handed to the capture renderer. The
 * captured card is a pure, deterministic function of this object — same
 * `MomentState` in → byte-identical artifact out (see `lib/belief/capture`).
 */
export interface MomentState {
  /** {@link SAMPLE_COUNT} samples of pHome across match time — curve + card. */
  curveSamples: Float32Array;
  /** Current home win-probability at the captured instant. */
  p: number;
  /** Current away win-probability — used for the card's colour mix + label. */
  pAway: number;
  minute: number;
  scoreHome: number;
  scoreAway: number;
  favorite: Favorite;
  event: BeliefEvent;
  /** Drama at capture — seeds the frozen-burst intensity. */
  magnitude: number;
  oddsMessageId: string;
  /** Pinned at capture so the proof survives the feed's retention window. */
  merkleProof: MerkleProof | null;
  fixtureMeta: {
    home: string;
    away: string;
    competition: string;
    capturedAt: number;
  };
}

/**
 * The one interface every data source implements. Construct an adapter, then
 * `start` it with a tick callback; the returned disposer stops emission and
 * frees timers/connections.
 */
export interface BeliefAdapter {
  readonly fixture: FixtureMeta;
  /** Begin emitting ticks; returns a disposer that stops emission. */
  start(onTick: (tick: BeliefTick) => void): () => void;
  /**
   * Pinned Merkle proof for a captured odds messageId, if this source has one
   * (replay pins them at record time; live fetches them; the stub has none).
   */
  getProof?(oddsMessageId: string): MerkleProof | null;
}

/**
 * Classify the favoured side from home/away probabilities with a dead-zone so
 * a near-coin-flip reads as `level` rather than flickering between sides.
 */
export function deriveFavorite(
  pHome: number,
  pAway: number,
  eps = 0.04,
): Favorite {
  const d = pHome - pAway;
  if (d > eps) return "home";
  if (d < -eps) return "away";
  return "level";
}
