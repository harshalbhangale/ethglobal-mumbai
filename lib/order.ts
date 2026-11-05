/**
 * Parses plain-language orders, the same text a user types in the desk or replies to @AfterMarkets on X:
 *   "copy $2 of ETH, TP 10%, SL 5%"
 *   "buy $5 of ETH if it dips to 2,900"
 *   "sell my ETH at 4,000"
 */

export type Side = "buy" | "sell";

export type ParsedOrder = {
  side: Side;
  asset: string;
  /** USD notional; null means "all of it" (sell my ETH). */
  amountUsd: number | null;
  /** Limit trigger price in USD; null means market. */
  limitPrice: number | null;
  /** Take-profit / stop-loss as fractions (0.1 = 10%). */
  takeProfitPct: number | null;
  stopLossPct: number | null;
  /** True when the text started with "copy" (copying a call from a post). */
  copy: boolean;
};

export type ParseResult = { ok: true; order: ParsedOrder } | { ok: false; error: string };

const num = (s: string) => Number(s.replace(/,/g, ""));

export function parseOrder(input: string): ParseResult {
  const text = input.trim().toLowerCase().replace(/^@aftermarkets\s+/, "");
  if (!text) return { ok: false, error: "Type an order, like “copy $2 of ETH, TP 10%, SL 5%”." };

  const sideMatch = text.match(/^(copy|buy|long|sell|short)\b/);
  if (!sideMatch) return { ok: false, error: "Start with copy, buy or sell." };
  const verb = sideMatch[1];
  const side: Side = verb === "sell" || verb === "short" ? "sell" : "buy";

  const amountMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  const amountUsd = amountMatch ? num(amountMatch[1]) : null;

  // Asset: "$2 of eth", "my eth", "buy eth", or a $TICKER cashtag.
  const assetMatch =
    text.match(/\bof\s+\$?([a-z][a-z0-9]{1,9})\b/) ??
    text.match(/\bmy\s+\$?([a-z][a-z0-9]{1,9})\b/) ??
    text.match(/^(?:copy|buy|long|sell|short)\s+\$?([a-z][a-z0-9]{1,9})\b/) ??
    text.match(/\$([a-z][a-z0-9]{1,9})\b/);
  const asset = (assetMatch?.[1] ?? "eth").toUpperCase();

  const limitMatch = text.match(/\b(?:at|to|below|above|under|over)\s+\$?([\d,]+(?:\.\d+)?)(?!\s*%)/);
  const limitPrice = limitMatch ? num(limitMatch[1]) : null;

  const tpMatch = text.match(/\b(?:tp|take[\s-]?profit)\s*:?\s*\+?([\d.]+)\s*%/);
  const slMatch = text.match(/\b(?:sl|stop[\s-]?loss|stop)\s*:?\s*-?([\d.]+)\s*%/);
  const takeProfitPct = tpMatch ? num(tpMatch[1]) / 100 : null;
  const stopLossPct = slMatch ? num(slMatch[1]) / 100 : null;

  if (side === "buy" && amountUsd === null) return { ok: false, error: "Say how much, like “$5”." };
  if (amountUsd !== null && !(amountUsd > 0)) return { ok: false, error: "Amount must be more than $0." };
  if (stopLossPct !== null && stopLossPct >= 1) return { ok: false, error: "Stop-loss must be under 100%." };

  return {
    ok: true,
    order: { side, asset, amountUsd, limitPrice, takeProfitPct, stopLossPct, copy: verb === "copy" },
  };
}

export type ExitPrices = { entry: number; takeProfit: number | null; stopLoss: number | null };

/** Exit prices from the entry (limit price if set, else the market price). */
export function exitPrices(order: ParsedOrder, marketPrice: number): ExitPrices {
  const entry = order.limitPrice ?? marketPrice;
  const dir = order.side === "buy" ? 1 : -1;
  return {
    entry,
    takeProfit: order.takeProfitPct === null ? null : entry * (1 + dir * order.takeProfitPct),
    stopLoss: order.stopLossPct === null ? null : entry * (1 - dir * order.stopLossPct),
  };
}

export function describeOrder(o: ParsedOrder): string {
  const amount = o.amountUsd === null ? `all your ${o.asset}` : `$${o.amountUsd} of ${o.asset}`;
  const when = o.limitPrice === null ? "at market" : `at $${o.limitPrice.toLocaleString("en-US")}`;
  return `${o.side === "buy" ? "Buy" : "Sell"} ${amount} ${when}`;
}
