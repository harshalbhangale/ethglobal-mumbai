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
import { recordPanel } from "./record-panel";

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
  it("renders tiles, caveats and the breakdown as text", () => {
    const panel = recordPanel("kol", record);
    expect(panel.querySelectorAll(".tile")).toHaveLength(3);
    expect(panel.querySelector(".chips")?.textContent).toContain("Worst call");
    expect(panel.querySelector("details")?.textContent).toContain("$BTC down");
  });
  it("says so plainly when nothing is scored", () => {
    expect(recordPanel("kol", [call("open", 5)]).textContent).toBe("@kol: no scored calls seen yet · 1 open");
  });
});
