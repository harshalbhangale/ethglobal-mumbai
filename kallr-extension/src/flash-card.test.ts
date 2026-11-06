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
  it("has the card layout: price header, the call and Follow, Copy button, Powered by footer", async () => {
    const { card } = await mounted();
    expect(q(card, ".swap-title strong").textContent).toBe("Ethereum");
    // Logos are inlined, so they survive extension reloads.
    expect(q(card, ".swap-icon").getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(q(card, ".caller-strip .caller-handle").textContent).toBe("@kol");
    // The call, how it moved since the post, and the caller's record so far.
    expect(q(card, ".caller-strip .caller-side").textContent).toBe("Long $ETH");
    expect(q(card, ".caller-strip .caller-move").textContent).toBe("+2.5% since post");
    expect(q(card, ".caller-strip .caller-facts").textContent).toContain("1 scored · 100% hit · +2.5% median");
    expect(q(card, ".caller-strip .x-follow").textContent).toBe("Follow");
    expect(card.querySelector(".call-insights")).toBeNull();
    // The call's own Arkiv record, when it has one.
    expect(card.querySelector(".caller-strip a.caller-arkiv[href*='arkiv']")).toBeNull();
    expect(q(card, ".inline-buy").textContent).toBe("⇄ Copy");
    expect(q(card, ".inline-panel").hidden).toBe(true);
    expect(q(card, ".swap-powered").textContent).toBe("Kall MarketsPowered byDEFINITIVE");
    expect(card.querySelector(".swap-powered .brand-mark-glyph")).not.toBeNull();
    expect(q(card, ".swap-powered .definitive-logo").getAttribute("aria-label")).toBe("Definitive");
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

  it("picks any token from search and orders it by contract address in MetaMask", async () => {
    const sendMessage = worker([DEGEN, FAKE]);
    const calls = fakeWallet({
      eth_requestAccounts: () => ["0x00000000000000000000000000000000000000a1"],
      eth_chainId: () => "0x2105",
      eth_signTypedData_v4: () => "0xa1",
    });
    sendMessage.mockImplementation(async (m: { type: string }): Promise<unknown> => {
      if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
      if (m.type === "token-search") return { tokens: [DEGEN, FAKE] };
      if (m.type === "x-status") return { kall: null, signer: "metamask" };
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
    await vi.waitFor(() => expect(made.card.textContent).toContain("Bought DEGEN with $1.00"));
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

describe("sign on X in MetaMask, when picked", () => {
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
      if (m.type === "x-status") return { kall: null, signer: "metamask" };
      if (m.type === "flash-quote") return { quote };
      if (m.type === "flash-order") return { orderId: "887ccf13-aaaa-bbbb-cccc-000000000000", attachedBracket: { status: "pending_activation" } };
      if (m.type === "flash-order-status")
        return { status: "ORDER_STATUS_FILLED", fills: [{ transactionId: `0x${"ab".repeat(32)}`, venues: ["uniswap_v3"] }] };
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
    await vi.waitFor(() => expect(card.textContent).toContain("Bought ETH with $25.00"));
    // The Definitive Flash receipt: quote, signed by MetaMask and sent are done; the fill follows.
    const rowStates = () => [...card.querySelectorAll<HTMLElement>(".flash-receipt .fr-row")].map((r) => r.className.replace("fr-row ", ""));
    expect(rowStates().slice(0, 3)).toEqual(["done", "done", "done"]);
    expect(q(card, '.fr-row[data-row="signed"]').textContent).toContain("Signed by MetaMask0x0000…00a1");
    expect(q(card, '.fr-row[data-row="sent"]').textContent).toContain("Order 887ccf13…0000");
    expect(open).not.toHaveBeenCalled();
    // The receipt asks Flash for the fill with the wallet that placed it (Flash needs the funder).
    await vi.waitFor(() =>
      expect(worker).toHaveBeenCalledWith(expect.objectContaining({ type: "flash-order-status", orderId: "887ccf13-aaaa-bbbb-cccc-000000000000", funder: from })),
    );
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
    expect(card.textContent).toContain("Arms on the first fill");
    // Receipt: Base badge, Basescan links for the wallet, its approval and (once filled) the swap.
    expect(q(card, ".network-badge").textContent).toBe("Base mainnet");
    const links = [...card.querySelectorAll<HTMLAnchorElement>(".receipt a")].map((a) => a.href);
    expect(links).toContain("https://basescan.org/tx/0xhash");
    await vi.waitFor(() => expect(q(card, ".receipt").textContent).toContain("Uniswap V3 · via Definitive"));
    expect(rowStates()).toEqual(["done", "done", "done", "done"]);
    expect(q<HTMLAnchorElement>(card, '.fr-row[data-row="filled"] a').href).toBe(`https://basescan.org/tx/0x${"ab".repeat(32)}`);
    // The rows sit under the success burst, inside the done card.
    const done = q(card, ".done-card");
    expect([...done.children].map((c) => c.className).slice(0, 3)).toEqual(["sb", "done-head", "flash-receipt"]);
    // Success burst: check, amount, asset and the TP/SL pair, then the swap on Basescan.
    const burst = q(card, ".sb");
    expect(burst.getAttribute("role")).toBe("status");
    expect(burst.querySelector(".sb-tick")).not.toBeNull();
    expect(burst.querySelectorAll(".sb-piece").length).toBeGreaterThan(8);
    expect(q(burst, ".sb-title").textContent).toBe("Order placed");
    expect(q(burst, ".sb-amount").textContent).toBe("$25.00 · Bought ETH");
    expect(q(burst, ".sb-tp").textContent).toBe("TP +10% · $2,750");
    expect(q(burst, ".sb-sl").textContent).toBe("SL −5% · $2,375");
    expect(q<HTMLAnchorElement>(burst, ".sb-link a").href).toBe(`https://basescan.org/tx/0x${"ab".repeat(32)}`);
  });

  it("stops cleanly when the user rejects in the wallet", async () => {
    const { card, worker } = await place({
      eth_requestAccounts: () => [from],
      eth_chainId: () => "0x2105",
      eth_sendTransaction: () => Promise.reject({ code: 4001, message: "User rejected the request." }),
    });
    await vi.waitFor(() => expect(card.textContent).toContain("Cancelled in your wallet. Nothing was sent."));
    expect(worker.mock.calls.some(([m]) => m.type === "flash-order")).toBe(false);
    expect(card.querySelector(".sb")).toBeNull();
  });
});

describe("sign on X with the Kall wallet, by default", () => {
  const KALL = "0x00000000000000000000000000000000000000c4";
  const signature = `0x${"ef".repeat(65)}`;

  it("places on Kall's server with no wallet prompt, even with MetaMask on the page, and shows the signature", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const calls = fakeWallet({ eth_requestAccounts: () => ["0x00000000000000000000000000000000000000a1"] });
    const worker = stubWorker();
    worker.mockImplementation(async (m: { type: string }): Promise<unknown> => {
      if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
      if (m.type === "x-status") return { kall: { address: KALL, expires: Date.now() + 86_400_000 }, signer: "kall" };
      if (m.type === "x-order")
        return {
          orderId: "99999999-aaaa-bbbb-cccc-000000000000",
          from: KALL,
          exits: null,
          txs: [{ label: "Approve", hash: `0x${"cd".repeat(32)}` }],
          signature,
          quote: { from: { amount: "5" }, to: { amount: "0.002" }, estimatedPriceImpact: "0.0003", fees: { estimatedFeeNotional: "0" } },
          // Uniswap's best pool would have given 0.4% less WETH for the same $5.
          uniswapOut: "0.001992",
        };
      if (m.type === "flash-order-status") return { status: "ORDER_STATUS_FILLED", fills: [{ transactionId: `0x${"ab".repeat(32)}`, venues: [] }] };
      if (m.type === "signer") return { kall: { address: KALL, expires: Date.now() + 86_400_000 }, signer: "metamask" };
      return null;
    });
    const { flashCard } = await import("./flash-card");
    const made = flashCard({ post, asset: "ETH", answer: answer() });
    document.body.append(made.card);
    await vi.waitFor(() => expect(made.card.querySelector(".swap-title b")?.textContent).toBe("$2,500"));
    made.open();
    const amount = q<HTMLInputElement>(made.card, ".swap-amount");
    amount.value = "5";
    amount.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(q(made.card, ".review").textContent).toContain("Signed byYour Kall wallet · no pop-up Use MetaMask"));
    q<HTMLButtonElement>(made.card, ".swap-submit").click();
    await vi.waitFor(() => expect(made.card.textContent).toContain("Bought ETH with $5.00"));

    const sent = worker.mock.calls.find(([m]) => m.type === "x-order")?.[0] as unknown as { order: Record<string, unknown>; caller: string };
    expect(sent.order).toMatchObject({ asset: "ETH", side: "buy", qty: "5", orderType: "market", funderAddress: KALL });
    expect(sent.caller).toBe("kol");
    // The Flash receipt shows what the server did: Flash's quote, the Kall wallet, the order ID, the fill.
    await vi.waitFor(() => expect(q(made.card, '.fr-row[data-row="filled"]').className).toBe("fr-row done"));
    expect(q(made.card, '.fr-row[data-row="quote"]').textContent).toBe("✓Quote from Definitive$2,500.00 · 0.40% more than Uniswap · no fee");
    expect(q(made.card, '.fr-row[data-row="signed"]').textContent).toBe("✓Signed by your Kall wallet0x0000…00c4");
    expect(q(made.card, '.fr-row[data-row="sent"]').textContent).toContain("Order 99999999…0000");
    // No wallet prompt and no desk: the server signed.
    expect(calls.map((c) => c.method)).not.toContain("eth_requestAccounts");
    expect(open).not.toHaveBeenCalled();
    const receiptText = q(made.card, ".receipt").textContent;
    expect(receiptText).toContain("Signature0xefef…efef");
    expect([...made.card.querySelectorAll<HTMLAnchorElement>(".receipt a")].map((a) => a.href)).toContain(`https://basescan.org/tx/0x${"cd".repeat(32)}`);

    // Switching to MetaMask is one click, and stays picked.
    q<HTMLButtonElement>(made.card, ".signer-switch").click();
    await vi.waitFor(() => expect(worker).toHaveBeenCalledWith(expect.objectContaining({ type: "signer", signer: "metamask" })));
  });

  it("shows the server's reason when the Kall wallet can't place it", async () => {
    stubWorker().mockImplementation(async (m: { type: string }): Promise<unknown> => {
      if (m.type === "prices") return { prices: [{ asset: "ETH", price: "2500", source: "chainlink-base" }] };
      if (m.type === "x-status") return { kall: { address: KALL, expires: Date.now() + 86_400_000 }, signer: "kall" };
      if (m.type === "x-order") return { failed: "Trades from X are up to $25 each. Use Kall Markets for more." };
      return null;
    });
    fakeWallet(null);
    const { flashCard } = await import("./flash-card");
    const made = flashCard({ post, asset: "ETH", answer: answer() });
    document.body.append(made.card);
    await vi.waitFor(() => expect(made.card.querySelector(".swap-title b")?.textContent).toBe("$2,500"));
    made.open();
    const amount = q<HTMLInputElement>(made.card, ".swap-amount");
    amount.value = "50";
    amount.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>(made.card, ".swap-submit").click();
    await vi.waitFor(() => expect(made.card.textContent).toContain("Trades from X are up to $25 each."));
    expect(made.card.querySelector(".sb")).toBeNull();
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
    expect(q(card, ".review").textContent).toContain("Signed byYour Kall wallet, in Kall Markets");
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

describe("flashCard caller strip", () => {
  it("links the call to its Arkiv record", async () => {
    const key = `0x${"c".repeat(64)}`;
    const { card } = await mounted({ ...answer(), arkivKey: key });
    expect(q(card, ".caller-strip a.caller-arkiv").getAttribute("href")).toBe(`https://rabdi.explorer.arkiv.network/entity/${key}`);
  });
});
