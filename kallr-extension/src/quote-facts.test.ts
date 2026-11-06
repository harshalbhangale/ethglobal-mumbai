// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flashQuoteSchema } from "@kallr/integrations/definitive";

vi.hoisted(() => Object.assign(globalThis, { KALLR_APP_ORIGIN: "https://kallr.test" }));
const { quoteSummary } = await import("./flash-card");
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

const text = (n: Element) => [...n.querySelectorAll("dt")].map((dt) => `${dt.textContent}=${dt.nextElementSibling?.textContent}`);

describe("quote facts", () => {
  it("reads Flash's decimals as percentages", () => {
    const f = quoteFacts(quote);
    expect(f).toMatchObject({ impact: 0.019775167, slippage: 0.05, feeUsd: 0, receivedUsd: 4898.610935 });
    expect(text(quoteSummary(f, "DEGEN"))).toEqual([
      "You get=5,991,128.5071 DEGEN · ≈$4,898.61",
      "Price impact=1.98%",
      "Max slippage=5.00%",
      "Flash fee=Free",
      "Best price=✓ Definitive Flash · best route on Base",
    ]);
  });

  it("flags heavy impact and skips numbers Flash didn't send", () => {
    const f = quoteFacts({ ...quote, estimatedPriceImpact: "-0.045", recommendedSlippage: null, fees: null });
    const node = quoteSummary(f, "USDC");
    expect(text(node)).toEqual(["You get=5,991,128.5071 USDC · ≈$4,898.61", "Price impact=4.50%", "Best price=✓ Definitive Flash · best route on Base"]);
    expect(node.querySelector(".down")?.textContent).toBe("4.50%");
  });

  it("accepts a numeric slippage", () => {
    expect(quoteFacts(flashQuoteSchema.parse({ ...quote, recommendedSlippage: 0.15 })).slippage).toBe(0.15);
  });
});
