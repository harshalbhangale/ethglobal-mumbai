import { buildQuoteRequest, flashOrderInputSchema } from "@kallr/integrations/definitive";
import { errorResponse, flash } from "@/lib/server/flash";

/** Quote an order on Base with Definitive Flash. Returns what the funder wallet must approve and sign; signs nothing. */
export async function POST(req: Request) {
  try {
    const { order } = (await req.json()) as { order: unknown };
    const input = flashOrderInputSchema.parse(order);
    const quote = await flash.quote(buildQuoteRequest(input));
    return Response.json({ quote });
  } catch (err) {
    return errorResponse(err);
  }
}
