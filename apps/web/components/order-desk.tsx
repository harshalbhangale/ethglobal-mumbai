"use client";

import { useEffect, useMemo, useState } from "react";
import { getEthUsd } from "@/lib/chain";
import { describeOrder, exitPrices, parseOrder, type ExitPrices, type ParsedOrder } from "@/lib/order";
import type { StoredOrder } from "@/lib/orders-store";

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

/** Live ETH/USD from Chainlink on Base, refreshed every 30s. */
function useEthPrice() {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      getEthUsd()
        .then((p) => alive && setPrice(p))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return price;
}

const examples = ["copy $2 of ETH, TP 10%, SL 5%", "buy $5 of ETH if it dips to 2,300", "sell my ETH at 4,000"];

export function OrderComposer({
  onAdd,
}: {
  onAdd: (o: { text: string; order: ParsedOrder; exits: ExitPrices }) => void;
}) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const ethPrice = useEthPrice();

  const parsed = useMemo(() => (text.trim() ? parseOrder(text) : null), [text]);
  const order = parsed?.ok ? parsed.order : null;
  // Only ETH has a live feed wired so far; other assets need a limit price to compute exits.
  const market = order && order.asset === "ETH" ? ethPrice : null;
  const exits = order && (order.limitPrice ?? market) ? exitPrices(order, market ?? 0) : null;

  return (
    <section aria-labelledby="composer-heading" className="rounded-2xl border border-rule bg-card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="composer-heading" className="font-display text-lg font-semibold">
          New order
        </h2>
        <span className="text-sm text-slate tabular-nums">
          ETH {ethPrice ? usd(ethPrice) : "…"} <span className="text-slate/70">· Chainlink on Base</span>
        </span>
      </div>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (order && exits) {
            onAdd({ text: text.trim(), order, exits });
            setText("");
            setSubmitted(false);
          }
        }}
      >
        <label htmlFor="order-text" className="sr-only">
          Describe your order
        </label>
        <input
          id="order-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSubmitted(false);
          }}
          placeholder="Type an order, like “copy $2 of ETH, TP 10%, SL 5%”"
          className="min-w-0 flex-1 rounded-full border border-rule bg-paper px-5 py-3 text-[15px] placeholder:text-slate/80 focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={!order || !exits}
          className="rounded-full bg-ink px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-40"
        >
          Queue order
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            className="rounded-full border border-rule px-3 py-1.5 text-sm text-slate hover:border-ink hover:text-ink"
          >
            {ex}
          </button>
        ))}
      </div>

      {parsed && !parsed.ok && (submitted || text.length > 6) && (
        <p className="mt-4 text-sm text-down">{parsed.error}</p>
      )}
      {order && !exits && (
        <p className="mt-4 text-sm text-slate">
          {order.asset === "ETH" ? "Loading the ETH price…" : `No live price for ${order.asset} yet: add a price, like “at 0.01”.`}
        </p>
      )}
      {order && exits && <OrderPreview order={order} exits={exits} />}
    </section>
  );
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

export function OpenOrders({ orders, onCancel }: { orders: StoredOrder[]; onCancel: (id: string) => void }) {
  const open = orders.filter((o) => o.status !== "cancelled");

  return (
    <section id="orders" aria-labelledby="orders-heading" className="rounded-2xl border border-rule bg-card p-6">
      <div className="flex items-baseline justify-between">
        <h2 id="orders-heading" className="font-display text-lg font-semibold">
          Open orders
        </h2>
        {open.length > 0 && <span className="text-sm text-slate">{open.length} queued</span>}
      </div>

      {open.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-rule px-6 py-10 text-center">
          <p className="font-semibold">No open orders yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate">
            Reply “@AfterMarkets copy $2” under a call on X, or type an order above. It shows up here with its
            take-profit and stop-loss.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-rule">
          {open.map((o) => (
            <li key={o.id} className="flex items-start justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="font-semibold">{describeOrder(o.order)}</p>
                <p className="mt-1 text-sm text-slate tabular-nums">
                  Entry {usd(o.exits.entry)}
                  {o.exits.takeProfit !== null && (
                    <>
                      {" · "}
                      <span className="text-up">TP {usd(o.exits.takeProfit)}</span>
                    </>
                  )}
                  {o.exits.stopLoss !== null && (
                    <>
                      {" · "}
                      <span className="text-down">SL {usd(o.exits.stopLoss)}</span>
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate/80">Queued: submits once Flash is connected</p>
              </div>
              <button
                type="button"
                onClick={() => onCancel(o.id)}
                className="shrink-0 rounded-full border border-rule px-3 py-1.5 text-sm text-slate hover:border-ink hover:text-ink"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
