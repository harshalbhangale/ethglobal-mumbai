import { arkivPublic, readTrades } from "@kallr/integrations/arkiv";
import type { Hex } from "viem";
import { mergeHistory, parseWallets, type TradeRecord, type WalletHistory } from "@/lib/history";
import { arkivWriterAddress } from "@/lib/server/arkiv";
import { flash } from "@/lib/server/flash";

export const dynamic = "force-dynamic";

const n = (v: unknown) => (v === undefined || v === null ? 0 : Number(v));

/**
 * Everything a person traded through Kall, across their wallets (`?wallets=0x…,0x…`): each wallet's
 * Flash orders, joined with the Arkiv record that says whether it came from the keyboard, X (the
 * extension) or the web app, and which call it copied. The Kall app shows this as its History.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const client = arkivWriterAddress ? arkivPublic(process.env.ARKIV_ACCESS_KEY ?? "") : null;

  // ?all=1: every trade placed through Kall, for a wallet that hasn't traded yet. The wallets are the
  // traders on Kall's Arkiv trade records (newest first, up to five).
  let wallets: string[] | null;
  if (params.get("all") === "1") {
    const all = client && arkivWriterAddress ? await readTrades(client, arkivWriterAddress).catch(() => []) : [];
    const traders = [...new Set([...all].sort((a, b) => n(b.placedAt.value) - n(a.placedAt.value)).map((t) => String(t.trader.value)))];
    wallets = parseWallets(traders.slice(0, 5).join(","));
    if (!wallets) return Response.json({ orders: [], failed: [], scope: "all" }, { headers: { "cache-control": "no-store" } });
  } else {
    wallets = parseWallets(params.get("wallets"));
  }
  if (!wallets) return Response.json({ error: "wallets must be up to five comma-separated addresses" }, { status: 400 });
  const read: WalletHistory[] = await Promise.all(
    wallets.map(async (address) => {
      const [orders, entities] = await Promise.all([
        flash.listOrders(address).catch(() => null),
        client && arkivWriterAddress ? readTrades(client, arkivWriterAddress, address as Hex).catch(() => []) : Promise.resolve([]),
      ]);
      const records: TradeRecord[] = entities.map((t) => ({
        key: t.$key,
        trader: String(t.trader.value),
        source: String(t.source.value),
        asset: String(t.asset.value),
        side: String(t.side.value),
        orderType: String(t.orderType.value),
        qty: String(t.qty.value),
        flashOrderId: String(t.flashOrderId.value),
        caller: t.caller?.value ? String(t.caller.value) : null,
        postId: t.postId?.value ? String(t.postId.value) : null,
        placedAt: n(t.placedAt.value),
      }));
      return { address, orders, records };
    }),
  );

  const { orders, failed } = mergeHistory(read);
  if (failed.length === wallets.length && orders.length === 0) {
    return Response.json({ error: "Couldn't read your orders from Definitive Flash." }, { status: 502 });
  }
  return Response.json({ orders, failed, scope: params.get("all") === "1" ? "all" : "yours" }, { headers: { "cache-control": "no-store" } });
}
