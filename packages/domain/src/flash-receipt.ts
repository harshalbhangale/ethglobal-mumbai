/**
 * The Definitive Flash receipt: four rows that fill in as a trade happens, so the user sees what
 * Definitive did even when no wallet pop-up shows (the Kall wallet signs in the browser or on our
 * server). The same model drives the web app (React) and the X card (shadow DOM).
 *
 *   1. Quote from Definitive  price · price impact · fee
 *   2. Signed by <wallet>     0x1234…abcd
 *   3. Sent to Definitive     Flash order ID, copyable
 *   4. Filled                 amount received · View swap on Basescan ↗
 *
 * Rows not reached yet are pending; a failure marks its own row red with the error.
 */

export type ReceiptRowState = "pending" | "live" | "done" | "failed";
export type ReceiptRowKey = "quote" | "signed" | "sent" | "filled";

/**
 * Flash's own numbers for the fill. Impact and fee are as Flash quotes them; impact 0.01 = 1%.
 * `vsUniswap`: how much more Flash gives than Uniswap's pools for the same trade (0.004 = 0.4%;
 * negative when Uniswap gives more), when it was measured.
 */
export type ReceiptQuote = {
  price: number | null;
  impact: number | null;
  feeUsd: number | null;
  vsUniswap?: number | null;
  /** The same edge in dollars: what this trade gets beyond Uniswap's best pool, at the quote's price. */
  savedUsd?: number | null;
};

export type FlashReceipt = {
  /** Who signs, as the row reads: "your Kall wallet", "MetaMask". */
  signer: string;
  /** Index of the row in progress: 0 quote … 3 filled; 4 when every row is done. */
  at: number;
  quote: ReceiptQuote | null;
  wallet: string | null;
  orderId: string | null;
  /** What the live signing row is doing right now ("Approving USDC on Base…"). */
  note: string | null;
  /** A limit or TWAP order: it rests on Flash until the price comes. */
  resting: boolean;
  /** Polled a while with no fill yet. */
  slow: boolean;
  fill: { received: string | null; symbol: string; tx: string } | null;
  error: { row: number; message: string } | null;
};

export type ReceiptEvent =
  | { type: "quoting" }
  | { type: "quoted"; quote: ReceiptQuote }
  | { type: "signing"; wallet?: string | null; note?: string | null }
  | { type: "signed"; wallet: string }
  | { type: "sending" }
  | { type: "sent"; orderId: string; resting?: boolean }
  | { type: "filled"; tx: string; received: string | null; symbol: string }
  | { type: "slow" }
  | { type: "failed"; message: string };

export function startReceipt(signer: string): FlashReceipt {
  return { signer, at: 0, quote: null, wallet: null, orderId: null, note: null, resting: false, slow: false, fill: null, error: null };
}

/** Steps only move forward; once a row has failed the receipt stays as it is. */
export function advanceReceipt(r: FlashReceipt, e: ReceiptEvent): FlashReceipt {
  if (r.error) return r;
  const to = (row: number) => Math.max(r.at, row);
  switch (e.type) {
    case "quoting":
      return { ...r, at: to(0) };
    case "quoted":
      return { ...r, quote: e.quote, at: to(1) };
    case "signing":
      return { ...r, wallet: e.wallet ?? r.wallet, note: e.note ?? null, at: to(1) };
    case "signed":
      return { ...r, wallet: e.wallet, note: null, at: to(2) };
    case "sending":
      return { ...r, note: null, at: to(2) };
    case "sent":
      return { ...r, orderId: e.orderId, resting: Boolean(e.resting), at: to(3) };
    case "filled":
      return { ...r, fill: { tx: e.tx, received: e.received, symbol: e.symbol }, slow: false, at: 4 };
    case "slow":
      return r.at === 3 ? { ...r, slow: true } : r;
    case "failed":
      return { ...r, error: { row: Math.min(r.at, 3), message: e.message } };
  }
}

export type ReceiptRow = {
  key: ReceiptRowKey;
  title: string;
  state: ReceiptRowState;
  /** One line under the title; empty while pending. */
  detail: string;
  /** A value to copy (the full order ID). */
  copy?: string;
  link?: { href: string; label: string };
};

