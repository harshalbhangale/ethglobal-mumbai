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
  const sendMessage = vi.fn(async (m: { type: string }) => {
    if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
    if (m.type === "after-market") return after;
    if (m.type === "watchlist") return { entries: [] };
    return null;
  });
  vi.stubGlobal("chrome", { runtime: { id: "x", sendMessage, getURL: (p: string) => `chrome-extension://t/${p}` } });
  return sendMessage;
}

beforeEach(() => vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "https://aftermarkets.test"));
afterEach(() => {
  document.body.innerHTML = "";
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
  it("has Xtrading's layout: price header, Call check strip, Copy button, Powered by footer", async () => {
    const { card } = await mounted();
    expect(q(card, ".swap-title strong").textContent).toBe("Ethereum");
    expect(q(card, ".swap-icon").getAttribute("src")).toBe("chrome-extension://t/brand/tokens/eth.png");
    expect(buttons(card, ".call-insights summary .ci-chip").map((c) => c.textContent)).toEqual([
      "Bullish ETH",
      "Creator record",
      "After market",
    ]);
    expect(q(card, ".inline-buy").textContent).toBe("⇄ Copy");
    expect(q(card, ".inline-panel").hidden).toBe(true);
    expect(q(card, ".swap-powered").textContent).toBe("Powered byAfterMarketsDefinitive Flash");
  });

  it("opens the Call check with the post as text, this call and the record", async () => {
    const { card } = await mounted({ ...answer(), call: { ...answer().call!, horizonStated: true } });
    const details = q<HTMLDetailsElement>(card, ".call-insights");
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    const text = details.textContent ?? "";
    expect(q(details, "blockquote").textContent).toBe(post.text);
    expect(text).toContain("24h (stated)");
    expect(text).toContain("Price at posting$2,400");
    expect(text).toContain("Detected calls");
    expect(q(details, ".recent-calls a").getAttribute("href")).toBe("https://x.com/kol/status/2");
  });

  it("copies a buy with TP/SL into the desk, sized in USD", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { card, open: openPanel } = await mounted();
    openPanel();
    const amount = q<HTMLInputElement>(card, ".swap-amount");
    amount.value = "25";
    amount.dispatchEvent(new Event("input"));
    expect(q(card, ".swap-out").textContent).toBe("≈ 0.01");
    expect(card.textContent).toContain("+10% · $2,750");
    expect(card.textContent).toContain("−5% · $2,375");
    expect(card.textContent).toContain("Definitive Flash · Base");
    const submit = q<HTMLButtonElement>(card, ".swap-submit");
    expect(submit.textContent).toBe("Buy ETH");
    submit.click();
    const url = new URL(open.mock.calls[0]?.[0] as string);
    expect(url.origin + url.pathname).toBe("https://aftermarkets.test/app");
    expect(url.searchParams.get("order")).toBe("copy $25 of ETH tp 10% sl 5%");
    expect(url.searchParams.get("post")).toBe("2");
    expect(url.searchParams.get("caller")).toBe("kol");
  });

  it("refuses a lone take-profit or stop-loss, since Flash places them as a pair", async () => {
    const { card, open } = await mounted();
    open();
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
    expect(new URL(open.mock.calls[0]?.[0] as string).searchParams.get("order")).toBe("sell $25.00 of ETH");
  });

  it("shows the record but no trade panel for assets Base can't trade", async () => {
    const { card } = await mounted(answer("up", "SOL"), "SOL", "price unavailable");
    expect(q(card, ".inline-buy").hidden).toBe(true);
    expect(card.querySelector(".inline-panel")).toBeNull();
    expect(card.textContent).toContain("$SOL isn't tradable on Base yet");
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
    const hosts = el.querySelectorAll<HTMLElement>(".aftermarkets-host");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.previousElementSibling?.getAttribute("data-testid")).toBe("tweetText");
    const card = hosts[0]?.shadowRoot?.querySelector(".swap-card") as HTMLElement;
    expect(q(card, ".inline-panel").hidden).toBe(true);
    (el.querySelector(".aftermarkets-xbuy") as HTMLElement).click();
    expect(q(card, ".inline-panel").hidden).toBe(false);
  });

  it("attaches a hidden card under X's ticker when the post isn't a call", async () => {
    const sendMessage = stubWorker(null);
    const { decorate } = await import("./post-card");
    document.body.innerHTML = article("gm, charts look interesting");
    const el = document.querySelector("article") as HTMLElement;
    await decorate(el);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "after-market" }));
    const host = el.querySelector<HTMLElement>(".aftermarkets-host");
    expect(host?.previousElementSibling?.querySelector("nav")).not.toBeNull();
    const card = host?.shadowRoot?.querySelector(".swap-card") as HTMLElement;
    expect(card.hidden).toBe(true);
    (el.querySelector(".aftermarkets-xbuy") as HTMLElement).click();
    expect(card.hidden).toBe(false);
    expect(card.querySelector(".call-insights")).toBeNull();
  });

  it("draws nothing for an ordinary post", async () => {
    const sendMessage = stubWorker(null);
    const { decorate } = await import("./post-card");
    document.body.innerHTML = `<article data-testid="tweet"><a href="/kol/status/3"><time>1h</time></a><div data-testid="tweetText">lunch was good</div></article>`;
    await decorate(document.querySelector("article") as HTMLElement);
    expect(document.querySelector(".aftermarkets-host")).toBeNull();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "after-market" }));
  });
});
