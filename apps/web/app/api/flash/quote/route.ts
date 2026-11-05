import { buildQuoteRequest, flashOrderInputSchema } from "@aftermarkets/integrations/definitive";
import { errorResponse, flash } from "@/lib/server/flash";

/** Quote an order on Base. Returns what the funder wallet must approve and sign; signs nothing. */
export async function POST(req: Request) {
  try {
    const { order } = (await req.json()) as { order: unknown };
    const request = buildQuoteRequest(flashOrderInputSchema.parse(order));
    const quote = await flash.quote(request);
    return Response.json({ quote });
  } catch (err) {
    return errorResponse(err);
  }
}
