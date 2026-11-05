import { describe, expect, it } from "vitest";
import { callerRecord, describeCall, describeRecord, median, type Observe, readDirection, scoreCall } from "./after-market";
import { postTimestampMs } from "./calls";

/** Snowflake ID for a unix time, so postTimestampMs round-trips. */
const idAt = (seconds: number) => ((BigInt(seconds * 1000) - 1288834974657n) << 22n).toString();
const T0 = 1_790_000_000;
const DAY = 86400;

/** ETH at 2000 when posted, then a straight line to `end` over a week. */
function line(end: number): Observe {
  return async (asset, t) => {
    const p = 2000 + ((end - 2000) * Math.min(t - T0, 7 * DAY)) / (7 * DAY);
    return { assetId: asset, sourceId: "test", price: String(Math.round(p * 1e8)), priceDecimals: 8, timestamp: String(t) };
  };
}

describe("scoreCall", () => {
  it("round-trips snowflake times", () => {
    expect(Number(postTimestampMs(idAt(T0))) / 1000).toBe(T0);
  });

  it("scores a bullish call at its stated timeframe", async () => {
    const call = await scoreCall({ postId: idAt(T0), handle: "kol", text: "Buying $ETH, higher this week" }, T0 + 30 * DAY, line(2200));
    expect(call).toMatchObject({ asset: "ETH", direction: "up", horizonStated: true, status: "hit", entry: 2000 });
    expect(call?.expiresAt).toBe(T0 + 7 * DAY);
    expect(call?.returnBps).toBe(1000);
  });

  it("scores a bearish call as right when price falls, using 24h when no timeframe is stated", async () => {
    const call = await scoreCall({ postId: idAt(T0), handle: "kol", text: "Selling my $ETH, looks weak" }, T0 + 30 * DAY, line(1300));
    expect(call).toMatchObject({ direction: "down", horizonStated: false, status: "hit" });
    expect(call?.expiresAt).toBe(T0 + DAY);
  });

  it("marks calls inside their timeframe as open against the latest price", async () => {
    const call = await scoreCall({ postId: idAt(T0), handle: "kol", text: "Long $ETH, moon this week 🚀" }, T0 + DAY, line(1300));
    expect(call?.status).toBe("open");
    expect(call?.returnBps).toBeLessThan(0);
  });

  it("ignores posts that are not priced calls", async () => {
    const obs = line(2000);
    expect(await scoreCall({ postId: idAt(T0), handle: "kol", text: "gm frens" }, T0 + DAY, obs)).toBeNull();
    expect(await scoreCall({ postId: idAt(T0), handle: "kol", text: "buy $PEPE now" }, T0 + DAY, obs)).toBeNull();
  });

  it("reports unpriced calls instead of inventing a number", async () => {
    const call = await scoreCall({ postId: idAt(T0), handle: "kol", text: "buy $BTC" }, T0 + 30 * DAY, async () => null);
    expect(call).toMatchObject({ status: "unpriced", returnBps: null });
  });
});

describe("readDirection with an AI reader", () => {
  const post = (text: string) => ({ postId: "2090209604332327087", handle: "cryptocred", text });
  const sarcasm = "Was I long the BTC breakout?\n\nNo.";

  it("lets the reader veto a keyword match (sarcasm)", async () => {
    expect(await readDirection(post(sarcasm))).toEqual({ asset: "BTC", direction: "up" });
    expect(await readDirection(post(sarcasm), async () => ({ isCall: false, symbol: "BTC", direction: null }))).toBeNull();
  });

  it("takes the reader's direction and maps wrapped tickers", async () => {
    expect(await readDirection(post("eyeing 82k on $WETH"), async () => ({ isCall: true, symbol: "WETH", direction: "up" }))).toEqual({
      asset: "ETH",
      direction: "up",
    });
  });

  it("skips coins we can't price, and falls back to keywords when the reader fails", async () => {
    expect(await readDirection(post("buy $PEPE"), async () => ({ isCall: true, symbol: "PEPE", direction: "up" }))).toBeNull();
    expect(await readDirection(post("Shorting $ETH here"), async () => Promise.reject(new Error("timeout")))).toEqual({
      asset: "ETH",
      direction: "down",
    });
  });
});

describe("callerRecord", () => {
  it("summarizes hits, misses and open calls", async () => {
    const posts = [
      { postId: idAt(T0), handle: "kol", text: "buy $ETH this week" },
      { postId: idAt(T0), handle: "kol", text: "sell $ETH now, weak" },
      { postId: idAt(T0), handle: "kol", text: "gm" },
    ];
    const record = await callerRecord("kol", posts, T0 + 30 * DAY, { observe: line(2400) });
    expect(record).toMatchObject({ scored: 2, hits: 1, open: 0 });
    expect(describeRecord(record)).toMatch(/^1 of 2 calls hit \(50%\), median/);
  });

  it("describes a call in one line", async () => {
    const call = await scoreCall({ postId: idAt(T0), handle: "kol", text: "buy $ETH this week" }, T0 + 30 * DAY, line(2200));
    expect(describeCall(call!, T0 + 30 * DAY)).toBe("$ETH up from $2,000 → $2,200 (+10.0%): hit");
  });

  it("median handles even and odd counts", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
});
