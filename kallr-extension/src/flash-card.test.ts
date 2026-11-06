// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Answer } from "./call-view";

const postedAt = 1_800_000_000;
const answer = (direction: "up" | "down" = "up", asset = "ETH"): Answer => ({
  call: { asset, direction, postedAt, expiresAt: postedAt + 86_400, horizonStated: false, entry: 2400, last: 2460, status: "hit", returnBps: 250 },
  record: { scored: 1, hits: 1, hitRate: 1, medianReturnBps: 250, open: 0 },
  calls: [{ postId: "2", asset, direction, status: "hit", returnBps: 250, postedAt, expiresAt: postedAt + 86_400 }],
});
const post = { handle: "kol", postId: "2", text: "$ETH to 3k, longing" };

/** The worker: Chainlink prices and the after market for a post. */
function stubWorker(after: Answer | null = answer()) {
  const sendMessage = vi.fn(async (m: { type: string }): Promise<unknown> => {
    if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
    if (m.type === "after-market") return after;
    if (m.type === "watchlist") return { entries: [] };
    return null;
  });
  vi.stubGlobal("chrome", { runtime: { id: "x", sendMessage, getURL: (p: string) => `chrome-extension://t/${p}` } });
  return sendMessage;
}

beforeEach(() => vi.stubGlobal("KALLR_APP_ORIGIN", "https://kallr.test"));
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function mounted(a: Answer | null = answer(), asset = "ETH", price = "$2,500") {
  stubWorker(a);
  const { flashCard } = await import("./flash-card");
  const made = flashCard({ post, asset, answer: a });
  document.body.append(made.card);
  await vi.waitFor(() => expect(made.card.querySelector(".swap-title b")?.textContent).toBe(price));
  return made;
}

const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const buttons = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLButtonElement>(sel)];

describe("flashCard", () => {
  it("has the card layout: price header, the call and Follow, Copy button, Powered by footer", async () => {
    const { card } = await mounted();
    expect(q(card, ".swap-title strong").textContent).toBe("Ethereum");
    // Logos are inlined, so they survive extension reloads.
    expect(q(card, ".swap-icon").getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(q(card, ".caller-strip .caller-handle").textContent).toBe("@kol");
    // The card shows the call itself; the caller's record lives on their profile card.
    expect(q(card, ".caller-strip .caller-record").textContent).toBe("Long $ETH");
    expect(q(card, ".caller-strip .x-follow").textContent).toBe("Follow");
    expect(card.querySelector(".call-insights")).toBeNull();
    expect(q(card, ".inline-buy").textContent).toBe("⇄ Copy");
    expect(q(card, ".inline-panel").hidden).toBe(true);
    expect(q(card, ".swap-powered").textContent).toBe("Powered byDEFINITIVE");
    expect(q(card, ".swap-powered .definitive-logo").getAttribute("aria-label")).toBe("Definitive");
  });

  it("copies a buy with TP/SL into the desk, sized in USD", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { card, open: openPanel } = await mounted();
    openPanel();
    q<HTMLButtonElement>(card, ".exits-toggle").click();
    const amount = q<HTMLInputElement>(card, ".swap-amount");
    amount.value = "25";
    amount.dispatchEvent(new Event("input"));
    expect(q(card, ".swap-out").textContent).toBe("≈ 0.01");
    expect(card.textContent).toContain("+10% · $2,750");
    expect(card.textContent).toContain("−5% · $2,375");
    expect(q(card, ".review").textContent).toContain("RouteBest route by Definitive · MEV-protected");
    expect(q(card, ".review").textContent).toContain("ExitsTP $2,750 · SL $2,375");
    expect(q(card, ".swap-submit").textContent).toBe("Buy ETH · $25.00");
    const submit = q<HTMLButtonElement>(card, ".swap-submit");
    expect(submit.textContent).toBe("Buy ETH · $25.00");
    submit.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(card.textContent).toContain("Opened in Kall Markets: your Kall wallet signs it there.");
    const url = new URL(open.mock.calls[0]?.[0] as string);
    expect(url.origin + url.pathname).toBe("https://kallr.test/app");
    expect(url.searchParams.get("order")).toBe("copy $25 of ETH tp 10% sl 5%");
    expect(url.searchParams.get("post")).toBe("2");
    expect(url.searchParams.get("caller")).toBe("kol");
  });

  it("refuses a lone take-profit or stop-loss, since Flash places them as a pair", async () => {
    const { card, open } = await mounted();
    open();
    q<HTMLButtonElement>(card, ".exits-toggle").click();
    const amount = q<HTMLInputElement>(card, ".swap-amount");
    amount.value = "10";
    amount.dispatchEvent(new Event("input"));
    buttons(card, ".exit-chips.sl button").find((b) => b.textContent === "None")?.click();
    expect(q<HTMLButtonElement>(card, ".swap-submit").disabled).toBe(true);
    expect(card.textContent).toContain("as a pair");
    buttons(card, ".exit-chips.tp button").find((b) => b.textContent === "None")?.click();
    expect(q<HTMLButtonElement>(card, ".swap-submit").disabled).toBe(false);
  });

  it("starts on Sell for a bearish call and sells a USD value", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { card, open: openPanel } = await mounted(answer("down"));
    openPanel();
    expect(buttons(card, ".seg button").find((b) => b.getAttribute("aria-pressed") === "true")?.textContent).toBe("Sell");
    expect(q(card, ".exits").hidden).toBe(true);
    const amount = q<HTMLInputElement>(card, ".swap-amount");
    amount.value = "0.01";
    amount.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>(card, ".swap-submit").click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(new URL(open.mock.calls[0]?.[0] as string).searchParams.get("order")).toBe("sell $25.00 of ETH");
  });

  it("shows the record but no trade for a coin with no liquid token on Base", async () => {
    const { card } = await mounted(answer("up", "SOL"), "SOL", "price unavailable");
    expect(q(card, ".inline-buy").hidden).toBe(true);
    expect(q(card, ".inline-panel").hidden).toBe(true);
    await vi.waitFor(() => expect(card.textContent).toContain("$SOL has no liquid, unflagged token on Base"));
  });
});

