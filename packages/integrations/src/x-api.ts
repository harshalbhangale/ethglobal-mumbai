import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * X API v2 for the @AfterMarkets bot: read mentions and a caller's posts, post replies.
 * Signed with OAuth 1.0a user context (the bot account's tokens), which never expire.
 * Server-only.
 */

export const X_API_URL = "https://api.x.com/2";

export type XCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * OAuth 1.0a Authorization header (RFC 5849, HMAC-SHA1). `params` are query or form
 * parameters that are part of the signature; JSON bodies are not.
 */
export function oauthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  params: Record<string, string> = {},
  fixed?: { nonce: string; timestamp: string },
) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: fixed?.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [enc(k), enc(all[k] ?? "")] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return `OAuth ${Object.keys(oauth)
    .sort()
    .map((k) => `${enc(k)}="${enc(oauth[k] ?? "")}"`)
    .join(", ")}`;
}

const postSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string().optional(),
  conversation_id: z.string().optional(),
  created_at: z.string().optional(),
  referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
});
export type XPost = z.infer<typeof postSchema>;
const userSchema = z.object({ id: z.string(), username: z.string(), name: z.string().optional() });
export type XUser = z.infer<typeof userSchema>;

const timelineSchema = z.object({
  data: z.array(postSchema).optional(),
  includes: z.object({ tweets: z.array(postSchema).optional(), users: z.array(userSchema).optional() }).optional(),
  meta: z.object({ newest_id: z.string().optional(), result_count: z.number().optional() }).optional(),
});

/** A mention with the post it replies to (the call), when there is one. */
export type Mention = {
  post: XPost;
  author: XUser | null;
  parent: XPost | null;
  parentAuthor: XUser | null;
};

const POST_FIELDS = "author_id,conversation_id,created_at,referenced_tweets";

export class XApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function xClient(creds: XCredentials, fetcher: typeof fetch = fetch) {
  async function call(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown) {
    const url = `${X_API_URL}${path}`;
    const qs = new URLSearchParams(query).toString();
    const res = await fetcher(qs ? `${url}?${qs}` : url, {
      method,
      headers: {
        authorization: oauthHeader(method, url, creds, query),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as { detail?: string; title?: string } | null;
    if (!res.ok) throw new XApiError(json?.detail ?? json?.title ?? `X API ${res.status}`, res.status);
    return json;
  }

  return {
    async me(): Promise<XUser> {
      const res = z.object({ data: userSchema }).parse(await call("GET", "/users/me"));
      return res.data;
    },

    async userByHandle(handle: string): Promise<XUser> {
      const res = z.object({ data: userSchema }).parse(await call("GET", `/users/by/username/${encodeURIComponent(handle)}`));
      return res.data;
    },

    /** Mentions newer than `sinceId`, oldest first, each joined with the post it replies to. */
    async mentions(userId: string, sinceId?: string): Promise<{ mentions: Mention[]; newestId?: string }> {
      const query: Record<string, string> = {
        max_results: "50",
        "tweet.fields": POST_FIELDS,
        expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
        "user.fields": "username",
      };
      if (sinceId) query.since_id = sinceId;
      const res = timelineSchema.parse(await call("GET", `/users/${userId}/mentions`, query));
      const posts = new Map((res.includes?.tweets ?? []).map((t) => [t.id, t]));
      const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));
      const mentions = (res.data ?? []).map((post) => {
        const parentId = post.referenced_tweets?.find((r) => r.type === "replied_to")?.id;
        const parent = parentId ? (posts.get(parentId) ?? null) : null;
        return {
          post,
          author: post.author_id ? (users.get(post.author_id) ?? null) : null,
          parent,
          parentAuthor: parent?.author_id ? (users.get(parent.author_id) ?? null) : null,
        };
      });
      return { mentions: mentions.reverse(), newestId: res.meta?.newest_id };
    },

    /** A user's own recent posts (no retweets or replies), newest first. */
    async userPosts(userId: string, max = 100): Promise<XPost[]> {
      const res = timelineSchema.parse(
        await call("GET", `/users/${userId}/tweets`, {
          max_results: String(Math.min(Math.max(max, 5), 100)),
          exclude: "retweets,replies",
          "tweet.fields": POST_FIELDS,
        }),
      );
      return res.data ?? [];
    },

    async reply(inReplyTo: string, text: string): Promise<string> {
      const res = z
        .object({ data: z.object({ id: z.string() }) })
        .parse(await call("POST", "/tweets", {}, { text, reply: { in_reply_to_tweet_id: inReplyTo } }));
      return res.data.id;
    },
  };
}
export type XClient = ReturnType<typeof xClient>;
