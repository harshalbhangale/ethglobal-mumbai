"use client";

import { type WatchlistEntry, watchlistLimit, watchlistSchema } from "@aftermarkets/domain";

/**
 * Who you follow on AfterMarkets. With the extension installed the list lives there (so following
 * on X and here is one list); otherwise it is kept in this browser only. A followed handle is a
 * lookup hint, never a verified identity. Moves to the account with /api/follows (PLAN 5b).
 */

export type FollowCommand = { action: "read" } | { action: "add" | "remove"; handle: string };
export type FollowSource = "extension" | "browser";

const REQUEST = "aftermarkets-follows-request";
const RESPONSE = "aftermarkets-follows-response";
const LOCAL_KEY = "aftermarkets.follows.v1";
const TIMEOUT_MS = 2500;

export const HANDLE = /^[a-z0-9_]{1,15}$/;

export function normalize(input: string): string | null {
  const handle = input.trim().replace(/^@/, "").replace(/^https?:\/\/(x|twitter)\.com\//i, "").split(/[/?#]/)[0]?.toLowerCase() ?? "";
  return HANDLE.test(handle) ? handle : null;
}

export function extensionInstalled() {
  return typeof document !== "undefined" && document.documentElement.dataset.aftermarketsExtension === "1";
}

/** One request through the extension's app bridge. Rejects when it isn't installed or doesn't answer. */
function bridge(payload: Record<string, unknown>): Promise<unknown> {
  const nonce = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window) return;
      if (event.data?.type !== RESPONSE || event.data.nonce !== nonce) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data.value);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Extension not connected"));
    }, TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.postMessage({ type: REQUEST, nonce, ...payload }, location.origin);
  });
}

export async function extensionFollows(command: FollowCommand): Promise<WatchlistEntry[]> {
  const parsed = watchlistSchema.safeParse(await bridge(command));
  if (!parsed.success) throw new Error("The extension couldn't update the list (it holds up to 50).");
  return parsed.data.entries;
}

/** "Follow here when I follow on X": read it, or set it when `enabled` is given. */
export async function extensionMirror(enabled?: boolean): Promise<boolean> {
  const value = (await bridge(enabled === undefined ? { action: "mirror-read" } : { action: "mirror-set", enabled })) as {
    enabled?: unknown;
  } | null;
  if (typeof value?.enabled !== "boolean") throw new Error("The extension didn't answer. Reload it and try again.");
  return value.enabled;
}

export function readLocal(): WatchlistEntry[] {
  try {
    const parsed = watchlistSchema.safeParse(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{"entries":[]}'));
    return parsed.success ? parsed.data.entries : [];
  } catch {
    return [];
  }
}

export function updateLocal(command: Exclude<FollowCommand, { action: "read" }>): WatchlistEntry[] {
  const entries = readLocal();
  let next = entries;
  if (command.action === "remove") next = entries.filter((e) => e.handle !== command.handle);
  else if (!entries.some((e) => e.handle === command.handle)) {
    if (entries.length >= watchlistLimit) throw new Error(`You can follow up to ${watchlistLimit} callers.`);
    next = [{ handle: command.handle, savedAt: new Date().toISOString() }, ...entries];
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ entries: next }));
  } catch {
    // Storage blocked (private window): the change lasts for this page only.
  }
  return next;
}
