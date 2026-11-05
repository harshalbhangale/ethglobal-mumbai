import { createPublicClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq, gt, lte } from "@arkiv-network/sdk/query";
import { addr, bool, dec, defineSchema, i32, str, u64 } from "@arkiv-network/sdk/schema";
import { type Hex, http } from "viem";
import type { ScoredCall } from "./after-market";
import type { FlashOrderInput } from "./definitive";

/**
 * Kallr data on Arkiv (testnet Rabdi). Trades run on Base mainnet through Flash; their
 * records, and every call we price, live here so anyone can read them without asking us.
 *
 * Anyone can write an entity with our schema tags, so every read is restricted to entities our
 * writer created (`createdBy`). The writer then hands each trade to the trader's wallet: the
 * creator proves we saw the order on Flash, the owner is the trader.
 */

export const ARKIV_CHAIN_ID = 7794095;
export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";

/** A Flash order placed through Kallr. Read-only once written; owned by the trader. */
export const Trades = defineSchema("kallr.trades", {
  trader: addr().indexed(),
  /** Which surface placed it: desk, extension or keyboard. */
  source: str().indexed(),
  asset: str().indexed(),
  side: str().indexed(),
  orderType: str(),
  /** As sent to Flash: USDC on a buy, asset units on a sell. */
  qty: str(),
  limitPrice: str().optional(),
  /** Exit trigger prices in USD, when a TP/SL bracket is attached. */
  takeProfit: str().optional(),
  stopLoss: str().optional(),
  flashOrderId: str().indexed(),
  /** The call on X this trade copied, if any. */
  postId: str().indexed().optional(),
  caller: str().indexed().optional(),
  placedAt: u64().indexed(),
});

/** A call on X while it is open. Expires a scoring window after its deadline. */
export const Calls = defineSchema("kallr.calls", {
  postId: str().indexed(),
  caller: str().indexed(),
  asset: str().indexed(),
  direction: str().indexed(),
  postedAt: u64().indexed(),
  deadline: u64().indexed(),
  horizonStated: bool(),
  /** Chainlink price at the minute it was posted; absent when unpriced. */
  entry: dec().optional(),
  /** Swarm reference of the post snapshot (text and link as seen when priced), so a deleted post stays provable. */
  swarmRef: str().optional(),
});

/** How a call ended. Anyone may extend it so a caller's record outlives Arkiv's max lifetime; nobody can edit it. */
export const CallResults = defineSchema("kallr.call-results", {
  postId: str().indexed(),
  caller: str().indexed(),
  asset: str().indexed(),
  direction: str(),
  /** hit, miss or flat. */
  status: str().indexed(),
  /** Move in the called direction, basis points. */
  returnBps: i32().indexed(),
  entry: dec(),
  exit: dec(),
  postedAt: u64(),
  deadline: u64().indexed(),
  /** The same Swarm snapshot as the call, kept for the result's ~182-day life. */
  swarmRef: str().optional(),
});

export type TradeSource = "desk" | "extension" | "keyboard";
export type TradeContext = { source: TradeSource; caller?: string | null };

/** After a call's deadline we keep it this long so the scorer can settle it, then Arkiv drops it. */
export const SCORING_WINDOW_SECONDS = 2 * 24 * 60 * 60;
/** Arkiv's longest lifetime is about 182.5 days; stay a day inside it. */
const MAX_SECONDS = 181 * 24 * 60 * 60;

const decimal = (n: number) => dec(n.toFixed(8).replace(/\.?0+$/, ""));

export function tradeValues(input: FlashOrderInput, orderId: string, context: TradeContext, placedAt: number) {
  return {
    trader: addr(input.funderAddress as Hex),
    source: context.source,
    asset: input.asset,
    side: input.side,
    orderType: input.orderType,
    qty: input.qty,
    ...(input.limitPrice ? { limitPrice: input.limitPrice } : {}),
    ...(input.takeProfit ? { takeProfit: input.takeProfit.notionalPrice } : {}),
    ...(input.stopLoss ? { stopLoss: input.stopLoss.notionalPrice } : {}),
    flashOrderId: orderId,
    ...(input.sourcePostId ? { postId: input.sourcePostId } : {}),
    ...(context.caller ? { caller: context.caller.toLowerCase() } : {}),
    placedAt: u64(BigInt(placedAt)),
  };
}

export function callValues(call: ScoredCall, swarmRef?: string | null) {
  return {
    ...(swarmRef ? { swarmRef } : {}),
    postId: call.postId,
    caller: call.handle.toLowerCase(),
    asset: call.asset,
    direction: call.direction,
    postedAt: u64(BigInt(call.postedAt)),
    deadline: u64(BigInt(call.expiresAt)),
    horizonStated: call.horizonStated,
    ...(call.entry !== null ? { entry: decimal(call.entry) } : {}),
  };
}

/** Values for a settled call, or null while it is open or unpriced. */
export function resultValues(call: ScoredCall, swarmRef?: string | null) {
  if (call.status !== "hit" && call.status !== "miss" && call.status !== "flat") return null;
  if (call.entry === null || call.last === null || call.returnBps === null) return null;
  return {
    ...(swarmRef ? { swarmRef } : {}),
    postId: call.postId,
    caller: call.handle.toLowerCase(),
    asset: call.asset,
    direction: call.direction,
    status: call.status,
    returnBps: i32(call.returnBps),
    entry: decimal(call.entry),
    exit: decimal(call.last),
    postedAt: u64(BigInt(call.postedAt)),
    deadline: u64(BigInt(call.expiresAt)),
  };
}

