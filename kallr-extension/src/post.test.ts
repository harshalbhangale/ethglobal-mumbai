import { parseOrder } from "@kallr/domain/order";
import { describe, expect, it } from "vitest";
import { copyOrderText, deskUrl, identityFromHref, mergeHistory, mightBeCall, PRESETS, timeLeft } from "./post";

describe("identityFromHref", () => {
  it("reads handle and post ID from a timestamp link", () => {
    expect(identityFromHref("/CryptoRover/status/2110056722328908098")).toEqual({
      handle: "cryptorover",
      postId: "2110056722328908098",
    });
    expect(identityFromHref("https://x.com/kol/status/123/")).toEqual({ handle: "kol", postId: "123" });
  });
  it("rejects anything else", () => {
    expect(identityFromHref("/kol/status/123/photo/1")).toBeNull();
    expect(identityFromHref("/i/status/abc")).toBeNull();
    expect(identityFromHref("/bad-handle!/status/1")).toBeNull();
  });
});

describe("copy links", () => {
  it("presets parse back into the right order on the desk", () => {
    const text = copyOrderText("BTC", PRESETS[0]!);
    const parsed = parseOrder(text);
    expect(parsed.ok && parsed.order).toMatchObject({ asset: "BTC", amountUsd: 5, takeProfitPct: 0.1, stopLossPct: 0.05, copy: true });
  });
  it("desk URL carries the order and the source post", () => {
    const url = new URL(deskUrl("https://app.example", "ETH", PRESETS[1]!, { handle: "kol", postId: "42" }));
    expect(url.pathname).toBe("/app");
    expect(url.searchParams.get("order")).toBe("copy $20 of ETH tp 10% sl 5%");
    expect(url.searchParams.get("post")).toBe("42");
    expect(url.searchParams.get("caller")).toBe("kol");
  });
});

describe("mergeHistory", () => {
  it("dedupes, keeps newest first and caps", () => {
    let h: { postId: string; text: string }[] = [];
    h = mergeHistory(h, { postId: "10", text: "a" });
    h = mergeHistory(h, { postId: "30", text: "b" });
    h = mergeHistory(h, { postId: "10", text: "a2" });
    h = mergeHistory(h, { postId: "20", text: "c" }, 2);
    expect(h.map((p) => p.postId)).toEqual(["30", "20"]);
  });
});

it("timeLeft", () => {
  expect(timeLeft(3 * 86400)).toBe("3d left");
  expect(timeLeft(5 * 3600)).toBe("5h left");
  expect(timeLeft(0)).toBe("scoring");
});

it("mightBeCall pre-filters posts worth asking about", () => {
  expect(mightBeCall("Buying $ETH here")).toBe(true);
  expect(mightBeCall("bitcoin to 100k")).toBe(true);
  expect(mightBeCall("gm frens, coffee time")).toBe(false);
  expect(mightBeCall("this costs $5")).toBe(false);
  expect(mightBeCall("new gem CA: 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed")).toBe(true);
});
