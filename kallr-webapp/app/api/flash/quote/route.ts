import { buildQuoteRequest, flashOrderInputSchema } from "@kallr/integrations/definitive";
import { errorResponse, flash } from "@/lib/server/flash";
import { uniswapOut } from "@/lib/server/uniswap";

/**
 * Quote an order on Base with Definitive Flash. Returns what the funder wallet must approve and sign;
 * signs nothing. `uniswapOut` is what Uniswap's pools would give for the same trade (null when not
 * measured): a benchmark only, the order always goes to Definitive Flash.
 */
export async function POST(req: Request) {
  try {
    const { order } = (await req.json()) as { order: unknown };
    const input = flashOrderInputSchema.parse(order);
    // Both at once: the Uniswap benchmark never makes the Flash quote wait longer.
    const uniswap = uniswapOut(input);
    const quote = await flash.quote(buildQuoteRequest(input));
    return Response.json({ quote, uniswapOut: await uniswap });
  } catch (err) {
    return errorResponse(err);
  }
}
