import { errorResponse, flash } from "@/lib/server/flash";

export const dynamic = "force-dynamic";

/** Recent Flash orders for one funder wallet, newest first. */
export async function GET(req: Request) {
  try {
    const funder = new URL(req.url).searchParams.get("funder") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(funder)) return Response.json({ error: "funder must be an address" }, { status: 400 });
    return Response.json({ orders: await flash.listOrders(funder) });
  } catch (err) {
    return errorResponse(err);
  }
}
