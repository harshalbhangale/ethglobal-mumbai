import { describe, expect, it } from "vitest";
import { logWindows } from "./log-windows";

describe("logWindows", () => {
  it("covers the whole range newest first, each window within the span", () => {
    const w = logWindows(100n, 250n, 50n);
    expect(w).toEqual([
      { fromBlock: 201n, toBlock: 250n },
      { fromBlock: 151n, toBlock: 200n },
      { fromBlock: 101n, toBlock: 150n },
      { fromBlock: 100n, toBlock: 100n },
    ]);
  });

  it("is one window when the range fits", () => {
    expect(logWindows(55_315_000n, 55_340_000n, 50_000n)).toEqual([{ fromBlock: 55_315_000n, toBlock: 55_340_000n }]);
  });

  it("stops at the cap and handles empty ranges", () => {
    expect(logWindows(0n, 1_000n, 10n, 3)).toHaveLength(3);
    expect(logWindows(10n, 5n, 10n)).toEqual([]);
  });
});
