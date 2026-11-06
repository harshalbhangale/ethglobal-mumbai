import { TRACKED_CALLERS } from "@kallr/integrations/arkiv";
import { describe, expect, it } from "vitest";
import { copyCall, toDirection } from "./feed";

describe("feed", () => {
  it("reads calls stored as up/down (callValues) as long/short", () => {
    expect(toDirection("down")).toBe("short");
    expect(toDirection("short")).toBe("short");
    expect(toDirection("up")).toBe("long");
    expect(toDirection(undefined)).toBe("long");
  });

  it("tracks 8–9 distinct, lowercase X handles", () => {
    const handles = TRACKED_CALLERS.map((c) => c.handle);
    expect(handles.length).toBeGreaterThanOrEqual(8);
    expect(new Set(handles).size).toBe(handles.length);
    for (const h of handles) expect(h).toMatch(/^[a-z0-9_]{1,15}$/);
  });
});

describe("copyCall", () => {
  const call = { caller: "kol", postId: "1850000000000000000", asset: "ETH", direction: "long" as const };

  it("opens the real desk prefilled with $1 and exits, linked to the post", () => {
    const r = copyCall(call);
    expect("href" in r).toBe(true);
    const url = new URL(("href" in r ? r.href : ""), "https://kall-markets.vercel.app");
    expect(url.pathname).toBe("/app");
    expect(url.searchParams.get("order")).toBe("copy $1 of ETH tp 10% sl 5%");
    expect(url.searchParams.get("post")).toBe(call.postId);
    expect(url.searchParams.get("caller")).toBe("kol");
  });

  it("says why shorts and coins the desk can't buy aren't copyable", () => {
    expect(copyCall({ ...call, direction: "short" })).toEqual({ reason: "Short call · can't copy shorts yet" });
    expect(copyCall({ ...call, asset: "SOL" })).toEqual({ reason: "$SOL isn't tradable on Base yet" });
  });
});
