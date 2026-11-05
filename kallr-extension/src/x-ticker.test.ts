// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const xCard = (symbol: string, price = "$2,511.29", change = "−1.30%") => `
  <article data-testid="tweet">
    <div data-testid="tweetText">gm</div>
    <div><nav><div data-testid="ScrollSnap-List">
      <a role="link" href="https://x.com/search?q=%24${symbol}">
        <div style="display:flex"><span>Ethereum</span><span>${symbol}</span><span>${price}</span><span>${change}</span></div>
      </a>
    </div></nav></div>
  </article>`;

const article = () => document.querySelector("article") as HTMLElement;

beforeEach(() => {
  vi.stubGlobal("KALLR_APP_ORIGIN", "https://kallr.test");
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("findXTicker", () => {
  it("maps X's cashtag cards to assets tradable on Base", async () => {
    const { findXTicker } = await import("./x-ticker");
    document.body.innerHTML = xCard("ETH");
    expect(findXTicker(article())).toMatchObject({ symbol: "ETH", asset: "ETH" });
    document.body.innerHTML = xCard("cbBTC", "$96,100");
    expect(findXTicker(article())).toMatchObject({ symbol: "CBBTC", asset: "BTC" });
  });
  it("ignores assets we can't trade and cards without a price", async () => {
    const { findXTicker } = await import("./x-ticker");
    document.body.innerHTML = xCard("DOGE");
    expect(findXTicker(article())).toBeNull();
    document.body.innerHTML = xCard("ETH", "soon");
    expect(findXTicker(article())).toBeNull();
  });
});

describe("mountTickerButton", () => {
  it("pins one ⇄ Buy button in X's card that opens ours without navigating X", async () => {
    const { findXTicker, mountTickerButton } = await import("./x-ticker");
    document.body.innerHTML = xCard("ETH");
    const card = findXTicker(article());
    if (!card) throw new Error("no ticker");
    expect(card.container.querySelector("nav")).not.toBeNull();
    const onOpen = vi.fn();
    mountTickerButton(card, onOpen);
    mountTickerButton(card, onOpen);
    const hosts = article().querySelectorAll<HTMLElement>(".kallr-xbuy");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.shadowRoot?.querySelector("button")?.textContent).toBe("⇄ Buy");

    const navigated = vi.fn();
    card.link.addEventListener("click", navigated);
    hosts[0]?.click();
    expect(navigated).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("prices", () => {
  it("reads X's live price and 24h change for the asset or an alias", async () => {
    const { readXTicker } = await import("./ticker-price");
    document.body.innerHTML = xCard("WETH");
    expect(readXTicker(article(), ["ETH", "WETH"])).toEqual({ price: "2511.29", change24hPct: "-1.30", source: "x" });
    expect(readXTicker(article(), ["BTC"])).toBeNull();
  });
  it("keeps only well-formed Chainlink rows from the app", async () => {
    const { parsePrices } = await import("./ticker-price");
    const prices = parsePrices({
      prices: [
        { asset: "ETH", price: "3412.5", source: "chainlink-base" },
        { asset: "BTC", price: 96000 },
        { asset: "SOL", price: "1e3" },
      ],
    });
    expect([...prices.keys()]).toEqual(["ETH"]);
    expect(parsePrices(null).size).toBe(0);
  });
  it("formats prices for display", async () => {
    const { formatPrice } = await import("./ticker-price");
    expect(formatPrice("3412.567")).toBe("$3,412.57");
    expect(formatPrice("0.00012345")).toBe("$0.000123");
  });
});
