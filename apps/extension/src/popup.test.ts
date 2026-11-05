import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("popup status", () => {
  it("labels local and packaged builds, and says when the app is down", async () => {
    vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "http://localhost:3000");
    const local = await import("./popup");
    expect(local.buildLabel(true)).toBe("Local build · Base mainnet");
    expect(local.statusRows({ prices: null, following: 0, mirror: false })).toEqual([
      { label: "App", value: "Not reachable. Start the local app.", tone: "off" },
    ]);
    vi.resetModules();
    vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "https://aftermarkets.app");
    const prod = await import("./popup");
    expect(prod.buildLabel(true)).toBe("Base mainnet");
    expect(prod.buildLabel(false)).toBe("App not reachable");
  });

  it("lists prices, Flash, follows and the follow-on-X setting", async () => {
    vi.stubGlobal("AFTERMARKETS_APP_ORIGIN", "https://aftermarkets.app");
    const { statusRows } = await import("./popup");
    expect(statusRows({ prices: ["ETH", "BTC"], following: 3, mirror: false })).toEqual([
      { label: "App", value: "Connected", tone: "ok" },
      { label: "Prices", value: "Chainlink · ETH, BTC", tone: "ok" },
      { label: "Orders", value: "Definitive Flash · Base", tone: "ok" },
      { label: "Following", value: "3", tone: "ok" },
      { label: "Follow on X", value: "Off · turn on in the desk", tone: "off" },
    ]);
  });
});
