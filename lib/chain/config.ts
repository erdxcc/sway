/**
 * On-chain (Solana) configuration for the "provably real" layer — browser-safe.
 *
 * Public values only: the RPC cluster, the TxLINE program + token addresses
 * (published at https://txline-docs.txodds.com/documentation/programs/addresses),
 * and derived feature flags. Secrets (API token, subscribe keypair) never live
 * here — they stay server-side in the SSE relay. See docs/ONCHAIN_SETUP.md.
 */

export type Cluster = "devnet" | "mainnet-beta";

export const CLUSTER: Cluster =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta"
    ? "mainnet-beta"
    : "devnet";

/** Default public RPC for the cluster; override with NEXT_PUBLIC_SOLANA_RPC. */
export const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC?.trim() ||
  (CLUSTER === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com");

/** TxLINE REST base (auth, snapshots, Merkle proofs). */
export const TXLINE_REST_BASE = "https://txline.txodds.com";

/**
 * TxLINE Solana program + token addresses, verbatim from the TxLINE docs.
 * Devnet is the hackathon target; mainnet kept for reference.
 */
export const TXLINE = {
  devnet: {
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
    usdtMint: "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh",
  },
  "mainnet-beta": {
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
    usdtMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
} as const;

/** PDA seeds for the TxLINE program (identical on both networks). */
export const TXLINE_SEEDS = {
  tokenTreasury: "token_treasury_v2",
  usdtTreasury: "usdt_treasury",
  pricingMatrix: "pricing_matrix",
  dailyScoresRoots: "daily_scores_roots",
  dailyBatchRoots: "daily_batch_roots",
  tenDailyFixturesRoots: "ten_daily_fixtures_roots",
} as const;

/** Active network's TxLINE addresses. */
export function txlineAddresses() {
  return TXLINE[CLUSTER];
}

/**
 * Sway's own Metaplex Core collection / mint authority. Optional — when unset,
 * the mint path stays disabled (capture + Merkle verify still work).
 */
export const SWAY_COLLECTION =
  process.env.NEXT_PUBLIC_SWAY_COLLECTION?.trim() || null;

/** Is the Sway mint path configured (a collection / mint authority present)? */
export function isMintConfigured(): boolean {
  return Boolean(SWAY_COLLECTION);
}

/** Cluster-aware Solana Explorer URL for a tx signature or an address. */
export function explorerUrl(
  idOrSig: string,
  kind: "tx" | "address" = "tx",
): string {
  const suffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/${kind}/${idOrSig}${suffix}`;
}