/** A call lives through its timeframe plus the scoring window, capped at Arkiv's max lifetime. */
export function callExpiration(call: Pick<ScoredCall, "expiresAt">, nowSeconds: number) {
  const until = Math.min(call.expiresAt + SCORING_WINDOW_SECONDS, nowSeconds + MAX_SECONDS);
  return ExpirationTime.atDate(new Date(Math.max(until, nowSeconds + 3600) * 1000));
}

// ---------- Reads (browser or server) ----------

export function arkivPublic(accessKey = "") {
  return createPublicClient({ chain: rabdi({ accessKey }), transport: http() });
}
export type ArkivPublic = ReturnType<typeof arkivPublic>;

export async function readTrades(client: ArkivPublic, writer: Hex, trader?: Hex) {
  const q = client.select().from(Trades).createdBy(writer);
  const filtered = trader ? q.where(eq("trader", addr(trader))) : q;
  return (await filtered.orderBy(desc("placedAt")).limit(100).fetch()).entities;
}

export async function readResults(client: ArkivPublic, writer: Hex, caller?: string) {
  const q = client.select().from(CallResults).createdBy(writer);
  const filtered = caller ? q.where(eq("caller", caller.toLowerCase())) : q;
  return (await filtered.orderBy(desc("deadline")).limit(100).fetch()).entities;
}

export async function readOpenCalls(client: ArkivPublic, writer: Hex, nowSeconds: number) {
  return (
    await client
      .select()
      .from(Calls)
      .createdBy(writer)
      .where(gt("deadline", u64(BigInt(nowSeconds))))
      .orderBy(desc("postedAt"))
      .limit(100)
      .fetch()
  ).entities;
}

/** Calls past their deadline, still inside the scoring window. */
export async function readDueCalls(client: ArkivPublic, writer: Hex, nowSeconds: number) {
  return (
    await client
      .select()
      .from(Calls)
      .createdBy(writer)
      .where(lte("deadline", u64(BigInt(nowSeconds))))
      .limit(100)
      .fetch()
  ).entities;
}

/** The stored call for a post, with its Swarm snapshot reference, or null. */
export async function findCall(client: ArkivPublic, writer: Hex, postId: string) {
  const page = await client
    .select({ $key: true, swarmRef: true })
    .from(Calls)
    .createdBy(writer)
    .where(eq("postId", postId))
    .limit(1)
    .fetch();
  const row = page.entities[0];
  return row ? { key: row.$key, swarmRef: row.swarmRef?.value ?? null } : null;
}

/** What Kallr saves to Swarm when it first prices a call: the post as seen, and the call it read. */
export function callSnapshot(call: ScoredCall, text: string, capturedAt: number) {
  return {
    kind: "kallr.call-snapshot",
    version: 1,
    postId: call.postId,
    url: `https://x.com/${call.handle}/status/${call.postId}`,
    caller: call.handle.toLowerCase(),
    text: text.slice(0, 2000),
    asset: call.asset,
    direction: call.direction,
    postedAt: call.postedAt,
    deadline: call.expiresAt,
    entry: call.entry,
    priceSource: "chainlink-base",
    capturedAt,
  };
}

export async function hasCall(client: ArkivPublic, writer: Hex, postId: string) {
  const page = await client.select({ $key: true }).from(Calls).createdBy(writer).where(eq("postId", postId)).limit(1).fetch();
  return page.entities.length > 0;
}

/**
 * Callers Kallr follows and prices: the roster the portal and the extension start from.
 * One entity per handle, written by our writer and re-written by `npm run arkiv:callers`.
 */
export const TrackedCallers = defineSchema("kallr.tracked-callers", {
  handle: str().indexed(),
  /** Why they're tracked, shown under their name. */
  focus: str(),
  addedAt: u64().indexed(),
});

/** Well-known crypto callers on X who post directional calls on BTC, ETH and alts. */
export const TRACKED_CALLERS: Array<{ handle: string; focus: string }> = [
  { handle: "rektcapital", focus: "BTC cycle and altcoin technicals" },
  { handle: "pentosh1", focus: "BTC, ETH and majors" },
  { handle: "cryptokaleo", focus: "BTC and high-conviction alts" },
  { handle: "cryptodonalt", focus: "BTC and ETH swing calls" },
  { handle: "hsakatrades", focus: "Perps flow and majors" },
  { handle: "smartcontracter", focus: "Elliott-wave BTC and ETH" },
  { handle: "altcoinsherpa", focus: "Altcoin setups" },
  { handle: "cryptocred", focus: "Technical analysis on majors" },
  { handle: "inmortalcrypto", focus: "BTC and alt cycle calls" },
];

export async function readTrackedCallers(client: ArkivPublic, writer: Hex) {
  return (await client.select().from(TrackedCallers).createdBy(writer).orderBy(desc("addedAt")).limit(100).fetch()).entities;
}

export async function hasResult(client: ArkivPublic, writer: Hex, postId: string) {
  const page = await client
    .select({ $key: true })
    .from(CallResults)
    .createdBy(writer)
    .where(eq("postId", postId))
    .limit(1)
    .fetch();
  return page.entities.length > 0;
}
