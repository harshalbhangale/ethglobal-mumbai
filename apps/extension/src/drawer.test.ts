// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Answer } from "./call-view";

const postedAt = 1_800_000_000;
const answer: Answer = {
  call: {
    asset: "ETH",
    direction: "up",
    postedAt,
    expiresAt: postedAt + 86_400,
    horizonStated: false,
    entry: 2400,
    last: 2460,
    status: "hit",
    returnBps: 250,
  },
  record: { scored: 2, hits: 1, hitRate: 0.5, medianReturnBps: 50, open: 0 },
  calls: [
    { postId: "2", asset: "ETH", direction: "up", status: "hit", returnBps: 250, postedAt, expiresAt: postedAt + 86_400 },
    { postId: "1", asset: "BTC", direction: "down", status: "miss", returnBps: -150, postedAt: postedAt - 9e4, expiresAt: postedAt },
  ],
};
const post = { handle: "kol", postId: "2", text: "<b>$ETH</b> to 3k, longing" };

const shadow = () => document.querySelector(".aftermarkets-drawer-host")?.shadowRoot ?? null;

beforeEach(() => vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "https://aftermarkets.test"));
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("openDrawer", () => {
  it("shows the post as text, the call, the record, recent calls and copy buttons", async () => {
    const { openDrawer } = await import("./drawer");
    openDrawer({ post, answer, live: { price: "2475.1", change24hPct: null, source: "chainlink-base" } });
    const root = shadow();
    expect(root).not.toBeNull();
    expect(root?.querySelector("blockquote")?.textContent).toBe(post.text);
    expect(root?.querySelector("blockquote b")).toBeNull();
    const text = root?.textContent ?? "";
    expect(text).toContain("24h (default; none stated)");
    expect(text).toContain("+2.5%");
    expect(text).toContain("Chainlink on Base");
    expect(root?.querySelectorAll(".calls li")).toHaveLength(2);
    expect(root?.querySelector('.calls a')?.getAttribute("href")).toBe("https://x.com/kol/status/2");
    expect(root?.textContent).toContain("Copy $5");
  });

  it("closes on Escape and the close button, and only one is ever open", async () => {
    const { closeDrawer, isDrawerOpen, openDrawer } = await import("./drawer");
    openDrawer({ post, answer, live: null });
    openDrawer({ post, answer, live: null });
    expect(document.querySelectorAll(".aftermarkets-drawer-host")).toHaveLength(1);
    shadow()?.querySelector("aside")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(isDrawerOpen()).toBe(false);
    openDrawer({ post, answer, live: null });
    (shadow()?.querySelector(".close") as HTMLElement).click();
    expect(document.querySelector(".aftermarkets-drawer-host")).toBeNull();
    closeDrawer();
  });
});

describe("horizonLabel", () => {
  it("says whether the post stated the horizon", async () => {
    const { horizonLabel } = await import("./drawer");
    expect(horizonLabel({ postedAt: 0, expiresAt: 7 * 86_400, horizonStated: true })).toBe("7d (stated in the post)");
    expect(horizonLabel({ postedAt: 0, expiresAt: 6 * 3600, horizonStated: false })).toBe("6h (default; none stated)");
    expect(horizonLabel({ expiresAt: 1 })).toBe("—");
  });
});
