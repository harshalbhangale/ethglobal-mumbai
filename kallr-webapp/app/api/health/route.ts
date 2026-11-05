/**
 * Instant "is the app up" check for the extension popup. Touches no RPC or external service, so it
 * answers even while Chainlink reads are slow; what's actually live is reported by the routes
 * that use it (/api/prices, /api/flash/*).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, chain: "base", chainId: 8453, orders: "definitive-flash" },
    { headers: { "cache-control": "no-store" } },
  );
}
