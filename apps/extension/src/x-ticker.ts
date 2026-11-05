import { el, shadowHost } from "./dom";
import { tickerCards } from "./ticker-price";

export { ALIASES } from "./ticker-price";

/** X cashtag symbols that map to an asset the desk trades on Base through Flash. */
const ASSETS = { ETH: "ETH", WETH: "ETH", BTC: "BTC", WBTC: "BTC", CBBTC: "BTC" } as const;
type TickerSymbol = keyof typeof ASSETS;
export type TickerAsset = (typeof ASSETS)[TickerSymbol];

export type XTickerCard = {
  link: HTMLElement;
  /** X's carousel block; our attached card goes right after it. */
  container: HTMLElement;
  symbol: TickerSymbol;
  asset: TickerAsset;
};

/**
 * X renders a ticker card (name, live price, 24h change, sparkline) in a ScrollSnap carousel for
 * many cashtags. Returns the first card in the post for an asset we can trade, or null.
 * No classification involved: the card itself says which asset it is.
 */
export function findXTicker(article: HTMLElement): XTickerCard | null {
  for (const { link, texts } of tickerCards(article)) {
    if (!texts.some((t) => /^\$[0-9,]+(\.[0-9]+)?$/.test(t))) continue;
    const symbol = texts.map((t) => t.toUpperCase()).find((t): t is TickerSymbol => t in ASSETS);
    const container = link.closest("nav")?.parentElement ?? link.parentElement;
    if (symbol && container) return { link, container, symbol, asset: ASSETS[symbol] };
  }
  return null;
}

/**
 * X's sparkline row is a wrapping flex line; a button appended there drops onto the next line.
 * Pin it to the card instead, in the empty corner under the chart.
 */
function pin(link: HTMLElement, host: HTMLElement) {
  if (getComputedStyle(link).position === "static") link.style.position = "relative";
  Object.assign(host.style, { position: "absolute", right: "12px", bottom: "10px", zIndex: "2", margin: "0" });
  link.append(host);
}

/**
 * Puts a "⇄ Buy" button inside X's ticker card, as Xtrading does. Idempotent per card; restores
 * itself when X re-renders the card. The button never lets the click navigate X's link.
 */
export function mountTickerButton(card: XTickerCard, onOpen: () => void) {
  if (card.link.querySelector(".aftermarkets-xbuy")) return;
  const { host, root } = shadowHost("aftermarkets-xbuy");
  root.append(el("button", { class: "xbuy", type: "button" }, "⇄ Buy"));
  for (const type of ["click", "mousedown", "pointerdown", "keydown"])
    host.addEventListener(type, (event) => {
      if (type === "keydown" && (event as KeyboardEvent).key !== "Enter") return;
      event.stopPropagation();
      if (type === "click" || type === "keydown") {
        event.preventDefault();
        onOpen();
      }
    });
  pin(card.link, host);
}
