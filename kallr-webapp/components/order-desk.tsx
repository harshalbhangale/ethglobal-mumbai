"use client";

import {
  FLASH_BASE_ASSETS,
  type FlashOrder,
  OPEN_STATUSES,
} from "@kallr/integrations/definitive";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getUsdPrice, hasUsdFeed, type PricedAsset } from "@/lib/chain";
import { shortOrderId } from "@kallr/domain/flash-receipt";
import { fillTransaction, listFlashOrders, type OrderContext, placeFlashOrder, receiptEvents } from "@/lib/flash-client";
import { toFlashOrder } from "@/lib/flash-order";
import type { TradeItem } from "@/lib/feed";
import { FlashReceiptView, useFillWatch, useFlashReceipt } from "./flash-receipt";
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

type Status = { kind: "idle" } | { kind: "working" } | { kind: "done"; orderId: string } | { kind: "error"; message: string };

export function OrderComposer({ wallet, onPlaced }: { wallet: ConnectedWallet | null; onPlaced: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<{ postId: string; caller: string | null } | null>(null);
  const [via, setVia] = useState<OrderContext["source"]>("desk");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const prices = useUsdPrices();
  const flashReceipt = useFlashReceipt(wallet && wallet.walletClientType !== "privy" ? "your wallet" : "your Kall wallet");
  const [watched, setWatched] = useState<{ funder: string; side: "buy" | "sell"; symbol: string } | null>(null);
  useFillWatch(flashReceipt.receipt, flashReceipt.emit, watched);

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
          const input = flash.input;
          const side = order?.side ?? "buy";
          flashReceipt.begin();
          setWatched({ funder: wallet.address, side, symbol: side === "buy" ? (order?.asset === "BTC" ? "cbBTC" : "WETH") : "USDC" });
          setStatus({ kind: "working" });
          try {
            const res = await placeFlashOrder(input, wallet, (step, info) => flashReceipt.emit(...receiptEvents(step, info, side)), {
              source: via,
              caller: source?.caller ?? null,
            });
            flashReceipt.emit({ type: "sent", orderId: res.orderId, resting: input.orderType !== "market" });
            setStatus({ kind: "done", orderId: res.orderId });
            setText("");
            onPlaced();
          } catch (err) {
            const message = friendlyError(err);
            flashReceipt.emit({ type: "failed", message });
            setStatus({ kind: "error", message });
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
          className="rounded-lg bg-lime px-6 py-3 text-[15px] font-semibold text-on-lime disabled:opacity-40"
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

      {/* The receipt replaces the one-line status: it stays after the trade with each Flash step. */}
      {flashReceipt.receipt && <FlashReceiptView receipt={flashReceipt.receipt} className="mt-4" />}
    </section>
  );
}

function friendlyError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|cancel/i.test(msg)) return "The wallet didn't sign. Nothing was placed.";
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

const num = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
type Filled = { targetAmount?: string | null; contraAmount?: string | null; averagePrice?: string | null; averageNotionalPrice?: string | null };
const filledOf = (o: FlashOrder): Filled | null => (o.filled && typeof o.filled === "object" ? (o.filled as Filled) : null);
const when = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const typeOf = (o: FlashOrder) => (o.orderType === "bracket" ? "TP/SL" : o.orderType === "limit" ? "Limit" : o.orderType === "twap" ? "TWAP" : "Market");
const statusTone = (s: string) =>
  s === "ORDER_STATUS_FILLED" ? "text-up" : s === "ORDER_STATUS_REJECTED" || s === "ORDER_STATUS_CANCELLED" ? "text-down" : OPEN_STATUSES.includes(s) ? "text-lime" : "text-slate";

type OrdersTab = "open" | "history" | "trades";

/**
 * Orders like an exchange: tabs for Open orders, Order history (filled, cancelled, expired on
 * Definitive Flash) and Trade history (every trade Kall Markets recorded on Arkiv). Each row opens to
 * show its details and proofs.
 */
