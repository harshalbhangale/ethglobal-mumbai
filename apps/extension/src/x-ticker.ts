import { appOrigin } from "./config";
import { el, openDesk, shadowHost } from "./dom";
import { deskUrl } from "./post";
import { tickerCards } from "./ticker-price";

/** X cashtag symbols that map to an asset the desk trades on Base through Flash. */
const ASSETS = { ETH: "ETH", WETH: "ETH", BTC: "BTC", WBTC: "BTC", CBBTC: "BTC" } as const;
type TickerSymbol = keyof typeof ASSETS;
export type TickerAsset = (typeof ASSETS)[TickerSymbol];

export const ALIASES: Record<TickerAsset, string[]> = { ETH: ["WETH"], BTC: ["WBTC", "CBBTC"] };

export type XTickerCard = { link: HTMLElement; symbol: TickerSymbol; asset: TickerAsset };

/**
 * X renders a ticker card (name, live price, 24h change, sparkline) in a ScrollSnap carousel for
 * many cashtags. Returns the first card in the post for an asset we can trade, or null.
 * No classification involved: the card itself says which asset it is.
 */
export function findXTicker(article: HTMLElement): XTickerCard | null {
  for (const { link, texts } of tickerCards(article)) {
    if (!texts.some((t) => /^\$[0-9,]+(\.[0-9]+)?$/.test(t))) continue;
    const symbol = texts.map((t) => t.toUpperCase()).find((t): t is TickerSymbol => t in ASSETS);
    if (symbol) return { link, symbol, asset: ASSETS[symbol] };
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
 * Puts a "Copy on Base" button inside X's ticker card. It opens the desk prefilled with the asset
 * and default exits; the user sets the amount and signs there. Idempotent per card, and restores
 * itself when X re-renders the card.
 */
export function attachToXTicker(article: HTMLElement, post: { postId: string; handle: string }) {
  const card = findXTicker(article);
  if (!card) return null;
  if (card.link.querySelector(".aftermarkets-xbuy")) return card;

  const { host, root } = shadowHost("aftermarkets-xbuy");
  host.style.marginTop = "0";
  const button = el("button", { class: "primary", type: "button" }, "Copy on Base");
  root.append(button);
  // The button sits inside X's link: never let the click or keypress navigate.
  for (const type of ["click", "mousedown", "pointerdown", "keydown"])
    host.addEventListener(type, (event) => {
      if (type === "keydown" && (event as KeyboardEvent).key !== "Enter") return;
      event.stopPropagation();
      if (type === "click" || type === "keydown") {
        event.preventDefault();
        openDesk(deskUrl(appOrigin, card.asset, null, post));
      }
    });
  pin(card.link, host);
  return card;
}
