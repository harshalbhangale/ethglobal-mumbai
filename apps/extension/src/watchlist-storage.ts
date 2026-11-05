import { type WatchlistCommand, type WatchlistEntry, watchlistLimit, watchlistSchema } from "@aftermarkets/domain";

/**
 * Callers this browser follows on AfterMarkets, kept in chrome.storage.local. A followed handle is a
 * lookup hint, never a verified identity. Synced to the account once /api/follows exists (PLAN 5b).
 */
const key = "aftermarkets.watchlist.v1";

export async function readWatchlist(): Promise<WatchlistEntry[]> {
  const stored = await chrome.storage.local.get(key);
  const parsed = watchlistSchema.safeParse(stored[key]);
  return parsed.success ? parsed.data.entries : [];
}

let queue: Promise<unknown> = Promise.resolve();

/** Writes are serialized so concurrent clicks from several tabs never drop an entry. */
export function updateWatchlist(
  command: Exclude<WatchlistCommand, { action: "read" }>,
): Promise<{ entries: WatchlistEntry[] } | { error: "watchlist_full" }> {
  const run = async () => {
    const entries = await readWatchlist();
    let next: WatchlistEntry[];
    if (command.action === "remove") next = entries.filter((e) => e.handle !== command.handle);
    else if (entries.some((e) => e.handle === command.handle)) next = entries;
    else if (entries.length >= watchlistLimit) return { error: "watchlist_full" as const };
    else next = [{ handle: command.handle, savedAt: new Date().toISOString() }, ...entries];
    await chrome.storage.local.set({ [key]: { entries: next } });
    return { entries: next };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
