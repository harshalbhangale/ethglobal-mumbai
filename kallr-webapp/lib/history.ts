import type { FlashOrder } from "@kallr/integrations/definitive";

/**
 * One history across every wallet a person trades from: the Kall wallet (keyboard and app) and their
 * own wallet (X through the extension, and the web app). Flash says what each order is and how it
 * filled; the Arkiv record says where it was placed and which call it copied.
 */

export type TradeSource = "keyboard" | "extension" | "desk";

/** A Kall trade record on Arkiv, flattened. */
export type TradeRecord = {
  key: string;
  trader: string;
  source: string;
  asset: string;
  side: string;
  orderType: string;
  qty: string;
  flashOrderId: string;
  caller: string | null;
  postId: string | null;
  placedAt: number;
};

export type WalletHistory = {
  address: string;
  /** Null when Flash couldn't be read for this wallet. */
  orders: FlashOrder[] | null;
  records: TradeRecord[];
};

export type HistoryOrder = FlashOrder & {
  funderAddress: string;
  /** Where it was placed, from its Arkiv record; null when it has none. */
  source: TradeSource | null;
  caller: string | null;
  postId: string | null;
  arkivKey: string | null;
  /** The coin's symbol when the record names it (Flash only gives the token address). */
  assetHint: string | null;
};

const SOURCES: TradeSource[] = ["keyboard", "extension", "desk"];
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

function placedMs(o: { placedAt?: string | null }) {
  const t = o.placedAt ? Date.parse(o.placedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Every order across the wallets, newest first, each with its record when there is one. */
export function mergeHistory(wallets: WalletHistory[]): { orders: HistoryOrder[]; failed: string[] } {
  const records = new Map<string, TradeRecord>();
  for (const w of wallets) for (const r of w.records) records.set(r.flashOrderId, r);

  const seen = new Set<string>();
  const orders: HistoryOrder[] = [];
  const withRecord = (o: FlashOrder, funder: string, r: TradeRecord | undefined): HistoryOrder => ({
    ...o,
    funderAddress: funder,
    source: r && SOURCES.includes(r.source as TradeSource) ? (r.source as TradeSource) : null,
    caller: r?.caller ?? null,
    postId: r?.postId ?? null,
    arkivKey: r?.key ?? null,
    assetHint: r && !isAddress(r.asset) ? r.asset.toUpperCase() : null,
  });

  for (const w of wallets) {
    for (const o of w.orders ?? []) {
      if (seen.has(o.orderId)) continue;
      seen.add(o.orderId);
      const funder = typeof o.funderAddress === "string" ? o.funderAddress : w.address;
      orders.push(withRecord(o, funder, records.get(o.orderId)));
    }
  }

  // A record Flash didn't list (an older order past the first page, or Flash was down): still show it.
  for (const w of wallets) {
    for (const r of w.records) {
      if (seen.has(r.flashOrderId)) continue;
      seen.add(r.flashOrderId);
      const order: FlashOrder = {
        orderId: r.flashOrderId,
        orderType: r.orderType,
        side: r.side,
        status: "RECORDED",
        targetAsset: r.asset,
        contraAsset: "",
        qty: r.qty,
        placedAt: new Date(r.placedAt * 1000).toISOString(),
      };
      orders.push(withRecord(order, r.trader, r));
    }
  }

  orders.sort((a, b) => placedMs(b) - placedMs(a));
  return { orders, failed: wallets.filter((w) => w.orders === null).map((w) => w.address) };
}

/** `?wallets=0xa…,0xb…` → up to five distinct addresses, or null if one isn't an address. */
export function parseWallets(raw: string | null): string[] | null {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length || !list.every(isAddress)) return null;
  const out: string[] = [];
  for (const a of list) if (!out.some((b) => b.toLowerCase() === a.toLowerCase())) out.push(a);
  return out.slice(0, 5);
}
