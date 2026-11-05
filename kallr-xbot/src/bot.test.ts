import { parseOrder } from "@kallr/domain/order";
import type { CallerRecord, Observe } from "@kallr/integrations/after-market";
import { describe, expect, it } from "vitest";
import { type BotDeps, commandText, MAX_REPLY, orderText, replyFor, type Tag, xLength } from "./bot";

const idAt = (seconds: number) => ((BigInt(seconds * 1000) - 1288834974657n) << 22n).toString();
const T0 = 1_790_000_000;
const observe: Observe = async (asset, t) => ({
  assetId: asset,
  sourceId: "test",
  price: String((t > T0 + 3600 ? 2100 : 2000) * 1e8),
  priceDecimals: 8,
  timestamp: String(t),
});
const record: CallerRecord = {
  handle: "kol",
  methodology: "directional-return-v1",
  scored: 11,
  hits: 7,
  hitRate: 7 / 11,
  medianReturnBps: 320,
  open: 2,
  calls: [],
};
const deps: BotDeps = {
  botHandle: "Kallr",
  appUrl: "https://kallr.example",
  nowSeconds: T0 + 7200,
  record: async () => record,
  observe,
};
const call = { postId: idAt(T0), handle: "kol", text: "Buying $ETH here, higher this week 🚀" };
const tag = (text: string, parent: Tag["parent"] = call): Tag => ({ postId: "9", text, fromHandle: "alice", parent });

describe("replyFor", () => {
  it("replies with the caller's record and this call's after market", async () => {
    const reply = await replyFor(tag("@kol @Kallr"), deps);
    expect(reply).toContain("@alice After market for @kol:");
    expect(reply).toContain("7 of 11 calls hit (64%), median +3.2% · 2 open");
    expect(reply).toContain("This call: $ETH up from $2,000 → $2,100 (+5.0%)");
    expect(xLength(reply!)).toBeLessThanOrEqual(MAX_REPLY);
  });

  it("turns a bare copy into a desk link for the call's asset, never a trade", async () => {
    const reply = await replyFor(tag("@kol @Kallr copy $2, TP 10%, SL 5%", { ...call, text: "long $BTC this week" }), deps);
    expect(reply).toContain("Copy @kol's call: buy $2 of $BTC, TP +10% / SL −5% on Base.");
    const link = new URL(reply!.match(/https:\S+/)![0]);
    expect(link.pathname).toBe("/app");
    expect(link.searchParams.get("order")).toBe("copy $2 of BTC tp 10% sl 5%");
    expect(link.searchParams.get("post")).toBe(call.postId);
    expect(xLength(reply!)).toBeLessThanOrEqual(MAX_REPLY);
  });

  it("explains bad orders and untagged posts, and ignores itself", async () => {
    expect(await replyFor(tag("@Kallr copy"), deps)).toContain("Say how much");
    expect(await replyFor(tag("@Kallr what's up", null), deps)).toContain("Reply to a crypto call and tag me");
    expect(await replyFor({ ...tag("@Kallr"), fromHandle: "kallr" }, deps)).toBeNull();
  });

  it("says so when the post isn't a priced call", async () => {
    const reply = await replyFor(tag("@Kallr", { ...call, text: "gm, coffee time" }), deps);
    expect(reply).toContain("This post isn't a call I can price");
    expect(reply).not.toContain("Copy it");
  });

  it("won't copy a ticker trade from a post that shares a contract", async () => {
    const bait = { ...call, text: "Buying $ETH here 🚀 CA: 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" };
    const reply = await replyFor(tag("@kol @Kallr copy $2", bait), deps);
    expect(reply).toContain("won't copy a ticker trade");
    expect(reply).not.toMatch(/https:\/\//);
  });
});

describe("helpers", () => {
  it("strips leading reply handles", () => {
    expect(commandText("@kol @Kallr  copy $2")).toBe("copy $2");
  });
  it("order text parses back to the same order", () => {
    for (const text of ["copy $2 of BTC tp 10% sl 5%", "buy $5 of ETH at 2300 tp 8% sl 4%", "sell $3 of ETH"]) {
      const a = parseOrder(text);
      expect(a.ok && orderText(a.order)).toBe(text);
    }
  });
  it("counts links as 23 characters", () => {
    expect(xLength(`a https://example.com/${"x".repeat(100)}`)).toBe(25);
  });
});
