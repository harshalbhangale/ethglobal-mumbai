import { flashOrderInputSchema } from "@kallr/integrations/definitive";
import { describe, expect, it } from "vitest";
import { toDecimal, toFlashOrder } from "./flash-order.ts";
import { exitPrices, parseOrder, type ParsedOrder } from "@kallr/domain/order";

const funder = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function flash(text: string, price: number) {
  const r = parseOrder(text);
  if (!r.ok) throw new Error(r.error);
  const order: ParsedOrder = r.order;
  return toFlashOrder(order, exitPrices(order, price), funder);
}

describe("toDecimal", () => {
  it("truncates without exponents", () => {
    expect(toDecimal(2, 6)).toBe("2");
    expect(toDecimal(2659.206, 2)).toBe("2659.2");
    expect(toDecimal(0.000123456789, 8)).toBe("0.00012345");
    expect(toDecimal(1e-12, 8)).toBe("0");
  });
});

describe("toFlashOrder", () => {
  it("copy with TP/SL becomes a USDC buy with an attached bracket", () => {
    const r = flash("copy $2 of ETH, TP 10%, SL 5%", 2400);
    expect(r).toEqual({
      ok: true,
      input: {
        asset: "ETH",
        side: "buy",
        qty: "2",
        orderType: "market",
        funderAddress: funder,
        takeProfit: { notionalPrice: "2640" },
        stopLoss: { notionalPrice: "2280" },
      },
    });
    if (r.ok) expect(flashOrderInputSchema.safeParse(r.input).success).toBe(true);
  });

  it("limit buy uses the limit as entry for the exits", () => {
    const r = flash("buy $5 of BTC at 78,000 tp 5% sl 2%", 80000);
    expect(r.ok && r.input).toMatchObject({
      asset: "BTC",
      orderType: "limit",
      limitPrice: "78000",
      takeProfit: { notionalPrice: "81900" },
      stopLoss: { notionalPrice: "76440" },
    });
  });

  it("dollar sells are sized in the asset", () => {
    const r = flash("sell $10 of ETH", 2500);
    expect(r.ok && r.input).toMatchObject({ side: "sell", qty: "0.004", orderType: "market" });
  });

  it("explains orders Flash can't take", () => {
    expect(flash("sell my ETH at 4,000", 2400)).toMatchObject({ ok: false });
    expect(flash("sell $5 of ETH tp 10% sl 5%", 2400)).toMatchObject({ ok: false });
    expect(flash("copy $2 of ETH tp 10%", 2400)).toMatchObject({ ok: false });
    expect(flash("buy $5 of DEGEN", 0.01)).toMatchObject({ ok: false });
  });
});
