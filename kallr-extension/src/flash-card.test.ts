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

/**
 * Stands in for wallet-bridge.ts in X's page: answers the content script's wallet requests.
 * `wallet: null` means no MetaMask / Rabby installed.
 */
type WalletImpl = Record<string, (params: unknown[]) => unknown>;
let walletListener: ((e: MessageEvent) => void) | null = null;
function fakeWallet(wallet: WalletImpl | null) {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  walletListener = (event: MessageEvent) => {
    const d = event.data as { type?: string; id?: string; method?: string; params?: unknown[] };
    if (d?.type !== "kallr-wallet-request" || !d.id || !d.method) return;
    calls.push({ method: d.method, params: d.params ?? [] });
    const reply = (body: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "kallr-wallet-response", id: d.id, ...body }, origin: location.origin, source: window }),
      );
    if (d.method === "kallr_ping") return void queueMicrotask(() => reply({ result: wallet !== null }));
    const impl = wallet?.[d.method];
    queueMicrotask(() =>
      impl ? Promise.resolve(impl(d.params ?? [])).then((result) => reply({ result }), (e) => reply({ error: e })) : reply({ error: { code: 4200, message: "nope" } }),
    );
  };
  window.addEventListener("message", walletListener);
  // happy-dom's postMessage doesn't set source/origin; route requests straight to the fake bridge.
  vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => walletListener?.({ data } as MessageEvent));
  return calls;
}

