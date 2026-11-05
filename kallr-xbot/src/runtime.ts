import { type CallerRecord, callerRecord } from "@kallr/integrations/after-market";
import { type XClient, type XCredentials, xClient } from "@kallr/integrations/x-api";

export function credentialsFromEnv(): XCredentials | null {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) return null;
  return { apiKey: X_API_KEY, apiSecret: X_API_SECRET, accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_SECRET };
}

export const appUrl = () => process.env.APP_URL || "http://localhost:3000";
export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Caller records from their recent posts, cached so busy threads don't burn the X rate limit. */
export function recordLookup(x: XClient | null, ttlMs = 10 * 60_000) {
  const ids = new Map<string, string>();
  const cache = new Map<string, { at: number; record: CallerRecord }>();
  return {
    remember(handle: string, userId: string) {
      ids.set(handle.toLowerCase(), userId);
    },
    async record(handle: string): Promise<CallerRecord | null> {
      if (!x) return null;
      const key = handle.toLowerCase();
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.record;
      const id = ids.get(key) ?? (await x.userByHandle(key)).id;
      ids.set(key, id);
      const posts = await x.userPosts(id, 100);
      const record = await callerRecord(
        key,
        posts.map((p) => ({ postId: p.id, handle: key, text: p.text })),
        nowSeconds(),
      );
      cache.set(key, { at: Date.now(), record });
      return record;
    },
  };
}
