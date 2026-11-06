import { describe, expect, it } from "vitest";
import {
  BASE_USDC,
  buildQuoteRequest,
  buildSubmitRequest,
  FLASH_BASE_ASSETS,
  flashCancelMessage,
  flashClient,
  flashOrderInputSchema,
  flashQuoteSchema,
  NATIVE_ASSET,
} from "./definitive";

const funder = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const copyCall = {
  asset: "ETH" as const,
  side: "buy" as const,
  qty: "2",
  orderType: "market" as const,
  takeProfit: { notionalPrice: "2700" },
  stopLoss: { notionalPrice: "2200" },
  funderAddress: funder,
};

// Trimmed from a live Base quote (2 USDC → WETH with a bracket, forceMinimalAllowance).
const liveQuote = {
  quoteId: "8d061e27-c168-4c71-a749-91353e177dd8",
  from: { asset: "contra", amount: "2", notional: "2" },
  to: { asset: "target", amount: "0.000819279264832803", notional: "1.980579" },
  estimatedPriceImpact: "-0.0016875",
  evm: {
    approveTx: { to: BASE_USDC, data: "0x095ea7b3" },
    permitTypedData: "",
    orderTypedData: '{"primaryType":"FlashOrder"}',
  },
  attachedBracket: {
    evm: {
      approveTx: { to: FLASH_BASE_ASSETS.ETH.address, data: "0x095ea7b3" },
      permitTypedData: null,
      orderTypedData: '{"primaryType":"FlashOrder"}',
    },
    salt: "12993040772762961690023632905185608658155317",
    deadline: "281474976710655",
    signedMaxFromAmount: "0.0008701441634381",
  },
};

describe("buildQuoteRequest", () => {
  it("builds a USDC → WETH buy on Base with an attached bracket and bounded approvals", () => {
    expect(buildQuoteRequest(copyCall)).toEqual({
      targetChain: "base",
      contraChain: "base",
      targetAsset: FLASH_BASE_ASSETS.ETH.address,
      contraAsset: BASE_USDC,
      side: "buy",
      qty: "2",
      orderType: "market",
      funderAddress: funder,
      forceMinimalAllowance: true,
      attachedBracket: { takeProfit: { notionalPrice: "2700" }, stopLoss: { notionalPrice: "2200" } },
    });
  });

  it("prices a limit entry as a cross price so it can carry a bracket", () => {
    const req = buildQuoteRequest({ ...copyCall, orderType: "limit", limitPrice: "2300" });
    expect(req.limitCrossPrice).toBe("2300");
    expect(req).not.toHaveProperty("limitNotionalPrice");
  });

  it("rejects orders Flash would refuse or that make no sense on spot", () => {
    const bad = [
      { ...copyCall, orderType: "limit" as const },
      { ...copyCall, limitPrice: "2300" },
      { ...copyCall, side: "sell" as const },
      { ...copyCall, stopLoss: undefined },
      { ...copyCall, takeProfit: { notionalPrice: "2000" } },
      { ...copyCall, qty: "0" },
      { ...copyCall, qty: "1e3" },
      { ...copyCall, funderAddress: "0x123" },
    ];
    for (const o of bad) expect(flashOrderInputSchema.safeParse(o).success, JSON.stringify(o)).toBe(false);
  });
});

describe("quote and submit", () => {
  it("accepts the live quote shape", () => {
    expect(flashQuoteSchema.parse(liveQuote).attachedBracket?.signedMaxFromAmount).toBe("0.0008701441634381");
  });

  it("echoes the order, both signatures and the bracket material on submit", () => {
    const req = buildQuoteRequest(copyCall);
    const body = buildSubmitRequest(req, {
      quoteId: liveQuote.quoteId,
      userSignature: "0xaa",
      evmOrderTypedData: liveQuote.evm.orderTypedData,
      bracket: {
        userSignature: "0xbb",
        salt: liveQuote.attachedBracket.salt,
        deadline: liveQuote.attachedBracket.deadline,
        signedMaxFromAmount: liveQuote.attachedBracket.signedMaxFromAmount,
      },
    });
    expect(body).toMatchObject({
      ...req,
      quoteId: liveQuote.quoteId,
      userSignature: "0xaa",
      attachedBracket: {
        takeProfit: { notionalPrice: "2700" },
        stopLoss: { notionalPrice: "2200" },
        userSignature: "0xbb",
        salt: liveQuote.attachedBracket.salt,
      },
    });
  });

  it("refuses a submit whose bracket signature does not match the quote", () => {
    const req = buildQuoteRequest(copyCall);
    expect(() =>
      buildSubmitRequest(req, { quoteId: "q", userSignature: "0xaa", evmOrderTypedData: "{}" }),
    ).toThrow(/Bracket/);
  });
});

describe("flashClient", () => {
  it("sends the API key and surfaces Flash errors", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, key: new Headers(init.headers).get("x-definitive-api-key") });
      return new Response(JSON.stringify({ message: "insufficient balance" }), { status: 400 });
    }) as unknown as typeof fetch;
    const client = flashClient({ apiKey: "k_test", fetcher });
    await expect(client.quote(buildQuoteRequest(copyCall))).rejects.toThrow("insufficient balance");
    expect(seen[0]).toEqual({ url: "https://flash.definitive.fi/v1/quote", key: "k_test" });
  });
});

