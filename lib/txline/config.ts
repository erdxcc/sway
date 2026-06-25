/**
 * TxLINE feed configuration — SERVER-SIDE ONLY.
 *
 * Do not import this (or anything under lib/txline) from a client component:
 * these values gate the paid SL12 feed and must never reach the browser. Values
 * come from environment variables (see .env.example).
 */

export interface TxlineConfig {
  apiBase: string;
  sseBase: string;
  clientId: string;
  serviceLevelId: string;
  subscribeTxSig: string;
  /** Pre-issued token shortcut for local dev. */
  staticToken: string;
}

export function readConfig(): TxlineConfig {
  const apiBase = process.env.TXLINE_API_BASE ?? "";
  return {
    apiBase,
    sseBase: process.env.TXLINE_SSE_BASE ?? apiBase,
    clientId: process.env.TXLINE_CLIENT_ID ?? "",
    serviceLevelId: process.env.TXLINE_SERVICE_LEVEL_ID ?? "12",
    subscribeTxSig: process.env.TXLINE_SUBSCRIBE_TXSIG ?? "",
    staticToken: process.env.TXLINE_API_TOKEN ?? "",
  };
}

/**
 * True when the relay can actually reach the feed: either a static token plus an
 * SSE base, or a full base + subscribe-tx for the guest/activate exchange.
 */
export function isConfigured(cfg: TxlineConfig = readConfig()): boolean {
  if (cfg.staticToken) return Boolean(cfg.sseBase);
  return Boolean(cfg.apiBase && cfg.sseBase && cfg.subscribeTxSig);
}
