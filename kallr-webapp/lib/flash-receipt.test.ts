import { advanceReceipt, receiptRows, startReceipt } from "@kallr/domain/flash-receipt";
import type { FlashQuote } from "@kallr/integrations/definitive";
import { describe, expect, it } from "vitest";
import { receiptEvents, stepLabel } from "./flash-client";

const FROM = "0x1234567890abcdef1234567890abcdef1234abcd";
const quote = {
  quoteId: "q1",
  from: { amount: "2" },
  to: { amount: "0.001" },
  estimatedPriceImpact: "0.0005",
  fees: { estimatedFeeNotional: "0" },
  evm: { orderTypedData: "{}" },
} as FlashQuote;
const info = { quote, from: FROM };

describe("web placement steps as Flash receipt events", () => {
  it("quoting has no quote yet", () => {
    expect(receiptEvents("quoting", undefined, "buy")).toEqual([{ type: "quoting" }]);
  });

  it("the first step after the quote completes the quote row and shows what is signing", () => {
    expect(receiptEvents("approving", info, "buy")).toEqual([
      { type: "quoted", quote: { price: 2000, impact: 0.0005, feeUsd: 0, vsUniswap: null, savedUsd: null } },
      { type: "signing", wallet: FROM, note: stepLabel.approving },
    ]);
  });

  it("carries the Uniswap benchmark into the quote row", () => {
    const [quoted] = receiptEvents("signing", { ...info, uniswapOut: "0.000996" }, "buy");
    expect(quoted?.type === "quoted" && quoted.quote.vsUniswap).toBeCloseTo(0.004016, 5);
  });

  it("submitting marks the Kall wallet's signature done", () => {
    const events = receiptEvents("submitting", info, "buy");
    expect(events.slice(1)).toEqual([{ type: "signed", wallet: FROM }, { type: "sending" }]);
  });

  it("a Kall-wallet trade reads quote → signed → sent with no pop-up", () => {
    let r = startReceipt("your Kall wallet");
    for (const step of ["quoting", "signing", "submitting"] as const) r = receiptEvents(step, step === "quoting" ? undefined : info, "buy").reduce(advanceReceipt, r);
    r = advanceReceipt(r, { type: "sent", orderId: "6f1c2a9e-1b2c-4d5e-8f90-1234567890ab" });
    const rows = receiptRows(r);
    expect(rows.map((row) => row.state)).toEqual(["done", "done", "done", "live"]);
    expect(rows.map((row) => row.detail)).toEqual([
      "$2,000.00 · impact 0.05% · no fee",
      "0x1234…abcd",
      "Order 6f1c2a9e…90ab",
      "Waiting for Definitive to fill…",
    ]);
  });
});
