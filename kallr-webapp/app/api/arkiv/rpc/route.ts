/**
 * Arkiv reads relayed for the browser's Anon-RPC worker.
 *
 * The browser sends its Arkiv queries through the Nym mixnet to this route, which forwards them to
 * Arkiv's RPC. Arkiv sees Kall's server, Kall's server sees a Nym exit, so neither can tie a query
 * (e.g. "this wallet's trades") to the user. The relay exists because the Nym worker drops request
 * headers and Arkiv's RPC refuses a request without `content-type: application/json` (Base doesn't
 * mind, so Base reads go straight through Nym).
 *
 * Read-only by design: only Arkiv's query methods and a few chain reads pass, batches included, so this
 * can't be used as an open proxy.
 */

import type { NextRequest } from "next/server";
import { ARKIV_RPC, relayable } from "@/lib/server/arkiv-relay";

const MAX_BODY = 64 * 1024;

/** Browser workers in a null-origin sandbox (passthrough, Tor) preflight their JSON POST. */
export function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Not JSON" }, { status: 400 });
  }
  if (!relayable(body)) return Response.json({ error: "Only Arkiv read methods are relayed" }, { status: 403 });

  const key = process.env.ARKIV_ACCESS_KEY || process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY || "";
  const url = key ? `${ARKIV_RPC}/${encodeURIComponent(key)}` : ARKIV_RPC;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Arkiv didn't answer" }, { status: 502 });
  }
}
