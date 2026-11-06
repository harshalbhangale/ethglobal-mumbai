import { FLASH_BASE_ASSETS } from "@kallr/integrations/definitive";
import { flash } from "@/lib/server/flash";

/**
 * One token's live price on Base, for the Kall Keyboard's ticker: `?key=ETH`, `BTC` or a contract
 * address. From the token's deepest Base pool on Dexscreener (it moves with every swap), else
 * Definitive's token search. Kept 3s per token, so a keyboard polling every few seconds and many
 * keyboards on the same coin share one upstream read.
 */
export const dynamic = "force-dynamic";

type Price = { symbol: string; price: number; change24h: number | null; source: "dexscreener" | "definitive"; at: number };
type DexPair = {
  chainId: string;
  baseToken: { address: string; symbol: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
};

const TTL_MS = 3_000;
const cache = new Map<string, { at: number; price: Price }>();
const inflight = new Map<string, Promise<Price | null>>();

function addressFor(key: string): string | null {
  const k = key.toUpperCase();
  if (k === "ETH" || k === "WETH") return FLASH_BASE_ASSETS.ETH.address;
  if (k === "BTC" || k === "CBBTC") return FLASH_BASE_ASSETS.BTC.address;
  return /^0x[0-9a-fA-F]{40}$/.test(key) ? key : null;
}

async function fromDex(address: string): Promise<Price | null> {
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${address}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!res.ok) return null;
  const pairs = ((await res.json()) as DexPair[]).filter(
    (p) => p.chainId === "base" && p.baseToken.address.toLowerCase() === address.toLowerCase() && Number(p.priceUsd) > 0,
  );
  const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!best) return null;
  return { symbol: best.baseToken.symbol, price: Number(best.priceUsd), change24h: best.priceChange?.h24 ?? null, source: "dexscreener", at: Date.now() };
}

async function fromDefinitive(address: string): Promise<Price | null> {
  const hit = (await flash.search(address, 1)).find((t) => t.address.toLowerCase() === address.toLowerCase());
  if (!hit || !(Number(hit.price) > 0)) return null;
  // Definitive gives the 24h change as a fraction.
  const change = hit.priceChange24h ? Number(hit.priceChange24h) * 100 : null;
  return { symbol: hit.symbol, price: Number(hit.price), change24h: Number.isFinite(change) ? change : null, source: "definitive", at: Date.now() };
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key")?.trim() ?? "";
  const address = addressFor(key);
  if (!address) return Response.json({ error: "key must be ETH, BTC or a token address" }, { status: 400 });
  const id = address.toLowerCase();

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.price, { headers: { "cache-control": "no-store" } });

  let job = inflight.get(id);
  if (!job) {
    job = fromDex(address)
      .catch(() => null)
      .then((p) => p ?? fromDefinitive(address).catch(() => null))
      .finally(() => inflight.delete(id));
    inflight.set(id, job);
  }
  const price = await job;
  if (!price) {
    // Keep showing the last good price rather than nothing.
    if (hit) return Response.json(hit.price, { headers: { "cache-control": "no-store" } });
    return Response.json({ error: "No live price for that token right now." }, { status: 503 });
  }
  // ETH and BTC trade as WETH and cbBTC; show the coin's name.
  const k = key.toUpperCase();
  const named = k === "ETH" || k === "BTC" ? { ...price, symbol: k } : price;
  cache.set(id, { at: Date.now(), price: named });
  return Response.json(named, { headers: { "cache-control": "no-store" } });
}
