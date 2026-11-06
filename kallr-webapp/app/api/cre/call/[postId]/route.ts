import { readCallScore } from "@/lib/server/cre";

export const dynamic = "force-dynamic";

/** The Chainlink CRE score for one call (hit, miss or flat, with the signed transaction), or scored: false. */
export async function GET(_req: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!/^\d{1,25}$/.test(postId)) return Response.json({ error: "Invalid postId" }, { status: 400 });
  const s = await readCallScore(postId).catch(() => null);
  return Response.json(s ? { scored: true, ...s } : { scored: false });
}
