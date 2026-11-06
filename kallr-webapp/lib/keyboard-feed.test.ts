import { describe, expect, it } from "vitest";
import { callerRows, snapshotExcerpt } from "./keyboard-feed";

describe("callerRows", () => {
  const roster = [
    { handle: "cryptokaleo", focus: "BTC and alts" },
    { handle: "pentosh1", focus: "majors" },
  ];
  const calls = [
    { caller: "CryptoKaleo", postedAt: 100 },
    { caller: "eyewhales", postedAt: 300 },
  ];
  const results = [
    { caller: "cryptokaleo", status: "hit", returnBps: 120 },
    { caller: "cryptokaleo", status: "miss", returnBps: -80 },
    { caller: "cryptokaleo", status: "hit", returnBps: 40 },
  ];

  it("lists the roster and anyone with a priced call, with their record", () => {
    const rows = callerRows(roster, calls, results);
    expect(rows.map((r) => r.handle)).toEqual(["cryptokaleo", "eyewhales", "pentosh1"]);
    expect(rows[0]).toMatchObject({ tracked: true, open: 1, settled: 3, hits: 2, medianBps: 40, lastCallAt: 100 });
    expect(rows[0]!.hitRate).toBeCloseTo(2 / 3);
    expect(rows[1]).toMatchObject({ tracked: false, focus: null, open: 1, settled: 0, hitRate: null });
    expect(rows[2]).toMatchObject({ tracked: true, open: 0, settled: 0 });
  });
});

describe("snapshotExcerpt", () => {
  it("flattens whitespace and trims long posts", () => {
    expect(snapshotExcerpt({ text: "  $ETH to 4k\n\nthis week " })).toBe("$ETH to 4k this week");
    expect(snapshotExcerpt({ text: "a".repeat(300) }, 10)).toBe(`${"a".repeat(9)}…`);
    expect(snapshotExcerpt({ text: "" })).toBeNull();
    expect(snapshotExcerpt(null)).toBeNull();
  });
});