export function OpenOrders({
  orders,
  error,
  history,
  funder,
}: {
  orders: FlashOrder[] | null;
  error: string | null;
  history?: { trades: TradeItem[]; explorer: string; loading: boolean };
  /** The wallet that placed these orders: Flash needs it to look up a fill's transaction. */
  funder?: string | null;
}) {
  const open = orders?.filter((o) => OPEN_STATUSES.includes(o.status) || o.attachedBracket?.status === "active") ?? [];
  const closed = orders?.filter((o) => !open.includes(o)) ?? [];
  const [tab, setTab] = useState<OrdersTab>("open");
  const tabs: Array<{ id: OrdersTab; label: string; count: number | null }> = [
    { id: "open", label: "Open orders", count: orders ? open.length : null },
    { id: "history", label: "Order history", count: orders ? closed.length : null },
    ...(history ? [{ id: "trades" as const, label: "Trade history", count: history.loading ? null : history.trades.length }] : []),
  ];
  const filled = orders?.filter((o) => o.status === "ORDER_STATUS_FILLED") ?? [];
  const volume = filled.reduce((sum, o) => sum + (num(filledOf(o)?.contraAmount) ?? (o.side === "buy" ? Number(o.qty) || 0 : 0)), 0);

  return (
    <div id="orders" className="space-y-4">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-rule bg-rule">
        <Tile label="Open now" value={orders ? String(open.length) : "…"} />
        <Tile label="Filled on Flash" value={orders ? String(filled.length) : "…"} />
        <Tile label="Volume" value={orders ? usd(volume) : "…"} />
      </div>

      <section className="overflow-hidden rounded-lg border border-rule bg-card">
        <div role="tablist" aria-label="Orders" className="flex gap-1 overflow-x-auto border-b border-rule px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px shrink-0 border-b-2 px-3 py-3 text-sm font-semibold ${tab === t.id ? "border-lime text-ink" : "border-transparent text-slate hover:text-ink"}`}
            >
              {t.label}
              {t.count !== null && <span className="ml-1.5 rounded bg-paper px-1.5 py-0.5 text-xs tabular-nums text-slate">{t.count}</span>}
            </button>
          ))}
        </div>

        {error && tab !== "trades" && <p className="px-4 py-3 text-sm text-down">{error}</p>}

        {tab !== "trades" &&
          (orders === null && !error ? (
            <Placeholder text="Loading orders from Definitive Flash…" />
          ) : (tab === "open" ? open : closed).length === 0 ? (
            <Placeholder text={tab === "open" ? "Nothing open. Limit orders and armed take-profit / stop-loss exits wait here until they fill." : "Filled, cancelled and expired orders show up here."} />
          ) : (
            <OrderTable orders={tab === "open" ? open : closed} funder={funder ?? null} />
          ))}

        {tab === "trades" &&
          history &&
          (history.loading ? (
            <Placeholder text="Reading Arkiv…" />
          ) : history.trades.length === 0 ? (
            <Placeholder text="No trades from this wallet yet. Each trade you place is recorded on Arkiv and shows here." />
          ) : (
            <TradeTable trades={history.trades} explorer={history.explorer} />
          ))}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-xs text-slate">{label}</p>
      <p className="font-display mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="px-4 py-12 text-center text-sm text-slate">{text}</p>;
}

const HEAD = "grid grid-cols-[1.1fr_0.8fr_0.7fr_1fr_0.9fr_20px] items-center gap-3";

function OrderTable({ orders, funder }: { orders: FlashOrder[]; funder: string | null }) {
  return (
    <div>
      <div className={`${HEAD} border-b border-rule px-4 py-2 text-xs text-slate`}>
        <span>Pair</span>
        <span>Type</span>
        <span>Side</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Status</span>
        <span />
      </div>
      <ul className="divide-y divide-rule">
        {orders.map((o) => (
          <OrderRow key={o.orderId} o={o} funder={funder} />
        ))}
      </ul>
    </div>
  );
}

