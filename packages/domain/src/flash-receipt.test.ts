import { describe, expect, it } from "vitest";
import {
  advanceReceipt,
  closedWithoutFill,
  fillFrom,
  quoteLine,
  type ReceiptEvent,
  receiptQuote,
  receiptRows,
  savingsLine,
  shortHex,
  shortOrderId,
  startReceipt,
  uniswapEdge,
} from "./flash-receipt";

const WALLET = "0x1234567890abcdef1234567890abcdef1234abcd";
const ORDER = "6f1c2a9e-1b2c-4d5e-8f90-1234567890ab";
const TX = `0x${"ab".repeat(32)}`;
const QUOTE = { price: 3412.2, impact: 0.0004, feeUsd: 0.01 };

const run = (...events: ReceiptEvent[]) => events.reduce(advanceReceipt, startReceipt("your Kall wallet"));
const states = (...events: ReceiptEvent[]) => receiptRows(run(...events)).map((r) => r.state);

describe("Flash receipt rows", () => {
  it("starts with every row pending and no details", () => {
    const rows = receiptRows(startReceipt("your Kall wallet"));
    expect(rows.map((r) => r.key)).toEqual(["quote", "signed", "sent", "filled"]);
    expect(rows[0]?.state).toBe("live");
    expect(rows.slice(1).map((r) => r.state)).toEqual(["pending", "pending", "pending"]);
    expect(rows.slice(1).every((r) => r.detail === "")).toBe(true);
    expect(rows[1]?.title).toBe("Signed by your Kall wallet");
  });

  it("goes live row by row as each step happens", () => {
    expect(states({ type: "quoting" })).toEqual(["live", "pending", "pending", "pending"]);
    expect(states({ type: "quoting" }, { type: "quoted", quote: QUOTE })).toEqual(["done", "live", "pending", "pending"]);

    const signing = receiptRows(run({ type: "quoted", quote: QUOTE }, { type: "signing", wallet: WALLET, note: "Approving this amount on Base…" }));
    expect(signing[0]?.detail).toBe("$3,412.20 · impact 0.04% · fee $0.01");
    expect(signing[1]).toMatchObject({ state: "live", detail: "Approving this amount on Base…" });

    const sending = receiptRows(run({ type: "quoted", quote: QUOTE }, { type: "signed", wallet: WALLET }, { type: "sending" }));
    expect(sending.map((r) => r.state)).toEqual(["done", "done", "live", "pending"]);
    expect(sending[1]?.detail).toBe("0x1234…abcd");
  });

  it("shows the order ID with a copy value once sent, then waits for the fill", () => {
    const rows = receiptRows(run({ type: "quoted", quote: QUOTE }, { type: "signed", wallet: WALLET }, { type: "sent", orderId: ORDER }));
    expect(rows[2]).toMatchObject({ state: "done", detail: "Order 6f1c2a9e…90ab", copy: ORDER });
    expect(rows[3]).toMatchObject({ state: "live", detail: "Waiting for Definitive to fill…" });
    expect(rows[3]?.link).toBeUndefined();
  });

  it("completes with the amount received and a Basescan link", () => {
    const r = run(
      { type: "quoted", quote: QUOTE },
      { type: "signed", wallet: WALLET },
      { type: "sent", orderId: ORDER },
      { type: "filled", tx: TX, received: "0.000293018", symbol: "WETH" },
    );
    const rows = receiptRows(r);
    expect(rows.every((row) => row.state === "done")).toBe(true);
    expect(rows[3]).toMatchObject({
      detail: "Received 0.000293018 WETH",
      link: { href: `https://basescan.org/tx/${TX}`, label: "View swap on Basescan ↗" },
    });
  });

  it("marks only the failed row red, with the error, and stops there", () => {
    const r = run({ type: "quoted", quote: QUOTE }, { type: "signing", wallet: WALLET }, { type: "failed", message: "The wallet didn't sign." });
    const rows = receiptRows(r);
    expect(rows.map((row) => row.state)).toEqual(["done", "failed", "pending", "pending"]);
    expect(rows[1]?.detail).toBe("The wallet didn't sign.");
    // Nothing moves after a failure.
    expect(advanceReceipt(r, { type: "sent", orderId: ORDER })).toBe(r);
  });

  it("fails the Filled row when Flash closes the order", () => {
    const rows = receiptRows(run({ type: "quoted", quote: QUOTE }, { type: "signed", wallet: WALLET }, { type: "sent", orderId: ORDER }, { type: "failed", message: "Closed." }));
    expect(rows.map((row) => row.state)).toEqual(["done", "done", "done", "failed"]);
  });

  it("says a resting limit or TWAP order stays open in Open orders", () => {
    const rows = receiptRows(run({ type: "quoted", quote: QUOTE }, { type: "signed", wallet: WALLET }, { type: "sent", orderId: ORDER, resting: true }));
    expect(rows[3]?.state).toBe("live");
    expect(rows[3]?.detail).toMatch(/stays open in Open orders/);
  });

  it("says when the fill is slow, only once it is waiting for one", () => {
    expect(run({ type: "slow" }).slow).toBe(false);
    const rows = receiptRows(run({ type: "quoted", quote: QUOTE }, { type: "signed", wallet: WALLET }, { type: "sent", orderId: ORDER }, { type: "slow" }));
    expect(rows[3]?.detail).toMatch(/^Still filling/);
  });
});

