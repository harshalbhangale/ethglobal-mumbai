import { callInsights } from "./call-insights";
import type { Answer, PostRef } from "./call-view";
import { formatBps } from "./card-metrics";
import { appOrigin } from "./config";
import { el, openDesk, safeLink } from "./dom";
import { BASESCAN, placeOnX, type QuoteFacts, type Step, waitForFill } from "./flash-direct";
import { followButton } from "./follows";
import { definitiveLogo, tokenIcon } from "./logos";
import { cardOrderText, COPYABLE, DECIMAL, deskOrderUrl } from "./post";
import { ALIASES, formatPrice, type LivePrice, livePrice } from "./ticker-price";
import { type Choice, choiceIcon, plainPrice, searchTokens, tokenPicker } from "./token-picker";
import { hasBrowserWallet, rejected } from "./wallet";

export { tokenIcon } from "./logos";

/**
 * The post card: live price header, the caller strip (record + Follow), the Call receipt strip, then
 * the trade flow. Trades on Base through Definitive Flash with take-profit / stop-loss attached as
 * one bracket. With MetaMask / Rabby on the page every step is signed right here, with a step
 * tracker; otherwise the Kall Markets desk opens to sign with the Privy wallet.
 */

const NAMES: Record<string, string> = { ETH: "Ethereum", BTC: "Bitcoin" };
/** Token actually traded on Base: brackets need an ERC-20, so ETH trades as WETH. */
const TOKENS: Record<string, string> = { ETH: "WETH", BTC: "cbBTC" };
export const TP_CHOICES = [5, 10, 20, 50] as const;
export const SL_CHOICES = [3, 5, 10, 20] as const;
export const AMOUNT_PRESETS = [0.5, 1, 5, 10] as const;
/**
 * Smallest order worth sending. Flash quotes refuse ~$0.01 ("fees would exceed output"); $0.10
 * quotes but returns ~$0.08; from ~$0.50 the fill is close to the amount. Checked 5 Nov 2026.
 */
export const MIN_SENSIBLE_USD = 0.5;
/** A cashtag only maps to a Base token with at least this much liquidity (and no risk flag). */
export const MIN_LIQUIDITY_USD = 50_000;

const money = (value: number) =>
  Number.isFinite(value) ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "";

/** Every step placeOnX can report, in order. Approvals and the TP/SL signature appear only when they happen. */
const TRACK: Array<{ step: Step; label: string; optional?: boolean }> = [
  { step: "connecting", label: "Connect wallet · Base" },
  { step: "quoting", label: "Get a Flash quote" },
  { step: "wrapping", label: "Wrap ETH to WETH", optional: true },
  { step: "approving", label: "Approve USDC (sized to this order)", optional: true },
  { step: "approving-exits", label: "Approve the TP/SL exit", optional: true },
  { step: "signing", label: "Sign the order" },
  { step: "signing-exits", label: "Sign the TP/SL", optional: true },
  { step: "submitting", label: "Place on Base" },
];

/** The live step list: done ✓, current ●, upcoming ○; optional steps show only once reached. */
export function stepTracker() {
  const list = el("ol", { class: "steps", "aria-live": "polite" });
  const reached = new Set<Step>();
  let current: Step | null = null;
  let failed = false;
  let failMessage = "";
  const render = () => {
    const order = TRACK.filter((t) => !t.optional || reached.has(t.step));
    const at = current ? order.findIndex((t) => t.step === current) : -1;
    list.replaceChildren(
      ...order.map((t, i) => {
        const state = i < at ? "done" : i === at ? (failed ? "failed" : "active") : "todo";
        return el(
          "li",
          { class: `step ${state}` },
          el("span", { class: "step-dot", "aria-hidden": "true" }, state === "done" ? "✓" : state === "failed" ? "!" : ""),
          el("span", {}, t.label, state === "failed" && failMessage ? el("small", { class: "step-error" }, failMessage) : null),
        );
      }),
    );
  };
  render();
  return {
    root: list,
    to(step: Step) {
      reached.add(step);
      current = step;
      failed = false;
      render();
    },
    /** Marks the current step failed and says why, right under it. */
    fail(message = "") {
      failed = true;
      failMessage = message;
      render();
    },
    finish() {
      current = null;
      list.replaceChildren(
        ...TRACK.filter((t) => !t.optional || reached.has(t.step)).map((t) =>
          el("li", { class: "step done" }, el("span", { class: "step-dot", "aria-hidden": "true" }, "✓"), el("span", {}, t.label)),
        ),
      );
    },
  };
}

