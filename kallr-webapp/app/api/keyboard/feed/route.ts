import { arkivPublic, readOpenCalls, readResults, readTrackedCallers, readTrades } from "@kallr/integrations/arkiv";
import { callerRows, snapshotExcerpt } from "@/lib/keyboard-feed";
import { arkivWriterAddress } from "@/lib/server/arkiv";
import { keyboardWalletAddressFor } from "@/lib/server/keyboard-auth";
import { tradeTokenByKey } from "@/lib/server/keyboard-tokens";
import { swarmUrl } from "@/lib/server/swarm";

/**
 * What the Kall Keyboard on iPhone shows, read from Arkiv on the server (the keyboard can't run the
 * Arkiv SDK): every caller Kall Markets tracks or has priced, with their record; open calls and recent
 * results, each with the post's text from its Swarm snapshot; the linked wallet's trades; and live
 * ETH and BTC prices. Which callers the user follows is kept on the phone.
 */
export const dynamic = "force-dynamic";

const n = (v: unknown) => (v === undefined || v === null ? null : Number(v));

// Swarm content never changes for a reference, so a post's text is fetched once per server instance.
const texts = new Map<string, string | null>();
async function postText(ref: string | undefined): Promise<string | null> {
  if (!ref) return null;
  if (texts.has(ref)) return texts.get(ref) ?? null;
  const text = await fetch(swarmUrl(ref), { signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => snapshotExcerpt(j))
    .catch(() => null);
  if (text) texts.set(ref, text);
  return text;
}

export async function GET(req: Request) {
  if (!arkivWriterAddress) return Response.json({ error: "Arkiv isn't configured on this server." }, { status: 503 });
  const client = arkivPublic(process.env.ARKIV_ACCESS_KEY ?? "");
  const now = Math.floor(Date.now() / 1000);
  const writer = arkivWriterAddress;
  const tradesOf = keyboardWalletAddressFor(req);
  const [roster, calls, results, trades, eth, btc] = await Promise.all([
    readTrackedCallers(client, writer).catch(() => []),
    readOpenCalls(client, writer, now).catch(() => []),
    readResults(client, writer).catch(() => []),
    tradesOf ? readTrades(client, writer, tradesOf).catch(() => []) : Promise.resolve([]),
    tradeTokenByKey("ETH").catch(() => null),
    tradeTokenByKey("BTC").catch(() => null),
  ]);

  const openCalls = calls.slice(0, 40).map((c) => ({
    postId: c.postId.value,
    caller: c.caller.value,
    asset: c.asset.value,
    direction: c.direction.value,
    postedAt: n(c.postedAt.value),
    deadline: n(c.deadline.value),
    entry: n(c.entry?.value),
    swarmRef: c.swarmRef?.value,
  }));
  const settled = results.slice(0, 40).map((r) => ({
    postId: r.postId.value,
    caller: r.caller.value,
    asset: r.asset.value,
    direction: r.direction.value,
    status: r.status.value,
    returnBps: n(r.returnBps.value),
    postedAt: n(r.postedAt?.value),
    deadline: n(r.deadline.value),
    swarmRef: r.swarmRef?.value,
  }));
  const [callTexts, resultTexts] = await Promise.all([
    Promise.all(openCalls.map((c) => postText(c.swarmRef))),
    Promise.all(settled.map((r) => postText(r.swarmRef))),
  ]);

  const body = {
    following: roster.map((c) => String(c.handle.value)),
    callers: callerRows(
      roster.map((c) => ({ handle: String(c.handle.value), focus: c.focus?.value ? String(c.focus.value) : null })),
      openCalls,
      settled,
    ),
    prices: { ETH: eth?.price ?? null, BTC: btc?.price ?? null },
    calls: openCalls.map(({ swarmRef: _ref, ...c }, i) => ({ ...c, text: callTexts[i] })),
    results: settled.map(({ swarmRef: _ref, ...r }, i) => ({ ...r, text: resultTexts[i] })),
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
