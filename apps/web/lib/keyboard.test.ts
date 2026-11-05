import type { ScoredCall } from "@aftermarkets/integrations/after-market";
import type { TokenCheck } from "@aftermarkets/integrations/safety-checks";
import { describe, expect, it, vi } from "vitest";
import { type KeyboardDeps, keyboardLookup, typedOrder } from "./keyboard";

const NOW = 1_800_000_000;
const call = (over: Partial<ScoredCall> = {}): ScoredCall => ({
  postId: "1850000000000000000",
  handle: "kol",
  asset: "BTC",
  direction: "up",
  postedAt: NOW - 3600,
  expiresAt: NOW + 3600,
  horizonStated: false,
  entry: 100_000,
  last: 102_000,
  status: "open",
  returnBps: 200,
  ...over,
});

function deps(over: Partial<KeyboardDeps> = {}): KeyboardDeps {
  return {
    appOrigin: "http://localhost:3000",
    nowSeconds: NOW,
    fetchPost: vi.fn(async (postId: string) => ({ postId, authorHandle: "kol", text: "$BTC to 120k this week" })),
    score: vi.fn(async (p) => call({ postId: p.postId })),
    checkToken: vi.fn(async () => null),
    ...over,
  };
}

describe("typedOrder", () => {
  it("takes the order from its last verb on the current line", () => {
    expect(typedOrder("gm\nlooks good, copy $5 tp 10% sl 5%")).toBe("copy $5 tp 10% sl 5%");
  });
  it("ignores sentences that only say buy", () => {
    expect(typedOrder("should I buy this?")).toBeNull();
    expect(typedOrder("sell my ETH")).toBe("sell my ETH");
  });
});

describe("keyboardLookup", () => {
  it("scores the call a copied post link points at", async () => {
    const r = await keyboardLookup({ text: "https://x.com/KOL/status/1850000000000000000?s=20" }, deps());
    expect(r.post).toMatchObject({ handle: "kol", postId: "1850000000000000000" });
    expect(r.call?.asset).toBe("BTC");
    expect(r.record?.line).toBe("@kol: 1 open call, none scored yet");
  });

  it("copies the call's asset and links to the desk with the post", async () => {
    const r = await keyboardLookup(
      { text: "https://x.com/kol/status/1850000000000000000", typed: "copy $5 tp 10% sl 5%" },
      deps(),
    );
    expect(r.order?.ok).toBe(true);
    if (!r.order?.ok) return;
    expect(r.order.text).toBe("copy $5 of BTC tp 10% sl 5%");
    const url = new URL(r.order.deskUrl);
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.searchParams.get("order")).toBe("copy $5 of BTC tp 10% sl 5%");
    expect(url.searchParams.get("caller")).toBe("kol");
  });

  it("checks a pasted contract and refuses a ticker copy next to it", async () => {
    const token: TokenCheck = {
      address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
      name: "Degen",
      symbol: "DEGEN",
      flags: [{ kind: "honeypot", severity: "danger", text: "Honeypot: you may not be able to sell" }],
      holders: null,
      liquidityUsd: 12_000,
      volume24hUsd: null,
      ageDays: 3,
      pairUrl: null,
      sources: { goplus: "ok", dexscreener: "ok" },
    };
    const r = await keyboardLookup(
      { text: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", typed: "buy $5 of eth" },
      deps({ checkToken: vi.fn(async () => token) }),
    );
    expect(r.token?.line).toBe("$DEGEN: 1 warning · liquidity $12,000 · 3d old");
    expect(r.order).toMatchObject({ ok: false });
  });

  it("reports a bad order instead of linking it", async () => {
    const r = await keyboardLookup({ typed: "copy $0 of eth" }, deps());
    expect(r.order).toEqual({ ok: false, error: "Amount must be more than $0." });
  });
});
