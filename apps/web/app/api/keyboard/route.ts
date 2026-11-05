import { scoreCall } from "@aftermarkets/integrations/after-market";
import { fetchPublicPost } from "@aftermarkets/integrations/calls";
import { checkToken } from "@aftermarkets/integrations/safety-checks";
import { z } from "zod";
import { keyboardLookup } from "@/lib/keyboard";

/**
 * The AfterMarkets row on the Android keyboard (apps/keyboard). Read-only: it prices the
 * call a copied X link points at, checks a shared contract, and turns a typed order into
 * a desk link. Nothing here signs or trades.
 */

const post = z.object({
  postId: z.string().regex(/^[0-9]{1,30}$/),
  handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).transform((h) => h.toLowerCase()),
  text: z.string().min(1).max(2000),
});
const bodySchema = z.object({
  text: z.string().max(2000).optional(),
  typed: z.string().max(500).optional(),
  history: z.array(post).max(40).default([]),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = await keyboardLookup(parsed.data, {
    // Desk links open in the phone's browser on the origin the keyboard talks to.
    appOrigin: process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin,
    nowSeconds,
    fetchPost: (id) => fetchPublicPost(id),
    score: (p) => scoreCall(p, nowSeconds),
    checkToken: (address) => checkToken(address),
  });
  return Response.json(result);
}
