import { after } from "next/server";
import { getBalances } from "@/lib/chain";
import { buildKeyboardOrder, keyboardOrderSchema, previewLines } from "@/lib/keyboard-trade";
import { recordTrade } from "@/lib/server/arkiv";
import { errorResponse } from "@/lib/server/flash";
import { authorized, keyboardWalletAddress, MAX_ORDER_USD, placeFromKeyboardWallet } from "@/lib/server/keyboard-wallet";
import { tradeTokenByKey } from "@/lib/server/keyboard-tokens";

/**
 * One-tap orders from the Kall keyboard on iPhone. The keyboard sends a simple order (token,
 * dollars, exits as percents) with its build token; the server places it on Definitive Flash from
 * the Kall keyboard wallet and records it on Arkiv as a keyboard trade.
 *
 *   GET  → the wallet's address, balances and per-order cap (to fund it and show what it holds)
 *   POST → { order, dryRun? }; dryRun quotes and signs but sends nothing
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!keyboardWalletAddress) return Response.json({ configured: false });
  const balances = await getBalances(keyboardWalletAddress).catch(() => null);
  return Response.json({ configured: true, address: keyboardWalletAddress, maxUsd: MAX_ORDER_USD, balances });
}

export async function POST(req: Request) {
  if (!keyboardWalletAddress) return Response.json({ error: "The keyboard wallet isn't set up on this server." }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "This build can't place orders." }, { status: 401 });
  try {
    const body = (await req.json()) as { order?: Record<string, unknown>; dryRun?: boolean };
    const order = keyboardOrderSchema.parse({ ...body.order, funder: keyboardWalletAddress });
    if (Number(order.usd) > MAX_ORDER_USD) {
      return Response.json({ error: `The keyboard wallet places up to $${MAX_ORDER_USD} per order.` }, { status: 400 });
    }
    const token = await tradeTokenByKey(order.token);
    const input = buildKeyboardOrder(order, token.price);
    const placed = await placeFromKeyboardWallet(input, body.dryRun === true);
    const preview = previewLines(order, input, placed.quote, token.symbol);
    if (placed.dryRun) return Response.json({ dryRun: true, preview, approvals: placed.approvals });
    after(() => recordTrade(input, placed.submitted.orderId, { source: "keyboard", caller: order.caller ?? null }));
    return Response.json({ dryRun: false, orderId: placed.submitted.orderId, preview, approvals: placed.approvals });
  } catch (err) {
    return errorResponse(err);
  }
}
