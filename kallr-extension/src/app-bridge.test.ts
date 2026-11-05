// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://kallr.test";
const nonce = "0123456789abcdef0123";

let sendMessage: ReturnType<typeof vi.fn>;
let posted: unknown[];

beforeEach(() => {
  vi.stubGlobal("KALLR_APP_ORIGIN", ORIGIN);
  sendMessage = vi.fn(async () => ({ entries: [{ handle: "kol", savedAt: "2026-11-05T10:00:00.000Z" }] }));
  vi.stubGlobal("chrome", { runtime: { id: "x", sendMessage } });
  vi.stubGlobal("location", { origin: ORIGIN });
  posted = [];
  vi.spyOn(window, "postMessage").mockImplementation((value: unknown) => void posted.push(value));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

const event = (data: unknown, over: Partial<{ origin: string; source: unknown }> = {}) =>
  ({ data, origin: over.origin ?? ORIGIN, source: "source" in over ? over.source : window }) as MessageEvent;

describe("app bridge", () => {
  it("relays follow commands from the app page and answers with the same nonce", async () => {
    const { handleBridgeMessage, REQUEST, RESPONSE } = await import("./app-bridge");
    handleBridgeMessage(event({ type: REQUEST, nonce, action: "add", handle: "kol" }));
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(sendMessage).toHaveBeenCalledWith({ type: "watchlist", command: { action: "add", handle: "kol" } });
    expect(posted[0]).toEqual({ type: RESPONSE, nonce, value: { entries: [{ handle: "kol", savedAt: "2026-11-05T10:00:00.000Z" }] } });
    expect(document.documentElement.dataset.kallrExtension).toBe("1");
  });

  it("ignores other origins, other windows, bad nonces and bad handles", async () => {
    const { handleBridgeMessage, REQUEST } = await import("./app-bridge");
    handleBridgeMessage(event({ type: REQUEST, nonce, action: "read" }, { origin: "https://evil.test" }));
    handleBridgeMessage(event({ type: REQUEST, nonce, action: "read" }, { source: null }));
    handleBridgeMessage(event({ type: REQUEST, nonce: "short", action: "read" }));
    handleBridgeMessage(event({ type: REQUEST, nonce, action: "add", handle: "<script>" }));
    handleBridgeMessage(event({ type: "something-else", nonce, action: "read" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });
});
