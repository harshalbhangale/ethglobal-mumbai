import { afterEach, describe, expect, it, vi } from "vitest";
import type { PopupState } from "./popup";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const storage = (values: Record<string, unknown> = {}) => ({ get: vi.fn(async () => values) }) as never;

describe("popup labels", () => {
  it("labels local and packaged builds", async () => {
    vi.stubGlobal("KALLR_APP_ORIGIN", "http://localhost:3000");
    const local = await import("./popup");
    expect(local.buildLabel("checking")).toBe("Checking…");
    expect(local.buildLabel("up")).toBe("Local build · Base mainnet");
    expect(local.buildLabel("down")).toBe("Local build · app not reachable");
    vi.resetModules();
    vi.stubGlobal("KALLR_APP_ORIGIN", "https://kallr.app");
    const prod = await import("./popup");
    expect(prod.buildLabel("up")).toBe("Base mainnet");
    expect(prod.buildLabel("down")).toBe("App not reachable");
  });

  it("lists app, prices, Flash, follows and the follow-on-X setting", async () => {
    vi.stubGlobal("KALLR_APP_ORIGIN", "https://kallr.app");
    const { statusRows } = await import("./popup");
    expect(statusRows({ app: "up", prices: ["ETH", "BTC"], following: 3, mirror: false })).toEqual([
      { label: "App", value: "Connected", tone: "ok" },
      { label: "Prices", value: "Chainlink · ETH, BTC", tone: "ok" },
      { label: "Orders", value: "Definitive Flash · Base", tone: "ok" },
      { label: "Following", value: "3", tone: "ok" },
      { label: "Follow on X", value: "Off · turn on in the desk", tone: "off" },
    ]);
    expect(statusRows({ app: "up", prices: "slow", following: 0, mirror: true })[1]).toEqual({
      label: "Prices",
      value: "Slow to load · reopen to retry",
      tone: "off",
    });
  });
});

describe("runChecks", () => {
  it("shows the app as connected right away while a slow price read is still loading", async () => {
    vi.stubGlobal("KALLR_APP_ORIGIN", "http://localhost:3000");
    let releasePrices: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.endsWith("/api/health")
          ? ok({ ok: true })
          : new Promise<Response>((resolve) => {
              releasePrices = resolve;
            }),
      ),
    );
    const { runChecks } = await import("./popup");
    const seen: PopupState[] = [];
    const done = runChecks((s) => seen.push(s), storage({ "kallr.watchlist.v1": { entries: [{}, {}] } }));
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ app: "up", following: 2, mirror: false }));
    expect(seen.at(-1)?.prices).toBe("loading");
    expect(seen[0]).toEqual({ app: "checking", prices: "loading", following: null, mirror: null });

    releasePrices(new Response(JSON.stringify({ prices: [{ asset: "ETH" }, { asset: "BTC" }] })));
    expect(await done).toEqual({ app: "up", prices: ["ETH", "BTC"], following: 2, mirror: false });
  });

  it("marks the app down only when the health check fails, and a timed-out price read as slow", async () => {
    vi.stubGlobal("KALLR_APP_ORIGIN", "http://localhost:3000");
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (url.endsWith("/api/health") ? ok({ ok: true }) : Promise.reject(timeout))),
    );
    const { runChecks } = await import("./popup");
    expect(await runChecks(() => {}, storage())).toMatchObject({ app: "up", prices: "slow" });

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await runChecks(() => {}, storage())).toMatchObject({ app: "down", prices: "unavailable" });
  });
});
