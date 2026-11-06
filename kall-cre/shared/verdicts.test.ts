import { describe, expect, it } from "vitest";
import { decide, score, STATUS, VERDICT } from "./verdicts";

const REAL = "0xB1a03EdA10342529bBF8EB700a06C60441fEf25d";
const FAKE = "0x1111111111111111111111111111111111111111";

describe("decide", () => {
  it("passes the real coin", () => expect(decide(REAL, "PEPE", "PEPE", REAL.toLowerCase())).toBe(VERDICT.real));
  it("catches an impostor with the same symbol", () => expect(decide(FAKE, "PEPE", "PEPE", REAL)).toBe(VERDICT.impostor));
  it("catches a contract that is another coin", () => expect(decide(FAKE, "PEPE", "DOGE", REAL)).toBe(VERDICT.mismatch));
  it("catches an address that isn't a token", () => expect(decide(FAKE, "PEPE", "", REAL)).toBe(VERDICT.noToken));
  it("says unknown when there's no liquid real coin to compare", () => expect(decide(FAKE, "XYZ", "XYZ", "")).toBe(VERDICT.unknown));
});

describe("score", () => {
  it("scores a long that went up as a hit", () => expect(score(true, 300_000_000_000n, 330_000_000_000n)).toEqual({ returnBps: 1000, status: STATUS.hit }));
  it("scores a short that went up as a miss", () => expect(score(false, 300_000_000_000n, 330_000_000_000n)).toEqual({ returnBps: -1000, status: STATUS.miss }));
  it("leaves a call without an entry price open", () => expect(score(true, 0n, 1n).status).toBe(STATUS.open));
});
