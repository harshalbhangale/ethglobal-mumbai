import { watchlistCommandSchema } from "@aftermarkets/domain";
import { appOrigin } from "./config";
import { mergeHistory } from "./post";
import { readWatchlist, updateWatchlist } from "./watchlist-storage";

/**
 * Service worker: the only part that talks to the AfterMarkets API. It remembers the calls
 * each caller has posted that this browser has seen (chrome.storage.local, nothing leaves
 * the browser except the post text sent for scoring) and asks the API for the after market.
 */

type SeenPost = { postId: string; text: string };
type Request =
  | { type: "after-market"; handle: string; post: SeenPost }
  | { type: "prices" }
  | { type: "caller-record"; handle: string }
  | { type: "watchlist"; command: unknown };

const HANDLE = /^[a-z0-9_]{1,15}$/;

async function history(handle: string, post: SeenPost) {
  const key = `seen:${handle}`;
  const stored = ((await chrome.storage.local.get(key))[key] as SeenPost[] | undefined) ?? [];
  const next = mergeHistory(stored, post);
  await chrome.storage.local.set({ [key]: next });
  return next;
}

const inflight = new Map<string, Promise<unknown>>();

async function afterMarket(req: Extract<Request, { type: "after-market" }>) {
  const seen = await history(req.handle, req.post);
  const res = await fetch(`${appOrigin}/api/after-market`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: req.handle, post: req.post, history: seen }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/** A caller's record from the posts this browser has seen, for their profile page. */
async function callerRecord(handle: string) {
  const key = `seen:${handle}`;
  const seen = ((await chrome.storage.local.get(key))[key] as SeenPost[] | undefined) ?? [];
  const [newest, ...rest] = seen;
  if (!newest) return { calls: [], record: null, seen: 0 };
  const res = await fetch(`${appOrigin}/api/after-market`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, post: newest, history: rest }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return { ...(await res.json()), seen: seen.length };
}

async function watchlist(raw: unknown) {
  const command = watchlistCommandSchema.parse(raw);
  return command.action === "read" ? { entries: await readWatchlist() } : updateWatchlist(command);
}

async function prices() {
  const res = await fetch(`${appOrigin}/api/prices`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((message: Request, sender, respond) => {
  if (!sender.tab?.url?.match(/^https:\/\/(x|twitter)\.com\//)) return;
  let job: Promise<unknown>;
  if (message?.type === "after-market") {
    const key = message.post.postId;
    job = inflight.get(key) ?? afterMarket(message).finally(() => inflight.delete(key));
    inflight.set(key, job);
  } else if (message?.type === "prices") {
    job = inflight.get("prices") ?? prices().finally(() => inflight.delete("prices"));
    inflight.set("prices", job);
  } else if (message?.type === "caller-record" && HANDLE.test(message.handle)) {
    const key = `record:${message.handle}`;
    job = inflight.get(key) ?? callerRecord(message.handle).finally(() => inflight.delete(key));
    inflight.set(key, job);
  } else if (message?.type === "watchlist") {
    job = watchlist(message.command);
  } else return;
  job.then(respond, (err: unknown) => respond({ error: err instanceof Error ? err.message : "failed" }));
  return true; // async response
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${appOrigin}/app` });
});
