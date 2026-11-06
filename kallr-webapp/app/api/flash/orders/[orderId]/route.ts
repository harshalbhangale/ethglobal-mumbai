import { errorResponse, flash } from "@/lib/server/flash";

export const dynamic = "force-dynamic";

/**
 * One Flash order's status and fills: the on-chain transaction hash and the venues it routed through.
 * `?funder=` is the wallet that placed it, which Flash needs to find the order.
 */
export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return Response.json({ error: "orderId must be a UUID" }, { status: 400 });
  const funder = new URL(req.url).searchParams.get("funder");
  if (funder && !/^0x[0-9a-fA-F]{40}$/.test(funder)) return Response.json({ error: "funder must be an address" }, { status: 400 });
  try {
    return Response.json(await flash.getOrder(orderId, funder ?? undefined));
  } catch (err) {
    return errorResponse(err);
  }
}
