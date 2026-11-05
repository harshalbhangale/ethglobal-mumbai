import { send } from "./dom";

/**
 * Content-script view of who this browser follows on AfterMarkets. Reads go through the service
 * worker once and are cached; any tab's change refreshes every tab via chrome.storage events.
 */

type Entries = { entries: Array<{ handle: string; savedAt: string }> };

let cache: Promise<Set<string>> | null = null;
const listeners = new Set<() => void>();

export function followed(): Promise<Set<string>> {
  cache ??= send<Entries>({ type: "watchlist", command: { action: "read" } }).then(
    (value) => new Set(value?.entries.map((e) => e.handle) ?? []),
  );
  return cache;
}

export async function isFollowing(handle: string) {
  return (await followed()).has(handle);
}

/** Follow or unfollow; resolves to the new state, or null when the worker refused (e.g. list full). */
export async function setFollowing(handle: string, on: boolean): Promise<boolean | null> {
  const value = await send<Entries>({ type: "watchlist", command: { action: on ? "add" : "remove", handle } });
  if (!value) return null;
  cache = Promise.resolve(new Set(value.entries.map((e) => e.handle)));
  for (const fn of listeners) fn();
  return value.entries.some((e) => e.handle === handle);
}

export function onFollowsChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !("aftermarkets.watchlist.v1" in changes)) return;
    cache = null;
    for (const fn of listeners) fn();
  });
} catch {
  // Extension context gone after a reload; this tab keeps its last known state.
}

/** A Follow / Following toggle for a caller. */
export function followButton(handle: string, make: (label: string) => HTMLButtonElement) {
  const button = make("Follow");
  button.setAttribute("aria-pressed", "false");
  const render = (on: boolean) => {
    button.textContent = on ? "Following" : "Follow";
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("primary", !on);
  };
  void isFollowing(handle).then(render);
  onFollowsChanged(() => void isFollowing(handle).then(render));
  button.addEventListener("click", async () => {
    const next = button.getAttribute("aria-pressed") !== "true";
    button.disabled = true;
    const state = await setFollowing(handle, next);
    button.disabled = false;
    if (state === null) button.title = "Couldn't update: you can follow up to 50 callers";
    else render(state);
  });
  return button;
}
