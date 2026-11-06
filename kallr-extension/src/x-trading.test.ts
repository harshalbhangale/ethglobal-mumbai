import { beforeEach, describe, expect, it, vi } from "vitest";

const WALLET = "0x00000000000000000000000000000000000000c4";
// A made-up key in the server's format: payload.mac.
const KEY = `${"a".repeat(40)}.${"b".repeat(43)}`;

let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
  vi.stubGlobal("KALLR_APP_ORIGIN", "https://app.example");
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
        set: async (v: Record<string, unknown>) => void Object.assign(store, v),
        remove: async (k: string) => void delete store[k],
      },
    },
  });
});

describe("trading from X", () => {
  it("keeps the key from Kall Markets but only ever answers with the wallet and expiry", async () => {
    const { xKey, xStatus } = await import("./x-trading");
    const expires = Date.now() + 86_400_000;
    expect(await xKey({ op: "set", key: KEY, address: WALLET, expires })).toEqual({ address: WALLET, expires });
    expect(JSON.stringify(await xKey({ op: "read" }))).not.toContain(KEY);
    expect(await xStatus()).toEqual({ kall: { address: WALLET, expires }, signer: "kall" });
    expect(await xKey({ op: "clear" })).toBeNull();
  });

  it("refuses a malformed key or address, and forgets an expired one", async () => {
    const { xKey, xStatus } = await import("./x-trading");
    expect(await xKey({ op: "set", key: "nope", address: WALLET, expires: Date.now() + 1000 })).toBeNull();
    expect(await xKey({ op: "set", key: KEY, address: "0x12", expires: Date.now() + 1000 })).toBeNull();
    await xKey({ op: "set", key: KEY, address: WALLET, expires: Date.now() - 1 });
    expect((await xStatus()).kall).toBeNull();
  });

  it("signs with the Kall wallet unless MetaMask is picked", async () => {
    const { setSigner, xStatus } = await import("./x-trading");
    expect((await xStatus()).signer).toBe("kall");
    expect((await setSigner("metamask")).signer).toBe("metamask");
    expect((await setSigner("anything")).signer).toBe("metamask");
    expect((await setSigner("kall")).signer).toBe("kall");
  });

  it("sends the order with the key and forgets a key the server no longer accepts", async () => {
    const { placeWithKall, xKey } = await import("./x-trading");
    await xKey({ op: "set", key: KEY, address: WALLET, expires: Date.now() + 86_400_000 });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Turn on trading from X in Kall Markets › Wallet." }), { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect(await placeWithKall({ asset: "ETH" }, "kol")).toEqual({ failed: "Turn on trading from X in Kall Markets › Wallet." });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(await xKey({ op: "read" })).toBeNull();
  });
});
