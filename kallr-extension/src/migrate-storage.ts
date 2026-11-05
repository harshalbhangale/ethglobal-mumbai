/**
 * One-time move of local data saved under the product's former name ("aftermarkets.*") to the
 * Kallr keys, so follows and settings survive the rename. Copies only where no Kallr value exists
 * yet, then removes the old keys. Safe to run on every start.
 */
export const RENAMED_KEYS: Array<[from: string, to: string]> = [
  ["aftermarkets.watchlist.v1", "kallr.watchlist.v1"],
  ["aftermarkets.mirror-x.v1", "kallr.mirror-x.v1"],
  ["aftermarkets.mirrored-from-x.v1", "kallr.mirrored-from-x.v1"],
];

export async function migrateStorage(storage: Pick<chrome.storage.LocalStorageArea, "get" | "set" | "remove"> = chrome.storage.local) {
  const old = await storage.get(RENAMED_KEYS.map(([from]) => from));
  const current = await storage.get(RENAMED_KEYS.map(([, to]) => to));
  const moves: Record<string, unknown> = {};
  for (const [from, to] of RENAMED_KEYS) if (old[from] !== undefined && current[to] === undefined) moves[to] = old[from];
  if (Object.keys(moves).length) await storage.set(moves);
  const stale = RENAMED_KEYS.map(([from]) => from).filter((k) => old[k] !== undefined);
  if (stale.length) await storage.remove(stale);
  return Object.keys(moves);
}
