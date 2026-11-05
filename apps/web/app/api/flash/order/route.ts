import {
  buildQuoteRequest,
  buildSubmitRequest,
  flashOrderInputSchema,
  flashSignaturesSchema,
} from "@aftermarkets/integrations/definitive";
import { after } from "next/server";
import { z } from "zod";
import { recordTrade } from "@/lib/server/arkiv";
import { errorResponse, flash } from "@/lib/server/flash";

/** Where the order came from, for the trades dashboard. Not part of what Flash sees. */
const contextSchema = z
  .object({
    source: z.enum(["desk", "extension", "keyboard"]).default("desk"),
    caller: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).nullish(),
  })
  .default({ source: "desk" });

/**
 * Submit a quoted order with the funder's signatures. The order body is rebuilt from the
 * validated input on the server, so the browser can only submit what it quoted and signed.
 * Once Flash accepts it, a read-only record goes to Arkiv and is handed to the trader's wallet.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { order: unknown; signatures: unknown; context?: unknown };
    const input = flashOrderInputSchema.parse(body.order);
    const context = contextSchema.parse(body.context);
    const request = buildQuoteRequest(input);
    const submitted = await flash.submit(buildSubmitRequest(request, flashSignaturesSchema.parse(body.signatures)));
    after(() => recordTrade(input, submitted.orderId, context));
    return Response.json(submitted);
  } catch (err) {
    return errorResponse(err);
  }
}
