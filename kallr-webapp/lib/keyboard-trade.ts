import { savedVsUniswap, uniswapEdge } from "@kallr/domain/flash-receipt";
import type { FlashOrderInput, FlashQuote } from "@kallr/integrations/definitive";
import { z } from "zod";

/**
 * The keyboard's trade panel sends a simple order (token, dollars, percentages); the server turns it
 * into the shared Flash order input at the current price, so the Kotlin side never does price math.
 * Orders are buys that spend USDC; the app's swap sells the wallet's ETH for that USDC.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const keyboardOrderSchema = z
  .object({
    funder: address,
    /** ETH, BTC, or any Base token by contract address. */
    token: z.union([z.enum(["ETH", "BTC"]), address]),
    kind: z.enum(["swap", "limit", "twap"]),
    /** USDC to spend. */
    usd: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/),
    /** Limit entry as a percent from the current price, e.g. -5 = 5% below. */
    limitPct: z.number().min(-90).max(-0.1).optional(),
    twapMinutes: z.number().int().min(5).max(30 * 24 * 60).optional(),
    tpPct: z.number().min(0.5).max(1000).optional(),
    slPct: z.number().min(0.5).max(95).optional(),
    postId: z.string().regex(/^[0-9]{1,30}$/).optional(),
    caller: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (Number(o.usd) <= 0) ctx.addIssue({ code: "custom", message: "Amount must be more than $0.", path: ["usd"] });
    if (o.kind === "limit" && o.limitPct === undefined)
      ctx.addIssue({ code: "custom", message: "Pick how far below the price to buy.", path: ["limitPct"] });
    if (o.kind === "twap" && o.twapMinutes === undefined)
      ctx.addIssue({ code: "custom", message: "Pick how long to spread the buy over.", path: ["twapMinutes"] });
    if ((o.tpPct === undefined) !== (o.slPct === undefined))
      ctx.addIssue({ code: "custom", message: "Set both a take-profit and a stop-loss, or neither.", path: ["tpPct"] });
  });
export type KeyboardOrder = z.infer<typeof keyboardOrderSchema>;

/** A positive price as a plain decimal with 6 significant digits, never in exponent form (PEPE is ~0.00001). */
export function priceString(n: number): string {
  if (!(n > 0) || !Number.isFinite(n)) throw new Error("Price unavailable");
  const digits = Math.max(0, 6 - Math.floor(Math.log10(n)) - 1);
  return n.toFixed(Math.min(digits, 18)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function buildKeyboardOrder(o: KeyboardOrder, price: number): FlashOrderInput {
  const entry = o.kind === "limit" ? price * (1 + (o.limitPct ?? 0) / 100) : price;
  const input: FlashOrderInput = {
    asset: o.token,
    side: "buy",
    qty: o.usd,
    orderType: o.kind === "swap" ? "market" : o.kind,
    funderAddress: o.funder,
  };
  if (o.kind === "limit") input.limitPrice = priceString(entry);
  if (o.kind === "twap") input.durationSeconds = (o.twapMinutes ?? 0) * 60;
  if (o.tpPct !== undefined && o.slPct !== undefined) {
    input.takeProfit = { notionalPrice: priceString(entry * (1 + o.tpPct / 100)) };
    input.stopLoss = { notionalPrice: priceString(entry * (1 - o.slPct / 100)) };
  }
  if (o.postId) input.sourcePostId = o.postId;
  return input;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1 ? 2 : 6 });
const amount = (s: string) => {
  const n = Number(s);
  return n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(2) : n.toPrecision(4);
};

/** About $1 of ETH stays in the Kall wallet: the wrap and approvals are paid in ETH. */
export const GAS_RESERVE_ETH = 0.0004;

/** The app's Swap ETH to USDC: dollars of the Kall wallet's ETH to sell for USDC on Flash. */
export const keyboardSwapSchema = z
  .object({ usd: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/, "Enter a dollar amount.") })
  .strict()
  .refine((o) => Number(o.usd) >= 1, { message: "Swap at least $1.", path: ["usd"] });

/** ETH to sell for `usd` dollars, rounded down to 6 decimals so it never sells more than asked. */
export function ethForUsd(usd: number, price: number): string {
  if (!(price > 0) || !Number.isFinite(price)) throw new Error("ETH price unavailable");
  const qty = Math.floor((usd / price) * 1e6) / 1e6;
  if (!(qty > 0)) throw new Error("That amount is too small to swap.");
  return qty.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** The most the wallet can swap and still keep gas, in dollars rounded down to cents. */
export function maxSwapUsd(ethBalance: number, price: number): number {
  return Math.max(0, Math.floor((ethBalance - GAS_RESERVE_ETH) * price * 100) / 100);
}

/** A market sell of the wallet's native ETH for USDC: Flash wraps it, then sells the WETH. */
export function buildSwapOrder(usd: string, price: number, funder: string): FlashOrderInput {
  return { asset: "ETH", side: "sell", qty: ethForUsd(Number(usd), price), orderType: "market", funderAddress: funder, native: true };
}

/**
 * Flash's own estimates for a quote, for the review card, plus what it beats Uniswap's best pool by
 * for the same trade (`uniswapOut`, measured alongside): `savedUsd` in dollars, `vsUniswapPct` in
 * percent. Both null when unmeasured; negative when Uniswap would give more.
 */
export function quoteDetails(q: FlashQuote, side?: "buy" | "sell", uniswapOut?: string | null) {
  const pct = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v) * 100);
  const edge = side ? uniswapEdge(q.to.amount, uniswapOut) : null;
  return {
    impactPct: pct(q.estimatedPriceImpact),
    slippagePct: pct(q.recommendedSlippage),
    feeUsd: q.fees?.estimatedFeeNotional ? Number(q.fees.estimatedFeeNotional) : null,
    savedUsd: side ? savedVsUniswap(q, side, uniswapOut) : null,
    vsUniswapPct: edge === null ? null : edge * 100,
  };
}

/** The swap's review card, in the same shape as an order's. */
export function swapPreviewLines(usd: string, input: FlashOrderInput, quote: FlashQuote) {
  return {
    title: `Swap $${usd} of ETH to USDC`,
    kind: "Market swap on Base through Flash",
    pay: `${input.qty} ETH`,
    get: `about ${amount(quote.to.amount)} USDC`,
    exits: "None",
    approval: quote.wrap?.evmTx ? `Wrap ${input.qty} ETH, then approve it` : quote.evm.approveTx ? `${input.qty} WETH only` : "Not needed",
  };
}

/** What the confirm sheet shows, in plain words. */
export function previewLines(o: KeyboardOrder, input: FlashOrderInput, quote: FlashQuote, symbol: string) {
  const kind =
    o.kind === "swap"
      ? "Market swap"
      : o.kind === "limit"
        ? `Limit buy at ${usd(Number(input.limitPrice))} (${o.limitPct}%)`
        : `TWAP over ${o.twapMinutes! >= 60 ? `${+(o.twapMinutes! / 60).toFixed(1)}h` : `${o.twapMinutes} min`}`;
  return {
    title: `Buy $${o.usd} of ${symbol}`,
    kind: `${kind} on Base through Flash`,
    pay: `${o.usd} USDC`,
    get: `${o.kind === "swap" ? "about " : "up to about "}${amount(quote.to.amount)} ${symbol}`,
    exits:
      input.takeProfit && input.stopLoss
        ? `TP ${usd(Number(input.takeProfit.notionalPrice))} · SL ${usd(Number(input.stopLoss.notionalPrice))}`
        : "None",
    approval: quote.evm.approveTx ? `${o.usd} USDC only` : "Not needed",
  };
}
