import { arkivPublic, readOpenCalls, readResults, readTrackedCallers, readTrades } from "@kallr/integrations/arkiv";
import { arkivWriterAddress } from "@/lib/server/arkiv";
import { keyboardWalletAddress } from "@/lib/server/keyboard-wallet";
import { tradeTokenByKey } from "@/lib/server/keyboard-tokens";

/**
 * What the Kall keyboard on iPhone shows, read from Arkiv on the server (the keyboard can't run the
 * Arkiv SDK): open calls and recent results from the callers Kall Markets tracks, and the keyboard
 * wallet's trades. Prices are live Chainlink prices for ETH and BTC.
 */
export const dynamic = "force-dynamic";

const n = (v: unknown) => (v === undefined || v === null ? null : Number(v));

export async function GET() {
  if (!arkivWriterAddress) return Response.json({ error: "Arkiv isn't configured on this server." }, { status: 503 });
  const client = arkivPublic(process.env.ARKIV_ACCESS_KEY ?? "");
  const now = Math.floor(Date.now() / 1000);
  const writer = arkivWriterAddress;
  const [callers, calls, results, trades, eth, btc] = await Promise.all([
    readTrackedCallers(client, writer).catch(() => []),
    readOpenCalls(client, writer, now).catch(() => []),
    readResults(client, writer).catch(() => []),
    keyboardWalletAddress ? readTrades(client, writer, keyboardWalletAddress).catch(() => []) : Promise.resolve([]),
    tradeTokenByKey("ETH").catch(() => null),
    tradeTokenByKey("BTC").catch(() => null),
  ]);
  const body = {
    following: callers.map((c) => String(c.handle.value)),
    prices: { ETH: eth?.price ?? null, BTC: btc?.price ?? null },
    calls: calls.slice(0, 30).map((c) => ({
      postId: c.postId.value,
      caller: c.caller.value,
      asset: c.asset.value,
      direction: c.direction.value,
      postedAt: n(c.postedAt.value),
      deadline: n(c.deadline.value),
      entry: n(c.entry?.value),
    })),
    results: results.slice(0, 30).map((r) => ({
      postId: r.postId.value,
      caller: r.caller.value,
      asset: r.asset.value,
      direction: r.direction.value,
      status: r.status.value,
      returnBps: n(r.returnBps.value),
      deadline: n(r.deadline.value),
    })),
    trades: trades.slice(0, 30).map((t) => ({
      asset: t.asset.value,
      side: t.side.value,
      qty: t.qty.value,
      orderType: t.orderType.value,
      placedAt: n(t.placedAt.value),
      flashOrderId: t.flashOrderId.value,
      caller: t.caller?.value ?? null,
      key: t.$key,
    })),
  };
  return Response.json(body, { headers: { "cache-control": "s-maxage=15, stale-while-revalidate=60" } });
}
