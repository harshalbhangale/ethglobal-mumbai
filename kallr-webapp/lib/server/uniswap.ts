import "server-only";
import { BASE_USDC, FLASH_BASE_ASSETS, type FlashOrderInput, type FlashQuote, tokenAddress } from "@kallr/integrations/definitive";
import { comparePrices, type PriceCompare, toBaseUnits, uniswapQuote } from "@kallr/integrations/uniswap";
import { erc20Abi, type Address } from "viem";
import { publicClient } from "@/lib/chain";

/**
 * Flash vs Uniswap for the trade the user is about to sign: same tokens, same amount, same moment.
 * Kall Markets only ever trades through Definitive Flash; this is the benchmark line under the quote.
 * Off (null) without UNISWAP_API_KEY, for limit/TWAP orders, or when Uniswap is slow or errors.
 */

const API_KEY = process.env.UNISWAP_API_KEY ?? "";
export const uniswapEnabled = Boolean(API_KEY);

const USDC_DECIMALS = 6;
const decimalsCache = new Map<string, number>();

async function decimalsOf(token: string): Promise<number | null> {
  const known = Object.values(FLASH_BASE_ASSETS).find((a) => a.address.toLowerCase() === token.toLowerCase());
  if (known) return known.decimals;
  if (token.toLowerCase() === BASE_USDC.toLowerCase()) return USDC_DECIMALS;
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
 * Uniswap's quote for the same swap as the order: what goes in, what comes out (native ETH counts as
 * WETH). Start it together with the Flash quote so the benchmark adds no wait.
 */
export async function uniswapFor(order: FlashOrderInput): Promise<{ amountOut: bigint; outDecimals: number } | null> {
  if (!uniswapEnabled || order.orderType !== "market") return null;
  const asset = tokenAddress(order.asset);
  const [tokenIn, tokenOut] = order.side === "buy" ? [BASE_USDC, asset] : [asset, BASE_USDC];
  const [inDecimals, outDecimals] = await Promise.all([decimalsOf(tokenIn), decimalsOf(tokenOut)]);
  if (inDecimals === null || outDecimals === null) return null;
  const uni = await uniswapQuote({ tokenIn, tokenOut, amountIn: toBaseUnits(order.qty, inDecimals), swapper: order.funderAddress }, API_KEY);
  return uni ? { amountOut: uni.amountOut, outDecimals } : null;
}

/** Flash's quote beside Uniswap's, or null when Uniswap had no answer. */
export function compareWith(quote: FlashQuote, uni: { amountOut: bigint; outDecimals: number } | null): PriceCompare | null {
  return uni ? comparePrices(quote.to.amount, uni.amountOut, uni.outDecimals) : null;
}
