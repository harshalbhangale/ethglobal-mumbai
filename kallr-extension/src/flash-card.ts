import { callInsights } from "./call-insights";
import type { Answer, PostRef } from "./call-view";
import { appOrigin } from "./config";
import { assetUrl, el, openDesk, safeLink, wordmark } from "./dom";
import { placeOnX, STEP_LABEL } from "./flash-direct";
import { cardOrderText, COPYABLE, DECIMAL, deskOrderUrl } from "./post";
import { ALIASES, formatPrice, type LivePrice, livePrice } from "./ticker-price";
import { hasBrowserWallet, rejected } from "./wallet";

/**
 * The post card, laid out as a swap card: live price header, the Call check strip, then
 * a trade panel. Here it trades on Base through Definitive Flash, with take-profit / stop-loss
 * attached as one bracket. Signing happens in the Kallr desk, never on X.
 */

const NAMES: Record<string, string> = { ETH: "Ethereum", BTC: "Bitcoin" };
/** Token actually traded on Base: brackets need an ERC-20, so ETH trades as WETH. */
const TOKENS: Record<string, string> = { ETH: "WETH", BTC: "cbBTC" };
const IMAGES: Record<string, string> = { ETH: "brand/tokens/eth.png", BTC: "brand/tokens/btc.png", USDC: "brand/tokens/usdc.png" };
export const TP_CHOICES = [5, 10, 20, 50] as const;
export const SL_CHOICES = [3, 5, 10, 20] as const;

export function tokenIcon(asset: string, size = 40) {
  const image = IMAGES[asset];
  if (image)
    return el("img", {
      class: "swap-icon",
      src: assetUrl(image),
      width: String(size),
      height: String(size),
      alt: "",
      style: `width:${size}px;height:${size}px;border-radius:50%`,
    });
  const colors: Record<string, string> = { ETH: "#627EEA", BTC: "#F7931A", USDC: "#2775CA", SOL: "#9945FF" };
  return el(
    "span",
    {
      class: "swap-icon",
      style: `width:${size}px;height:${size}px;background:${colors[asset] ?? "#536471"};font-size:${Math.round(size * 0.48)}px`,
      "aria-hidden": "true",
    },
    asset.slice(0, 1),
  );
}

const money = (value: number) =>
  Number.isFinite(value) ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "";

export type FlashCard = { card: HTMLElement; open: () => void };