const DEGEN = {
  address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
  symbol: "DEGEN",
  name: "Degen",
  decimals: 18,
  price: "8.15e-4",
  liquidity: "231680",
  change24h: "-0.02",
  imageUrl: null,
  riskFlagged: false,
};
const FAKE = { ...DEGEN, address: "0x22f9ec77961e9a17721e940d52cbb30adc68ce08", liquidity: "3", riskFlagged: true };

describe("any Base token", () => {
  function worker(tokens: unknown[]) {
    const sendMessage = stubWorker(answer("up", "DEGEN"));
    const base = sendMessage.getMockImplementation();
    sendMessage.mockImplementation(async (m: { type: string }): Promise<unknown> => {
      if (m.type === "token-search") return { tokens };
      return base?.(m);
    });
    return sendMessage;
  }

  it("makes a $DEGEN call tradable when an unflagged, liquid DEGEN exists on Base", async () => {
    worker([DEGEN, FAKE]);
    const { flashCard } = await import("./flash-card");
    const made = flashCard({ post, asset: "DEGEN", answer: answer("up", "DEGEN") });
    document.body.append(made.card);
    await vi.waitFor(() => expect(q(made.card, ".inline-buy").hidden).toBe(false));
    expect(q(made.card, ".swap-title strong").textContent).toBe("Degen");
    await vi.waitFor(() => expect(q(made.card, ".swap-title b").textContent).toBe("$0.000815"));
  });

  it("never maps a cashtag to a flagged or illiquid look-alike", async () => {
    worker([FAKE]);
    const { flashCard } = await import("./flash-card");
    const made = flashCard({ post, asset: "DEGEN", answer: answer("up", "DEGEN") });
    document.body.append(made.card);
    await vi.waitFor(() => expect(made.card.textContent).toContain("$DEGEN has no liquid, unflagged token on Base"));
    expect(q(made.card, ".inline-buy").hidden).toBe(true);
  });

  it("asks the user to choose when a liquid look-alike shares the cashtag", async () => {
    // Real Flash data: an unflagged look-alike reports more liquidity than the real DEGEN.
    const LOOKALIKE = { ...DEGEN, address: "0xF83C329908c41D197CA5105223f9eAb52F72243e", liquidity: "3046015", price: "0.0000518" };
    worker([LOOKALIKE, DEGEN, FAKE]);
    const { flashCard } = await import("./flash-card");
    const made = flashCard({ post, asset: "DEGEN", answer: answer("up", "DEGEN") });
    document.body.append(made.card);
    await vi.waitFor(() => expect(made.card.textContent).toContain("2 tokens on Base are called $DEGEN"));
    expect(q(made.card, ".inline-buy").hidden).toBe(true);
    q<HTMLButtonElement>(made.card, ".untradable .link-button").click();
    expect(q<HTMLInputElement>(made.card, ".picker-search").value).toBe("DEGEN");
    await vi.waitFor(() => expect(made.card.querySelectorAll(".picker-row")).toHaveLength(3));
    made.card.querySelectorAll<HTMLButtonElement>(".picker-row")[1]?.click();
    expect(q(made.card, ".swap-title strong").textContent).toBe("Degen");
    expect(q(made.card, ".untradable").hidden).toBe(true);
  });

  it("picks any token from search and opens it in Kall Markets by contract address", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const sendMessage = worker([DEGEN, FAKE]);
    sendMessage.mockImplementation(async (m: { type: string }): Promise<unknown> => {
      if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
      if (m.type === "token-search") return { tokens: [DEGEN, FAKE] };
      return null;
    });
    const { flashCard } = await import("./flash-card");
    const made = flashCard({ post, asset: "ETH", answer: answer() });
    document.body.append(made.card);
    made.open();
    (made.card.querySelector(".swap-box:not(.swap-pay) .pick-token") as HTMLElement).click();
    const search = q<HTMLInputElement>(made.card, ".picker-search");
    search.value = "degen";
    search.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(made.card.querySelector(".picker-row")?.textContent).toContain("DEGEN"));
    const rows = [...made.card.querySelectorAll<HTMLButtonElement>(".picker-row")];
    expect(rows[1]?.disabled).toBe(true);
    expect(rows[1]?.textContent).toContain("Flagged");
    rows[0]?.click();
    expect(q(made.card, ".picker-slot").hidden).toBe(true);
    expect(q(made.card, ".swap-title strong").textContent).toBe("Degen");
    const amount = q<HTMLInputElement>(made.card, ".swap-amount");
    amount.value = "1";
    amount.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(q<HTMLButtonElement>(made.card, ".swap-submit").disabled).toBe(false));
    q<HTMLButtonElement>(made.card, ".swap-submit").click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    const url = new URL(open.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("token")).toBe(DEGEN.address);
    expect(url.searchParams.get("order")).toBe("copy $1");
    expect(sendMessage.mock.calls.some(([m]) => m.type === "flash-quote" || m.type === "flash-order")).toBe(false);
  });
});