describe("quote numbers", () => {
  it("prices a buy and a sell from the quote's own amounts", () => {
    const buy = receiptQuote({ from: { amount: "1" }, to: { amount: "0.0005" }, estimatedPriceImpact: "-0.0012", fees: { estimatedFeeNotional: "0.003" } }, "buy");
    expect(buy).toEqual({ price: 2000, impact: 0.0012, feeUsd: 0.003, vsUniswap: null, savedUsd: null });
    const sell = receiptQuote({ from: { amount: "0.001" }, to: { amount: "3.4" } }, "sell");
    expect(sell).toEqual({ price: 3400, impact: null, feeUsd: null, vsUniswap: null, savedUsd: null });
    expect(receiptQuote({ from: { amount: "1" }, to: { amount: "0" } }, "buy").price).toBeNull();
  });

  it("measures Flash against Uniswap for the same trade", () => {
    expect(uniswapEdge("1.004", "1")).toBeCloseTo(0.004, 10);
    expect(uniswapEdge("0.99", "1")).toBeCloseTo(-0.01, 10);
    expect(uniswapEdge("1", null)).toBeNull();
    expect(uniswapEdge("1", "0")).toBeNull();
    expect(receiptQuote({ from: { amount: "1" }, to: { amount: "0.0005" } }, "buy", "0.000498").vsUniswap).toBeCloseTo(0.004016, 5);
    expect(quoteLine({ price: 2000, impact: 0.0012, feeUsd: 0, vsUniswap: 0.0042 })).toBe("$2,000.00 · 0.42% more than Uniswap · no fee");
    expect(quoteLine({ price: 2000, impact: 0.0012, feeUsd: 0, vsUniswap: -0.003 })).toBe("$2,000.00 · impact 0.12% · no fee");
  });

  it("says the saving in dollars: extra tokens at the quote's price on a buy, extra USDC on a sell", () => {
    // $100 buys 0.05 ETH on Flash, 0.0498 on Uniswap: 0.0002 ETH more, at $2,000 = $0.40.
    const buy = receiptQuote({ from: { amount: "100" }, to: { amount: "0.05" } }, "buy", "0.0498");
    expect(buy.savedUsd).toBeCloseTo(0.4, 10);
    expect(savingsLine(buy)).toBe("You saved $0.40 vs Uniswap");
    expect(quoteLine(buy)).toBe("$2,000.00 · $0.40 better than Uniswap");
    // Selling 0.01 ETH: 34.12 USDC on Flash, 34.05 on Uniswap.
    const sell = receiptQuote({ from: { amount: "0.01" }, to: { amount: "34.12" } }, "sell", "34.05");
    expect(savingsLine(sell)).toBe("You saved $0.07 vs Uniswap");
    // A $1 trade: under a cent still reads as money.
    expect(savingsLine(receiptQuote({ from: { amount: "1" }, to: { amount: "0.0005" } }, "buy", "0.000498"))).toBe("You saved $0.004 vs Uniswap");
  });

  it("claims no saving when it wasn't measured or Uniswap was as good", () => {
    expect(savingsLine(receiptQuote({ from: { amount: "100" }, to: { amount: "0.05" } }, "buy"))).toBeNull();
    expect(savingsLine(receiptQuote({ from: { amount: "100" }, to: { amount: "0.0498" } }, "buy", "0.05"))).toBeNull();
    expect(savingsLine(null)).toBeNull();
    // Measured as a percentage only: say that.
    expect(savingsLine({ price: 2000, impact: null, feeUsd: null, vsUniswap: 0.0042 })).toBe("You got 0.42% more than Uniswap");
  });

  it("writes the quote line compactly", () => {
    expect(quoteLine({ price: 2000, impact: 0.0012, feeUsd: 0 })).toBe("$2,000.00 · impact 0.12% · no fee");
    expect(quoteLine({ price: 0.0123, impact: null, feeUsd: 0.003 })).toBe("$0.0123 · fee $0.0030");
    expect(quoteLine({ price: null, impact: null, feeUsd: null })).toBe("Quoted");
  });

  it("shortens addresses and order IDs", () => {
    expect(shortHex(WALLET)).toBe("0x1234…abcd");
    expect(shortOrderId(ORDER)).toBe("6f1c2a9e…90ab");
  });
});

describe("fill polls", () => {
  it("reads the swap hash and the amount received for the side", () => {
    const detail = { status: "ORDER_STATUS_FILLED", fills: [{ transactionId: null }, { transactionId: TX }], filled: { targetAmount: "0.0003", contraAmount: "1.02" } };
    expect(fillFrom(detail, "buy")).toEqual({ tx: TX, received: "0.0003" });
    expect(fillFrom(detail, "sell")).toEqual({ tx: TX, received: "1.02" });
  });

  it("waits while there is no on-chain hash, and keeps a fill without amounts", () => {
    expect(fillFrom({ status: "ORDER_STATUS_ACCEPTED", fills: [] }, "buy")).toBeNull();
    expect(fillFrom({ fills: [{ transactionId: "pending" }] }, "buy")).toBeNull();
    expect(fillFrom(null, "buy")).toBeNull();
    expect(fillFrom({ fills: [{ transactionId: TX }], filled: null }, "buy")).toEqual({ tx: TX, received: null });
  });

  it("knows which statuses never fill", () => {
    expect(closedWithoutFill("ORDER_STATUS_CANCELLED")).toBe(true);
    expect(closedWithoutFill("ORDER_STATUS_REJECTED")).toBe(true);
    expect(closedWithoutFill("ORDER_STATUS_ACCEPTED")).toBe(false);
    expect(closedWithoutFill(null)).toBe(false);
  });
});
