import {
  CALL_ASSETS,
  CALL_METHODOLOGY,
  type CallAsset,
  observePrice,
  PRICE_TOLERANCE_SECONDS,
  type PriceObservation,
  postTimestampMs,
} from "./calls";
import { DEFAULT_CALL_HORIZON_SECONDS, heuristicSignal, statedTimeframe } from "./signals";

/**
 * The after market of a call: what the price did after it was posted.
 *
 * Each call is priced at the minute it was posted and scored at the end of its stated
 * timeframe (24h when none is stated) under directional-return-v1: any move in the called
 * direction is a hit. These are hypothetical returns of the call, not anyone's wallet
 * returns, and only posts we were shown are covered: a caller's deleted posts are missing.
 */

export type CallPost = { postId: string; handle: string; text: string };

export type ScoredCall = {
  postId: string;
  handle: string;
  asset: CallAsset;
  direction: "up" | "down";
  postedAt: number;
  expiresAt: number;
  horizonStated: boolean;
  entry: number | null;
  /** Exit price for a scored call, latest price for an open one. */
  last: number | null;
  status: "hit" | "miss" | "flat" | "open" | "unpriced";
  /** Move in the called direction, in basis points (+ means the call was right so far). */
  returnBps: number | null;
};

export type Observe = (asset: CallAsset, timestamp: number) => Promise<PriceObservation | null>;

const toNumber = (o: PriceObservation | null) => (o ? Number(o.price) / 10 ** o.priceDecimals : null);

/** Null when the post isn't a directional call on an asset we can price. */
export async function scoreCall(
  post: CallPost,
  nowSeconds: number,
  observe: Observe = (a, t) => observePrice(a, t),
): Promise<ScoredCall | null> {
  const signal = heuristicSignal({ postId: post.postId, handle: post.handle, text: post.text });
  if (!signal.isCall || !signal.direction || !signal.asset || !(signal.asset in CALL_ASSETS)) return null;
  const asset = signal.asset as CallAsset;
  const stated = statedTimeframe(post.text);
  const postedAt = Math.floor(Number(postTimestampMs(post.postId)) / 1000);
  const expiresAt = postedAt + (stated ?? DEFAULT_CALL_HORIZON_SECONDS);
  const direction = signal.direction === "bullish" ? "up" : "down";
  const base = { postId: post.postId, handle: post.handle, asset, direction, postedAt, expiresAt, horizonStated: stated !== null } as const;
  return priceCall(base, nowSeconds, observe);
}

export type CallBase = Pick<ScoredCall, "postId" | "handle" | "asset" | "direction" | "postedAt" | "expiresAt" | "horizonStated">;

/** Prices a call we already know the shape of, e.g. one stored on Arkiv, without its post text. */
export async function priceCall(
  base: CallBase,
  nowSeconds: number,
  observe: Observe = (a, t) => observePrice(a, t),
): Promise<ScoredCall> {
  const { asset, direction, postedAt, expiresAt } = base;
  const entry = toNumber(await observe(asset, postedAt));
  if (entry === null) return { ...base, entry: null, last: null, status: "unpriced", returnBps: null };

  const expired = nowSeconds >= expiresAt + PRICE_TOLERANCE_SECONDS;
  // Open calls are marked against the last complete minute.
  const last = toNumber(await observe(asset, expired ? expiresAt : nowSeconds - 120));
  if (last === null) return { ...base, entry, last: null, status: expired ? "unpriced" : "open", returnBps: null };

  const move = (direction === "up" ? last - entry : entry - last) / entry;
  const returnBps = Math.round(move * 10_000);
  const status = !expired ? "open" : returnBps > 0 ? "hit" : returnBps < 0 ? "miss" : "flat";
  return { ...base, entry, last, status, returnBps };
}

export type CallerRecord = {
  handle: string;
  methodology: typeof CALL_METHODOLOGY;
  scored: number;
  hits: number;
  /** Hits / scored, 0–1; null with nothing scored. */
  hitRate: number | null;
  medianReturnBps: number | null;
  open: number;
  calls: ScoredCall[];
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

export function summarize(handle: string, calls: ScoredCall[]): CallerRecord {
  const done = calls.filter((c) => c.status === "hit" || c.status === "miss" || c.status === "flat");
  const hits = done.filter((c) => c.status === "hit").length;
  return {
    handle,
    methodology: CALL_METHODOLOGY,
    scored: done.length,
    hits,
    hitRate: done.length ? hits / done.length : null,
    medianReturnBps: median(done.map((c) => c.returnBps ?? 0)),
    open: calls.filter((c) => c.status === "open").length,
    calls,
  };
}

/** Scores up to `limit` calls among a caller's posts, sequentially to stay polite to price sources. */
export async function callerRecord(
  handle: string,
  posts: CallPost[],
  nowSeconds: number,
  options: { limit?: number; observe?: Observe } = {},
): Promise<CallerRecord> {
  const scored: ScoredCall[] = [];
  for (const post of posts) {
    if (scored.length >= (options.limit ?? 20)) break;
    const call = await scoreCall(post, nowSeconds, options.observe);
    if (call) scored.push(call);
  }
  return summarize(handle, scored);
}

const pct = (bps: number) => `${bps >= 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(1)}%`;
const price = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 4 })}`;

function timeLeft(seconds: number) {
  if (seconds >= 2 * 86400) return `${Math.round(seconds / 86400)}d left`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h left`;
  return `${Math.max(1, Math.round(seconds / 60))}m left`;
}

/** One line on a single call, e.g. "$ETH up from $2,418 → $2,455 (+1.5%), 22h left". */
export function describeCall(call: ScoredCall, nowSeconds: number) {
  const head = `$${call.asset} ${call.direction}`;
  if (call.entry === null) return `${head}: no price at posting time`;
  const from = `from ${price(call.entry)}`;
  if (call.last === null || call.returnBps === null) return `${head} ${from}`;
  const move = `${from} → ${price(call.last)} (${pct(call.returnBps)})`;
  if (call.status === "open") return `${head} ${move}, ${timeLeft(call.expiresAt - nowSeconds)}`;
  return `${head} ${move}: ${call.status === "hit" ? "hit" : call.status === "miss" ? "missed" : "flat"}`;
}

/** One line on a caller's record, e.g. "7 of 11 calls hit (64%), median +3.2%". */
export function describeRecord(record: CallerRecord) {
  if (!record.scored) return record.open ? `${record.open} open call${record.open > 1 ? "s" : ""}, none scored yet` : "No scored calls yet";
  const rate = Math.round((record.hitRate ?? 0) * 100);
  const median = record.medianReturnBps === null ? "" : `, median ${pct(record.medianReturnBps)}`;
  const open = record.open ? ` · ${record.open} open` : "";
  return `${record.hits} of ${record.scored} calls hit (${rate}%)${median}${open}`;
}
