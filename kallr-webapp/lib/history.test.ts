import { describe, expect, it } from "vitest";
import type { FlashOrder } from "@kallr/integrations/definitive";
import { mergeHistory, parseWallets, type TradeRecord } from "./history";

const KALL = "0xa8405c56803353580962205BC20A36e3e10a8072";
const MINE = "0x94d3d3466ED0a6299D9384190eF461bb171e140D";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const order = (orderId: string, placedAt: string, funder: string): FlashOrder => ({
  orderId,
  orderType: "market",
  side: "sell",
  status: "ORDER_STATUS_FILLED",
  targetAsset: WETH,
  contraAsset: USDC,
  qty: "0.0001",
  placedAt,
  funderAddress: funder,
});

const record = (flashOrderId: string, trader: string, source: string, extra: Partial<TradeRecord> = {}): TradeRecord => ({
  key: `0xkey-${flashOrderId}`,
  trader,
  source,
  asset: "ETH",
  side: "sell",
  orderType: "market",
  qty: "0.0001",
  flashOrderId,
  caller: null,
  postId: null,
  placedAt: 1_793_900_000,
  ...extra,
});

describe("mergeHistory", () => {
  it("joins each wallet's Flash orders with their Arkiv records, newest first", () => {
    const { orders, failed } = mergeHistory([
      { address: KALL, orders: [order("kb-1", "2026-11-06T14:09:02.587Z", KALL)], records: [record("kb-1", KALL, "keyboard")] },
      {
        address: MINE,
        orders: [order("x-1", "2026-11-06T05:21:19.875Z", MINE), order("old-1", "2026-11-05T18:52:34.630Z", MINE)],
        records: [record("x-1", MINE, "extension", { caller: "lookonchain", postId: "1986" })],
      },
    ]);
    expect(failed).toEqual([]);
    expect(orders.map((o) => [o.orderId, o.source, o.funderAddress])).toEqual([
      ["kb-1", "keyboard", KALL],
      ["x-1", "extension", MINE],
      ["old-1", null, MINE],
    ]);
    expect(orders[1]).toMatchObject({ caller: "lookonchain", postId: "1986", arkivKey: "0xkey-x-1", assetHint: "ETH" });
    expect(orders[2]).toMatchObject({ caller: null, arkivKey: null, assetHint: null });
  });

  it("still shows a recorded trade Flash didn't list, and names the wallets Flash couldn't read", () => {
    const { orders, failed } = mergeHistory([
      { address: MINE, orders: null, records: [record("x-2", MINE, "desk", { asset: "0x311935cd80b76769bf2ecc9d8ab7635b2139cf82" })] },
    ]);
    expect(failed).toEqual([MINE]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ orderId: "x-2", status: "RECORDED", source: "desk", funderAddress: MINE, assetHint: null });
    expect(orders[0]!.placedAt).toBe(new Date(1_793_900_000 * 1000).toISOString());
  });

  it("lists an order once even if two wallets return it", () => {
    const o = order("same", "2026-11-06T05:00:00.000Z", KALL);
    expect(mergeHistory([{ address: KALL, orders: [o], records: [] }, { address: KALL, orders: [o], records: [] }]).orders).toHaveLength(1);
  });
});

describe("parseWallets", () => {
  it("takes up to five distinct addresses and rejects anything else", () => {
    expect(parseWallets(`${KALL}, ${MINE},${KALL.toLowerCase()}`)).toEqual([KALL, MINE]);
    expect(parseWallets(`${KALL},nope`)).toBeNull();
    expect(parseWallets("")).toBeNull();
    expect(parseWallets(null)).toBeNull();
  });
});
