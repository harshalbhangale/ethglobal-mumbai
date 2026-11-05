import { buildQuoteRequest } from "@kallr/integrations/definitive";
import { buildKeyboardOrder, keyboardOrderSchema, previewLines } from "@/lib/keyboard-trade";
import { errorResponse, flash } from "@/lib/server/flash";
import { tradeTokenByKey } from "@/lib/server/keyboard-tokens";

/**
 * The keyboard's trade panel: a simple order (token, dollars, TP/SL and limit as percents, TWAP
 * minutes) becomes the shared Flash order input at the live price, and gets quoted. The keyboard
 * signs the quote with the user's embedded wallet and submits through /api/flash/order with
 * context { source: "keyboard" }. Nothing here signs or trades.
 */
export async function POST(req: Request) {
  try {
    const order = keyboardOrderSchema.parse(await req.json());
    const token = await tradeTokenByKey(order.token);
    const input = buildKeyboardOrder(order, token.price);
    const quote = await flash.quote(buildQuoteRequest(input));
    return Response.json({
      order: input,
      quote,
      token: { symbol: token.symbol, price: token.price },
      preview: previewLines(order, input, quote, token.symbol),
      context: { source: "keyboard", caller: order.caller ?? null },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
