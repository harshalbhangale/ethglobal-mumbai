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
  vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "https://aftermarkets.test");
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

describe("attachToXTicker", () => {
  it("pins one Copy button in the card that opens the desk without navigating X", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { attachToXTicker } = await import("./x-ticker");
    document.body.innerHTML = xCard("ETH");
    const post = { postId: "2110056722328908098", handle: "kol" };
    expect(attachToXTicker(article(), post)).not.toBeNull();
    attachToXTicker(article(), post);
    const hosts = article().querySelectorAll(".aftermarkets-xbuy");
    expect(hosts).toHaveLength(1);

    const link = article().querySelector("a") as HTMLElement;
    const navigated = vi.fn();
    link.addEventListener("click", navigated);
    (hosts[0] as HTMLElement).click();
    expect(navigated).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
    const url = new URL(open.mock.calls[0]?.[0] as string);
    expect(url.origin).toBe("https://aftermarkets.test");
    expect(url.searchParams.get("order")).toContain("ETH");
    expect(url.searchParams.get("caller")).toBe("kol");
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