function OrderRow({ o, funder }: { o: FlashOrder; funder: string | null }) {
  const [open, setOpen] = useState(false);
  const isFilled = o.status === "ORDER_STATUS_FILLED" || o.status === "ORDER_STATUS_PARTIALLY_FILLED";
  /** The fill's swap on Base: looked up when a filled row is opened. Undefined until asked. */
  const [tx, setTx] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open || !isFilled || !funder || tx !== undefined) return;
    let alive = true;
    void fillTransaction(o.orderId, funder).then((hash) => alive && setTx(hash));
    return () => {
      alive = false;
    };
  }, [open, isFilled, funder, o.orderId, tx]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const symbol = symbolOf(o.targetAsset);
  const f = filledOf(o);
  const tp = num(o.attachedBracket?.takeProfit?.notionalPrice);
  const sl = num(o.attachedBracket?.stopLoss?.notionalPrice);
  const avg = num(f?.averageNotionalPrice ?? f?.averagePrice);
  const amount = o.side === "buy" && o.orderType !== "bracket" ? usd(Number(o.qty)) : `${Number(o.qty).toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${symbol}`;
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`${HEAD} w-full px-4 py-3 text-left text-sm hover:bg-paper/60`}>
        <span className="min-w-0">
          <span className="block font-semibold">{symbol}/USDC</span>
          <span className="block text-xs text-slate">{when(o.placedAt)}</span>
        </span>
        <span>{typeOf(o)}</span>
        <span className={`font-semibold ${o.side === "buy" ? "text-up" : "text-down"}`}>{o.side === "buy" ? "Buy" : "Sell"}</span>
        <span className="text-right font-semibold tabular-nums">{amount}</span>
        <span className={`text-right text-xs font-semibold ${statusTone(o.status)}`}>{statusText[o.status] ?? o.status}</span>
        <span aria-hidden="true" className={`text-slate transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="space-y-3 bg-paper/50 px-4 py-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-slate">Flash order ID</dt>
            <dd className="flex items-center gap-2 font-mono font-semibold">
              <span className="truncate" title={o.orderId}>{shortOrderId(o.orderId)}</span>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(o.orderId).then(() => setCopied(true), () => {})}
                className="shrink-0 rounded border border-rule px-1.5 font-sans text-[11px] font-semibold text-slate hover:border-lime hover:text-lime"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </dd>
          </div>
          <Detail k="Avg fill price" v={avg ? usd(avg) : "—"} />
          <Detail k="Received" v={f?.targetAmount ? `${Number(f.targetAmount).toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${symbol}` : "—"} />
          {o.limitCrossPrice && <Detail k="Limit price" v={usd(Number(o.limitCrossPrice))} />}
          {tp !== null && <Detail k="Take-profit" v={usd(tp)} tone="text-up" />}
          {sl !== null && <Detail k="Stop-loss" v={usd(sl)} tone="text-down" />}
          {o.attachedBracket && <Detail k="Exits" v={bracketText[o.attachedBracket.status] ?? o.attachedBracket.status} />}
          {o.closeReason && <Detail k="Closed because" v={o.closeReason.replace(/_/g, " ").toLowerCase()} />}
          <Detail k="Route" v="Definitive Flash · Base" />
        </dl>
        {isFilled && funder && (
          <p className="text-xs">
            {tx ? (
              <a href={`https://basescan.org/tx/${tx}`} target="_blank" rel="noreferrer" className="inline-block rounded-md border border-rule px-3 py-1.5 font-semibold hover:border-lime hover:text-lime">
                View swap on Basescan ↗
              </a>
            ) : (
              <span className="text-slate">{tx === null ? "No swap transaction reported by Flash yet." : "Finding the swap on Base…"}</span>
            )}
          </p>
        )}
        </div>
      )}
    </li>
  );
}

function Detail({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate">{k}</dt>
      <dd className={`truncate font-semibold tabular-nums ${tone ?? ""}`}>{v}</dd>
    </div>
  );
}

function TradeTable({ trades, explorer }: { trades: TradeItem[]; explorer: string }) {
  return (
    <div>
      <div className={`${HEAD} border-b border-rule px-4 py-2 text-xs text-slate`}>
        <span>Pair</span>
        <span>Via</span>
        <span>Side</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Proof</span>
        <span />
      </div>
      <ul className="divide-y divide-rule">
        {trades.map((t) => (
          <TradeRow key={t.id} t={t} explorer={explorer} />
        ))}
      </ul>
    </div>
  );
}

const VIA: Record<string, string> = { desk: "Web", extension: "X", keyboard: "Keyboard" };

function TradeRow({ t, explorer }: { t: TradeItem; explorer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`${HEAD} w-full px-4 py-3 text-left text-sm hover:bg-paper/60`}>
        <span className="min-w-0">
          <span className="block font-semibold">{t.asset}/USDC</span>
          <span className="block text-xs text-slate">{new Date(t.placedAt * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </span>
        <span>{VIA[t.source] ?? t.source}</span>
        <span className={`font-semibold ${t.side === "buy" ? "text-up" : "text-down"}`}>{t.side === "buy" ? "Buy" : "Sell"}</span>
        <span className="text-right font-semibold tabular-nums">{t.side === "buy" ? `$${t.qty}` : `${t.qty} ${t.asset}`}</span>
        <span className="text-right text-xs font-semibold text-lime">Arkiv ✓</span>
        <span aria-hidden="true" className={`text-slate transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="space-y-3 bg-paper/50 px-4 py-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <Detail k="Copying" v={t.caller ? `@${t.caller}` : "—"} />
            <Detail k="Take-profit" v={t.takeProfit !== null ? usd(t.takeProfit) : "—"} tone="text-up" />
            <Detail k="Stop-loss" v={t.stopLoss !== null ? usd(t.stopLoss) : "—"} tone="text-down" />
            <Detail k="Flash order" v={`${t.flashOrderId.slice(0, 10)}…`} />
          </dl>
          <div className="flex flex-wrap gap-2">
            <a href={`${explorer}/entity/${t.id}`} target="_blank" rel="noreferrer" className="rounded-md border border-rule px-3 py-1.5 text-xs font-semibold hover:border-lime hover:text-lime">
              Proof on Arkiv ↗
            </a>
            {t.caller && t.postId && (
              <a href={`https://x.com/${t.caller}/status/${t.postId}`} target="_blank" rel="noreferrer" className="rounded-md border border-rule px-3 py-1.5 text-xs font-semibold hover:border-ink">
                The call on X ↗
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
