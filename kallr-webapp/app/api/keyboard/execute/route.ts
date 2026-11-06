import { after } from "next/server";
import { getBalances } from "@/lib/chain";
import { buildKeyboardOrder, keyboardOrderSchema, previewLines, quoteDetails } from "@/lib/keyboard-trade";
import { recordTrade } from "@/lib/server/arkiv";
import { errorResponse } from "@/lib/server/flash";
import { authorized, keyboardWalletAddress, MAX_ORDER_USD, placeFromKeyboardWallet } from "@/lib/server/keyboard-wallet";
import { tradeTokenByKey } from "@/lib/server/keyboard-tokens";
import { compareWith, uniswapFor } from "@/lib/server/uniswap";

/**
 * One-tap orders from the Kall keyboard on iPhone. The keyboard sends a simple order (token,
 * dollars, exits as percents) with its build token; the server places it on Definitive Flash from
 * the Kall keyboard wallet and records it on Arkiv as a keyboard trade.
 *
 *   GET  → the wallet's address, balances and per-order cap (to fund it and show what it holds)
 *   POST → { order, dryRun? }; dryRun quotes and signs but sends nothing
 */
export const dynamic = "force-dynamic";
/** Quote, two approvals that wait for Base, signing and submit can take 10–30s; the default is shorter. */
export const maxDuration = 60;

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
    // The review also sets the Flash quote beside Uniswap's for the same trade (a benchmark only).
    const dryRun = body.dryRun === true;
    const [placed, uni] = await Promise.all([placeFromKeyboardWallet(input, dryRun), dryRun ? uniswapFor(input).catch(() => null) : null]);
    const preview = previewLines(order, input, placed.quote, token.symbol);
    // What the review card shows next to the preview: Flash's own estimates for this quote.
    const details = quoteDetails(placed.quote);
    if (placed.dryRun) return Response.json({ dryRun: true, preview, details, approvals: placed.approvals, compare: compareWith(placed.quote, uni) });
    after(() => recordTrade(input, placed.submitted.orderId, { source: "keyboard", caller: order.caller ?? null }));
    return Response.json({ dryRun: false, orderId: placed.submitted.orderId, preview, details, approvals: placed.approvals });
  } catch (err) {
    return errorResponse(err);
  }
}