describe("selling native ETH", () => {
  const seller = "0x94d3d3466ED0a6299D9384190eF461bb171e140D";
  it("quotes the native asset and submits the wrapped one", () => {
    const req = buildQuoteRequest({ asset: "ETH", side: "sell", qty: "0.0003", orderType: "market", funderAddress: seller, native: true });
    expect(req.targetAsset).toBe(NATIVE_ASSET);
    const body = buildSubmitRequest(req, { quoteId: "q", userSignature: "0xab", evmOrderTypedData: "{}" });
    expect(body.targetAsset).toBe(FLASH_BASE_ASSETS.ETH.address);
  });
  it("refuses native ETH anywhere but an ETH sell", () => {
    expect(() => buildQuoteRequest({ asset: "ETH", side: "buy", qty: "1", orderType: "market", funderAddress: seller, native: true })).toThrow();
    expect(() => buildQuoteRequest({ asset: "BTC", side: "sell", qty: "0.0001", orderType: "market", funderAddress: seller, native: true })).toThrow();
  });
  it("reads the wrap action from a quote", () => {
    const q = flashQuoteSchema.parse({
      quoteId: "q",
      from: { amount: "0.0003" },
      to: { amount: "0.57" },
      wrap: { wrappedAsset: FLASH_BASE_ASSETS.ETH.address, evmTx: { to: FLASH_BASE_ASSETS.ETH.address, data: "0xd0e30db0", value: "300000000000000" } },
      evm: { approveTx: null, permitTypedData: "", orderTypedData: "{}" },
    });
    expect(q.wrap?.evmTx?.value).toBe("300000000000000");
  });
});

describe("TWAP", () => {
  const twap = { asset: "ETH" as const, side: "buy" as const, qty: "10", orderType: "twap" as const, funderAddress: funder };

  it("spreads a buy over its duration, and can carry a bracket", () => {
    const req = buildQuoteRequest({ ...twap, durationSeconds: 600 });
    expect(req).toMatchObject({ orderType: "twap", durationSeconds: 600, qty: "10" });
    const withExits = buildQuoteRequest({ ...twap, durationSeconds: 3600, takeProfit: { notionalPrice: "2700" }, stopLoss: { notionalPrice: "2200" } });
    expect(withExits.attachedBracket).toEqual({ takeProfit: { notionalPrice: "2700" }, stopLoss: { notionalPrice: "2200" } });
  });

  it("needs a duration within Flash's 5 minutes to 30 days, and no limit price", () => {
    expect(flashOrderInputSchema.safeParse(twap).success).toBe(false);
    expect(flashOrderInputSchema.safeParse({ ...twap, durationSeconds: 120 }).success).toBe(false);
    expect(flashOrderInputSchema.safeParse({ ...twap, durationSeconds: 31 * 86_400 }).success).toBe(false);
    expect(flashOrderInputSchema.safeParse({ ...twap, durationSeconds: 600, limitPrice: "2500" }).success).toBe(false);
  });

  it("refuses a duration on market and limit orders", () => {
    expect(flashOrderInputSchema.safeParse({ ...copyCall, durationSeconds: 600 }).success).toBe(false);
    expect(buildQuoteRequest(copyCall)).not.toHaveProperty("durationSeconds");
  });
});

describe("listOrders", () => {
  it("reads the order list as Flash sends it, with assets and fills as objects", async () => {
    const asset = (address: string, ticker: string) => ({ id: "x", name: ticker, address, ticker, chain: { id: "8453", name: "base", namespace: "eip155" } });
    const listed = {
      orderId: "bf841342-89db-4ada-88bc-a640fa15295b",
      orderType: "market",
      side: "sell",
      status: "ORDER_STATUS_FILLED",
      closeReason: "REASON_FULLY_FILLED",
      targetAsset: asset(FLASH_BASE_ASSETS.ETH.address, "WETH"),
      contraAsset: asset(BASE_USDC, "USDC"),
      qty: "0.0001",
      filled: { targetAmount: "0.0001", contraAmount: "0.204526", averagePrice: "2045.26", averageNotionalPrice: "2045.26" },
      limitNotionalPrice: null,
      brackets: null,
      placedAt: "2026-11-06T05:21:19.875Z",
    };
    const fetcher = (async () => new Response(JSON.stringify({ orders: [listed], nextPageToken: null }))) as unknown as typeof fetch;
    const [order] = await flashClient({ apiKey: "k_test", fetcher }).listOrders("0x94d3d3466ED0a6299D9384190eF461bb171e140D");
    expect(order).toMatchObject({
      targetAsset: FLASH_BASE_ASSETS.ETH.address,
      contraAsset: BASE_USDC,
      filled: { targetAmount: "0.0001", contraAmount: "0.204526", averagePrice: "2045.26" },
    });
  });
});

describe("flashCancelMessage", () => {
  it("is the exact two-line message Flash checks", () => {
    expect(flashCancelMessage("0b6f7c2e-1111-4222-8333-444455556666")).toBe(
      "Definitive Flash v1 — Cancel Order\nOrder: 0b6f7c2e-1111-4222-8333-444455556666",
    );
  });
});
