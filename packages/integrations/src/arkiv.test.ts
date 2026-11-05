import { describe, expect, it } from "vitest";
import type { ScoredCall } from "./after-market";
import { callExpiration, callSnapshot, callValues, resultValues, SCORING_WINDOW_SECONDS, tradeValues } from "./arkiv";
import type { FlashOrderInput } from "./definitive";

const NOW = 1_800_000_000;
const call = (over: Partial<ScoredCall> = {}): ScoredCall => ({
  postId: "1850000000000000000",
  handle: "KOL",
  asset: "ETH",
  direction: "up",
  postedAt: NOW - 3600,
  expiresAt: NOW + 3600,
  horizonStated: true,
  entry: 3412.5,
  last: 3480.12345678912,
  status: "open",
  returnBps: 198,
  ...over,
});

describe("tradeValues", () => {
  const input: FlashOrderInput = {
    asset: "ETH",
    side: "buy",
    qty: "5",
    orderType: "market",
    takeProfit: { notionalPrice: "3753.75" },
    stopLoss: { notionalPrice: "3241.88" },
    funderAddress: "0x1111111111111111111111111111111111111111",
    sourcePostId: "1850000000000000000",
  };

  it("records the order, its exits, its source and the call it copied", () => {
    const v = tradeValues(input, "ord_1", { source: "keyboard", caller: "KOL" }, NOW);
    expect(v).toMatchObject({
      source: "keyboard",
      asset: "ETH",
      side: "buy",
      qty: "5",
      takeProfit: "3753.75",
      stopLoss: "3241.88",
      flashOrderId: "ord_1",
      postId: "1850000000000000000",
      caller: "kol",
    });
    expect(v.trader).toMatchObject({ value: input.funderAddress });
    expect(v.placedAt).toMatchObject({ value: BigInt(NOW) });
  });

  it("leaves optional fields out instead of writing empty values", () => {
    const v = tradeValues({ ...input, takeProfit: undefined, stopLoss: undefined, sourcePostId: undefined }, "ord_2", { source: "desk" }, NOW);
    expect(v).not.toHaveProperty("takeProfit");
    expect(v).not.toHaveProperty("postId");
    expect(v).not.toHaveProperty("caller");
  });
});

describe("calls", () => {
  it("writes an open call with its deadline and entry price", () => {
    const v = callValues(call());
    expect(v).toMatchObject({ caller: "kol", asset: "ETH", direction: "up", horizonStated: true });
    expect(v.deadline).toMatchObject({ value: BigInt(NOW + 3600) });
    expect(v.entry).toMatchObject({ value: "3412.5" });
  });

  it("only settled, priced calls become results", () => {
    expect(resultValues(call())).toBeNull();
    expect(resultValues(call({ status: "hit", last: null }))).toBeNull();
    const r = resultValues(call({ status: "hit" }));
    expect(r).toMatchObject({ status: "hit", caller: "kol" });
    expect(r?.returnBps).toMatchObject({ value: 198 });
    expect(r?.exit).toMatchObject({ value: "3480.12345679" });
  });

  it("keeps a call through its timeframe plus the scoring window", () => {
    const at = (e: { expiresAt: unknown }) => (e.expiresAt as Date).getTime() / 1000;
    expect(at(callExpiration(call(), NOW))).toBe(NOW + 3600 + SCORING_WINDOW_SECONDS);
    // A year-long call is capped a day inside Arkiv's ~182.5-day maximum.
    expect(at(callExpiration(call({ expiresAt: NOW + 400 * 86400 }), NOW))).toBe(NOW + 181 * 86400);
  });
});

describe("Swarm snapshots", () => {
  const REF = "a".repeat(64);

  it("keeps the snapshot reference on both the call and its result", () => {
    expect(callValues(call(), REF)).toMatchObject({ swarmRef: REF });
    expect(resultValues(call({ status: "miss", returnBps: -120 }), REF)).toMatchObject({ swarmRef: REF, status: "miss" });
    expect(callValues(call())).not.toHaveProperty("swarmRef");
  });

  it("snapshots the post as seen, with the call Kallr read from it", () => {
    const s = callSnapshot(call(), "$ETH to 4k this week", NOW);
    expect(s).toMatchObject({
      kind: "kallr.call-snapshot",
      url: "https://x.com/KOL/status/1850000000000000000",
      caller: "kol",
      text: "$ETH to 4k this week",
      asset: "ETH",
      direction: "up",
      entry: 3412.5,
      capturedAt: NOW,
    });
  });
});
