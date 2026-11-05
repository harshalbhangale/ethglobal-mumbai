import { readWatchlist, updateWatchlist } from "./watchlist-storage";

/**
 * Mirror X follows into Kallr follows (worker side). Opt-in. When on, a caller the viewer is
 * seen following on X is followed here; one seen unfollowed on X is removed only if X added them,
 * so follows made by hand are never touched. Reads button state on screen only: no X API, no cookies.
 */

const SETTINGS = "kallr.mirror-x.v1";
const MIRRORED = "kallr.mirrored-from-x.v1";
const HANDLE = /^[a-z0-9_]{1,15}$/;

export type Observation = { handle: string; following: boolean };

export async function mirrorEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SETTINGS);
  return (stored[SETTINGS] as { enabled?: unknown } | undefined)?.enabled === true;
}

export async function setMirror(enabled: boolean) {
  await chrome.storage.local.set({ [SETTINGS]: { enabled } });
  return { enabled };
}

async function mirrored(): Promise<Set<string>> {
  const stored = (await chrome.storage.local.get(MIRRORED))[MIRRORED];
  return new Set(Array.isArray(stored) ? stored.filter((h): h is string => typeof h === "string" && HANDLE.test(h)) : []);
}

/** Applies what the content script saw on X. Returns what changed, for tests and logs. */
export async function applyObservations(viewer: string, observations: Observation[]) {
  const changed = { added: [] as string[], removed: [] as string[] };
  if (!HANDLE.test(viewer) || !(await mirrorEnabled())) return changed;
  const fromX = await mirrored();
  const current = new Set((await readWatchlist()).map((e) => e.handle));
  for (const { handle, following } of observations.slice(0, 100)) {
    if (!HANDLE.test(handle) || handle === viewer) continue;
    if (following && !current.has(handle)) {
      const result = await updateWatchlist({ action: "add", handle });
      if ("error" in result) break; // list full: stop, don't drop anything
      current.add(handle);
      fromX.add(handle);
      changed.added.push(handle);
    } else if (!following && current.has(handle) && fromX.has(handle)) {
      await updateWatchlist({ action: "remove", handle });
      current.delete(handle);
      fromX.delete(handle);
      changed.removed.push(handle);
    }
  }
  await chrome.storage.local.set({ [MIRRORED]: [...fromX] });
  return changed;
}