beforeEach(() => vi.stubGlobal("KALLR_APP_ORIGIN", "https://kallr.test"));
afterEach(() => {
  document.body.innerHTML = "";
  if (walletListener) window.removeEventListener("message", walletListener);
  walletListener = null;
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
  it("has the card layout: price header, Call check strip, Copy button, Powered by footer", async () => {
    const { card } = await mounted();
    expect(q(card, ".swap-title strong").textContent).toBe("Ethereum");
    // Logos are inlined, so they survive extension reloads.
    expect(q(card, ".swap-icon").getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(q(card, ".caller-strip .caller-handle").textContent).toBe("@kol");
    expect(q(card, ".caller-strip .caller-record").textContent).toBe("1/1 calls moved their way · this call +2.5%");
    expect(q(card, ".caller-strip .x-follow").textContent).toBe("Follow");
    expect(buttons(card, ".call-insights summary .ci-chip").map((c) => c.textContent)).toEqual([
      "Bullish ETH",
      "Creator record",
      "After market",
    ]);
    expect(q(card, ".inline-buy").textContent).toBe("⇄ Copy");
    expect(q(card, ".inline-panel").hidden).toBe(true);
    expect(q(card, ".swap-powered").textContent).toBe("Powered byDEFINITIVE");
    expect(q(card, ".swap-powered .definitive-logo").getAttribute("aria-label")).toBe("Definitive");
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
    fakeWallet(null);
    const { card, open: openPanel } = await mounted();
    openPanel();
    q<HTMLButtonElement>(card, ".exits-toggle").click();
    const amount = q<HTMLInputElement>(card, ".swap-amount");
    amount.value = "25";
    amount.dispatchEvent(new Event("input"));
    expect(q(card, ".swap-out").textContent).toBe("≈ 0.01");
    expect(card.textContent).toContain("+10% · $2,750");
    expect(card.textContent).toContain("−5% · $2,375");
    expect(q(card, ".review").textContent).toContain("RouteDefinitive Flash · MEV-protected");
    expect(q(card, ".review").textContent).toContain("ExitsTP $2,750 · SL $2,375");
    expect(q(card, ".swap-submit").textContent).toBe("Buy ETH · $25.00");
    const submit = q<HTMLButtonElement>(card, ".swap-submit");
    expect(submit.textContent).toBe("Buy ETH · $25.00");
    submit.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(card.textContent).toContain("No browser wallet here");
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
    fakeWallet(null);
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

  it("picks any token from search and orders it by contract address", async () => {
    const sendMessage = worker([DEGEN, FAKE]);
    const calls = fakeWallet({
      eth_requestAccounts: () => ["0x00000000000000000000000000000000000000a1"],
      eth_chainId: () => "0x2105",
      eth_signTypedData_v4: () => "0xa1",
    });
    sendMessage.mockImplementation(async (m: { type: string }): Promise<unknown> => {
      if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
      if (m.type === "token-search") return { tokens: [DEGEN, FAKE] };
      if (m.type === "flash-quote") return { quote: { quoteId: "q", from: { amount: "1" }, to: { amount: "1124" }, evm: { approveTx: null, permitTypedData: "", orderTypedData: "{}" } } };
      if (m.type === "flash-order") return { orderId: "11111111-2222-3333-4444-555555555555" };
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
    await vi.waitFor(() => expect(made.card.textContent).toContain("Bought DEGEN with $1.00 ✓"));
    const quoted = sendMessage.mock.calls.find(([m]) => m.type === "flash-quote")?.[0] as unknown as { order: Record<string, unknown> };
    expect(quoted.order.asset).toBe(DEGEN.address);
    expect(calls.map((c) => c.method)).toContain("eth_signTypedData_v4");
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

describe("sign on X with a browser wallet", () => {
  const typed = (name: string) => JSON.stringify({ primaryType: name, domain: { chainId: "8453" }, types: {}, message: {} });
  const quote = {
    quoteId: "q1",
    from: { amount: "25" },
    to: { amount: "0.0099" },
    evm: { approveTx: { to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0x095ea7b3" }, permitTypedData: "", orderTypedData: typed("FlashOrder") },
    attachedBracket: {
      evm: { approveTx: null, permitTypedData: null, orderTypedData: typed("Bracket") },
      salt: "0x1",
      deadline: "281474976710655",
      signedMaxFromAmount: "0.0104",
    },
  };
  const from = "0x00000000000000000000000000000000000000a1";

  async function place(wallet: WalletImpl) {
    const calls = fakeWallet(wallet);
    const worker = stubWorker();
    worker.mockImplementation(async (m: { type: string }): Promise<unknown> => {
      if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
      if (m.type === "flash-quote") return { quote };
      if (m.type === "flash-order") return { orderId: "887ccf13-aaaa-bbbb-cccc-000000000000", attachedBracket: { status: "pending_activation" } };
      return null;
    });
    const { flashCard } = await import("./flash-card");
    const made = flashCard({ post, asset: "ETH", answer: answer() });
    document.body.append(made.card);
    await vi.waitFor(() => expect(made.card.querySelector(".swap-title b")?.textContent).toBe("$2,500"));
    made.open();
    q<HTMLButtonElement>(made.card, ".exits-toggle").click();
    const amount = q<HTMLInputElement>(made.card, ".swap-amount");
    amount.value = "25";
    amount.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>(made.card, ".swap-submit").click();
    return { card: made.card, calls, worker };
  }

  it("connects, switches to Base, approves, signs order and exits, then submits", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    let chain = "0x1";
    const { card, calls, worker } = await place({
      eth_requestAccounts: () => [from],
      eth_chainId: () => chain,
      wallet_switchEthereumChain: () => {
        chain = "0x2105";
        return null;
      },
      eth_sendTransaction: () => "0xhash",
      eth_getTransactionReceipt: () => ({ status: "0x1" }),
      eth_signTypedData_v4: (p) => (String(p[1]).includes("Bracket") ? "0xb2" : "0xa1"),
    });
    await vi.waitFor(() => expect(card.textContent).toContain("Bought ETH with $25.00 ✓"));
    expect([...card.querySelectorAll(".steps .step")].map((s) => s.className)).toEqual(Array(6).fill("step done"));
    expect(open).not.toHaveBeenCalled();
    expect(calls.map((c) => c.method)).toEqual([
      "kallr_ping",
      "eth_requestAccounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_sendTransaction",
      "eth_getTransactionReceipt",
      "eth_signTypedData_v4",
      "eth_signTypedData_v4",
    ]);
    const quoted = worker.mock.calls.find(([m]) => m.type === "flash-quote")?.[0] as unknown as { order: Record<string, unknown> };
    expect(quoted.order).toEqual({
      asset: "ETH",
      side: "buy",
      qty: "25",
      orderType: "market",
      funderAddress: from,
      takeProfit: { notionalPrice: "2750" },
      stopLoss: { notionalPrice: "2375" },
      sourcePostId: "2",
    });
    const submitted = worker.mock.calls.find(([m]) => m.type === "flash-order")?.[0] as unknown as { signatures: Record<string, unknown> };
    expect(submitted.signatures).toEqual({
      quoteId: "q1",
      userSignature: "0xa1",
      evmOrderTypedData: quote.evm.orderTypedData,
      bracket: { userSignature: "0xb2", salt: "0x1", deadline: "281474976710655", signedMaxFromAmount: "0.0104" },
    });
    expect(q(card, ".swap-wallet").textContent).toBe("0x0000…00a1");
    expect(card.textContent).toContain("TP/SL arm on the first fill");
  });

  it("stops cleanly when the user rejects in the wallet", async () => {
    const { card, worker } = await place({
      eth_requestAccounts: () => [from],
      eth_chainId: () => "0x2105",
      eth_sendTransaction: () => Promise.reject({ code: 4001, message: "User rejected the request." }),
    });
    await vi.waitFor(() => expect(card.textContent).toContain("Cancelled in your wallet. Nothing was sent."));
    expect(worker.mock.calls.some(([m]) => m.type === "flash-order")).toBe(false);
  });
});

describe("plain swap by default", () => {
  it("starts with TP/SL off, so the order is a plain swap with the fewest steps", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    fakeWallet(null);
    const { card, open: openPanel } = await mounted();
    openPanel();
    expect(q(card, ".exits").hidden).toBe(true);
    expect(q(card, ".exits-toggle").textContent).toBe("＋ Take-profit / stop-loss");
    const amount = q<HTMLInputElement>(card, ".swap-amount");
    amount.value = "1";
    amount.dispatchEvent(new Event("input"));
    expect(q(card, ".review").textContent).toContain("ExitsNone · plain swap");
    expect(q(card, ".review").textContent).toContain("StepsApprove once (first time), sign once");
    q<HTMLButtonElement>(card, ".swap-submit").click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(new URL(open.mock.calls[0]?.[0] as string).searchParams.get("order")).toBe("copy $1 of ETH");
  });

  it("explains a missing balance in plain words", async () => {
    stubWorker();
    const { friendlyError } = await import("./flash-card");
    expect(friendlyError(new Error("REASON_INSUFFICIENT_FUNDER_BALANCE"), "USDC")).toBe(
      "Not enough USDC in this wallet on Base. Add USDC (and a little ETH for gas), then try again.",
    );
    expect(friendlyError({ code: 4001, message: "User rejected the request." }, "USDC")).toBe("Cancelled in your wallet. Nothing was sent.");
  });
});