const article = (body: string) => `
  <article data-testid="tweet">
    <div data-testid="User-Name"><span>KOL</span></div>
    <a href="/kol/status/2"><time>1h</time></a>
    <div data-testid="tweetText">${body}</div>
    <div><nav><div data-testid="ScrollSnap-List">
      <a role="link" href="https://x.com/search?q=%24ETH"><span>Ethereum</span><span>ETH</span><span>$2,511.29</span><span>+1.10%</span></a>
    </div></nav></div>
  </article>`;

describe("decorate", () => {
  it("puts one card under a call's text, and X's ticker button opens it", async () => {
    stubWorker(answer());
    const { decorate } = await import("./post-card");
    document.body.innerHTML = article("$ETH to 3k");
    const el = document.querySelector("article") as HTMLElement;
    await decorate(el);
    await decorate(el);
    const hosts = el.querySelectorAll<HTMLElement>(".kallr-host");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.previousElementSibling?.getAttribute("data-testid")).toBe("tweetText");
    const card = hosts[0]?.shadowRoot?.querySelector(".swap-card") as HTMLElement;
    expect(q(card, ".inline-panel").hidden).toBe(true);
    (el.querySelector(".kallr-xbuy") as HTMLElement).click();
    expect(q(card, ".inline-panel").hidden).toBe(false);
  });

  it("attaches a hidden card under X's ticker when the post isn't a call", async () => {
    const sendMessage = stubWorker(null);
    const { decorate } = await import("./post-card");
    document.body.innerHTML = article("gm, charts look interesting");
    const el = document.querySelector("article") as HTMLElement;
    await decorate(el);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "after-market" }));
    const host = el.querySelector<HTMLElement>(".kallr-host");
    expect(host?.previousElementSibling?.querySelector("nav")).not.toBeNull();
    const card = host?.shadowRoot?.querySelector(".swap-card") as HTMLElement;
    expect(card.hidden).toBe(true);
    (el.querySelector(".kallr-xbuy") as HTMLElement).click();
    expect(card.hidden).toBe(false);
    expect(card.querySelector(".call-insights")).toBeNull();
  });

  it("draws nothing for an ordinary post", async () => {
    const sendMessage = stubWorker(null);
    const { decorate } = await import("./post-card");
    document.body.innerHTML = `<article data-testid="tweet"><a href="/kol/status/3"><time>1h</time></a><div data-testid="tweetText">lunch was good</div></article>`;
    await decorate(document.querySelector("article") as HTMLElement);
    expect(document.querySelector(".kallr-host")).toBeNull();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "after-market" }));
  });
});

describe("plain swap by default", () => {
  it("starts with TP/SL off, so the order is a plain swap with the fewest steps", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { card, open: openPanel } = await mounted();
    openPanel();
    expect(q(card, ".exits").hidden).toBe(true);
    expect(q(card, ".exits-toggle").textContent).toBe("＋ Take-profit / stop-loss");
    const amount = q<HTMLInputElement>(card, ".swap-amount");
    amount.value = "1";
    amount.dispatchEvent(new Event("input"));
    expect(q(card, ".review").textContent).toContain("ExitsNone · plain swap");
    expect(q(card, ".review").textContent).toContain("Signed byYour Kall wallet, in Kall Markets");
    q<HTMLButtonElement>(card, ".swap-submit").click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(new URL(open.mock.calls[0]?.[0] as string).searchParams.get("order")).toBe("copy $1 of ETH");
  });
});
