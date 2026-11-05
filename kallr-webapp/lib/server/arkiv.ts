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
  hasCall,
  hasResult,
  readDueCalls,
  resultValues,
  type TradeContext,
  Trades,
  tradeValues,
} from "@kallr/integrations/arkiv";
import type { CallAsset } from "@kallr/integrations/calls";
import type { FlashOrderInput } from "@kallr/integrations/definitive";
import { type Hex, http, isHex } from "viem";
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

/** The call while it's open, and its result once it settles. Each is written once. */
export function recordCall(call: ScoredCall) {
  if (!writer || call.status === "unpriced") return Promise.resolve();
  const w = writer;
  return enqueue(`call ${call.postId}`, async () => {
    const now = Math.floor(Date.now() / 1000);
    if (call.expiresAt + 3600 > now && !(await hasCall(w.reader, w.address, call.postId))) {
      await w.wallet.createEntity(Calls, callValues(call), {
        expiration: callExpiration(call, now),
        flags: { readonly: true },
      });
    }
    await writeResult(w, call);
  });
}

async function writeResult(w: NonNullable<typeof writer>, call: ScoredCall) {
  const values = resultValues(call);
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
    await enqueue(`result ${scored.postId}`, () => writeResult(w, scored));
    settled++;
  }
  return { settled, due: due.length, configured: true };
}
