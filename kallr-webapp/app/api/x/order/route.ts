import { flashOrderInputSchema } from "@kallr/integrations/definitive";
import { after } from "next/server";
import { z } from "zod";
import { recordTrade } from "@/lib/server/arkiv";
import { errorResponse } from "@/lib/server/flash";
import { placeWithSigner } from "@/lib/server/flash-place";
import { privySigner, serverSigningReady } from "@/lib/server/privy-wallet";
import { uniswapOut } from "@/lib/server/uniswap";
import { bearer, readXKey } from "@/lib/server/x-key";

/**
 * A trade from the X card, signed by the user's Kall wallet on the server: no wallet pop-up. The
 * extension sends the order with its X key; the order must pay from and back to that key's wallet,
 * and stays under a per-order cap. Recorded on Arkiv as an extension trade.
 */
export const dynamic = "force-dynamic";
/** Quote, approvals that wait for Base, signing and submit can take 10–30s. */
export const maxDuration = 60;

const MAX_X_ORDER_USD = Number(process.env.KALL_X_MAX_USD ?? "25");

const bodySchema = z.object({ order: z.unknown(), caller: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).nullish() });

// One order per wallet at a time, so approvals never race the wallet's nonce.
const queues = new Map<string, Promise<unknown>>();

export async function POST(req: Request) {
  if (!serverSigningReady) return Response.json({ error: "Trading from X isn't set up on this server yet." }, { status: 503 });
  const key = readXKey(bearer(req));
  if (!key) return Response.json({ error: "Turn on trading from X in Kall Markets › Wallet." }, { status: 401 });
  try {
    const body = bodySchema.parse(await req.json());
    const input = flashOrderInputSchema.parse(body.order);
    if (input.funderAddress.toLowerCase() !== key.address.toLowerCase()) {
      return Response.json({ error: "This order isn't for your Kall wallet." }, { status: 403 });
    }
    const over = `Trades from X are up to $${MAX_X_ORDER_USD} each. Use Kall Markets for more.`;
    if (input.side === "buy" && Number(input.qty) > MAX_X_ORDER_USD) return Response.json({ error: over }, { status: 400 });

    // Uniswap's pools for the same trade, measured alongside: shown on the receipt, never traded on.
    const uniswap = uniswapOut(input);
    const run = (queues.get(key.walletId) ?? Promise.resolve()).then(() =>
      placeWithSigner(input, privySigner(key.walletId, key.address), {
        // A sell's size is in tokens: check its dollar value on the quote, before anything is signed.
        check: (quote) => {
          if (input.side === "sell" && !(Number(quote.from.notional) <= MAX_X_ORDER_USD)) throw Object.assign(new Error(over), { status: 400 });
        },
      }),
    );
    queues.set(key.walletId, run.catch(() => undefined));
    const placed = await run;
    const caller = body.caller ?? null;
    after(() => recordTrade(input, placed.submitted.orderId, { source: "extension", caller }));
    return Response.json({
      orderId: placed.submitted.orderId,
      from: key.address,
      exits: placed.submitted.attachedBracket?.status ?? null,
      received: placed.quote.to.amount,
      txs: placed.txs,
      signature: placed.signatures.userSignature,
      typedData: placed.quote.evm.orderTypedData,
      // Flash's own numbers, for the receipt on the X card: amounts, price impact and fee.
      quote: {
        from: placed.quote.from,
        to: placed.quote.to,
        estimatedPriceImpact: placed.quote.estimatedPriceImpact ?? null,
        fees: placed.quote.fees ?? null,
      },
      uniswapOut: await uniswap,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
