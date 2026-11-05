// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    storage: {
      local: {
        get: async (key: string) => ({ [key]: data[key] }),
        set: async (value: Record<string, unknown>) => void Object.assign(data, value),
      },
      onChanged: { addListener() {} },
    },
  };
}

beforeEach(() => vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "https://aftermarkets.test"));
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.resetModules();
});

const viewerLink = `<a data-testid="AppTabBar_Profile_Link" href="/Me">Profile</a>`;

describe("followObservations", () => {
  it("reads the follow button on someone else's profile, ignoring buttons inside posts", async () => {
    const { followObservations } = await import("./follow-observer");
    document.body.innerHTML = `${viewerLink}
      <div data-testid="primaryColumn">
        <div data-testid="UserName">KOL</div>
        <button data-testid="123-unfollow">Following</button>
        <article data-testid="tweet"><button data-testid="9-follow">Follow</button></article>
      </div>`;
    expect(followObservations("/KOL")).toEqual({ viewer: "me", observations: [{ handle: "kol", following: true }] });
    document.body.innerHTML = `${viewerLink}<div data-testid="primaryColumn"><div data-testid="UserName">KOL</div><button data-testid="123-follow">Follow</button></div>`;
    expect(followObservations("/kol/media")).toEqual({ viewer: "me", observations: [{ handle: "kol", following: false }] });
  });

  it("reads every account on the viewer's own Following page", async () => {
    const { followObservations } = await import("./follow-observer");
    const cell = (h: string, testid: string) =>
      `<div data-testid="UserCell"><a href="/${h}">${h}</a><button data-testid="${testid}">x</button></div>`;
    document.body.innerHTML = `${viewerLink}<div data-testid="primaryColumn">${cell("Alice", "1-unfollow")}${cell("bob", "2-follow")}</div>`;
    expect(followObservations("/me/following")?.observations).toEqual([
      { handle: "alice", following: true },
      { handle: "bob", following: false },
    ]);
  });

  it("reports nothing when logged out, on its own profile, or on other pages", async () => {
    const { followObservations } = await import("./follow-observer");
    document.body.innerHTML = `<div data-testid="primaryColumn"><div data-testid="UserName">K</div><button data-testid="1-follow">F</button></div>`;
    expect(followObservations("/kol")).toBeNull();
    document.body.innerHTML = `${viewerLink}<div data-testid="primaryColumn"><div data-testid="UserName">Me</div><button data-testid="1-follow">F</button></div>`;
    expect(followObservations("/me")?.observations).toEqual([]);
    expect(followObservations("/kol/status/1")?.observations).toEqual([]);
  });
});

describe("applyObservations", () => {
  it("does nothing until the viewer opts in", async () => {
    vi.stubGlobal("chrome", fakeStorage());
    const { applyObservations } = await import("./follow-sync");
    expect(await applyObservations("me", [{ handle: "kol", following: true }])).toEqual({ added: [], removed: [] });
  });

  it("follows on X follow, and unfollows on X unfollow only what X added", async () => {
    vi.stubGlobal("chrome", fakeStorage());
    const { applyObservations, setMirror } = await import("./follow-sync");
    const { readWatchlist, updateWatchlist } = await import("./watchlist-storage");
    await setMirror(true);
    await updateWatchlist({ action: "add", handle: "manual" });
    expect(await applyObservations("me", [{ handle: "kol", following: true }, { handle: "me", following: true }])).toEqual({
      added: ["kol"],
      removed: [],
    });
    expect((await readWatchlist()).map((e) => e.handle).sort()).toEqual(["kol", "manual"]);
    expect(
      await applyObservations("me", [
        { handle: "kol", following: false },
        { handle: "manual", following: false },
      ]),
    ).toEqual({ added: [], removed: ["kol"] });
    expect((await readWatchlist()).map((e) => e.handle)).toEqual(["manual"]);
  });
});

describe("bridge mirror setting", () => {
  it("reads and sets the setting from the app page only", async () => {
    const sendMessage = vi.fn(async (m: { enabled?: boolean }) => ({ enabled: m.enabled ?? false }));
    vi.stubGlobal("chrome", { runtime: { id: "x", sendMessage } });
    vi.stubGlobal("location", { origin: "https://aftermarkets.test" });
    const posted: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((v: unknown) => void posted.push(v));
    const { handleBridgeMessage, REQUEST } = await import("./app-bridge");
    const ev = (data: unknown) => ({ data, origin: "https://aftermarkets.test", source: window }) as unknown as MessageEvent;
    handleBridgeMessage(ev({ type: REQUEST, nonce: "0123456789abcdef0123", action: "mirror-set", enabled: true }));
    handleBridgeMessage(ev({ type: REQUEST, nonce: "0123456789abcdef0124", action: "mirror-set", enabled: "yes" }));
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: "mirror", enabled: true });
    vi.restoreAllMocks();
  });
});