/** Turns wallet and Flash errors into one plain sentence the user can act on. */
export function friendlyError(error: unknown, spending: string) {
  if (rejected(error)) return "Cancelled in your wallet. Nothing was sent.";
  const msg = (error as Error)?.message ?? String(error);
  if (/insufficient|balance|exceeds balance|not enough/i.test(msg))
    return `Not enough ${spending} in this wallet on Base. Add ${spending} (and a little ETH for gas), then try again.`;
  if (/too small|fees would exceed|minimum notional/i.test(msg)) return "Too small for Flash: fees would eat it. Try $0.50 or more.";
  if (/gas|intrinsic|funds for/i.test(msg)) return "Not enough ETH on Base for gas. Add about $0.10 of ETH.";
  return msg || "The order didn't go through.";
}

export type FlashCard = { card: HTMLElement; open: () => void };

export function flashCard(input: {
  post: PostRef & { text: string };
  asset: string;
  article?: HTMLElement;
  answer: Answer | null;
  /** Under X's own ticker card: X already shows the header, so start hidden. */
  attached?: boolean;
}): FlashCard {
  const { post } = input;
  // What's traded: ETH / BTC built-ins, or any Base token picked from search (or found for a cashtag).
  let choice: Choice | null = COPYABLE.has(input.asset) ? { kind: "known", key: input.asset as "ETH" | "BTC" } : null;
  const sym = () => (choice?.kind === "token" ? choice.token.symbol : choice?.kind === "known" ? choice.key : input.asset);
  /** The token actually moved on Base: WETH for ETH, cbBTC for BTC, else the token itself. */
  const tokenSym = () => (choice?.kind === "token" ? choice.token.symbol : (TOKENS[sym()] ?? sym()));
  const nameOf = () => (choice?.kind === "token" ? choice.token.name : (NAMES[sym()] ?? sym()));
  let tradable = choice !== null;
  const call = input.answer?.call ?? null;
  let side: "buy" | "sell" = call?.direction === "down" ? "sell" : "buy";
  // TP/SL is an opt-in extra: off by default keeps a first trade to approve once, sign once.
  let tp: number | null = null;
  let sl: number | null = null;
  let advanced = false;
  let live: LivePrice | null = null;
  let walletOnPage: boolean | null = null;
  void hasBrowserWallet().then((v) => {
    walletOnPage = v;
    if (!panel.hidden) update();
  });

  const card = el("section", {
    class: `inline-card swap-card${input.attached ? " inline-attached" : ""}`,
    "aria-label": `Trade ${input.asset} with Kall Markets`,
  });
  const priceText = el("b", {}, "…");
  const changeText = el("em", {});
  const buy = el("button", { type: "button", class: "inline-buy", "aria-expanded": "false" }, "⇄ Copy");
  const close = el("button", { type: "button", class: "inline-close", hidden: "", "aria-label": "Close" }, "✕ Close");
  if (!tradable) buy.hidden = true;

  // --- caller strip: who made the call, their record at a glance, and Follow ---
  const callerStrip = (() => {
    const calls = input.answer?.calls ?? [];
    const scored = calls.filter((c) => c.status === "hit" || c.status === "miss" || c.status === "flat");
    const hits = scored.filter((c) => c.status === "hit").length;
    const summary = scored.length
      ? `${hits}/${scored.length} calls moved their way`
      : calls.length
        ? `${calls.length} call${calls.length === 1 ? "" : "s"} seen · none scored yet`
        : "New caller on Kall Markets";
    const thisMove =
      call?.returnBps != null
        ? el("span", { class: call.returnBps >= 0 ? "up" : "down" }, ` · this call ${formatBps(call.returnBps)}`)
        : null;
    const follow = followButton(post.handle, (label) => el("button", { type: "button", class: "x-follow" }, label) as HTMLButtonElement);
    return el(
      "div",
      { class: "caller-strip" },
      el(
        "div",
        { class: "caller-id" },
        safeLink(`https://x.com/${post.handle}`, `@${post.handle}`, "caller-handle"),
        el("span", { class: "caller-record" }, summary, thisMove),
      ),
      follow,
    );
  })();

  // --- trade panel ---
  const panel = el("div", { class: "inline-panel", hidden: "" });
  const sides = el("div", { class: "inline-sides seg", role: "group", "aria-label": "Side" });
  const amount = el("input", {
    class: "inline-amount swap-amount",
    inputmode: "decimal",
    placeholder: "0",
    maxlength: "20",
    autocomplete: "off",
    "aria-label": "You pay",
  }) as HTMLInputElement;
  const payLabel = el("span", { class: "swap-label" }, "You pay");
  const payUsd = el("span", { class: "swap-usd" });
  const payToken = el("span", {});
  const presets = el("div", { class: "amount-presets", role: "group", "aria-label": "Amount" });
  const receiveAmount = el("strong", { class: "inline-output swap-out" }, "0");
  const receiveUsd = el("span", { class: "swap-usd" });
  const receiveToken = el("span", {});
  const tpText = el("b", {});
  const slText = el("b", {});
  const tpChips = el("div", { class: "exit-chips tp", role: "group", "aria-label": "Take-profit" });
  const slChips = el("div", { class: "exit-chips sl", role: "group", "aria-label": "Stop-loss" });
  const exitsToggle = el("button", { type: "button", class: "exits-toggle", "aria-expanded": "false" }, "＋ Take-profit / stop-loss");
  const exits = el(
    "div",
    { class: "exits", hidden: "" },
    el("div", { class: "exit-row" }, el("span", {}, "Take-profit ", tpText), tpChips),
    el("div", { class: "exit-row" }, el("span", {}, "Stop-loss ", slText), slChips),
  );
  const review = el("dl", { class: "review" });
  const walletChip = el("span", { class: "swap-wallet", hidden: "" });
  const status = el("p", { class: "inline-note", role: "status", "aria-live": "polite" });
  const submit = el("button", { type: "button", class: "inline-submit swap-submit", disabled: "" }, `Buy ${sym()}`);
  const progress = el("div", { class: "progress", hidden: "" });

  const pill = (symbol: string) => el("span", { class: "swap-pill" }, tokenIcon(symbol, 22), symbol);
  /** The traded token's pill is a button: it opens the token picker. */
  const pickPill = (label: string) => {
    const b = el(
      "button",
      { type: "button", class: "swap-pill pick-token", "aria-label": `Change token (now ${label})` },
      choice ? choiceIcon(choice, 22) : tokenIcon(label, 22),
      label,
      el("span", { class: "pick-caret", "aria-hidden": "true" }, "▾"),
    );
    b.addEventListener("click", (e) => {
      e.preventDefault();
      openPicker();
    });
    return b;
  };

  for (const value of ["buy", "sell"] as const) {
    const button = el("button", { type: "button", "aria-pressed": String(value === side) }, value === "buy" ? "Buy" : "Sell");
    button.addEventListener("click", () => {
      side = value;
      for (const b of sides.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
      amount.value = "";
      update();
    });
    sides.append(button);
  }

  for (const usd of AMOUNT_PRESETS) {
    const b = el("button", { type: "button" }, `$${usd}`);
    b.addEventListener("click", () => {
      // On a sell the box takes the asset amount: convert the dollar preset at the live price.
      const p = price();
      amount.value = side === "buy" ? String(usd) : Number.isFinite(p) ? String(Math.floor((usd / p) * 1e8) / 1e8) : "";
      update();
    });
    presets.append(b);
  }

  function chips(target: HTMLElement, choices: readonly number[], get: () => number | null, set: (v: number | null) => void) {
    for (const value of [...choices, null]) {
      const b = el("button", { type: "button", "aria-pressed": String(get() === value) }, value === null ? "None" : `${value}%`);
      b.addEventListener("click", () => {
        set(value);
        for (const other of target.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === b));
        update();
      });
      target.append(b);
    }
  }
  chips(tpChips, TP_CHOICES, () => tp, (v) => (tp = v));
  chips(slChips, SL_CHOICES, () => sl, (v) => (sl = v));
  const syncChips = () => {
    for (const [box, v] of [[tpChips, tp], [slChips, sl]] as const)
      for (const b of box.querySelectorAll("button"))
        b.setAttribute("aria-pressed", String(b.textContent === (v === null ? "None" : `${v}%`)));
  };
  exitsToggle.addEventListener("click", () => {
    advanced = !advanced;
    // Opening suggests 10% / 5%; closing removes the exits entirely.
    tp = advanced ? 10 : null;
    sl = advanced ? 5 : null;
    syncChips();
    update();
  });

  const price = () => (live ? Number(live.price) : Number.NaN);

  /** USD value of what's typed: dollars on a buy, token amount × price on a sell. */
  function usdValue(): number | null {
    if (!DECIMAL.test(amount.value) || !(Number(amount.value) > 0)) return null;
    const v = Number(amount.value);
    return side === "buy" ? v : v * price();
  }

  const row = (k: string, v: Node | string) => [el("dt", {}, k), el("dd", {}, v)];

  function update() {
    payLabel.textContent = side === "buy" ? "You pay" : "You sell";
    payToken.replaceChildren(side === "buy" ? pill("USDC") : pickPill(sym() === "ETH" && choice?.kind === "known" ? "ETH" : tokenSym()));
    receiveToken.replaceChildren(side === "buy" ? pickPill(tokenSym()) : pill("USDC"));
    exitsToggle.hidden = side === "sell";
    exits.hidden = side === "sell" || !advanced;
    exitsToggle.setAttribute("aria-expanded", String(advanced));
    exitsToggle.textContent = advanced ? "− Remove take-profit / stop-loss" : "＋ Take-profit / stop-loss";
    const p = price();
    const exitPrice = (pct: number, dir: 1 | -1) => formatPrice(String(p * (1 + (dir * pct) / 100)));
    const fmt = (pct: number | null, dir: 1 | -1) =>
      pct === null ? "off" : Number.isFinite(p) ? `${dir > 0 ? "+" : "−"}${pct}% · ${exitPrice(pct, dir)}` : `${pct}%`;
    tpText.textContent = fmt(tp, 1);
    slText.textContent = fmt(sl, -1);

    const value = Number(amount.value);
    const ok = DECIMAL.test(amount.value) && value > 0;
    const usd = usdValue();
    if (ok && Number.isFinite(p)) {
      const out = side === "buy" ? value / p : value * p;
      receiveAmount.textContent = `≈ ${out.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`;
      payUsd.textContent = money(side === "buy" ? value : value * p);
      receiveUsd.textContent = money(side === "buy" ? value : out);
    } else {
      receiveAmount.textContent = "0";
      payUsd.textContent = receiveUsd.textContent = "";
    }
    for (const b of presets.querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(side === "buy" && amount.value === b.textContent?.slice(1)));

    // Review: everything the order will do, before any wallet prompt.
    const withExits = side === "buy" && tp !== null && sl !== null;
    review.replaceChildren(
      ...row("Rate", Number.isFinite(p) ? `1 ${sym()} ≈ ${formatPrice(live?.price ?? "0").slice(1)} USDC` : "Price unavailable"),
      ...(choice?.kind === "token" ? row("Contract", `${choice.token.address.slice(0, 6)}…${choice.token.address.slice(-4)}`) : []),
      ...(withExits && Number.isFinite(p)
        ? row("Exits", el("span", {}, el("span", { class: "up" }, `TP ${exitPrice(tp as number, 1)}`), " · ", el("span", { class: "down" }, `SL ${exitPrice(sl as number, -1)}`)))
        : side === "buy"
          ? row("Exits", "None · plain swap")
          : []),
      ...row("Steps", withExits ? "Approve twice, sign twice (first time)" : "Approve once (first time), sign once"),
      ...row("Route", "Best route by Definitive · MEV-protected"),
      ...row("Network", "Base mainnet · real funds"),
      ...row("Sign in", walletOnPage === false ? "Kall Markets desk (Privy wallet)" : "Your browser wallet"),
    );

    const pairBroken = side === "buy" && (tp === null) !== (sl === null);
    if (pairBroken) status.textContent = "Flash places take-profit and stop-loss as a pair: set both, or neither.";
    else if (amount.value && !ok) status.textContent = "Enter a positive amount.";
    else if (usd !== null && usd < MIN_SENSIBLE_USD)
      status.textContent = `Under $${MIN_SENSIBLE_USD}, fees eat most of the order and Flash may refuse it. $0.50–$1 is the cheapest real test.`;
    else status.textContent = "";
    const ready = ok && !pairBroken && usd !== null && Number.isFinite(usd);
    submit.textContent = `${side === "buy" ? "Buy" : "Sell"} ${sym()}${ready && usd !== null ? ` · ${money(usd)}` : ""}`;
    if (ready) submit.removeAttribute("disabled");
    else submit.setAttribute("disabled", "");
  }

  async function refreshPrice() {
    if (choice?.kind === "token") {
      // Any other token: Flash's price for this exact contract.
      const fresh = (await searchTokens(choice.token.address)).find((t) => t.address.toLowerCase() === (choice as { token: { address: string } }).token.address.toLowerCase());
      if (fresh && choice?.kind === "token") choice = { kind: "token", token: fresh };
      const price = plainPrice(choice?.kind === "token" ? choice.token.price : null);
      const change = choice?.kind === "token" && choice.token.change24h !== null ? String(Number(choice.token.change24h) * 100) : null;
      live = price ? { price, change24hPct: change, source: "flash" } : null;
    } else live = await livePrice(input.article ?? document.body, sym(), ALIASES[sym() as keyof typeof ALIASES] ?? []);
    if (!live) {
      priceText.textContent = "price unavailable";
      changeText.textContent = "";
    } else {
      priceText.textContent = formatPrice(live.price);
      const change = live.change24hPct === null ? null : Number(live.change24hPct);
      changeText.textContent = change === null || !Number.isFinite(change) ? "" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)}%`;
      changeText.className = change !== null && change < 0 ? "down" : "up";
    }
    if (!panel.hidden) update();
  }
  void refreshPrice();
  const priceTimer = setInterval(() => {
    if (card.dataset.mounted && !card.isConnected) clearInterval(priceTimer);
    else void refreshPrice();
  }, 30_000);

  amount.addEventListener("input", update);

  let busy = false;
  /** With MetaMask / Rabby on the page: quote, approve, sign and submit right here on X. */
  async function placeHere() {
    busy = true;
    submit.setAttribute("disabled", "");
    const tracker = stepTracker();
    progress.replaceChildren(tracker.root);
    progress.hidden = false;
    review.hidden = true;
    status.textContent = "";
    const spent = side === "buy" ? money(Number(amount.value)) : `${amount.value} ${tokenSym()}`;
    try {
      const result = await placeOnX(
        {
          asset: choice?.kind === "token" ? choice.token.address : (sym() as "ETH" | "BTC"),
          decimals: choice?.kind === "token" ? choice.token.decimals : undefined,
          side,
          amount: amount.value,
          tpPct: side === "buy" ? tp : null,
          slPct: side === "buy" ? sl : null,
          price: price(),
          postId: post.postId,
          caller: post.handle,
          // Selling ETH spends the wallet's native ETH: most wallets hold ETH, not WETH.
          native: side === "sell" && choice?.kind === "known" && choice.key === "ETH",
        },
        (step) => tracker.to(step),
        (facts) => progress.prepend(quoteSummary(facts, side === "buy" ? tokenSym() : "USDC")),
      );
      tracker.finish();
      walletChip.textContent = `${result.from.slice(0, 6)}…${result.from.slice(-4)}`;
      walletChip.hidden = false;
      progress.append(
        receipt({
          title: `${side === "buy" ? "Bought" : "Sold"} ${sym()} with ${spent} ✓`,
          exits: result.exits,
          orderId: result.orderId,
          from: result.from,
          txs: result.txs,
        }),
      );
      amount.value = "";
    } catch (error) {
      const message = friendlyError(error, side === "buy" ? "USDC" : choice?.kind === "known" && choice.key === "ETH" ? "ETH" : tokenSym());
      tracker.fail(message);
      status.textContent = message;
    } finally {
      busy = false;
      review.hidden = false;
      const keep = [...status.childNodes];
      update();
      // update() rewrites the hint; keep the result line the user needs to see.
      if (keep.length) status.replaceChildren(...keep);
    }
  }

  submit.addEventListener("click", async () => {
    if (busy) return;
    const usd = usdValue();
    if (usd === null || !Number.isFinite(usd)) return;
    if (await hasBrowserWallet()) return placeHere();
    if (choice?.kind === "token") {
      // The desk's typed orders only know ETH and BTC; other tokens trade with a wallet on the page.
      status.textContent = `Trading ${sym()} needs MetaMask or Rabby in this browser.`;
      return;
    }
    const text = cardOrderText({
      side,
      asset: sym(),
      usd: side === "buy" ? amount.value : usd.toFixed(2),
      tpPct: side === "buy" ? tp : null,
      slPct: side === "buy" ? sl : null,
    });
    if (!text) return;
    const url = deskOrderUrl(appOrigin, text, post);
    openDesk(url);
    status.replaceChildren("No browser wallet here: review the quote and sign in the Kall Markets desk. ", safeLink(url, "Open desk ↗"));
  });

  // --- token picker, shown over the trade panel ---
  const pickerSlot = el("div", { class: "picker-slot", hidden: "" });
  function closePicker() {
    pickerSlot.hidden = true;
    pickerSlot.replaceChildren();
  }
  function openPicker(query = "") {
    const picker = tokenPicker((next) => {
      choice = next;
      tradable = true;
      amount.value = "";
      closePicker();
      renderHead();
      live = null;
      void refreshPrice();
      untradable.hidden = true;
      update();
    }, closePicker, query);
    pickerSlot.replaceChildren(picker.root);
    pickerSlot.hidden = false;
    picker.focus();
  }

  panel.append(
    pickerSlot,
    el(
      "div",
      { class: "swap-row" },
      sides,
      el("span", { class: "swap-row-end" }, walletChip, el("span", { class: "swap-chain-pill" }, el("span", { class: "swap-chain", "aria-hidden": "true" }), "Base")),
    ),
    el(
      "label",
      { class: "swap-box swap-pay" },
      payLabel,
      el("div", { class: "swap-line" }, amount, payToken),
      el("div", { class: "swap-line" }, payUsd, presets),
    ),
    el("span", { class: "swap-arrow", "aria-hidden": "true" }, "↓"),
    el(
      "div",
      { class: "swap-box" },
      el("span", { class: "swap-label" }, "You receive"),
      el("div", { class: "swap-line" }, receiveAmount, receiveToken),
      receiveUsd,
    ),
    exitsToggle,
    exits,
    review,
    progress,
    status,
    submit,
  );

  const footer = el(
    "footer",
    { class: "swap-footer" },
    el(
      "span",
      { class: "swap-powered" },
      "Powered by",
      definitiveLogo(11),
    ),
    safeLink(`https://x.com/${post.handle}`, `@${post.handle} on X ↗`),
  );

  function toggle(open: boolean) {
    panel.hidden = !open;
    if (input.attached) card.hidden = !open;
    buy.hidden = open || !tradable;
    close.hidden = !open;
    buy.setAttribute("aria-expanded", String(open));
    if (open) {
      update();
      amount.focus({ preventScroll: true });
    }
  }
  buy.addEventListener("click", () => toggle(true));
  close.addEventListener("click", () => toggle(false));
  card.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape" && !panel.hidden) toggle(false);
  });
  // Clicks inside the card must not open the post underneath.
  card.addEventListener("click", (event) => event.stopPropagation());

  const insights = input.answer ? callInsights({ post, answer: input.answer, live: () => live }) : null;
  const headIcon = el("span", { class: "head-icon" });
  const headName = el("strong", {});
  const headSym = el("span", {});
  const attachedTitle = el("strong", {});
  const attachedIcon = el("span", { class: "head-icon" });
  /** Header follows the chosen token. */
  function renderHead() {
    headIcon.replaceChildren(choice ? choiceIcon(choice, 40) : tokenIcon(sym(), 40));
    attachedIcon.replaceChildren(choice ? choiceIcon(choice, 28) : tokenIcon(sym(), 28));
    headName.textContent = nameOf();
    headSym.textContent = `${sym()} `;
    attachedTitle.textContent = `Trade ${sym()} with Kall Markets`;
  }
  renderHead();
  const header = el(
    "header",
    { class: "swap-head" },
    headIcon,
    el("div", { class: "swap-title" }, headName, el("span", {}, headSym, priceText, " ", changeText)),
    el("span", { class: "swap-spark" }),
    buy,
    close,
  );
  const untradable = el("p", { class: "inline-note untradable", style: "padding: 0 16px" }, `Looking up $${input.asset} on Base…`);
  if (input.attached) {
    card.hidden = true;
    card.append(
      el("header", { class: "swap-head" }, attachedIcon, el("div", { class: "swap-title" }, attachedTitle), close),
      ...(insights ? [insights] : []),
      panel,
      el("div", { style: "padding: 0 16px 12px" }, footer),
    );
  } else {
    card.append(header, callerStrip, ...(insights ? [insights] : []), panel);
    if (!tradable) card.append(untradable);
    card.append(el("div", { style: "padding: 0 16px 12px" }, footer));
  }
  update();

  // A call on a coin beyond ETH/BTC: find it on Base. Only an exact symbol with real liquidity and no
  // risk flag counts; anything else stays untradable rather than guessing among look-alikes.
  if (!tradable) {
    void searchTokens(input.asset).then((tokens) => {
      const matches = tokens.filter(
        (t) => t.symbol.toUpperCase() === input.asset.toUpperCase() && !t.riskFlagged && Number(t.liquidity) >= MIN_LIQUIDITY_USD,
      );
      const [match] = matches;
      if (!match) {
        untradable.textContent = `$${input.asset} has no liquid, unflagged token on Base. The record above still counts.`;
        return;
      }
      // Look-alikes can report more liquidity than the real coin, so two candidates means the user picks.
      if (matches.length > 1) {
        const choose = el("button", { type: "button", class: "link-button" }, `Choose the right $${input.asset} ↗`);
        choose.addEventListener("click", () => {
          toggle(true);
          openPicker(input.asset);
        });
        untradable.replaceChildren(`${matches.length} tokens on Base are called $${input.asset}. Check the contract before trading. `, choose);
        return;
      }
      choice = { kind: "token", token: match };
      tradable = true;
      untradable.hidden = true;
      buy.hidden = !panel.hidden;
      renderHead();
      void refreshPrice();
    });
  }
  return { card, open: () => tradable && toggle(true) };
}

