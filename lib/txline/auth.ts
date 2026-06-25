import { type TxlineConfig, readConfig } from "./config";

/**
 * Server-side TxLINE token acquisition.
 *
 * Resolves a usable API token and caches it in memory. Two paths:
 *  - TXLINE_API_TOKEN set → use it directly (local dev shortcut);
 *  - otherwise run guest-start → activate, using the out-of-band subscribe tx.
 *
 * The token is never returned to the browser — only the relay reads it.
 */

let cached: { token: string; at: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000; // refresh comfortably before a 1h expiry

export async function getApiToken(): Promise<string> {
  const cfg = readConfig();
  if (cfg.staticToken) return cfg.staticToken;
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  const token = await acquireToken(cfg);
  cached = { token, at: Date.now() };
  return token;
}

export function clearTokenCache(): void {
  cached = null;
}

/**
 * guest → (on-chain subscribe) → activate.
 *
 * NOTE: the subscribe transaction (Anchor program, Token-2022 PDAs,
 * SERVICE_LEVEL_ID) and the nacl signature over `txSig:leagues:jwt` need a
 * funded devnet keypair and the TxLINE program address/IDL. That runs
 * out-of-band; its resulting tx signature is supplied via TXLINE_SUBSCRIBE_TXSIG.
 * Endpoint paths below are best-effort from the brief — confirm against the
 * TxLINE docs before relying on this path.
 */
async function acquireToken(cfg: TxlineConfig): Promise<string> {
  if (!cfg.subscribeTxSig) {
    throw new Error(
      "TxLINE: no API token and no subscribe tx — set TXLINE_API_TOKEN, or complete the subscribe step and set TXLINE_SUBSCRIBE_TXSIG.",
    );
  }
  const jwt = await guestStart(cfg);
  return activate(cfg, jwt, cfg.subscribeTxSig);
}

async function guestStart(cfg: TxlineConfig): Promise<string> {
  const res = await fetch(`${cfg.apiBase}/auth/guest/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cfg.clientId ? { clientId: cfg.clientId } : {}),
  });
  if (!res.ok) throw new Error(`TxLINE guest/start failed: ${res.status}`);
  const data = (await res.json()) as { jwt?: string; token?: string };
  const jwt = data.jwt ?? data.token;
  if (!jwt) throw new Error("TxLINE guest/start: no jwt in response");
  return jwt;
}

async function activate(
  cfg: TxlineConfig,
  jwt: string,
  txSig: string,
): Promise<string> {
  const res = await fetch(`${cfg.apiBase}/api/token/activate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ txSig, serviceLevelId: cfg.serviceLevelId }),
  });
  if (!res.ok) throw new Error(`TxLINE token/activate failed: ${res.status}`);
  const data = (await res.json()) as { apiToken?: string; token?: string };
  const apiToken = data.apiToken ?? data.token;
  if (!apiToken) throw new Error("TxLINE token/activate: no apiToken in response");
  return apiToken;
}
