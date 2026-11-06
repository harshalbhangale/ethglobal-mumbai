import "server-only";
import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { priceCall, type ScoredCall } from "@kallr/integrations/after-market";
import {
  arkivPublic,
  CallResults,
  Calls,
  callExpiration,
  callValues,
  callSnapshot,
  findCall,
  findResultKey,
  hasResult,
  readDueCalls,
  readOpenCalls,
  readResults,
  resultValues,
  type TradeContext,
  Trades,
  tradeValues,
} from "@kallr/integrations/arkiv";
import type { CallAsset } from "@kallr/integrations/calls";
import type { FlashOrderInput } from "@kallr/integrations/definitive";
import { type Hex, http, isHex } from "viem";
import { uploadJson } from "./swarm";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Writes Kallr records to Arkiv (testnet Rabdi) with the server's key, which pays the gas
 * (tGLM from hub.arkiv.network/faucet). Without ARKIV_PRIVATE_KEY nothing is written and the app
 * works as before. Writes run one at a time so the account's nonce never races.
 */

const accessKey = process.env.ARKIV_ACCESS_KEY ?? "";
const privateKey = process.env.ARKIV_PRIVATE_KEY;

function makeWriter() {
  if (!privateKey || !isHex(privateKey)) return null;
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    wallet: createWalletClient({ chain: rabdi({ accessKey }), transport: http(), account }),
    reader: arkivPublic(accessKey),
  };
}

const writer = makeWriter();
export const arkivWriterAddress: Hex | null = writer?.address ?? null;

/** One caller's record as Arkiv has it: settled calls plus the ones still open, newest first. */
export async function callerRecordFromArkiv(handle: string) {
  if (!writer) return null;
  const h = handle.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const [settled, open] = await Promise.all([readResults(writer.reader, writer.address, h), readOpenCalls(writer.reader, writer.address, now)]);
  const dir = (v: unknown) => (v === "down" || v === "short" ? "down" : "up") as "up" | "down";
  const calls = [
    ...settled.map((e) => ({
      postId: String(e.postId.value),
      asset: String(e.asset.value),
      direction: dir(e.direction.value),
      status: (e.status.value === "hit" ? "hit" : e.status.value === "miss" ? "miss" : "flat") as "hit" | "miss" | "flat",
      returnBps: Number(e.returnBps.value),
      postedAt: Number(e.postedAt.value),
      expiresAt: Number(e.deadline.value),
    })),
    ...open
      .filter((e) => String(e.caller.value) === h)
      .map((e) => ({
        postId: String(e.postId.value),
        asset: String(e.asset.value),
        direction: dir(e.direction.value),
        status: "open" as const,
        returnBps: null,
        postedAt: Number(e.postedAt.value),
        expiresAt: Number(e.deadline.value),
      })),
  ].sort((a, b) => b.postedAt - a.postedAt);
  return { calls, writer: writer.address };
}

let queue: Promise<unknown> = Promise.resolve();
function enqueue(label: string, job: () => Promise<void>) {
  const run = queue.then(job).catch((err) => console.error(`[arkiv] ${label} failed:`, err instanceof Error ? err.message : err));
  queue = run;
  return run;
}

/** A trade record the trader owns: created read-only by us, then handed to their wallet. */
export function recordTrade(input: FlashOrderInput, orderId: string, context: TradeContext) {
  if (!writer) return Promise.resolve();
  const w = writer;
  return enqueue(`trade ${orderId}`, async () => {
    const { entityKey } = await w.wallet.createEntity(
      Trades,
      tradeValues(input, orderId, context, Math.floor(Date.now() / 1000)),
      { expiration: ExpirationTime.max(), flags: { readonly: true } },
    );
    const trader = input.funderAddress as Hex;
    if (trader.toLowerCase() !== w.address.toLowerCase()) {
      await w.wallet.changeOwnership({ entityKey, newOwner: trader });
    }
  });
}

