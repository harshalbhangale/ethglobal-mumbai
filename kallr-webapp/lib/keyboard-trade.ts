import type { FlashOrderInput, FlashQuote } from "@kallr/integrations/definitive";
import { z } from "zod";

/**
 * The keyboard's trade panel sends a simple order (token, dollars, percentages); the server turns it
 * into the shared Flash order input at the current price, so the Kotlin side never does price math.
 * Buys only: the keyboard spends USDC from the embedded wallet.
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
