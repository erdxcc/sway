import { getApiToken } from "@/lib/txline/auth";
import { isConfigured, readConfig } from "@/lib/txline/config";

/**
 * SSE relay. The browser's EventSource cannot set an Authorization header, so it
 * connects here; this server route holds the API token, opens the upstream
 * TxLINE stream with it, and pipes the events straight through. The token never
 * reaches the client.
 *
 * Degrades cleanly: an unconfigured/auth-failed/upstream-down relay returns a
 * single SSE `error` event so the client can fall back to replay/stub.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fixtureId = searchParams.get("fixtureId") ?? "";

  if (!isConfigured()) {
    return new Response(sseEvent("error", { reason: "txline-not-configured" }), {
      status: 503,
      headers: SSE_HEADERS,
    });
  }

  let token: string;
  try {
    token = await getApiToken();
  } catch (e) {
    return new Response(
      sseEvent("error", { reason: "auth-failed", message: String(e) }),
      { status: 502, headers: SSE_HEADERS },
    );
  }

  // Confirm the exact upstream stream path against the TxLINE docs.
  const cfg = readConfig();
  const upstreamUrl = `${cfg.sseBase}/odds/stream?fixtureId=${encodeURIComponent(fixtureId)}`;
  const upstream = await fetch(upstreamUrl, {
    headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    signal: req.signal,
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response(
      sseEvent("error", {
        reason: "upstream-unavailable",
        status: upstream?.status ?? 0,
      }),
      { status: 502, headers: SSE_HEADERS },
    );
  }

  // Pipe the upstream SSE straight through. (The relay will also centralise
  // reconnect + re-snapshot via `asOf` in a later step.)
  return new Response(upstream.body, { headers: SSE_HEADERS });
}
