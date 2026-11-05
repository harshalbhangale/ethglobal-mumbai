import { describe, expect, it } from "vitest";
import {
  deriveTradeRoute,
  heuristicSignal,
  mentionsPerp,
  statedTimeframe,
} from "./signals";

const base = { postId: "123", handle: "Alice" };

describe("heuristicSignal", () => {
  it("classifies an explicit bullish spot call", () => {
    const s = heuristicSignal({
      ...base,
      text: "Buying $MON here, this sends 🚀",
    });
    expect(s).toMatchObject({
      isCall: true,
      asset: "MON",
      direction: "bullish",
      instrument: "spot",
      confidence: "high",
      handle: "alice",
      source: "heuristic",
    });
  });
  it("detects explicit perp intent and leverage", () => {
    const s = heuristicSignal({ ...base, text: "Opening a 10x short on $BTC" });
    expect(s).toMatchObject({
      instrument: "perp",
      direction: "bearish",
      leverage: 10,
    });
  });
  it("reads go long / short as a perp position, but not a long-term horizon", () => {
    for (const text of [
      "go long on monad this week",
      "go short on ETH at 2400",
    ])
      expect(heuristicSignal({ ...base, text }).instrument).toBe("perp");
    expect(mentionsPerp("holding $MON long term")).toBe(false);
    expect(mentionsPerp("short-term $ETH bounce")).toBe(false);
    expect(mentionsPerp("bullish $MON in the long run")).toBe(false);
  });
  it("doesn't read 'in the short term' as a short call (real @AltcoinSherpa post)", () => {
    const s = heuristicSignal({
      postId: "2117998152859136080",
      handle: "altcoinsherpa",
      text: "Looking decent for \n$BTC\n in the short term, I'm eyeing 82kish region next up.",
    });
    expect(s.direction).not.toBe("bearish");
    expect(heuristicSignal({ postId: "1", handle: "a", text: "$ETH higher in the long run" }).direction).toBe("bullish");
    expect(heuristicSignal({ postId: "1", handle: "a", text: "Shorting $ETH here" }).direction).toBe("bearish");
  });

  it("keeps a bearish call without perp language on spot", () => {
    const s = heuristicSignal({ ...base, text: "Selling my $MON, top is in" });
    expect(s.instrument).toBe("spot");
  });
  it("treats an asset with trade intent but no direction as a call", () => {
    const s = heuristicSignal({ ...base, text: "trade mon" });
    expect(s).toMatchObject({ isCall: true, asset: "MON", direction: null });
  });
  it("ignores ordinary posts", () => {
    expect(heuristicSignal({ ...base, text: "gm, coffee time" }).isCall).toBe(
      false,
    );
  });
});

describe("deriveTradeRoute", () => {
  it("routes bullish ETH spot to a Definitive WETH buy on Base", () => {
    expect(deriveTradeRoute(heuristicSignal({ ...base, text: "buy $ETH" }))).toMatchObject({
      status: "available",
      venue: "Definitive",
      side: "buy",
      marketId: "0x4200000000000000000000000000000000000006",
    });
  });
  it("routes bearish spot to a sale, never a short", () => {
    expect(deriveTradeRoute(heuristicSignal({ ...base, text: "sell $BTC now" }))).toMatchObject({
      venue: "Definitive",
      side: "sell",
      instrument: "spot",
      market: "cbBTC / USDC",
    });
  });
  it("gives perp calls no route instead of a spot substitute", () => {
    const r = deriveTradeRoute(heuristicSignal({ ...base, text: "long $BTC 5x" }));
    expect(r.status).toBe("unavailable");
  });
  it("does not route assets without a configured Base market", () => {
    expect(deriveTradeRoute(heuristicSignal({ ...base, text: "buy $SOL" })).status).toBe("unavailable");
    expect(deriveTradeRoute(heuristicSignal({ ...base, text: "buy $MON" })).status).toBe("unavailable");
  });
});

describe("rules-mode phrasing", () => {
  it("reads common bearish exits", () => {
    expect(
      heuristicSignal({ ...base, text: "ETH looks weak here, I'm out" }),
    ).toMatchObject({
      isCall: true,
      asset: "ETH",
      direction: "bearish",
      instrument: "spot",
    });
  });
});

describe("statedTimeframe", () => {
  const day = 86400;
  it.each([
    ["go short on ETH this week at 2400", 7 * day],
    ["long BTC today", day],
    ["MON to 0.05 by friday", 7 * day],
    ["ETH 3k in 3 days", 3 * day],
    ["sol pumps within 4 hours", 4 * 3600],
    ["btc this month 120k", 30 * day],
    ["next 2 weeks eth up", 14 * day],
    ["ETH 5k by end of year", 365 * day],
    // The earliest stated timeframe wins.
    ["BTC 100k tomorrow, eth this month", day],
  ])("%s", (text, seconds) => {
    expect(statedTimeframe(text)).toBe(seconds);
  });

  it("returns null when no timeframe is stated", () => {
    expect(statedTimeframe("buy eth")).toBeNull();
    expect(statedTimeframe("weekly chart looks good")).toBeNull();
  });
});
