import { z } from "zod";
import { errorResponse } from "@/lib/server/flash";
import { keyboardWallet } from "@/lib/server/keyboard-auth";

/**
 * Cancel an open order the keyboard placed (a limit or TWAP still working). The server signs Flash's
 * cancel message with the same wallet that placed it; Flash rejects orders it didn't fund.
 */
export async function POST(req: Request) {
  const wallet = keyboardWallet(req);
  if ("error" in wallet) return Response.json({ error: wallet.error }, { status: wallet.status });
  try {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(await req.json());
    await wallet.cancel(orderId);
    return Response.json({ cancelled: orderId });
  } catch (err) {
    return errorResponse(err);
  }
}
