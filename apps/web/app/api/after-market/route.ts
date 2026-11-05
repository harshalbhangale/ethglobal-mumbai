import { type ScoredCall, scoreCall, summarize } from "@aftermarkets/integrations/after-market";
import { checkToken, type TokenCheck } from "@aftermarkets/integrations/safety-checks";
import { tokenReferences } from "@aftermarkets/integrations/token-references";
import { z } from "zod";

// Token checks are cached for 10 minutes per contract.
const tokenCache = new Map<string, { at: number; check: TokenCheck | null }>();
async function cachedTokenCheck(address: string) {
  const hit = tokenCache.get(address);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.check;
  const check = await checkToken(address).catch(() => null);
  if (tokenCache.size > 2000) tokenCache.clear();
  tokenCache.set(address, { at: Date.now(), check });
  return check;
}

/**
 * After market for a post on X: this call's move since posting, plus the caller's record
 * from their posts the viewer's extension has seen. Read-only; no X API involved.
 */

const post = z.object({
  postId: z.string().regex(/^[0-9]{1,30}$/),
  text: z.string().min(1).max(2000),
});
const bodySchema = z.object({
  handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  post,
  history: z.array(post).max(40).default([]),
});

// Scored calls are cached per post for 5 minutes: open calls move, closed ones don't change.
const cache = new Map<string, { at: number; call: ScoredCall | null }>();
const TTL_MS = 5 * 60_000;

async function cachedScore(handle: string, p: z.infer<typeof post>, now: number) {
  const key = `${p.postId}:${p.text.length}`;
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at < TTL_MS || (hit.call && hit.call.status !== "open"))) return hit.call;
  const call = await scoreCall({ postId: p.postId, handle, text: p.text }, now).catch(() => null);
  if (cache.size > 5000) cache.clear();
  cache.set(key, { at: Date.now(), call });
  return call;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { post: current, history } = parsed.data;
  const handle = parsed.data.handle.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  // A post that shares a contract address gets the token checked, call or not.
  const evmRef = tokenReferences(current.text).find((r) => r.kind === "evm");
  const [call, token] = await Promise.all([
    cachedScore(handle, current, now),
    evmRef ? cachedTokenCheck(evmRef.address) : Promise.resolve(null),
  ]);
  const others = history.filter((h) => h.postId !== current.postId);
  const scored: ScoredCall[] = [];
  for (const h of others) {
    const c = await cachedScore(handle, h, now);
    if (c) scored.push(c);
  }
  if (call) scored.push(call);
  const { calls: _calls, ...record } = summarize(handle, scored);
  // Compact per-call rows for the card's stats; newest first, no post text echoed back.
  const calls = scored
    .sort((a, b) => b.postedAt - a.postedAt)
    .map(({ postId, asset, direction, status, returnBps, postedAt, expiresAt }) => ({
      postId,
      asset,
      direction,
      status,
      returnBps,
      postedAt,
      expiresAt,
    }));
  return Response.json({ call, record, calls, checks: { token }, coverage: "posts seen in this browser" });
}
