import { watchlistCommandSchema } from "@aftermarkets/domain";
import { appOrigin } from "./config";
import { mergeHistory } from "./post";
import { applyObservations, mirrorEnabled, setMirror } from "./follow-sync";
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
  | { type: "watchlist"; command: unknown }
  | { type: "observe-follows"; viewer: string; observations: Array<{ handle: string; following: boolean }> }
  | { type: "mirror"; enabled?: boolean }
  | { type: "flash-quote"; order: unknown }
  | { type: "flash-order"; order: unknown; signatures: unknown; context?: unknown };

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

/**
 * Relays a Flash quote or submit to the app, which validates the order, holds the API key and talks
 * to Definitive. Errors come back as { failed } so the card can show Flash's own message.
 */
async function flashCall(path: "/api/flash/quote" | "/api/flash/order", body: unknown) {
  const res = await fetch(`${appOrigin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? json : { failed: json.error ?? `Flash request failed (${res.status})` };
}

async function prices() {
  const res = await fetch(`${appOrigin}/api/prices`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((message: Request, sender, respond) => {
  const url = sender.tab?.url ?? "";
  const fromX = /^https:\/\/(x|twitter)\.com\//.test(url);
  // The app's bridge may only manage follows; everything else is for x.com tabs.
  const fromApp = url.startsWith(`${appOrigin}/`) && (message?.type === "watchlist" || message?.type === "mirror");
  if (!fromX && !fromApp) return;
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
  } else if (message?.type === "mirror" && fromApp) {
    job = typeof message.enabled === "boolean" ? setMirror(message.enabled) : mirrorEnabled().then((enabled) => ({ enabled }));
  } else if (message?.type === "flash-quote" && fromX) {
    job = flashCall("/api/flash/quote", { order: message.order });
  } else if (message?.type === "flash-order" && fromX) {
    job = flashCall("/api/flash/order", {
      order: message.order,
      signatures: message.signatures,
      context: message.context,
    });
  } else if (message?.type === "observe-follows" && fromX && Array.isArray(message.observations)) {
    const observations = message.observations.filter(
      (o) => o && typeof o.handle === "string" && typeof o.following === "boolean",
    );
    job = applyObservations(String(message.viewer), observations);
  } else return;
  job.then(respond, (err: unknown) => respond({ error: err instanceof Error ? err.message : "failed" }));
  return true; // async response
});

// The toolbar button opens popup.html (see popup.ts), which links to the desk.