export function flashCard(input: {
  post: PostRef & { text: string };
  asset: string;
  article?: HTMLElement;
  answer: Answer | null;
  /** Under X's own ticker card: X already shows the header, so start hidden. */
  attached?: boolean;
}): FlashCard {
  const { post, asset } = input;
  const tradable = COPYABLE.has(asset);
  const token = TOKENS[asset] ?? asset;
  const call = input.answer?.call ?? null;
  let side: "buy" | "sell" = call?.direction === "down" ? "sell" : "buy";
  let tp: number | null = 10;
  let sl: number | null = 5;
  let live: LivePrice | null = null;

  const card = el("section", {
    class: `inline-card swap-card${input.attached ? " inline-attached" : ""}`,
    "aria-label": `Trade ${asset} with Kallr`,
  });
  const priceText = el("b", {}, "…");
  const changeText = el("em", {});
  const buy = el("button", { type: "button", class: "inline-buy", "aria-expanded": "false" }, "⇄ Copy");
  const close = el("button", { type: "button", class: "inline-close", hidden: "", "aria-label": "Close" }, "✕ Close");
  if (!tradable) buy.hidden = true;

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
  const receiveAmount = el("strong", { class: "inline-output swap-out" }, "0");
  const receiveUsd = el("span", { class: "swap-usd" });
  const receiveToken = el("span", {});
  const tpText = el("b", {});
  const slText = el("b", {});
  const tpChips = el("div", { class: "exit-chips tp", role: "group", "aria-label": "Take-profit" });
  const slChips = el("div", { class: "exit-chips sl", role: "group", "aria-label": "Stop-loss" });
  const exits = el(
    "div",
    { class: "exits" },
    el("div", { class: "exit-row" }, el("span", {}, "Take-profit ", tpText), tpChips),
    el("div", { class: "exit-row" }, el("span", {}, "Stop-loss ", slText), slChips),
  );
  const meta = el("p", { class: "swap-meta" });
  const walletChip = el("span", { class: "swap-wallet", hidden: "" });
  const status = el("p", { class: "inline-note", role: "status", "aria-live": "polite" });
  const submit = el("button", { type: "button", class: "inline-submit swap-submit", disabled: "" }, `Buy ${asset}`);

  const pill = (symbol: string) => el("span", { class: "swap-pill" }, tokenIcon(symbol === "USDC" ? "USDC" : asset, 22), symbol);

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

  const price = () => (live ? Number(live.price) : Number.NaN);

  /** USD value of what's typed: dollars on a buy, token amount × price on a sell. */
  function usdValue(): number | null {
    if (!DECIMAL.test(amount.value) || !(Number(amount.value) > 0)) return null;
    const v = Number(amount.value);
    return side === "buy" ? v : v * price();
  }

  function update() {
    payLabel.textContent = side === "buy" ? "You pay" : "You sell";
    payToken.replaceChildren(pill(side === "buy" ? "USDC" : token));
    receiveToken.replaceChildren(pill(side === "buy" ? token : "USDC"));
    submit.textContent = `${side === "buy" ? "Buy" : "Sell"} ${asset}`;
    exits.hidden = side === "sell";
    const p = price();
    const fmt = (pct: number | null, dir: 1 | -1) =>
      pct === null ? "off" : Number.isFinite(p) ? `${dir > 0 ? "+" : "−"}${pct}% · ${formatPrice(String(p * (1 + (dir * pct) / 100)))}` : `${pct}%`;
    tpText.textContent = fmt(tp, 1);
    slText.textContent = fmt(sl, -1);

    const value = Number(amount.value);
    const ok = DECIMAL.test(amount.value) && value > 0;
    if (ok && Number.isFinite(p)) {
      const out = side === "buy" ? value / p : value * p;
      receiveAmount.textContent = `≈ ${out.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`;
      payUsd.textContent = money(side === "buy" ? value : value * p);
      receiveUsd.textContent = money(side === "buy" ? value : out);
    } else {
      receiveAmount.textContent = "0";
      payUsd.textContent = receiveUsd.textContent = "";
    }
    meta.replaceChildren(
      Number.isFinite(p) ? `1 ${asset} ≈ ${formatPrice(live?.price ?? "0").slice(1)} USDC` : "Price unavailable",
      " · Definitive Flash · Base",
    );

    const pairBroken = side === "buy" && (tp === null) !== (sl === null);
    const usd = usdValue();
    if (pairBroken) status.textContent = "Flash places take-profit and stop-loss as a pair: set both, or neither.";
    else if (amount.value && !ok) status.textContent = "Enter a positive amount.";
    else status.textContent = ok ? "Estimate from the live price; you review the exact quote and sign in the desk." : "";
    const ready = ok && !pairBroken && usd !== null && Number.isFinite(usd);
    if (ready) submit.removeAttribute("disabled");
    else submit.setAttribute("disabled", "");
  }

  async function refreshPrice() {
    live = await livePrice(input.article ?? document.body, asset, ALIASES[asset as keyof typeof ALIASES] ?? []);
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
    try {
      const result = await placeOnX(
        {
          asset: asset as "ETH" | "BTC",
          side,
          amount: amount.value,
          tpPct: side === "buy" ? tp : null,
          slPct: side === "buy" ? sl : null,
          price: price(),
          postId: post.postId,
          caller: post.handle,
        },
        (step) => {
          status.textContent = STEP_LABEL[step];
        },
      );
      walletChip.textContent = `${result.from.slice(0, 6)}…${result.from.slice(-4)}`;
      walletChip.hidden = false;
      status.replaceChildren(
        `${side === "buy" ? "Bought" : "Sold"} ${asset} with Flash on Base ✓ `,
        result.exits ? `Exits ${result.exits === "pending_activation" ? "arm on the first fill" : result.exits}. ` : "",
        safeLink(`${appOrigin}/app#orders`, `Order ${result.orderId.slice(0, 8)}… ↗`),
      );
      amount.value = "";
    } catch (error) {
      status.textContent = rejected(error) ? "Cancelled in your wallet. Nothing was sent." : (error as Error).message || "The order didn't go through.";
    } finally {
      busy = false;
      const keep = status.textContent;
      const keepNodes = [...status.childNodes];
      update();
      // update() rewrites the hint; keep the result line the user needs to see.
      if (keep) status.replaceChildren(...keepNodes);
    }
  }

  submit.addEventListener("click", async () => {
    if (busy) return;
    const usd = usdValue();
    if (usd === null || !Number.isFinite(usd)) return;
    if (await hasBrowserWallet()) return placeHere();
    const text = cardOrderText({
      side,
      asset,
      usd: side === "buy" ? amount.value : usd.toFixed(2),
      tpPct: side === "buy" ? tp : null,
      slPct: side === "buy" ? sl : null,
    });
    if (!text) return;
    const url = deskOrderUrl(appOrigin, text, post);
    openDesk(url);
    status.replaceChildren("No browser wallet here: review the quote and sign in the Kallr desk. ", safeLink(url, "Open desk ↗"));
  });

  panel.append(
    el(
      "div",
      { class: "swap-row" },
      sides,
      el("span", { class: "swap-row-end" }, walletChip, el("span", { class: "swap-chain-pill" }, el("span", { class: "swap-chain", "aria-hidden": "true" }), "Base mainnet")),
    ),
    el(
      "label",
      { class: "swap-box swap-pay" },
      payLabel,
      el("div", { class: "swap-line" }, amount, payToken),
      payUsd,
    ),
    el("span", { class: "swap-arrow", "aria-hidden": "true" }, "↓"),
    el(
      "div",
      { class: "swap-box" },
      el("span", { class: "swap-label" }, "You receive"),
      el("div", { class: "swap-line" }, receiveAmount, receiveToken),
      receiveUsd,
    ),
    exits,
    meta,
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
      wordmark(),
      el("i", { class: "swap-powered-sep", "aria-hidden": "true" }),
      el("b", { class: "swap-venue" }, "Definitive Flash"),
    ),
    safeLink(`https://x.com/${post.handle}`, `@${post.handle} record ↗`),
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
  const header = el(
    "header",
    { class: "swap-head" },
    tokenIcon(asset),
    el("div", { class: "swap-title" }, el("strong", {}, NAMES[asset] ?? asset), el("span", {}, `${asset} `, priceText, " ", changeText)),
    el("span", { class: "swap-spark" }),
    buy,
    close,
  );
  if (input.attached) {
    card.hidden = true;
    card.append(
      el("header", { class: "swap-head" }, el("div", { class: "swap-title" }, el("strong", {}, `Trade ${asset} with Kallr`)), close),
      ...(insights ? [insights] : []),
      panel,
      el("div", { style: "padding: 0 16px 12px" }, footer),
    );
  } else {
    card.append(header, ...(insights ? [insights] : []));
    if (tradable) card.append(panel);
    else card.append(el("p", { class: "inline-note", style: "padding: 0 16px" }, `$${asset} isn't tradable on Base yet. The record above still counts.`));
    card.append(el("div", { style: "padding: 0 16px 12px" }, footer));
  }
  update();
  return { card, open: () => tradable && toggle(true) };
}
