import "server-only";
import { FLASH_BASE_ASSETS, type FlashToken } from "@kallr/integrations/definitive";
import { checkToken } from "@kallr/integrations/safety-checks";
import { getUsdPriceDecimal } from "@/lib/chain";
import { flash } from "@/lib/server/flash";

/** A token the keyboard can buy, with its live USD price. */
export type TradeToken = { token: "ETH" | "BTC" | `0x${string}`; symbol: string; price: number; logo: string | null };

/** Same bar as the extension: a call on a coin beyond ETH/BTC trades only with real liquidity. */
export const MIN_LIQUIDITY_USD = 50_000;

const isCore = (address: string) =>
  Object.values(FLASH_BASE_ASSETS).some((a) => a.address.toLowerCase() === address.toLowerCase());

/** Flash's token search, or null when it's unavailable (it answers SEARCH_NOT_ELIGIBLE for low-usage keys). */
async function flashSearch(query: string): Promise<FlashToken[] | null> {
  try {
    return await flash.search(query, 8);
  } catch {
    return null;
  }
}

type DexPair = {
  chainId: string;
  baseToken: { address: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  info?: { imageUrl?: string };
};

async function dex(url: string): Promise<DexPair[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) return [];
  const body = (await res.json()) as DexPair[] | { pairs?: DexPair[] | null };
  return (Array.isArray(body) ? body : (body.pairs ?? [])).filter((p) => p.chainId === "base");
}

/** The deepest Base pool for a token, from Dexscreener. */
function bestPair(pairs: DexPair[], match: (p: DexPair) => boolean) {
  return pairs.filter(match).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}

/** ETH/BTC from Chainlink on Base; any other token by its exact contract. Flagged or illiquid tokens are refused. */
export async function tradeTokenByKey(key: string): Promise<TradeToken> {
  if (key === "ETH" || key === "BTC") {
    const { price } = await getUsdPriceDecimal(key);
    return { token: key, symbol: key, price: Number(price), logo: null };
  }
  const found = (await flashSearch(key))?.find((t) => t.address.toLowerCase() === key.toLowerCase());
  if (found) {
    if (found.riskFlagged) throw new Error(`Definitive flags ${found.symbol} as risky, so Kall Markets won't trade it.`);
    if (Number(found.price) > 0) return { token: found.address as `0x${string}`, symbol: found.symbol, price: Number(found.price), logo: found.imageUrl ?? null };
  }
  // Flash search unavailable: Dexscreener for price and liquidity, GoPlus for honeypots and owner powers.
  const [pair, check] = await Promise.all([
    dex(`https://api.dexscreener.com/tokens/v1/base/${key}`).then((p) => bestPair(p, (x) => x.baseToken.address.toLowerCase() === key.toLowerCase())),
    checkToken(key).catch(() => null),
  ]);
  if (!pair || !(Number(pair.priceUsd) > 0)) throw new Error("No live price for that token on Base.");
  if ((pair.liquidity?.usd ?? 0) < MIN_LIQUIDITY_USD) throw new Error(`${pair.baseToken.symbol} has under $50K of liquidity on Base.`);
  const danger = check?.flags.find((f) => f.severity === "danger");
  if (danger) throw new Error(`${pair.baseToken.symbol}: ${danger.text}. Kall Markets won't trade it.`);
  return { token: pair.baseToken.address as `0x${string}`, symbol: pair.baseToken.symbol, price: Number(pair.priceUsd), logo: pair.info?.imageUrl ?? null };
}

/**
 * The Base token a call's ticker means: ETH/BTC, or the exact-symbol token with the most real pool
 * liquidity on Base. Dexscreener decides which token is "the" PEPE, because it sums actual pools;
 * a look-alike can report inflated liquidity elsewhere. Flash (or Dexscreener + GoPlus) then prices
 * it and refuses flagged or illiquid tokens.
 */
export async function tradeTokenForSymbol(symbol: string): Promise<TradeToken | null> {
  const s = symbol.toUpperCase();
  if (s === "ETH" || s === "BTC" || s === "WETH" || s === "CBBTC") return tradeTokenByKey(s === "WETH" ? "ETH" : s === "CBBTC" ? "BTC" : s);
  const pairs = await dex(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(s)}`).catch(() => [] as DexPair[]);
  const liquidity = new Map<string, number>();
  for (const p of pairs) {
    if (p.baseToken.symbol.toUpperCase() !== s || isCore(p.baseToken.address)) continue;
    const key = p.baseToken.address.toLowerCase();
    liquidity.set(key, (liquidity.get(key) ?? 0) + (p.liquidity?.usd ?? 0));
  }
  const [best] = [...liquidity.entries()].sort((a, b) => b[1] - a[1]);
  if (best && best[1] >= MIN_LIQUIDITY_USD) {
    const address = pairs.find((p) => p.baseToken.address.toLowerCase() === best[0])!.baseToken.address;
    return tradeTokenByKey(address).catch(() => null);
  }
  if (pairs.length) return null;
  // Dexscreener unavailable: Flash's search, first exact-symbol, unflagged, liquid match in its own ranking.
  const hit = (await flashSearch(s))?.find(
    (t) => t.symbol.toUpperCase() === s && !t.riskFlagged && Number(t.liquidity ?? 0) >= MIN_LIQUIDITY_USD && !isCore(t.address),
  );
  return hit ? tradeTokenByKey(hit.address).catch(() => null) : null;
}
