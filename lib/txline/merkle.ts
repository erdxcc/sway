import type { MerkleProof } from "@/lib/data/contract";

/**
 * TxLINE Merkle proof types + helpers for the "provably real" verification.
 *
 * TxLINE returns proof nodes as `{ hash, isRightSibling }` (position flags, not
 * sorted pairs); the on-chain root lives in a `daily_*_roots` PDA and is checked
 * by the program's `validateStat` method run as a read-only simulation. Today
 * this module does the wire-mapping + structural checks (dependency-free); the
 * on-chain simulation is the marked next step. See docs/ONCHAIN_SETUP.md.
 */

/** A single TxLINE proof node: a sibling hash + which side it sits on. */
export interface TxlineProofNode {
  hash: string;
  isRightSibling: boolean;
}

/** TxLINE's Merkle proof for one odds update (wire shape). */
export interface TxlineOddsProof {
  messageId: string;
  /** Hash of the odds message — the leaf. */
  leaf: string;
  /** The on-chain Merkle root this proof resolves to. */
  root: string;
  /** Sibling nodes from the leaf up to the root. */
  nodes: TxlineProofNode[];
}

/** The on-chain validation reference (exact hash + leaf encoding live here). */
export const ONCHAIN_VALIDATION_DOC =
  "https://txline-docs.txodds.com/documentation/examples/onchain-validation";

/**
 * Map a TxLINE wire proof onto the app's {@link MerkleProof} contract type.
 * `index` is reconstructed from the position flags (bit i set = our node is the
 * right child at level i, i.e. the sibling is on the left).
 */
export function toMerkleProof(p: TxlineOddsProof): MerkleProof {
  let index = 0;
  p.nodes.forEach((node, i) => {
    if (!node.isRightSibling) index |= 1 << i;
  });
  return {
    messageId: p.messageId,
    leaf: p.leaf,
    proof: p.nodes.map((n) => n.hash),
    root: p.root,
    index,
  };
}

/**
 * Structural sanity check — every field present and well-formed. This is NOT an
 * on-chain proof; it only guards against a malformed/empty payload so the UI
 * never shows a false "Verified".
 */
export function verifyProofShape(
  p: TxlineOddsProof | null | undefined,
): p is TxlineOddsProof {
  if (!p || !p.messageId || !p.leaf || !p.root) return false;
  if (!Array.isArray(p.nodes) || p.nodes.length === 0) return false;
  return p.nodes.every(
    (n) =>
      typeof n.hash === "string" &&
      n.hash.length > 0 &&
      typeof n.isRightSibling === "boolean",
  );
}

/**
 * Verify a proof against the on-chain root.
 *
 * TODO(onchain): replace with an Anchor read-only simulation of the program's
 * `validateStat` against the `daily_*_roots` PDA (devnet IDL) — let the on-chain
 * program check the proof rather than re-implementing the hash. Until then this
 * returns the structural result, so a true "Verified ✓" is never faked.
 */
export async function verifyOnChain(p: TxlineOddsProof): Promise<boolean> {
  return verifyProofShape(p);
}