/** Swarm references by post, so a failed Arkiv write doesn't upload the same snapshot again. */
const snapshots = new Map<string, string>();

/**
 * The call while it's open, and its result once it settles. Each is written once. The first time we
 * see a call with its post text, a snapshot of the post goes to Swarm and both entities keep its
 * reference, so the call stays provable after the post is deleted.
 */
export function recordCall(call: ScoredCall, text?: string) {
  if (!writer || call.status === "unpriced") return Promise.resolve();
  const w = writer;
  return enqueue(`call ${call.postId}`, async () => {
    const now = Math.floor(Date.now() / 1000);
    const existing = await findCall(w.reader, w.address, call.postId);
    let swarmRef = existing?.swarmRef ?? snapshots.get(call.postId) ?? null;
    if (!existing && call.expiresAt + 3600 > now) {
      if (text && !swarmRef) {
        swarmRef = await uploadJson(`kallr-call-${call.postId}.json`, callSnapshot(call, text, now)).catch((err) => {
          console.error("[swarm] snapshot failed:", err instanceof Error ? err.message : err);
          return null;
        });
        if (swarmRef) snapshots.set(call.postId, swarmRef);
      }
      await w.wallet.createEntity(Calls, callValues(call, swarmRef), {
        expiration: callExpiration(call, now),
        flags: { readonly: true },
      });
    }
    await writeResult(w, call, swarmRef);
  });
}

async function writeResult(w: NonNullable<typeof writer>, call: ScoredCall, swarmRef?: string | null) {
  const values = resultValues(call, swarmRef);
  if (!values || (await hasResult(w.reader, w.address, call.postId))) return;
  await w.wallet.createEntity(CallResults, values, {
    expiration: ExpirationTime.max(),
    flags: { readonly: true, permissionlessExtension: true },
  });
}

/** Settles stored calls whose deadline has passed. Safe to run any number of times. */
export async function settleDueCalls(nowSeconds: number) {
  if (!writer) return { settled: 0, due: 0, configured: false };
  const w = writer;
  const due = await readDueCalls(w.reader, w.address, nowSeconds);
  let settled = 0;
  for (const c of due) {
    const scored = await priceCall(
      {
        postId: c.postId.value,
        handle: c.caller.value,
        asset: c.asset.value as CallAsset,
        direction: c.direction.value === "down" ? "down" : "up",
        postedAt: Number(c.postedAt.value),
        expiresAt: Number(c.deadline.value),
        horizonStated: c.horizonStated.value,
      },
      nowSeconds,
    ).catch(() => null);
    if (!scored || !resultValues(scored)) continue;
    const swarmRef = c.swarmRef?.value ?? null;
    await enqueue(`result ${scored.postId}`, () => writeResult(w, scored, swarmRef));
    settled++;
  }
  return { settled, due: due.length, configured: true };
}

/** Calls whose deadline has passed, in the shape the Chainlink CRE scorer reads (kall-cre/score-calls). */
export async function dueCallsForCre(nowSeconds: number) {
  if (!writer) return [];
  const due = await readDueCalls(writer.reader, writer.address, nowSeconds);
  return due.map((c) => ({
    postId: c.postId.value,
    handle: c.caller.value,
    asset: c.asset.value,
    direction: c.direction.value === "down" ? "down" : "up",
    postedAt: Number(c.postedAt.value),
    expiresAt: Number(c.deadline.value),
  }));
}

/** The Arkiv entity key of a stored call, for a direct explorer link, or null when it isn't stored yet. */
export async function callEntityKey(postId: string): Promise<string | null> {
  if (!writer) return null;
  // A settled call's permanent record is its result; an open call is still its own entity.
  const result = await findResultKey(writer.reader, writer.address, postId).catch(() => null);
  if (result) return result;
  const open = await findCall(writer.reader, writer.address, postId).catch(() => null);
  return open?.key ?? null;
}
