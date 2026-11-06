import { buildQuoteRequest, flashOrderInputSchema, NATIVE_ASSET } from "@kallr/integrations/definitive";
import { describe, expect, it } from "vitest";
import { firstCashtag } from "./keyboard";
import { approvalTarget, buildKeyboardOrder, buildSwapOrder, ethForUsd, keyboardOrderSchema, keyboardSwapSchema, maxSwapUsd, priceString } from "./keyboard-trade";

const funder = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const PEPE = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";

describe("priceString", () => {
  it("keeps 6 significant digits without exponents", () => {
    expect(priceString(3412.5)).toBe("3412.5");
    expect(priceString(98_765.4321)).toBe("98765.4");
    expect(priceString(0.0000123456789)).toBe("0.0000123457");
    expect(() => priceString(0)).toThrow();
  });
});

describe("buildKeyboardOrder", () => {
  it("turns a $5 swap with TP/SL percents into a Flash buy with exit prices", () => {
    const o = keyboardOrderSchema.parse({ funder, token: "ETH", kind: "swap", usd: "5", tpPct: 10, slPct: 5, postId: "1850000000000000000", caller: "kol" });
    const input = buildKeyboardOrder(o, 3000);
    expect(input).toEqual({
      asset: "ETH",
      side: "buy",
      qty: "5",
      orderType: "market",
      funderAddress: funder,
      takeProfit: { notionalPrice: "3300" },
      stopLoss: { notionalPrice: "2850" },
      sourcePostId: "1850000000000000000",
    });
    expect(flashOrderInputSchema.safeParse(input).success).toBe(true);
  });

  it("prices a limit below market and its exits from the limit entry", () => {
    const o = keyboardOrderSchema.parse({ funder, token: PEPE, kind: "limit", usd: "2", limitPct: -5, tpPct: 20, slPct: 10 });
    const input = buildKeyboardOrder(o, 0.00001);
    expect(input).toMatchObject({ orderType: "limit", limitPrice: "0.0000095", takeProfit: { notionalPrice: "0.0000114" }, stopLoss: { notionalPrice: "0.00000855" } });
    expect(buildQuoteRequest(input).targetAsset).toBe(PEPE);
  });

  it("spreads a TWAP over its minutes", () => {
    const o = keyboardOrderSchema.parse({ funder, token: "BTC", kind: "twap", usd: "20", twapMinutes: 30 });
    expect(buildQuoteRequest(buildKeyboardOrder(o, 100_000))).toMatchObject({ orderType: "twap", durationSeconds: 1800 });
  });

  it("refuses half an exit, a limit without a distance and a TWAP without a duration", () => {
    expect(keyboardOrderSchema.safeParse({ funder, token: "ETH", kind: "swap", usd: "5", tpPct: 10 }).success).toBe(false);
    expect(keyboardOrderSchema.safeParse({ funder, token: "ETH", kind: "limit", usd: "5" }).success).toBe(false);
    expect(keyboardOrderSchema.safeParse({ funder, token: "ETH", kind: "twap", usd: "5" }).success).toBe(false);
    expect(keyboardOrderSchema.safeParse({ funder, token: "ETH", kind: "swap", usd: "0" }).success).toBe(false);
  });
});

describe("firstCashtag", () => {
  it("finds the coin a post calls, not dollar amounts", () => {
    expect(firstCashtag("$PEPE sending this week, buying $500 more")).toBe("PEPE");
    expect(firstCashtag("up 20% on $5 bags")).toBeNull();
  });
});

describe("swap ETH to USDC", () => {
  it("sells ETH worth the dollars asked, rounded down", () => {
    expect(ethForUsd(10, 2000)).toBe("0.005");
    expect(ethForUsd(10, 2223.41)).toBe("0.004497");
    expect(() => ethForUsd(0.0001, 2000)).toThrow();
  });
  it("keeps about $1 of ETH for gas", () => {
    expect(maxSwapUsd(0.0104, 2000)).toBe(20);
    expect(maxSwapUsd(0.0003, 2000)).toBe(0);
  });
  it("is a market sell of native ETH that Flash will quote", () => {
    const order = buildSwapOrder("10", 2000, funder);
    expect(flashOrderInputSchema.parse(order)).toMatchObject({ asset: "ETH", side: "sell", qty: "0.005", native: true });
    expect(buildQuoteRequest(order).targetAsset).toBe(NATIVE_ASSET);
  });
  it("takes whole dollars and cents, from $1", () => {
    expect(keyboardSwapSchema.safeParse({ usd: "12.5" }).success).toBe(true);
    expect(keyboardSwapSchema.safeParse({ usd: "0.5" }).success).toBe(false);
    expect(keyboardSwapSchema.safeParse({ usd: "1.234" }).success).toBe(false);
  });
});

describe("approvalTarget", () => {
  it("reads the token and spender from an ERC-20 approve, and nothing from anything else", () => {
    const spender = "1111111254eeb25477b68fb85ed929f73a960582";
    const data = `0x095ea7b3${"0".repeat(24)}${spender}${"f".repeat(64)}`;
    expect(approvalTarget({ to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data })).toEqual({
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      spender: `0x${spender}`,
    });
    expect(approvalTarget({ to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0xa9059cbb00" })).toBeNull();
    expect(approvalTarget(null)).toBeNull();
  });
});
