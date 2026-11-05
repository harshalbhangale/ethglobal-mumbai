// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory chrome.storage.local plus a runtime that routes messages to the real worker logic. */
function fakeChrome() {
  const data: Record<string, unknown> = {};
  const changed = new Set<(changes: Record<string, unknown>, area: string) => void>();
  return {
    data,
    storage: {
      local: {
        get: async (key: string) => ({ [key]: data[key] }),
        set: async (value: Record<string, unknown>) => {
          Object.assign(data, value);
          for (const fn of changed) fn(Object.fromEntries(Object.keys(value).map((k) => [k, {}])), "local");
        },
      },
      onChanged: { addListener: (fn: never) => changed.add(fn) },
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "https://aftermarkets.test");
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("profileHandle", () => {
  it("reads profile pages and their tabs, and ignores app pages and posts", async () => {
    const { profileHandle } = await import("./profile");
    expect(profileHandle("/CryptoRover")).toBe("cryptorover");
    expect(profileHandle("/kol/media")).toBe("kol");
    expect(profileHandle("/home")).toBeNull();
    expect(profileHandle("/i/bookmarks")).toBeNull();
    expect(profileHandle("/kol/status/123")).toBeNull();
    expect(profileHandle("/kol/following")).toBeNull();
    expect(profileHandle("/bad-handle!")).toBeNull();
  });
});

describe("watchlist storage", () => {
  it("adds, dedupes, removes and caps follows, with writes serialized", async () => {
    const chrome = fakeChrome();
    vi.stubGlobal("chrome", chrome);
    const { readWatchlist, updateWatchlist } = await import("./watchlist-storage");
    await Promise.all([
      updateWatchlist({ action: "add", handle: "a" }),
      updateWatchlist({ action: "add", handle: "b" }),
      updateWatchlist({ action: "add", handle: "a" }),
    ]);
    expect((await readWatchlist()).map((e) => e.handle).sort()).toEqual(["a", "b"]);
    await updateWatchlist({ action: "remove", handle: "a" });
    expect((await readWatchlist()).map((e) => e.handle)).toEqual(["b"]);
    for (let i = 0; i < 49; i++) await updateWatchlist({ action: "add", handle: `h${i}` });
    await expect(updateWatchlist({ action: "add", handle: "full" })).resolves.toEqual({ error: "watchlist_full" });
  });
  it("treats corrupted storage as empty", async () => {
    const chrome = fakeChrome();
    chrome.data["aftermarkets.watchlist.v1"] = { entries: [{ handle: "<script>", savedAt: "x" }] };
    vi.stubGlobal("chrome", chrome);
    const { readWatchlist } = await import("./watchlist-storage");
    await expect(readWatchlist()).resolves.toEqual([]);
  });
});

/** Routes the content script's messages to the worker's watchlist logic, and answers caller-record. */
async function wire(record: unknown = { calls: [], seen: 0 }) {
  const chrome = fakeChrome();
  const { readWatchlist, updateWatchlist } = await import("./watchlist-storage");
  const sendMessage = vi.fn(async (message: { type: string; command?: { action: string; handle?: string } }) => {
    if (message.type === "watchlist") {
      const c = message.command;
      if (c?.action === "read") return { entries: await readWatchlist() };
      return updateWatchlist(c as never);
    }
    if (message.type === "caller-record") return record;
    return null;
  });
  vi.stubGlobal("chrome", { ...chrome, runtime: { id: "x", sendMessage } });
  return sendMessage;
}

describe("followButton", () => {
  it("toggles Follow / Following and persists it", async () => {
    await wire();
    const { followButton, isFollowing } = await import("./follows");
    const button = followButton("kol", (label) => {
      const b = document.createElement("button");
      b.textContent = label;
      return b;
    });
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Following"));
    expect(await isFollowing("kol")).toBe(true);
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Follow"));
    expect(await isFollowing("kol")).toBe(false);
  });
});

const profilePage = (handle: string) => `
  <div data-testid="primaryColumn">
    <div data-testid="UserName"><span>Some KOL</span><span>@${handle}</span></div>
    <div data-testid="UserDescription">calls</div>
    <div role="tablist"></div>
  </div>`;

describe("scanProfile", () => {
  it("mounts one card above the tabs with Follow, the record and recent calls", async () => {
    const postedAt = 1_800_000_000;
    await wire({
      seen: 3,
      calls: [
        { postId: "9", asset: "ETH", direction: "up", status: "hit", returnBps: 220, postedAt, expiresAt: postedAt + 86_400 },
        { postId: "8", asset: "ETH", direction: "up", status: "open", returnBps: 30, postedAt, expiresAt: postedAt + 9e9 },
      ],
    });
    history.replaceState(null, "", "/KOL");
    document.body.innerHTML = profilePage("KOL");
    const { scanProfile } = await import("./profile");
    await scanProfile();
    await scanProfile();
    const hosts = document.querySelectorAll<HTMLElement>(".aftermarkets-profile-host");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.nextElementSibling?.getAttribute("role")).toBe("tablist");
    const text = hosts[0]?.shadowRoot?.textContent ?? "";
    expect(text).toContain("Follow");
    expect(text).toContain("1/1");
    expect(text).toContain("From 3 posts by @kol");
    expect(hosts[0]?.shadowRoot?.querySelector(".calls a")?.getAttribute("href")).toBe("https://x.com/kol/status/9");
  });
  it("is honest when nothing has been seen, and leaves non-profile pages alone", async () => {
    await wire({ calls: [], seen: 0 });
    history.replaceState(null, "", "/newkol");
    document.body.innerHTML = profilePage("newkol");
    const { scanProfile } = await import("./profile");
    await scanProfile();
    expect(document.querySelector(".aftermarkets-profile-host")?.shadowRoot?.textContent).toContain("No posts by @newkol seen yet");
    history.replaceState(null, "", "/home");
    await scanProfile();
    expect(document.querySelector(".aftermarkets-profile-host")).toBeNull();
  });
});

describe("addFollowBadge", () => {
  it("shows a Following chip on followed callers' posts only, and removes it on unfollow", async () => {
    await wire();
    const { setFollowing } = await import("./follows");
    const { addFollowBadge } = await import("./creator-badge");
    document.body.innerHTML = `<article><div data-testid="User-Name"><span>KOL</span><span>@kol</span></div></article>`;
    const article = document.querySelector("article") as HTMLElement;
    await addFollowBadge(article, "kol");
    expect(article.querySelector(".aftermarkets-badge-host")).toBeNull();
    await setFollowing("kol", true);
    await addFollowBadge(article, "kol");
    await addFollowBadge(article, "kol");
    expect(article.querySelectorAll(".aftermarkets-badge-host")).toHaveLength(1);
    expect(article.querySelector(".aftermarkets-badge-host")?.shadowRoot?.querySelector(".chip")?.textContent).toBe("Following");
    await setFollowing("kol", false);
    await addFollowBadge(article, "kol");
    expect(article.querySelector(".aftermarkets-badge-host")).toBeNull();
  });
});
