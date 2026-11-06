import type { ScoredCall } from "@kallr/integrations/after-market";
import type { TokenCheck } from "@kallr/integrations/safety-checks";
import { describe, expect, it, vi } from "vitest";
import {
  exitsFromLevels,
  firstHashtagTicker,
  type KeyboardDeps,
  keyboardLookup,
  looksCrypto,
  normalizeTicker,
  stopPrice,
  targetPrices,
  typedOrder,
} from "./keyboard";

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

describe("AI layer and fake contracts", () => {
  const REAL = "0x1111111111111111111111111111111111111111";
  const FAKE = "0x2222222222222222222222222222222222222222";
  const pepe = { token: REAL, symbol: "PEPE", price: 0.00001, logo: null };
  const read = (over: Record<string, unknown> = {}) => ({
    isCall: true,
    symbol: "PEPE",
    contract: null,
    chain: "base",
    direction: "up" as const,
    timeframe: "by Friday",
    order: null,
    summary: "$PEPE bullish by Friday",
    ...over,
  });

  it("reads a pasted Telegram message and offers the real token", async () => {
    const r = await keyboardLookup(
      { text: "aping the frog on base, $PEPE 5x by friday" },
      deps({ readCall: vi.fn(async () => read()), findTradeToken: vi.fn(async () => pepe) }),
    );
    expect(r.ai?.summary).toBe("$PEPE bullish by Friday");
    expect(r.trade?.token).toBe(REAL);
    expect(r.fake).toBeNull();
  });

  it("blocks a contract that claims $PEPE but isn't the real one", async () => {
    const r = await keyboardLookup(
      { text: `$PEPE is sending, CA ${FAKE}` },
      deps({ readCall: vi.fn(async () => read({ contract: FAKE })), findTradeToken: vi.fn(async () => pepe) }),
    );
    expect(r.fake).toEqual({ claimed: "PEPE", contract: FAKE, real: REAL });
    expect(r.trade).toBeNull();
  });

  it("allows a shared contract when it is the real token", async () => {
    const r = await keyboardLookup(
      { text: `$PEPE CA ${REAL}` },
      deps({ readCall: vi.fn(async () => read({ contract: REAL })), findTradeToken: vi.fn(async () => pepe) }),
    );
    expect(r.fake).toBeNull();
    expect(r.trade?.token).toBe(REAL);
  });

  it("turns plain words typed in the chat into a panel order", async () => {
    const order = { kind: "limit" as const, usd: 20, limitPct: -10, twapMinutes: null, tpPct: null, slPct: null };
    const r = await keyboardLookup(
      { typed: "buy 20 bucks of degen if it dips 10%" },
      deps({ readCall: vi.fn(async () => read({ symbol: "DEGEN", order })), findTradeToken: vi.fn(async () => ({ ...pepe, symbol: "DEGEN" })) }),
    );
    expect(r.prefill).toEqual(order);
    expect(r.trade?.symbol).toBe("DEGEN");
  });

  it("shows no direction when the AI says the message isn't a call", async () => {
    const r = await keyboardLookup(
      { text: "Was I long the $PEPE breakout? lol no" },
      deps({
        readCall: vi.fn(async () => read({ isCall: false, direction: "down", timeframe: null, summary: "Joke about missing a PEPE long." })),
        findTradeToken: vi.fn(async () => pepe),
      }),
    );
    expect(r.ai).toEqual({ summary: "Joke about missing a PEPE long.", symbol: "PEPE", direction: null, timeframe: null });
  });

  it("still fills an order the AI doesn't count as a call", async () => {
    const order = { kind: "market" as const, usd: 20, limitPct: null, twapMinutes: null, tpPct: null, slPct: null };
    const r = await keyboardLookup(
      { typed: "buy 20 bucks of pepe" },
      deps({ readCall: vi.fn(async () => read({ isCall: false, order })), findTradeToken: vi.fn(async () => pepe) }),
    );
    expect(r.prefill).toEqual(order);
  });

  it("doesn't send ordinary chat to the AI", async () => {
    const readCall = vi.fn(async () => read());
    await keyboardLookup({ text: "see you at dinner" }, deps({ readCall }));
    expect(readCall).not.toHaveBeenCalled();
  });
});

describe("Telegram-style calls", () => {
  const SOL = `#SOLUSDT 12H

#SOL is moving inside a falling wedge pattern on the 12-hour timeframe. It has bounced off the wedge support line and is on the verge of breaking above the wedge resistance. In case of a confirmed breakout, the potential upside targets are:

🎯 $99.52
🎯 $104.19
🎯 $107.96
🎯 $111.73
🎯 $117.10
🎯 $123.94

⚠️ Always remember to use a tight stop-loss and maintain proper risk management.`;

  it("reads the coin from hashtags and pairs", () => {
    expect(looksCrypto(SOL)).toBe(true);
    expect(firstHashtagTicker(SOL)).toBe("SOL");
    expect(firstHashtagTicker("#crypto #bitcoin breakout")).toBe("BTC");
    expect(firstHashtagTicker("#trading is fun")).toBeNull();
    expect(normalizeTicker("$ethusdt")).toBe("ETH");
  });

  it("reads targets and a stop price, not percents or TP numbers", () => {
    expect(targetPrices(SOL)).toEqual([99.52, 104.19, 107.96, 111.73, 117.1, 123.94]);
    expect(targetPrices("TP1: 2,450.5\nTP2 2600\ntp 10%")).toEqual([2450.5, 2600]);
    expect(stopPrice(SOL)).toBeNull();
    expect(stopPrice("Entry 90\nSL: $84.2")).toBe(84.2);
  });

  it("turns the first target above the price into the take-profit", () => {
    expect(exitsFromLevels(SOL, 90.47, "up")).toEqual({ tpPct: 10, slPct: null });
    expect(exitsFromLevels("🎯 99\nSL 86", 90, "up")).toEqual({ tpPct: 10, slPct: 4.4 });
    expect(exitsFromLevels(SOL, 90.47, "down")).toBeNull();
    expect(exitsFromLevels(SOL, 130, "up")).toBeNull();
  });

  it("opens the trade with the coin and exits, even with the AI off", async () => {
    const sol = { token: "0x311935cd80b76769bf2ecc9d8ab7635b2139cf82", symbol: "SOL", price: 90.47, logo: null };
    const findTradeToken = vi.fn(async () => sol);
    const r = await keyboardLookup({ text: SOL }, deps({ findTradeToken }));
    expect(findTradeToken).toHaveBeenCalledWith("SOL");
    expect(r.trade).toEqual(sol);
    expect(r.prefill).toMatchObject({ tpPct: 10, slPct: 5 });
  });
});
