"use client";

import {
  FLASH_BASE_ASSETS,
  type FlashOrder,
  OPEN_STATUSES,
} from "@kallr/integrations/definitive";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getUsdPrice, hasUsdFeed, type PricedAsset } from "@/lib/chain";
import { listFlashOrders, type OrderContext, type PlaceStep, placeFlashOrder, stepLabel } from "@/lib/flash-client";
import { toFlashOrder } from "@/lib/flash-order";
import { describeOrder, type ExitPrices, exitPrices, type ParsedOrder, parseOrder } from "@kallr/domain/order";

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

/** Live USD prices from Chainlink on Base, refreshed every 30s. */
export function useUsdPrices() {
  const [prices, setPrices] = useState<Partial<Record<PricedAsset, number>>>({});
  useEffect(() => {
    let alive = true;
    const tick = () =>
      (["ETH", "BTC"] as const).forEach((a) =>
        getUsdPrice(a)
          .then((p) => alive && setPrices((prev) => ({ ...prev, [a]: p })))
          .catch(() => {}),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return prices;
}

/** Flash orders for this wallet, polled every 15s and on demand. */
export function useFlashOrders(funder: string | null) {
  const [orders, setOrders] = useState<FlashOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!funder) return;
    try {
      setOrders(await listFlashOrders(funder));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load orders");
    }
  }, [funder]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);
  return { orders, error, refresh };
}

const examples = ["copy $2 of ETH, TP 10%, SL 5%", "buy $5 of BTC at 75,000 tp 8% sl 4%", "sell $3 of ETH"];

type Status = { kind: "idle" } | { kind: "working"; step: PlaceStep } | { kind: "done"; orderId: string } | { kind: "error"; message: string };

export function OrderComposer({ wallet, onPlaced }: { wallet: ConnectedWallet | null; onPlaced: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<{ postId: string; caller: string | null } | null>(null);
  const [via, setVia] = useState<OrderContext["source"]>("desk");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const prices = useUsdPrices();

  // Links from the @Kallr bot open the desk with the copied order filled in:
  // /app?order=copy+$2+of+BTC+tp+10%+sl+5%&post=123&caller=kol
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fromLink = q.get("order");
    if (fromLink) setText(fromLink.slice(0, 200));
    const src = q.get("src");
    if (src === "keyboard" || src === "extension") setVia(src);
    const post = q.get("post");
    if (post && /^[0-9]{1,30}$/.test(post)) {
      const caller = q.get("caller");
      setSource({ postId: post, caller: caller && /^[A-Za-z0-9_]{1,15}$/.test(caller) ? caller : null });
    }
  }, []);

  const parsed = useMemo(() => (text.trim() ? parseOrder(text) : null), [text]);
  const order = parsed?.ok ? parsed.order : null;
  const market = order && hasUsdFeed(order.asset) ? (prices[order.asset] ?? null) : null;
  const exits = order && (order.limitPrice ?? market) ? exitPrices(order, market ?? 0) : null;
  const flash = order && exits && wallet ? toFlashOrder(order, exits, wallet.address, source?.postId) : null;
  const busy = status.kind === "working";

  return (
    <section aria-labelledby="composer-heading" className="rounded-2xl border border-rule bg-card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="composer-heading" className="font-display text-lg font-semibold">
          {source ? (
            <>
              Copy{" "}
              <a
                href={`https://x.com/${source.caller ?? "i"}/status/${source.postId}`}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-rule underline-offset-4 hover:decoration-ink"
              >
                {source.caller ? `@${source.caller}’s call` : "this call"}
              </a>
            </>
          ) : (
            "New order"
          )}
        </h2>
        <span className="text-sm text-slate tabular-nums">
          ETH {prices.ETH ? usd(prices.ETH) : "…"} · BTC {prices.BTC ? usd(prices.BTC) : "…"}{" "}
          <span className="text-slate/70">· Chainlink on Base</span>
        </span>
      </div>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!flash?.ok || !wallet || busy) return;
          try {
            const res = await placeFlashOrder(flash.input, wallet, (step) => setStatus({ kind: "working", step }), {
              source: via,
              caller: source?.caller ?? null,
            });
            setStatus({ kind: "done", orderId: res.orderId });
            setText("");
            onPlaced();
          } catch (err) {
            setStatus({ kind: "error", message: friendlyError(err) });
          }
        }}
      >
        <label htmlFor="order-text" className="sr-only">
          Describe your order
        </label>
        <input
          id="order-text"
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            if (status.kind !== "working") setStatus({ kind: "idle" });
          }}
          placeholder="Type an order, like “copy $2 of ETH, TP 10%, SL 5%”"
          className="min-w-0 flex-1 rounded-full border border-rule bg-paper px-5 py-3 text-[15px] placeholder:text-slate/80 focus:border-ink focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!flash?.ok || busy}
          className="rounded-full bg-ink px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Placing…" : "Place order"}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={busy}
            onClick={() => setText(ex)}
            className="rounded-full border border-rule px-3 py-1.5 text-sm text-slate hover:border-ink hover:text-ink"
          >
            {ex}
          </button>
        ))}
      </div>

      {parsed && !parsed.ok && text.length > 6 && <p className="mt-4 text-sm text-down">{parsed.error}</p>}
      {order && !exits && (
        <p className="mt-4 text-sm text-slate">
          {hasUsdFeed(order.asset) ? `Loading the ${order.asset} price…` : `${order.asset} isn’t tradable on Base yet. Try ETH or BTC.`}
        </p>
      )}
      {order && exits && <OrderPreview order={order} exits={exits} />}
      {flash && !flash.ok && <p className="mt-3 text-sm text-down">{flash.error}</p>}
      {!wallet && order && <p className="mt-3 text-sm text-slate">Your wallet is still loading.</p>}

      <div aria-live="polite" className="mt-3 text-sm">
        {status.kind === "working" && <p className="text-ink">{stepLabel[status.step]}</p>}
        {status.kind === "done" && (
          <p className="text-up">Order placed on Base. It shows under Open orders with its exits.</p>
        )}
        {status.kind === "error" && <p className="text-down">{status.message}</p>}
      </div>
    </section>
  );
}

