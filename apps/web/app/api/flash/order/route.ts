import {
  buildQuoteRequest,
  buildSubmitRequest,
  flashOrderInputSchema,
  flashSignaturesSchema,
} from "@aftermarkets/integrations/definitive";
import { errorResponse, flash } from "@/lib/server/flash";

/**
 * Submit a quoted order with the funder's signatures. The order body is rebuilt from the
 * validated input on the server, so the browser can only submit what it quoted and signed.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { order: unknown; signatures: unknown };
    const request = buildQuoteRequest(flashOrderInputSchema.parse(body.order));
    const submitted = await flash.submit(buildSubmitRequest(request, flashSignaturesSchema.parse(body.signatures)));
    return Response.json(submitted);
  } catch (err) {
    return errorResponse(err);
  }
}
