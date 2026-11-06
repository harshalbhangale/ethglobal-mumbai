import { z } from "zod";
import { errorResponse } from "@/lib/server/flash";
import { authorized, cancelFromKeyboardWallet, keyboardWalletAddress } from "@/lib/server/keyboard-wallet";

/**
 * Cancel an open order the Kall keyboard wallet placed (a limit or TWAP still working). The server
 * signs Flash's cancel message with the keyboard wallet; Flash rejects orders it didn't fund.
 */
export async function POST(req: Request) {
  if (!keyboardWalletAddress) return Response.json({ error: "The keyboard wallet isn't set up on this server." }, { status: 503 });
  if (!authorized(req)) return Response.json({ error: "This build can't cancel orders." }, { status: 401 });
  try {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(await req.json());
    await cancelFromKeyboardWallet(orderId);
    return Response.json({ cancelled: orderId });
  } catch (err) {
    return errorResponse(err);
  }
}
