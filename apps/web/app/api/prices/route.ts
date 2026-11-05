import { getUsdPriceDecimal, USD_FEEDS, type PricedAsset } from "@/lib/chain";

/**
 * Live USD prices for every asset the desk trades, from Chainlink feeds on Base.
 * Used by the extension when a post has no X ticker card to read the price from.
 */
export const revalidate = 30;

export async function GET() {
  const assets = Object.keys(USD_FEEDS) as PricedAsset[];
  const results = await Promise.allSettled(assets.map((asset) => getUsdPriceDecimal(asset)));
  const prices = results.flatMap((r, i) =>
    r.status === "fulfilled" ? [{ asset: assets[i], ...r.value, source: "chainlink-base" as const }] : [],
  );
  if (!prices.length) return Response.json({ error: "Price feeds unavailable" }, { status: 503 });
  return Response.json({ prices }, { headers: { "cache-control": "public, max-age=30" } });
}