function friendlyError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|cancel/i.test(msg)) return "You cancelled in your wallet. Nothing was placed.";
  if (/insufficient|balance/i.test(msg)) return "Not enough USDC (or ETH for gas) in your wallet on Base.";
  return msg;
}

function OrderPreview({ order, exits }: { order: ParsedOrder; exits: ExitPrices }) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-rule sm:grid-cols-4">
      <Cell label="Order" value={describeOrder(order)} wide />
      <Cell label={order.limitPrice === null ? "Entry (market)" : "Entry (limit)"} value={usd(exits.entry)} />
      <Cell
        label={order.takeProfitPct === null ? "Take-profit" : `Take-profit +${round(order.takeProfitPct * 100)}%`}
        value={exits.takeProfit === null ? "None" : usd(exits.takeProfit)}
        tone="up"
      />
      <Cell
        label={order.stopLossPct === null ? "Stop-loss" : `Stop-loss −${round(order.stopLossPct * 100)}%`}
        value={exits.stopLoss === null ? "None" : usd(exits.stopLoss)}
        tone="down"
      />
    </dl>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

function Cell({ label, value, tone, wide }: { label: string; value: string; tone?: "up" | "down"; wide?: boolean }) {
  return (
    <div className={`bg-card p-4 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-sm text-slate">{label}</dt>
      <dd
        className={`mt-1 font-semibold tabular-nums ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

const symbolOf = (address: string) =>
  Object.values(FLASH_BASE_ASSETS).find((a) => a.address.toLowerCase() === address.toLowerCase())?.symbol ?? "token";

export const statusText: Record<string, string> = {
  ORDER_STATUS_PENDING: "Pending",
  ORDER_STATUS_ACCEPTED: "Working",
  ORDER_STATUS_PARTIALLY_FILLED: "Partly filled",
  ORDER_STATUS_FILLED: "Filled",
  ORDER_STATUS_CANCELLED: "Cancelled",
  ORDER_STATUS_REJECTED: "Rejected",
  ORDER_STATUS_TERMINATED: "Ended",
};

export const bracketText: Record<string, string> = {
  pending_activation: "Exits arm on first fill",
  active: "Exits armed",
  never_activated: "Exits never armed",
};

function describeFlashOrder(o: FlashOrder) {
  const symbol = symbolOf(o.targetAsset);
  const kind = o.orderType === "bracket" ? "Exit" : o.orderType === "limit" ? "Limit" : "Market";
  if (o.orderType === "bracket") return `${kind}: sell ${o.qty} ${symbol}`;
  return o.side === "buy" ? `${kind} buy: $${o.qty} of ${symbol}` : `${kind} sell: ${o.qty} ${symbol}`;
}

export function OpenOrders({ orders, error }: { orders: FlashOrder[] | null; error: string | null }) {
  const open = orders?.filter((o) => OPEN_STATUSES.includes(o.status) || o.attachedBracket?.status === "active") ?? [];
  const recent = orders?.filter((o) => !open.includes(o)).slice(0, 5) ?? [];

  return (
    <section id="orders" aria-labelledby="orders-heading" className="rounded-2xl border border-rule bg-card p-6">
      <div className="flex items-baseline justify-between">
        <h2 id="orders-heading" className="font-display text-lg font-semibold">
          Open orders
        </h2>
        {open.length > 0 && <span className="text-sm text-slate">{open.length} open</span>}
      </div>

      {error && <p className="mt-4 text-sm text-down">{error}</p>}
      {orders === null && !error && <p className="mt-6 text-sm text-slate">Loading orders from Definitive…</p>}

      {orders !== null && open.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-rule px-6 py-10 text-center">
          <p className="font-semibold">No open orders</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate">
            Reply “@Kallr copy $2” under a call on X, or type an order above. It shows up here with its
            take-profit and stop-loss.
          </p>
        </div>
      )}

      {open.length > 0 && <OrderList orders={open} />}
      {recent.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold text-slate">Recent</h3>
          <OrderList orders={recent} />
        </>
      )}
    </section>
  );
}

function OrderList({ orders }: { orders: FlashOrder[] }) {
  return (
    <ul className="mt-2 divide-y divide-rule">
      {orders.map((o) => {
        const tp = o.attachedBracket?.takeProfit?.notionalPrice;
        const sl = o.attachedBracket?.stopLoss?.notionalPrice;
        return (
          <li key={o.orderId} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{describeFlashOrder(o)}</p>
              <p className="mt-1 text-sm text-slate tabular-nums">
                {o.limitCrossPrice && <>Limit {usd(Number(o.limitCrossPrice))} · </>}
                {tp && <span className="text-up">TP {usd(Number(tp))}</span>}
                {tp && sl && " · "}
                {sl && <span className="text-down">SL {usd(Number(sl))}</span>}
                {o.attachedBracket && <> · {bracketText[o.attachedBracket.status] ?? o.attachedBracket.status}</>}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-rule px-3 py-1 text-sm text-slate">
              {statusText[o.status] ?? o.status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
