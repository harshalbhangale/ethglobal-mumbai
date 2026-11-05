import { TRACKED_CALLERS } from "@kallr/integrations/arkiv";
import { describe, expect, it } from "vitest";
import { toDirection } from "./feed";

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
