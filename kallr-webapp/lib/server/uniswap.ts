import "server-only";
import { BASE_USDC, FLASH_BASE_ASSETS, type FlashOrderInput, tokenAddress } from "@kallr/integrations/definitive";
import { type Address, erc20Abi, formatUnits, parseAbi, parseUnits } from "viem";
import { publicClient } from "@/lib/chain";

/**
 * Uniswap as a price benchmark only: what Uniswap v3's pools on Base would give for the same trade at
 * the same moment, read from Uniswap's own QuoterV2 contract (an eth_call: no API key, nothing sent).
 * Kall Markets never routes an order through Uniswap; every trade goes to Definitive Flash.
 */

/** Uniswap v3 QuoterV2 on Base. */
const QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
/** Every v3 fee tier: the best single pool is the benchmark. */
const FEES = [100, 500, 3000, 10000] as const;
const TIMEOUT_MS = 2500;

const decimalsCache = new Map<string, number>();
async function decimalsOf(token: string): Promise<number | null> {
  if (token.toLowerCase() === BASE_USDC.toLowerCase()) return 6;
  const known = Object.values(FLASH_BASE_ASSETS).find((a) => a.address.toLowerCase() === token.toLowerCase());
  if (known) return known.decimals;
  const hit = decimalsCache.get(token.toLowerCase());
  if (hit !== undefined) return hit;
  try {
    const d = Number(await publicClient.readContract({ address: token as Address, abi: erc20Abi, functionName: "decimals" }));
    if (decimalsCache.size > 500) decimalsCache.clear();
    decimalsCache.set(token.toLowerCase(), d);
    return d;
  } catch {
    return null;
  }
}

/**
 * What Uniswap's best v3 pool gives for this market order, as a decimal string of the output token.
 * Null for limit/TWAP orders, when no pool has the pair, or after 2.5s: it never delays a trade.
 */
export async function uniswapOut(order: FlashOrderInput): Promise<string | null> {
  if (order.orderType !== "market") return null;
  const run = async () => {
    // Native ETH sells go through WETH on both sides.
    const asset = tokenAddress(order.asset);
    const [tokenIn, tokenOut] = order.side === "buy" ? [BASE_USDC, asset] : [asset, BASE_USDC];
    const [inDecimals, outDecimals] = await Promise.all([decimalsOf(tokenIn), decimalsOf(tokenOut)]);
    if (inDecimals === null || outDecimals === null) return null;
    const amountIn = parseUnits(order.qty, inDecimals);
    if (amountIn <= 0n) return null;
    const outs = await Promise.all(
      FEES.map((fee) =>
        publicClient
          .simulateContract({
            address: QUOTER,
            abi: quoterAbi,
            functionName: "quoteExactInputSingle",
            args: [{ tokenIn: tokenIn as Address, tokenOut: tokenOut as Address, amountIn, fee, sqrtPriceLimitX96: 0n }],
          })
          .then((r) => r.result[0])
          .catch(() => 0n),
      ),
    );
    const best = outs.reduce((a, b) => (b > a ? b : a), 0n);
    return best > 0n ? formatUnits(best, outDecimals) : null;
  };
  return Promise.race([run().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS))]);
}