export const BASESCAN = "https://basescan.org";

export const shortHex = (s: string) => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
/** Flash order IDs are UUIDs: the first and last groups are enough to match one by eye. */
export const shortOrderId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

const pct = (f: number) => `${(Math.abs(f) * 100).toFixed(Math.abs(f) >= 0.1 ? 1 : 2)}%`;

export function formatUsdPrice(n: number) {
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 8;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n >= 1000 ? 2 : 0, maximumFractionDigits: digits })}`;
}

export function formatAmount(v: string | number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

/** Edges under this read as a tie: too small to claim. */
const MIN_EDGE = 0.0001;

/** "$0.12", or "$0.004" under a cent, so a small trade's saving still reads as money. */
export const formatSaved = (usd: number) => `$${usd.toFixed(usd >= 0.01 ? 2 : usd >= 0.001 ? 3 : 4)}`;

const measuredSaving = (q: ReceiptQuote) => (q.savedUsd != null && q.savedUsd >= 0.0001 ? q.savedUsd : null);

/**
 * The line to celebrate: "You saved $0.12 vs Uniswap" when Definitive Flash beat Uniswap's best pool
 * on this exact trade (the percentage when the dollars round to nothing). Null with no measurement or
 * no edge: a saving is only claimed when it was measured.
 */
export function savingsLine(q: ReceiptQuote | null | undefined): string | null {
  if (!q || q.vsUniswap == null || q.vsUniswap < MIN_EDGE) return null;
  const saved = measuredSaving(q);
  return saved !== null ? `You saved ${formatSaved(saved)} vs Uniswap` : `You got ${pct(q.vsUniswap)} more than Uniswap`;
}

export function quoteLine(q: ReceiptQuote) {
  const parts: string[] = [];
  if (q.price !== null) parts.push(formatUsdPrice(q.price));
  // Flash beat Uniswap on this exact trade: say by how much, in place of the impact.
  if (q.vsUniswap != null && q.vsUniswap >= MIN_EDGE) {
    const saved = measuredSaving(q);
    parts.push(saved !== null ? `${formatSaved(saved)} better than Uniswap` : `${pct(q.vsUniswap)} more than Uniswap`);
  } else if (q.impact !== null) parts.push(`impact ${pct(q.impact)}`);
  if (q.feeUsd !== null) parts.push(q.feeUsd === 0 ? "no fee" : `fee $${q.feeUsd.toFixed(q.feeUsd < 0.01 ? 4 : 2)}`);
  return parts.length ? parts.join(" · ") : "Quoted";
}

/** The four rows as they read right now. */
export function receiptRows(r: FlashReceipt): ReceiptRow[] {
  const state = (row: number): ReceiptRowState =>
    r.error?.row === row ? "failed" : row < r.at ? "done" : row === r.at && !r.error ? "live" : "pending";
  const failed = (row: number, otherwise: string) => (r.error?.row === row ? r.error.message : otherwise);
  const s = [state(0), state(1), state(2), state(3)] as const;

  const quote: ReceiptRow = {
    key: "quote",
    title: "Quote from Definitive",
    state: s[0],
    detail: failed(0, s[0] === "done" && r.quote ? quoteLine(r.quote) : s[0] === "live" ? "Asking Definitive Flash for the best route…" : ""),
  };
  const signed: ReceiptRow = {
    key: "signed",
    title: `Signed by ${r.signer}`,
    state: s[1],
    detail: failed(1, s[1] === "done" && r.wallet ? shortHex(r.wallet) : s[1] === "live" ? (r.note ?? "Signing the order…") : ""),
  };
  const sent: ReceiptRow = {
    key: "sent",
    title: "Sent to Definitive Flash",
    state: s[2],
    detail: failed(2, s[2] === "done" && r.orderId ? `Order ${shortOrderId(r.orderId)}` : s[2] === "live" ? "Sending the signed order…" : ""),
    ...(s[2] === "done" && r.orderId ? { copy: r.orderId } : {}),
  };
  const waiting = r.resting
    ? "Resting: stays open in Open orders until it fills."
    : r.slow
      ? "Still filling. It shows in Order history once Definitive fills it."
      : "Waiting for Definitive to fill…";
  const filled: ReceiptRow = {
    key: "filled",
    title: "Filled",
    state: s[3],
    detail: failed(
      3,
      r.fill ? (r.fill.received ? `Received ${formatAmount(r.fill.received)} ${r.fill.symbol}` : "Filled on Base") : s[3] === "live" ? waiting : "",
    ),
    ...(r.fill ? { link: { href: `${BASESCAN}/tx/${r.fill.tx}`, label: "View swap on Basescan ↗" } } : {}),
  };
  return [quote, signed, sent, filled];
}

/** The quote shape Flash returns (only what the receipt reads). */
export type QuoteNumbers = {
  from: { amount: string; notional?: string | null };
  to: { amount: string; notional?: string | null };
  estimatedPriceImpact?: string | null;
  fees?: { estimatedFeeNotional?: string | null } | null;
};

const num = (v: string | null | undefined) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Price per token from the quote's own amounts: a buy spends USDC (from) for tokens (to), a sell the
 * other way round.
 */
export function receiptQuote(q: QuoteNumbers, side: "buy" | "sell", uniswapOut?: string | null): ReceiptQuote {
  const usdc = num(side === "buy" ? q.from.amount : q.to.amount);
  const tokens = num(side === "buy" ? q.to.amount : q.from.amount);
  const impact = num(q.estimatedPriceImpact);
  return {
    price: usdc !== null && tokens !== null && tokens > 0 ? usdc / tokens : null,
    impact: impact === null ? null : Math.abs(impact),
    feeUsd: num(q.fees?.estimatedFeeNotional),
    vsUniswap: uniswapEdge(q.to.amount, uniswapOut),
    savedUsd: savedVsUniswap(q, side, uniswapOut),
  };
}

/**
 * Flash's edge over Uniswap in dollars: the extra output this trade gets, valued at the quote's own
 * price (a buy gets more tokens, a sell more USDC). Negative when Uniswap gives more; null unmeasured.
 */
export function savedVsUniswap(q: QuoteNumbers, side: "buy" | "sell", uniswapOut: string | null | undefined): number | null {
  const flash = num(q.to.amount);
  const uni = num(uniswapOut);
  if (flash === null || uni === null || flash <= 0 || uni <= 0) return null;
  const extra = flash - uni;
  if (side === "sell") return extra;
  const usdc = num(q.from.amount);
  return usdc === null ? null : (extra * usdc) / flash;
}

/**
 * How much more Flash's quote gives than Uniswap for the same trade (both in the output token):
 * 0.004 = 0.4% more; negative when Uniswap gives more. Null when either is missing.
 */
export function uniswapEdge(flashOut: string, uniswapOut: string | null | undefined): number | null {
  const flash = num(flashOut);
  const uni = num(uniswapOut);
  if (flash === null || uni === null || flash <= 0 || uni <= 0) return null;
  return (flash - uni) / uni;
}

/** A Flash order status that means it will never fill. */
export const closedWithoutFill = (status: string | null | undefined) => Boolean(status && /CANCEL|REJECT|FAIL|EXPIRE|TERMINAT/i.test(status));

/** What a fill poll says: the swap's hash and the amount received, from an order-detail response. */
export function fillFrom(
  detail: { status?: string | null; fills?: Array<{ transactionId: string | null }> | null; filled?: { targetAmount?: string | null; contraAmount?: string | null } | null } | null,
  side: "buy" | "sell",
): { tx: string; received: string | null } | null {
  const tx = detail?.fills?.find((f) => f.transactionId && /^0x[0-9a-fA-F]{64}$/.test(f.transactionId))?.transactionId;
  if (!tx) return null;
  const received = side === "buy" ? detail?.filled?.targetAmount : detail?.filled?.contraAmount;
  return { tx, received: received && Number(received) > 0 ? received : null };
}
