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
  vi.stubGlobal("KALLR_APP_ORIGIN", "https://kallr.test");
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
    chrome.data["kallr.watchlist.v1"] = { entries: [{ handle: "<script>", savedAt: "x" }] };
    vi.stubGlobal("chrome", chrome);
    const { readWatchlist } = await import("./watchlist-storage");
    await expect(readWatchlist()).resolves.toEqual([]);
  });
});

/** Routes the content script's messages to the worker's watchlist logic, and answers caller-record. */
async function wire(record: unknown = { calls: [], writer: null }) {
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
      writer: "0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53",
      calls: [
        { key: "0xabc9", postId: "9", asset: "ETH", direction: "up", status: "hit", returnBps: 220, postedAt, expiresAt: postedAt + 86_400, gone: true },
        { postId: "8", asset: "ETH", direction: "up", status: "open", returnBps: 30, postedAt: postedAt - 60, expiresAt: postedAt + 9e9 },
      ],
      deleted: 1,
      deletedChecked: 2,
    });
    history.replaceState(null, "", "/KOL");
    document.body.innerHTML = profilePage("KOL");
    const { scanProfile } = await import("./profile");
    await scanProfile();
    await scanProfile();
    const hosts = document.querySelectorAll<HTMLElement>(".kallr-profile-host");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.nextElementSibling?.getAttribute("role")).toBe("tablist");
    const root = hosts[0]?.shadowRoot;
    // Small: who and Follow, one line of numbers, the last calls, one footer line. No stat tiles.
    expect(root?.querySelector(".pc-title")?.textContent).toBe("@kol on Kall");
    expect(root?.querySelector(".pc-head .pc-follow")?.textContent).toBe("Follow");
    expect(root?.querySelector(".pc-line")?.textContent).toBe("2 calls · 100% hit · +2.2% avg · 1 deleted");
    expect(root?.querySelectorAll(".pc-stat")).toHaveLength(0);
    // Every call: open ones in view, closed ones behind a dropdown, all on the same four-column grid.
    expect(root?.querySelector(".pc-group")?.textContent).toBe("Open · 1");
    const openList = [...(root?.querySelector(".pc")?.children ?? [])].find((c) => c.matches("ul.pc-calls"));
    const openRows = openList?.querySelectorAll("li");
    expect(openRows).toHaveLength(1);
    expect(openRows?.[0]?.children).toHaveLength(4);
    expect([...(openRows?.[0]?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual(["https://x.com/kol/status/8"]);
    const closed = root?.querySelector<HTMLDetailsElement>("details.pc-closed");
    expect(closed?.open).toBe(false);
    expect(closed?.querySelector("summary")?.textContent).toBe("Closed calls · 1");
    const closedRow = closed?.querySelector(".pc-calls li");
    expect(closedRow?.children).toHaveLength(4);
    // Each call links to its record on Arkiv (when it has one) and to the post on X.
    expect([...(closedRow?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual([
      "https://rabdi.explorer.arkiv.network/entity/0xabc9",
      "https://x.com/kol/status/9",
    ]);
    // A call whose post is gone from X is still on the record, and says so.
    expect(closedRow?.querySelector(".pc-gone")?.textContent).toBe(" · deleted on X");
    // The whole record on Arkiv, and the desk.
    const foot = [...(root?.querySelectorAll(".pc-foot a") ?? [])].map((a) => a.getAttribute("href"));
    expect(foot).toEqual([
      "https://rabdi.explorer.arkiv.network/address/0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53",
      "https://kallr.test/app?caller=kol",
    ]);
    expect(root?.querySelector(".pc-foot")?.textContent).toContain("Too few to judge · Priced at post time");
  });
  it("shows the Kall mark, coin logos, and each trade copied from the caller with its Arkiv record", async () => {
    const postedAt = Math.floor(Date.now() / 1000) - 3600;
    const tradeKey = `0x${"b".repeat(64)}`;
    await wire({
      writer: null,
      calls: [{ key: `0x${"a".repeat(64)}`, postId: "8", asset: "ETH", direction: "up", status: "open", returnBps: null, postedAt, expiresAt: postedAt + 86_400 }],
      trades: [{ key: tradeKey, asset: "ETH", side: "sell", source: "extension", postId: "8", placedAt: postedAt + 60 }],
    });
    history.replaceState(null, "", "/copied");
    document.body.innerHTML = profilePage("copied");
    const { scanProfile } = await import("./profile");
    await scanProfile();
    const root = document.querySelector<HTMLElement>(".kallr-profile-host")?.shadowRoot;
    expect(root?.querySelector(".pc-head .brand-mark-glyph")).not.toBeNull();
    expect(root?.querySelectorAll(".pc-calls .pc-coin")).toHaveLength(2);
    const groups = [...(root?.querySelectorAll(".pc-group") ?? [])].map((g) => g.textContent);
    expect(groups).toContain("Copied on Kall · 1");
    const lists = [...(root?.querySelectorAll(".pc-calls") ?? [])];
    const copied = lists.at(-1);
    expect(copied?.textContent).toContain("Sold $ETH");
    expect(copied?.textContent).toContain("on X");
    const links = [...(copied?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(links).toEqual([`https://rabdi.explorer.arkiv.network/entity/${tradeKey}`, "https://x.com/copied/status/8"]);
  });
  it("is honest when a caller has no calls yet, and leaves non-profile pages alone", async () => {
    await wire({ calls: [], writer: null });
    history.replaceState(null, "", "/newkol");
    document.body.innerHTML = profilePage("newkol");
    const { scanProfile } = await import("./profile");
    await scanProfile();
    expect(document.querySelector(".kallr-profile-host")?.shadowRoot?.textContent).toContain("No calls by @newkol scored on Kall yet");
    history.replaceState(null, "", "/home");
    await scanProfile();
    expect(document.querySelector(".kallr-profile-host")).toBeNull();
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
    expect(article.querySelector(".kallr-badge-host")).toBeNull();
    await setFollowing("kol", true);
    await addFollowBadge(article, "kol");
    await addFollowBadge(article, "kol");
    expect(article.querySelectorAll(".kallr-badge-host")).toHaveLength(1);
    expect(article.querySelector(".kallr-badge-host")?.shadowRoot?.querySelector(".chip")?.textContent).toBe("Following");
    await setFollowing("kol", false);
    await addFollowBadge(article, "kol");
    expect(article.querySelector(".kallr-badge-host")).toBeNull();
  });
});

describe("tabsBlock", () => {
  it("mounts before X's whole tab nav, not inside the swipeable strip that clips it", async () => {
    const { tabsBlock } = await import("./profile");
    // X's profile, Nov 2026: column > … > div(1 child) > nav > div > SwipeableList > tablist.
    document.body.innerHTML = `
      <div data-testid="primaryColumn"><div id="header">
        <div data-testid="UserName"></div>
        <div id="wrap"><nav role="navigation"><div><div data-testid="ScrollSnap-SwipeableList">
          <div data-testid="ScrollSnap-List" role="tablist"><a role="tab">Posts</a></div>
        </div></div></nav></div>
      </div></div>`;
    const column = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]')!;
    const tabs = column.querySelector<HTMLElement>('[role="tablist"]')!;
    const block = tabsBlock(tabs, column);
    expect(block.id).toBe("wrap");
    const host = document.createElement("div");
    block.before(host);
    expect(host.parentElement?.id).toBe("header");
    expect(host.closest('[data-testid="ScrollSnap-SwipeableList"]')).toBeNull();
  });

  it("falls back to the tablist when there is no nav around it", async () => {
    const { tabsBlock } = await import("./profile");
    document.body.innerHTML = `<div data-testid="primaryColumn"><div role="tablist"></div><p></p></div>`;
    const column = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]')!;
    const tabs = column.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(tabsBlock(tabs, column)).toBe(tabs);
  });
});
