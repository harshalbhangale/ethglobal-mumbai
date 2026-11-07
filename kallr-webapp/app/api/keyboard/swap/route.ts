import { after } from "next/server";
import { getBalances, getUsdPriceDecimal } from "@/lib/chain";
import { buildSwapOrder, keyboardSwapSchema, maxSwapUsd, quoteDetails, swapPreviewLines } from "@/lib/keyboard-trade";
import { recordTrade } from "@/lib/server/arkiv";
import { errorResponse } from "@/lib/server/flash";
import { keyboardWallet } from "@/lib/server/keyboard-auth";
import { uniswapOut } from "@/lib/server/uniswap";

/**
 * Swap ETH to USDC in the user's Kall wallet, from the Kall Keyboard app: the user deposits ETH, swaps some to
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
  const wallet = keyboardWallet(req);
  if ("error" in wallet) return Response.json({ error: wallet.error }, { status: wallet.status });
  try {
    const body = (await req.json()) as { usd?: unknown; dryRun?: boolean };
    const { usd } = keyboardSwapSchema.parse({ usd: body.usd });
    if (Number(usd) > MAX_SWAP_USD) {
      return Response.json({ error: `The Kall wallet swaps up to $${MAX_SWAP_USD} at a time.` }, { status: 400 });
    }
    const [{ price }, balances] = await Promise.all([getUsdPriceDecimal("ETH"), getBalances(wallet.address)]);
    const ethPrice = Number(price);
    const most = maxSwapUsd(Number(balances.eth), ethPrice);
    if (Number(usd) > most) {
      const error = most >= 1 ? `Keep about $1 of ETH for gas: swap up to $${most.toFixed(2)}.` : "Deposit ETH first: the Kall wallet only has gas money.";
      return Response.json({ error }, { status: 400 });
    }
    const input = buildSwapOrder(usd, ethPrice, wallet.address);
    const dryRun = body.dryRun === true;
    // Uniswap's pools for the same swap, measured alongside: a benchmark only, the swap goes to Flash.
    const uniswap = uniswapOut(input);
    const placed = await wallet.place(input, dryRun);
    const preview = swapPreviewLines(usd, input, placed.quote);
    const details = quoteDetails(placed.quote, input.side, await uniswap);
    if (placed.dryRun) return Response.json({ dryRun: true, preview, details, approvals: placed.approvals });
    after(() => recordTrade(input, placed.submitted.orderId, { source: "keyboard", caller: null }));
    return Response.json({ dryRun: false, orderId: placed.submitted.orderId, preview, details, approvals: placed.approvals });
  } catch (err) {
    return errorResponse(err);
  }
}