const pct = (f: number) => `${(f * 100).toFixed(f >= 0.1 ? 1 : 2)}%`;

/** Flash's own numbers for this fill, shown the moment the quote lands (before any wallet prompt). */
export function quoteSummary(f: QuoteFacts, symbol: string) {
  const row = (k: string, v: Node | string, hint?: string) => [el("dt", hint ? { title: hint } : {}, k), el("dd", {}, v)];
  const amount = Number(f.received);
  const got = Number.isFinite(amount) ? amount.toLocaleString("en-US", { maximumFractionDigits: amount >= 1 ? 4 : 8 }) : f.received;
  const tone = f.impact === null ? "" : f.impact >= 0.03 ? "down" : f.impact >= 0.01 ? "warn" : "up";
  return el(
    "dl",
    { class: "review quote-facts" },
    ...row("You get", `${got} ${symbol}${f.receivedUsd !== null ? ` · ≈$${f.receivedUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}`),
    ...(f.impact !== null ? row("Price impact", el("span", { class: tone }, pct(f.impact)), "How much this order moves the price") : []),
    ...(f.slippage !== null ? row("Max slippage", pct(f.slippage), "Recommended by Definitive for this quote") : []),
    ...(f.feeUsd !== null ? row("Flash fee", f.feeUsd === 0 ? "Free" : `$${f.feeUsd.toFixed(2)}`) : []),
  );
}

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const venueName = (v: string) => v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * After a fill: the network, the wallet, every transaction the wallet sent, and the swap itself once
 * Definitive executes it, each linked to Basescan. The swap hash arrives a few seconds later.
 */
export function receipt(r: { title: string; exits: string | null; orderId: string; from: string; txs: Array<{ label: string; hash: string }> }) {
  const row = (k: string, v: Node | string) => [el("dt", {}, k), el("dd", {}, v)];
  const swap = el("dd", { class: "swap-pending" }, "Waiting for Definitive to fill on Base…");
  const venue = el("dd", {}, "Best route by Definitive");
  const card = el(
    "div",
    { class: "done-card" },
    el("div", { class: "done-head" }, el("strong", {}, r.title), el("span", { class: "network-badge" }, el("i", { "aria-hidden": "true" }), "Base")),
    el(
      "dl",
      { class: "review receipt" },
      el("dt", {}, "Swap"),
      swap,
      el("dt", {}, "Route"),
      venue,
      ...r.txs.flatMap((t) => row(t.label, safeLink(`${BASESCAN}/tx/${t.hash}`, `${short(t.hash)} ↗`))),
      ...row("Wallet", safeLink(`${BASESCAN}/address/${r.from}`, `${short(r.from)} ↗`)),
      ...row("Order", safeLink(`${appOrigin}/app#orders`, `${r.orderId.slice(0, 8)}… ↗`)),
      ...(r.exits ? row("TP/SL", r.exits === "pending_activation" ? "Arms on the first fill" : r.exits) : []),
    ),
  );
  void waitForFill(r.orderId).then((fill) => {
    if (!fill) {
      swap.replaceChildren("Still filling: check the order page");
      return;
    }
    swap.classList.remove("swap-pending");
    swap.replaceChildren(safeLink(`${BASESCAN}/tx/${fill.hash}`, `${short(fill.hash)} ↗`));
    if (fill.venues.length) venue.replaceChildren(`${fill.venues.map(venueName).join(" + ")} · via Definitive`);
  });
  return card;
}
