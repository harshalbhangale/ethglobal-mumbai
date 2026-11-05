// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  byAssetDirection,
  caveats,
  callStats,
  formatBps,
  profitFactor,
  type SeenCall,
  statTiles,
  worstCall,
} from "./card-metrics";
import { breakdown, recordPanel } from "./record-panel";

let id = 0;
const call = (status: SeenCall["status"], returnBps: number | null, asset = "ETH", direction: "up" | "down" = "up"): SeenCall => ({
  postId: String(++id),
  asset,
  direction,
  status,
  returnBps,
  postedAt: 1_800_000_000 + id,
  expiresAt: 1_800_086_400 + id,
});

const record = [
  call("hit", 300),
  call("hit", 120),
  call("miss", -1500),
  call("hit", 80, "BTC", "down"),
  call("miss", -40, "BTC", "down"),
  call("flat", 0),
  call("open", 50),
  call("unpriced", null),
];

describe("callStats", () => {
  it("counts settled calls only, with open ones kept apart", () => {
    expect(callStats(record)).toEqual({ scored: 6, hits: 3, open: 1, medianBps: 40 });
    expect(callStats([])).toBeNull();
    expect(callStats([call("open", 10)])).toEqual({ scored: 0, hits: 0, open: 1, medianBps: null });
  });
});

describe("profit factor and worst call", () => {
  it("divides gains by losses, and is null with no losses", () => {
    expect(profitFactor(record)).toBeCloseTo(500 / 1540);
    expect(profitFactor([call("hit", 100)])).toBeNull();
  });
  it("finds the worst settled call", () => {
    expect(worstCall(record)?.returnBps).toBe(-1500);
    expect(worstCall([call("open", -5000)])).toBeNull();
  });
});

describe("byAssetDirection", () => {
  it("groups settled calls, most-called first", () => {
    expect(byAssetDirection(record)).toEqual([
      { asset: "ETH", direction: "up", scored: 4, hits: 2, medianBps: 60 },
      { asset: "BTC", direction: "down", scored: 2, hits: 1, medianBps: 20 },
    ]);
  });
});

describe("tiles and caveats", () => {
  it("shows hit rate, median and profit factor with tones", () => {
    expect(statTiles(record)).toEqual([
      { label: "Hit rate", value: "3/6" },
      { label: "Median move", value: "+0.4%", tone: "good" },
      { label: "Profit factor", value: "0.32", tone: "bad" },
    ]);
    expect(statTiles([call("open", 1)])).toEqual([]);
  });
  it("flags small samples, big losers and unpriced calls; never praises", () => {
    expect(caveats(record)).toEqual([
      "Worst call −15.0% on $ETH",
      "Some calls couldn't be priced at posting time",
    ]);
    expect(caveats([call("hit", 100)])).toEqual(["Only 1 scored call seen: too few to judge"]);
    expect(caveats([])).toEqual(["Only 0 scored calls seen: too few to judge"]);
  });
  it("formats basis points with a real minus sign", () => {
    expect(formatBps(-1234)).toBe("−12.3%");
    expect(formatBps(0)).toBe("+0.0%");
  });
});

describe("recordPanel", () => {
  it("renders Xtrading-style stat tiles and caveat rows", () => {
    const panel = recordPanel(record);
    const tiles = [...panel.querySelectorAll(".stat-tile")].map((t) => [
      t.querySelector(".stat-value")?.textContent,
      t.querySelector(".stat-label")?.textContent,
    ]);
    expect(tiles).toEqual([
      ["8", "Detected calls"],
      ["3/6", "Moved their way"],
      ["+0.4%", "Median since post"],
      ["6", "Bullish"],
      ["2", "Bearish"],
    ]);
    expect(panel.querySelector(".stat-tile.good .stat-label")?.textContent).toBe("Median since post");
    const rows = panel.textContent ?? "";
    expect(rows).toContain("Profit factor0.32");
    expect(rows).toContain("Worst call−15.0% on $ETH");
    // Sample is 6 scored, above the minimum, so no "too few" row; unpriced calls go to No data.
    expect(rows).not.toContain("too few");
    expect(panel.querySelector(".unavailable summary")?.textContent).toBe("No data · 1");
  });
  it("puts what can't be computed in the No data dropdown, never as zero", () => {
    const panel = recordPanel([call("open", 5)]);
    expect(panel.querySelector(".unavailable summary")?.textContent).toBe("No data · 3");
    expect(panel.textContent).toContain("1 still open");
    expect(panel.textContent).toContain("0 scored · too few to judge");
  });
  it("breaks the record down by asset and direction", () => {
    expect(breakdown(record).textContent).toContain("$BTC bearish1/2 moved their way · median +0.2%");
    expect(breakdown([]).textContent).toBe("Nothing scored yet to break down.");
  });
});
