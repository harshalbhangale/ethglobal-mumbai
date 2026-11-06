import { after } from "next/server";
import { getBalances, getUsdPriceDecimal } from "@/lib/chain";
import { buildSwapOrder, keyboardSwapSchema, maxSwapUsd, quoteDetails, swapPreviewLines } from "@/lib/keyboard-trade";
import { recordTrade } from "@/lib/server/arkiv";
import { errorResponse } from "@/lib/server/flash";
import { authorized, keyboardWalletAddress, placeFromKeyboardWallet } from "@/lib/server/keyboard-wallet";
import { compareWith, uniswapFor } from "@/lib/server/uniswap";

/**
 * Swap ETH to USDC in the Kall wallet, from the Kall Keyboard app: the user deposits ETH, swaps some to
 * USDC here, and the keyboard's buys spend that USDC. A market sell of native ETH on Definitive Flash
 * (wrap, approve, sign, submit) that always leaves about $1 of ETH for gas.
 *
 *   POST → { usd, dryRun? }; dryRun quotes and signs but sends nothing
 */
export const dynamic = "force-dynamic";
/** Wrap, approval (each waits for Base), signing and submit. */
export const maxDuration = 60;

const MAX_SWAP_USD = Number(process.env.KALL_EXEC_MAX_SWAP_USD ?? "100");

export async function POST(req: Request) {
  if (!keyboardWalletAddress) return Response.json({ error: "The keyboard wallet isn't set up on this server." }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "This build can't swap." }, { status: 401 });
  try {
    const body = (await req.json()) as { usd?: unknown; dryRun?: boolean };
    const { usd } = keyboardSwapSchema.parse({ usd: body.usd });
    if (Number(usd) > MAX_SWAP_USD) {
      return Response.json({ error: `The Kall wallet swaps up to $${MAX_SWAP_USD} at a time.` }, { status: 400 });
    }
    const [{ price }, balances] = await Promise.all([getUsdPriceDecimal("ETH"), getBalances(keyboardWalletAddress)]);
    const ethPrice = Number(price);
    const most = maxSwapUsd(Number(balances.eth), ethPrice);
    if (Number(usd) > most) {
      const error = most >= 1 ? `Keep about $1 of ETH for gas: swap up to $${most.toFixed(2)}.` : "Deposit ETH first: the Kall wallet only has gas money.";
      return Response.json({ error }, { status: 400 });
    }
    const input = buildSwapOrder(usd, ethPrice, keyboardWalletAddress);
    const dryRun = body.dryRun === true;
    const [placed, uni] = await Promise.all([placeFromKeyboardWallet(input, dryRun), dryRun ? uniswapFor(input).catch(() => null) : null]);
    const preview = swapPreviewLines(usd, input, placed.quote);
    const details = quoteDetails(placed.quote);
    if (placed.dryRun) return Response.json({ dryRun: true, preview, details, approvals: placed.approvals, compare: compareWith(placed.quote, uni) });
    after(() => recordTrade(input, placed.submitted.orderId, { source: "keyboard", caller: null }));
    return Response.json({ dryRun: false, orderId: placed.submitted.orderId, preview, details, approvals: placed.approvals });
  } catch (err) {
    return errorResponse(err);
  }
}
