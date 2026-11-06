import { advanceReceipt, receiptRows, startReceipt } from "@kallr/domain/flash-receipt";
import { describe, expect, it } from "vitest";
import { STEP_LABEL } from "./flash-direct";
import { stepEvents } from "./flash-receipt-card";

const FROM = "0x1234567890abcdef1234567890abcdef1234abcd";

describe("MetaMask steps as Flash receipt events", () => {
  it("connecting and quoting keep the quote row live", () => {
    expect(stepEvents("connecting")).toEqual([{ type: "quoting" }]);
    expect(stepEvents("quoting", FROM)).toEqual([{ type: "quoting" }]);
  });

  it("every wallet prompt shows on the signing row with its own label", () => {
    for (const step of ["wrapping", "approving", "approving-exits", "signing", "signing-exits"] as const) {
      expect(stepEvents(step, FROM)).toEqual([{ type: "signing", wallet: FROM, note: STEP_LABEL[step] }]);
    }
  });

  it("submitting means the signature is done and the order is on its way", () => {
    expect(stepEvents("submitting", FROM)).toEqual([{ type: "signed", wallet: FROM }, { type: "sending" }]);
  });

  it("walks a whole MetaMask placement to the fill", () => {
    let r = startReceipt("MetaMask");
    for (const step of ["connecting", "quoting"] as const) r = stepEvents(step, FROM).reduce(advanceReceipt, r);
    r = advanceReceipt(r, { type: "quoted", quote: { price: 2000, impact: 0.001, feeUsd: 0 } });
    for (const step of ["approving", "signing", "submitting"] as const) r = stepEvents(step, FROM).reduce(advanceReceipt, r);
    expect(receiptRows(r).map((row) => row.state)).toEqual(["done", "done", "live", "pending"]);
    expect(receiptRows(r)[1]?.title).toBe("Signed by MetaMask");
    r = advanceReceipt(r, { type: "sent", orderId: "6f1c2a9e-1b2c-4d5e-8f90-1234567890ab" });
    r = advanceReceipt(r, { type: "filled", tx: `0x${"cd".repeat(32)}`, received: "0.0005", symbol: "WETH" });
    expect(receiptRows(r).every((row) => row.state === "done")).toBe(true);
  });
});
