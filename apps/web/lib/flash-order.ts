import { FLASH_BASE_ASSETS, type FlashAsset, type FlashOrderInput } from "@aftermarkets/integrations/definitive";
import type { ExitPrices, ParsedOrder } from "@aftermarkets/domain/order";

export type FlashOrderResult = { ok: true; input: FlashOrderInput } | { ok: false; error: string };

/** Decimal string without exponent or trailing zeros, truncated (never rounded up) to `dp` places. */
export function toDecimal(n: number, dp: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const factor = 10 ** dp;
  const fixed = (Math.floor(n * factor) / factor).toFixed(dp);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * Turns a typed or X-reply order into a Flash order on Base.
 * Buys spend USDC; sells sell the asset. TP/SL attach to buys only, and Flash needs both legs.
 */
export function toFlashOrder(
  order: ParsedOrder,
  exits: ExitPrices,
  funderAddress: string,
  sourcePostId?: string,
): FlashOrderResult {
  if (!(order.asset in FLASH_BASE_ASSETS))
    return { ok: false, error: `${order.asset} isn't tradable on Base yet. Try ETH or BTC.` };
  const asset = order.asset as FlashAsset;

  if (order.amountUsd === null) return { ok: false, error: "Say how much, like “$5”." };

  const hasTp = order.takeProfitPct !== null;
  const hasSl = order.stopLossPct !== null;
  if (order.side === "sell" && (hasTp || hasSl))
    return { ok: false, error: "Take-profit and stop-loss work on buys. Sell without them, or buy instead." };
  if (hasTp !== hasSl)
    return { ok: false, error: "Add both a take-profit and a stop-loss, like “TP 10%, SL 5%”." };

  let qty: string;
  if (order.side === "buy") {
    qty = toDecimal(order.amountUsd, 6); // USDC
  } else {
    if (!(exits.entry > 0)) return { ok: false, error: "Waiting for a price to size the sell." };
    qty = toDecimal(order.amountUsd / exits.entry, Math.min(FLASH_BASE_ASSETS[asset].decimals, 8));
  }
  if (qty === "0") return { ok: false, error: "Amount is too small." };

  const input: FlashOrderInput = {
    asset,
    side: order.side,
    qty,
    orderType: order.limitPrice === null ? "market" : "limit",
    funderAddress,
  };
  if (order.limitPrice !== null) input.limitPrice = toDecimal(order.limitPrice, 2);
  if (hasTp && hasSl && exits.takeProfit !== null && exits.stopLoss !== null) {
    input.takeProfit = { notionalPrice: toDecimal(exits.takeProfit, 2) };
    input.stopLoss = { notionalPrice: toDecimal(exits.stopLoss, 2) };
  }
  if (sourcePostId) input.sourcePostId = sourcePostId;
  return { ok: true, input };
}
