import { getUsdPriceDecimal, USD_FEEDS, type PricedAsset } from "@/lib/chain";

/**
 * Live USD prices for every asset the desk trades, from Chainlink feeds on Base.
 * Used by the extension when a post has no X ticker card to read the price from.
 *
 * Reading the feeds over the public Base RPC can take several seconds on a cold start, so the
 * result is kept for 30s and concurrent callers share one read instead of each waiting on the RPC.
 */
export const dynamic = "force-dynamic";

type Row = { asset: PricedAsset; price: string; updatedAt: number; source: "chainlink-base" };
const TTL_MS = 30_000;
let cached: { at: number; prices: Row[] } | null = null;
let inflight: Promise<Row[]> | null = null;

async function readFeeds(): Promise<Row[]> {
  const assets = Object.keys(USD_FEEDS) as PricedAsset[];
  const results = await Promise.allSettled(assets.map((asset) => getUsdPriceDecimal(asset)));
  return results.flatMap((r, i) => {
    const asset = assets[i];
    return r.status === "fulfilled" && asset ? [{ asset, ...r.value, source: "chainlink-base" as const }] : [];
  });
}

export async function GET() {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    inflight ??= readFeeds().finally(() => {
      inflight = null;
    });
    const prices = await inflight;
    // Keep the last good answer when a refresh comes back empty.
    if (prices.length) cached = { at: Date.now(), prices };
  }
  if (!cached?.prices.length) return Response.json({ error: "Price feeds unavailable" }, { status: 503 });
  return Response.json({ prices: cached.prices }, { headers: { "cache-control": "public, max-age=30" } });
}
