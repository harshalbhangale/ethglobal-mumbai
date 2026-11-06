import { buildQuoteRequest, flashOrderInputSchema } from "@kallr/integrations/definitive";
import { errorResponse, flash } from "@/lib/server/flash";
import { compareWith, uniswapFor } from "@/lib/server/uniswap";

/**
 * Quote an order on Base. Returns what the funder wallet must approve and sign; signs nothing.
 * `compare` sets the Flash quote beside Uniswap's for the same trade (null when unavailable); the
 * order itself always goes to Definitive Flash.
 */
export async function POST(req: Request) {
  try {
    const { order } = (await req.json()) as { order: unknown };
    const input = flashOrderInputSchema.parse(order);
    // Both quotes at once: the Uniswap benchmark never makes the Flash quote wait longer.
    const uniswap = uniswapFor(input).catch(() => null);
    const quote = await flash.quote(buildQuoteRequest(input));
    return Response.json({ quote, compare: compareWith(quote, await uniswap) });
  } catch (err) {
    return errorResponse(err);
  }
}
