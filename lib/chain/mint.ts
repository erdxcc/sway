"use client";

/**
 * Mint the captured moment as a Metaplex Core asset (devnet).
 *
 * This is the integration point. The full umi + mpl-core implementation lands
 * once the deps are installed and a collection / mint authority is configured —
 * the ready-to-paste template lives in docs/ONCHAIN_SETUP.md. Until then this
 * throws a clear, honest error so the UI keeps capture + Merkle verify working
 * with no wallet (judge mode).
 */

import { isMintConfigured } from "./config";

export interface MintInput {
  /** The rendered 1080×1920 collectible card. */
  imageBlob: Blob;
  /** Display name, e.g. "Portugal 1–2 Argentina · 86'". */
  name: string;
  /** The verified odds update this artifact is pinned to. */
  oddsMessageId: string;
  /** On-chain Merkle root the proof resolves to (null when unverified). */
  merkleRoot: string | null;
  /** Flattened metadata attributes (fixture / minute / score / win-prob…). */
  attributes: Record<string, string | number>;
  /** Connected payer public key (base58). */
  wallet: string;
}

export interface MintResult {
  /** Transaction signature (base58). */
  signature: string;
  /** Minted Core asset address (base58). */
  assetId: string;
  /** Cluster-aware Solana Explorer link for the tx. */
  explorerUrl: string;
}

/**
 * Mint `input` and resolve to the on-chain result. Throws with actionable
 * guidance until the on-chain layer is wired (see docs/ONCHAIN_SETUP.md).
 */
export async function mintMoment(_input: MintInput): Promise<MintResult> {
  if (!isMintConfigured()) {
    throw new Error(
      "On-chain mint not configured. Set NEXT_PUBLIC_SWAY_COLLECTION and install " +
        "the Metaplex deps (see docs/ONCHAIN_SETUP.md). Capture + verify work without it.",
    );
  }
  // TODO(onchain): umi(RPC_URL) + irysUploader(devnet) + walletAdapterIdentity →
  // upload card + metadata to Arweave → mpl-core create() → { signature, assetId }.
  throw new Error(
    "mintMoment: implementation pending — paste the template from docs/ONCHAIN_SETUP.md.",
  );
}
