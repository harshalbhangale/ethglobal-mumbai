import { getAddress, isAddress } from "viem";
import { getBalances, getUsdPriceDecimal } from "@/lib/chain";
import { errorResponse } from "@/lib/server/flash";
import { authorized, keyboardWalletAddress, withdrawFromKeyboardWallet } from "@/lib/server/keyboard-wallet";

/**
 * Withdraw from the Kall wallet to the user's own wallet: ETH or USDC on Base, to an address they type in
 * the Kall app. ETH keeps a little for gas, and each withdrawal is capped (KALL_EXEC_MAX_WITHDRAW_USD, $100).
 *
 *   POST → { asset: "ETH" | "USDC", amount, to, dryRun? }; dryRun checks it and sends nothing
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_WITHDRAW_USD = Number(process.env.KALL_EXEC_MAX_WITHDRAW_USD || "100");
/** A Base transfer costs well under a cent; this covers it with room to spare. */
const GAS_RESERVE_ETH = 0.00005;
const AMOUNT = { ETH: /^\d+(\.\d{1,18})?$/, USDC: /^\d+(\.\d{1,6})?$/ } as const;

const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function POST(req: Request) {
  if (!keyboardWalletAddress) return Response.json({ error: "The keyboard wallet isn't set up on this server." }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "This build can't withdraw." }, { status: 401 });
  try {
    const body = (await req.json()) as { asset?: unknown; amount?: unknown; to?: unknown; dryRun?: unknown };
    const asset = body.asset === "ETH" || body.asset === "USDC" ? body.asset : null;
    if (!asset) return bad("Pick ETH or USDC.");
    const amount = typeof body.amount === "string" ? body.amount.trim() : "";
    if (!AMOUNT[asset].test(amount) || !(Number(amount) > 0)) return bad("Enter an amount.");
    if (typeof body.to !== "string" || !isAddress(body.to.trim())) return bad("Enter a Base address (0x…).");
    const to = getAddress(body.to.trim());
    if (to === getAddress(keyboardWalletAddress)) return bad("That's the Kall wallet itself.");

    const [{ price }, balances] = await Promise.all([getUsdPriceDecimal("ETH"), getBalances(keyboardWalletAddress)]);
    const eth = Number(balances.eth);
    const most = asset === "ETH" ? Math.max(0, eth - GAS_RESERVE_ETH) : Number(balances.usdc);
    if (Number(amount) > most) return bad(`The Kall wallet can send up to ${most.toFixed(asset === "ETH" ? 6 : 2)} ${asset}.`);
    if (asset === "USDC" && eth < GAS_RESERVE_ETH) return bad("Add a little ETH for gas first.");
    const usd = asset === "ETH" ? Number(amount) * Number(price) : Number(amount);
    if (usd > MAX_WITHDRAW_USD) return bad(`Up to $${MAX_WITHDRAW_USD} per withdrawal.`);

    const preview = { asset, amount, to, usd: Math.round(usd * 100) / 100 };
    if (body.dryRun === true) return Response.json({ dryRun: true, ...preview });
    const tx = await withdrawFromKeyboardWallet({ asset, amount, to });
    return Response.json({ dryRun: false, ...preview, tx });
  } catch (err) {
    return errorResponse(err);
  }
}
