/**
 * Deterministic randomness for the capture pipeline.
 *
 * A captured artifact must be a *pure* function of its `MomentState` — the same
 * verified datapoint has to produce a byte-identical card on any device and on
 * every reload. We therefore seed all "random" placement (burst particle
 * positions, etc.) from `hashSeed(oddsMessageId)` and compute it on the CPU,
 * never from in-shader noise (GPU float precision varies between devices).
 */

/**
 * Deterministic 32-bit PRNG (mulberry32). Same seed → same sequence. Lifted
 * verbatim from the Kairos palette generator so behaviour matches the reference.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit string hash — turns an `oddsMessageId` into an RNG seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
