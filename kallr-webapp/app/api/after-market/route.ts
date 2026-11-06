import { type ScoredCall, scoreCall, summarize } from "@kallr/integrations/after-market";
import { checkToken, type TokenCheck } from "@kallr/integrations/safety-checks";
import { tokenReferences } from "@kallr/integrations/token-references";
import { after } from "next/server";
import { z } from "zod";
import { aiEnabled, readCall } from "@/lib/server/ai";
import { callEntityKey, recordCall } from "@/lib/server/arkiv";

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
  // The AI reads the post when a key is set; sarcasm, questions and commentary aren't calls.
  const call = await scoreCall({ postId: p.postId, handle, text: p.text }, now, undefined, aiEnabled ? readCall : undefined).catch(() => null);
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
  // Every call we price goes to Arkiv once (open, then its result), after the response.
  if (call) after(() => recordCall(call, current.text));
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
  // The call's own record on Arkiv, so the card can link straight to it (null until it's written).
  const arkivKey = await callEntityKey(current.postId);
  return Response.json({ call, record, calls, checks: { token }, arkivKey, coverage: "posts seen in this browser" });
}
