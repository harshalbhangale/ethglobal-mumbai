import { quoteLine, receiptQuote } from "@kallr/domain/flash-receipt";
import { describe, expect, it, vi } from "vitest";
import { flashQuoteSchema } from "@kallr/integrations/definitive";

vi.hoisted(() => Object.assign(globalThis, { KALLR_APP_ORIGIN: "https://kallr.test" }));
const { quoteFacts } = await import("./flash-direct");

// Shape of a real $5,000 USDC → DEGEN quote from Flash (decimals: 0.01 = 1%).
const quote = flashQuoteSchema.parse({
  quoteId: "q1",
  from: { amount: "5000", notional: "5000" },
  to: { amount: "5991128.507086361682721822", notional: "4898.610935" },
  estimatedPriceImpact: "0.019775167",
  recommendedSlippage: "0.05",
  fees: { estimatedFeeNotional: "0" },
  evm: { orderTypedData: "{}" },
});

describe("quote facts", () => {
  it("reads Flash's decimals as fractions", () => {
    expect(quoteFacts(quote)).toMatchObject({ impact: 0.019775167, slippage: 0.05, feeUsd: 0, receivedUsd: 4898.610935 });
  });

  it("skips numbers Flash didn't send and accepts a numeric slippage", () => {
    expect(quoteFacts({ ...quote, recommendedSlippage: null, fees: null })).toMatchObject({ slippage: null, feeUsd: null });
    expect(quoteFacts(flashQuoteSchema.parse({ ...quote, recommendedSlippage: 0.15 })).slippage).toBe(0.15);
  });
});

describe("the receipt's quote row against Uniswap", () => {
  it("says how much more Flash gives than Uniswap's pools for the same trade", () => {
    // Uniswap's best pool would give 0.42% less DEGEN: on $5,000 that's about $20.91 more DEGEN with Flash.
    const uni = (5991128.507086361682721822 / 1.0042).toString();
    expect(quoteLine(receiptQuote(quote, "buy", uni))).toBe("$0.00083457 · $20.91 better than Uniswap · no fee");
  });

  it("shows the price impact instead when Uniswap wasn't measured, ties or gives more", () => {
    expect(quoteLine(receiptQuote(quote, "buy", null))).toBe("$0.00083457 · impact 1.98% · no fee");
    expect(quoteLine(receiptQuote(quote, "buy", quote.to.amount))).toBe("$0.00083457 · impact 1.98% · no fee");
    expect(quoteLine(receiptQuote(quote, "buy", "6100000"))).toBe("$0.00083457 · impact 1.98% · no fee");
  });
});
