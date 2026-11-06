import { after } from "next/server";
import { getBalances } from "@/lib/chain";
import { buildKeyboardOrder, keyboardOrderSchema, previewLines, quoteDetails } from "@/lib/keyboard-trade";
import { recordTrade } from "@/lib/server/arkiv";
import { errorResponse } from "@/lib/server/flash";
import { keyboardWallet } from "@/lib/server/keyboard-auth";
import { keyboardWalletAddress, MAX_ORDER_USD } from "@/lib/server/keyboard-wallet";
import { tradeTokenByKey } from "@/lib/server/keyboard-tokens";

/**
 * One-tap orders from the Kall keyboard on iPhone. The keyboard sends a simple order (token, dollars,
 * exits as percents) with the key from linking the user's Kall wallet; the server places it on
 * Definitive Flash from that wallet and records it on Arkiv as a keyboard trade. (Builds that still send
 * the old build token trade from the shared keyboard wallet until it's emptied.)
 *
 *   GET  → the wallet's address, balances and per-order cap
 *   POST → { order, dryRun? }; dryRun quotes and signs but sends nothing
 */
export const dynamic = "force-dynamic";
/** Quote, two approvals that wait for Base, signing and submit can take 10–30s; the default is shorter. */
export const maxDuration = 60;

export async function GET(req: Request) {
  const linked = keyboardWallet(req);
  // Builds from before linking read the shared wallet without a token; keep answering them.
  const wallet = "error" in linked ? (keyboardWalletAddress ? { kind: "shared", address: keyboardWalletAddress, maxUsd: MAX_ORDER_USD } : null) : linked;
  if (!wallet) return Response.json({ configured: false });
  const balances = await getBalances(wallet.address).catch(() => null);
  return Response.json({ configured: true, wallet: wallet.kind, address: wallet.address, maxUsd: wallet.maxUsd, balances });
}

export async function POST(req: Request) {
  const wallet = keyboardWallet(req);
  if ("error" in wallet) return Response.json({ error: wallet.error }, { status: wallet.status });
  try {
    const body = (await req.json()) as { order?: Record<string, unknown>; dryRun?: boolean };
    const order = keyboardOrderSchema.parse({ ...body.order, funder: wallet.address });
    if (Number(order.usd) > wallet.maxUsd) {
      return Response.json({ error: `Keyboard orders are up to $${wallet.maxUsd} each.` }, { status: 400 });
    }
    const token = await tradeTokenByKey(order.token);
    const input = buildKeyboardOrder(order, token.price);
    const dryRun = body.dryRun === true;
    const placed = await wallet.place(input, dryRun);
    const preview = previewLines(order, input, placed.quote, token.symbol);
    // What the review card shows next to the preview: Flash's own estimates for this quote.
    const details = quoteDetails(placed.quote);
    if (placed.dryRun) return Response.json({ dryRun: true, preview, details, approvals: placed.approvals });
    after(() => recordTrade(input, placed.submitted.orderId, { source: "keyboard", caller: order.caller ?? null }));
    return Response.json({ dryRun: false, orderId: placed.submitted.orderId, preview, details, approvals: placed.approvals });
  } catch (err) {
    return errorResponse(err);
  }
}
