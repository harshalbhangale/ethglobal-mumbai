import { errorResponse, flash } from "@/lib/server/flash";

export const dynamic = "force-dynamic";

/** One Flash order's status and fills: the on-chain transaction hash and the venues it routed through. */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return Response.json({ error: "orderId must be a UUID" }, { status: 400 });
  try {
    return Response.json(await flash.getOrder(orderId));
  } catch (err) {
    return errorResponse(err);
  }
}
