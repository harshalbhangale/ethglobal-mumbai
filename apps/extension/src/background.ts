import { mergeHistory } from "./post";

declare const AFTERMARKETS_APP_ORIGIN: string;

/**
 * Service worker: the only part that talks to the AfterMarkets API. It remembers the calls
 * each caller has posted that this browser has seen (chrome.storage.local, nothing leaves
 * the browser except the post text sent for scoring) and asks the API for the after market.
 */

type SeenPost = { postId: string; text: string };
type Request = { type: "after-market"; handle: string; post: SeenPost };

async function history(handle: string, post: SeenPost) {
  const key = `seen:${handle}`;
  const stored = ((await chrome.storage.local.get(key))[key] as SeenPost[] | undefined) ?? [];
  const next = mergeHistory(stored, post);
  await chrome.storage.local.set({ [key]: next });
  return next;
}

const inflight = new Map<string, Promise<unknown>>();

async function afterMarket(req: Request) {
  const seen = await history(req.handle, req.post);
  const res = await fetch(`${AFTERMARKETS_APP_ORIGIN}/api/after-market`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: req.handle, post: req.post, history: seen }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((message: Request, sender, respond) => {
  if (message?.type !== "after-market" || !sender.tab?.url?.match(/^https:\/\/(x|twitter)\.com\//)) return;
  const key = message.post.postId;
  const job = inflight.get(key) ?? afterMarket(message).finally(() => inflight.delete(key));
  inflight.set(key, job);
  job.then(respond, (err: unknown) => respond({ error: err instanceof Error ? err.message : "failed" }));
  return true; // async response
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${AFTERMARKETS_APP_ORIGIN}/app` });
});
