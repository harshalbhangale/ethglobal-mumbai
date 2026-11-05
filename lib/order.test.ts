import { test } from "node:test";
import assert from "node:assert/strict";
import { exitPrices, parseOrder, type ParsedOrder } from "./order.ts";

function ok(text: string): ParsedOrder {
  const r = parseOrder(text);
  assert.ok(r.ok, `expected "${text}" to parse: ${r.ok ? "" : r.error}`);
  return r.order;
}

test("copy with TP and SL", () => {
  const o = ok("copy $2 of ETH, TP 10%, SL 5%");
  assert.deepEqual(o, {
    side: "buy", asset: "ETH", amountUsd: 2, limitPrice: null, takeProfitPct: 0.1, stopLossPct: 0.05, copy: true,
  });
});

test("limit buy with comma price", () => {
  const o = ok("buy $5 of ETH if it dips to 2,900");
  assert.equal(o.limitPrice, 2900);
  assert.equal(o.amountUsd, 5);
  assert.equal(o.side, "buy");
});

test("sell everything at a price", () => {
  const o = ok("sell my ETH at 4,000");
  assert.equal(o.side, "sell");
  assert.equal(o.amountUsd, null);
  assert.equal(o.limitPrice, 4000);
});

test("X reply with handle and cashtag", () => {
  const o = ok("@AfterMarkets copy $10 of $DEGEN tp 25% sl 10%");
  assert.equal(o.asset, "DEGEN");
  assert.equal(o.takeProfitPct, 0.25);
});

test("rejects missing verb and missing amount", () => {
  assert.equal(parseOrder("ETH to the moon").ok, false);
  assert.equal(parseOrder("buy ETH").ok, false);
  assert.equal(parseOrder("").ok, false);
});

test("exit prices for buy and sell", () => {
  const buy = exitPrices(ok("copy $2 of ETH, TP 10%, SL 5%"), 3000);
  assert.ok(Math.abs(buy.takeProfit! - 3300) < 1e-9);
  assert.ok(Math.abs(buy.stopLoss! - 2850) < 1e-9);
  const sell = exitPrices(ok("sell $5 of ETH at 4,000 tp 10% sl 5%"), 3000);
  assert.equal(sell.entry, 4000);
  assert.ok(Math.abs(sell.takeProfit! - 3600) < 1e-9);
  assert.ok(Math.abs(sell.stopLoss! - 4200) < 1e-9);
});
