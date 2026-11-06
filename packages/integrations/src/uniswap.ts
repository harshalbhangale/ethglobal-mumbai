import { z } from "zod";

/**
 * Uniswap Trading API, used only as a price benchmark: every Definitive Flash quote is compared with
 * what Uniswap's v2/v3/v4 pools would give for the same trade at the same moment. Kall Markets never
 * routes an order through it; Flash stays the only way to trade. Server-only (the key stays here).
 *
 * Docs: https://developers.uniswap.org/docs/api-reference/aggregator_quote
 */

export const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";
export const BASE_CHAIN_ID = 8453;

/** The parts of a /quote answer we read. Pool routes (CLASSIC) give output.amount; UniswapX gives orderInfo outputs. */
const quoteResponse = z
  .object({
    routing: z.string().optional(),
    quote: z
      .object({
        output: z.object({ amount: z.string() }).partial().passthrough().optional(),
        orderInfo: z
          .object({ outputs: z.array(z.object({ startAmount: z.string().optional() }).passthrough()).optional() })
          .passthrough()
          .optional(),
        priceImpact: z.union([z.number(), z.string()]).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type UniswapQuote = { amountOut: bigint; routing: string; priceImpact: number | null };

/**
 * Quote an exact-input swap on Base through Uniswap's pools. `amountIn` is in the input token's base
 * units. Returns null on any failure or after `timeoutMs`, so a slow Uniswap never delays a Flash quote.
 */
export async function uniswapQuote(
  input: { tokenIn: string; tokenOut: string; amountIn: bigint; swapper: string },
  apiKey: string,
  timeoutMs = 2500,
  fetcher: typeof fetch = fetch,
): Promise<UniswapQuote | null> {
  if (!apiKey || input.amountIn <= 0n) return null;
  try {
    const res = await fetcher(`${UNISWAP_API_URL}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        type: "EXACT_INPUT",
        amount: input.amountIn.toString(),
        tokenInChainId: BASE_CHAIN_ID,
        tokenOutChainId: BASE_CHAIN_ID,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        swapper: input.swapper,
        routingPreference: "BEST_PRICE",
        // Pools only: a like-for-like on-chain AMM price to set beside Flash.
        protocols: ["V2", "V3", "V4"],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const parsed = quoteResponse.safeParse(await res.json());
    if (!parsed.success) return null;
    const q = parsed.data.quote;
    const raw = q.output?.amount ?? q.orderInfo?.outputs?.[0]?.startAmount;
    if (!raw || !/^[0-9]+$/.test(raw)) return null;
    const impact = q.priceImpact === undefined ? null : Number(q.priceImpact);
    return { amountOut: BigInt(raw), routing: parsed.data.routing ?? "CLASSIC", priceImpact: Number.isFinite(impact) ? impact : null };
  } catch {
    return null;
  }
}

/** Decimal string → base units, e.g. ("1.5", 6) → 1500000n. Extra decimals are cut, never rounded up. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(amount)) return 0n;
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole + frac.slice(0, decimals).padEnd(decimals, "0"));
}

export type PriceCompare = {
  /** Units of the output token, as decimal strings. */
  flashOut: string;
  uniswapOut: string;
  /** How much more Flash gives than Uniswap, in percent; negative when Uniswap gives more. */
  edgePct: number;
  winner: "flash" | "uniswap" | "tie";
};

/** Flash's output (decimal string) against Uniswap's (base units), in the output token's decimals. */
export function comparePrices(flashOut: string, uniswapOut: bigint, outDecimals: number): PriceCompare | null {
  const flash = toBaseUnits(flashOut, outDecimals);
  if (flash <= 0n || uniswapOut <= 0n) return null;
  // Basis points of a basis point, so tiny edges still show: (flash − uni) / uni.
  const edgePct = Number(((flash - uniswapOut) * 1_000_000n) / uniswapOut) / 10_000;
  const scale = 10 ** outDecimals;
  return {
    flashOut,
    uniswapOut: (Number(uniswapOut) / scale).toString(),
    edgePct,
    winner: Math.abs(edgePct) < 0.01 ? "tie" : edgePct > 0 ? "flash" : "uniswap",
  };
}
