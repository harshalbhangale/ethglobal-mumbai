import { send } from "./dom";

export type LivePrice = {
  /** Exact decimal string, never parsed into a float until formatting. */
  price: string;
  change24hPct: string | null;
  source: "x" | "chainlink-base" | "flash";
};

/** Wrapped and bridged symbols X may show for the same asset. */
export const ALIASES: Record<string, string[]> = { ETH: ["WETH"], BTC: ["WBTC", "CBBTC"] };

const PRICE_TEXT =/^\$[0-9,]+(\.[0-9]+)?$/;
const CHANGE_TEXT = /^[+\-−][0-9.,]+%$/;

/** The spans of each card in X's ticker carousel. */
export function tickerCards(article: HTMLElement) {
  return [...article.querySelectorAll<HTMLElement>('[data-testid="ScrollSnap-List"] a[role="link"]')].map((link) => ({
    link,
    texts: [...link.querySelectorAll("span")].map((s) => s.textContent?.trim() ?? ""),
  }));
}

/**
 * X renders its own ticker card (name, live price, 24h change, sparkline) for many cashtags.
 * When the post has one for this symbol, read its current values: X's live data, already on screen.
 */
export function readXTicker(article: HTMLElement, symbols: string[]): LivePrice | null {
  const wanted = new Set(symbols.map((s) => s.toUpperCase()));
  for (const { texts } of tickerCards(article)) {
    if (!texts.some((t) => wanted.has(t.toUpperCase()))) continue;
    const price = texts.find((t) => PRICE_TEXT.test(t));
    if (!price) continue;
    const change = texts.find((t) => CHANGE_TEXT.test(t));
    return {
      price: price.slice(1).replaceAll(",", ""),
      change24hPct: change ? change.replace("−", "-").replace("+", "").replace("%", "") : null,
      source: "x",
    };
  }
  return null;
}

const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;

/** Validates the app's /api/prices answer; anything malformed is dropped, not guessed at. */
export function parsePrices(raw: unknown): Map<string, LivePrice> {
  const out = new Map<string, LivePrice>();
  const list = (raw as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(list)) return out;
  for (const row of list) {
    const { asset, price } = (row ?? {}) as { asset?: unknown; price?: unknown };
    if (typeof asset === "string" && typeof price === "string" && DECIMAL.test(price))
      out.set(asset, { price, change24hPct: null, source: "chainlink-base" });
  }
  return out;
}

let request: Promise<Map<string, LivePrice>> | null = null;
let requestedAt = 0;
/** Chainlink price on Base from the app, shared across cards and cached for 30s. */
export function chainlinkPrice(asset: string): Promise<LivePrice | null> {
  if (!request || Date.now() - requestedAt > 30_000) {
    requestedAt = Date.now();
    request = send<unknown>({ type: "prices" }).then(parsePrices);
  }
  return request.then((prices) => prices.get(asset) ?? null);
}

/** X's own price when the post shows it, else Chainlink. */
export async function livePrice(article: HTMLElement, asset: string, aliases: string[] = []) {
  return readXTicker(article, [asset, ...aliases]) ?? (await chainlinkPrice(asset));
}

export function formatPrice(price: string) {
  const value = Number(price);
  if (!Number.isFinite(value)) return `$${price}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 2 : value >= 1 ? 4 : 6 })}`;
}
