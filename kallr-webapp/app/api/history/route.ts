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
  const wallets = parseWallets(new URL(req.url).searchParams.get("wallets"));
  if (!wallets) return Response.json({ error: "wallets must be up to five comma-separated addresses" }, { status: 400 });

  const client = arkivWriterAddress ? arkivPublic(process.env.ARKIV_ACCESS_KEY ?? "") : null;
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
  return Response.json({ orders, failed }, { headers: { "cache-control": "no-store" } });
}
