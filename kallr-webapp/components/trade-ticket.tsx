"use client";

import { type ParsedOrder, exitPrices, parseOrder } from "@kallr/domain/order";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { type OrderContext, type PlaceStep, placeFlashOrder } from "@/lib/flash-client";
import { toFlashOrder } from "@/lib/flash-order";
import { useUsdPrices } from "./order-desk";

/**
 * The desk's trade ticket: pick everything with buttons (asset, side, amount, market or limit,
 * take-profit / stop-loss), with a sticky order summary holding the button, a step tracker and the
 * result, so nothing happens off screen. Typing an order still works and fills the form, and links
 * from the extension, keyboard and @Kallr bot (/app?order=…) open it prefilled.
 */

type Asset = "ETH" | "BTC";
const ASSETS: Asset[] = ["ETH", "BTC"];
const NAMES: Record<Asset, string> = { ETH: "Ethereum", BTC: "Bitcoin" };
export const AMOUNTS = [0.5, 1, 5, 10];
export const TPS = [5, 10, 20, 50];
export const SLS = [3, 5, 10, 20];
/** Flash quotes refuse ~$0.01; from ~$0.50 a fill is close to the amount (checked 5 Nov 2026). */
const MIN_USD = 0.5;

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

const STEPS: Array<{ step: PlaceStep; label: string; optional?: boolean }> = [
  { step: "quoting", label: "Get a Flash quote" },
  { step: "approving", label: "Approve USDC (sized to this order)", optional: true },
  { step: "approving-exits", label: "Approve the TP/SL exit", optional: true },
  { step: "signing", label: "Sign the order" },
  { step: "signing-exits", label: "Sign the TP/SL", optional: true },
  { step: "submitting", label: "Place on Base" },
];

type Run =
  | { kind: "idle" }
  | { kind: "working"; step: PlaceStep; seen: PlaceStep[] }
  | { kind: "done"; orderId: string; seen: PlaceStep[]; summary: string; exits: string | null }
  | { kind: "error"; message: string; seen: PlaceStep[]; at: PlaceStep | null };

function friendlyError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|cancel/i.test(msg)) return "You cancelled in your wallet. Nothing was placed.";
  if (/insufficient|balance/i.test(msg)) return "Not enough USDC (or ETH for gas) in your wallet on Base.";
  if (/too small|fees would exceed/i.test(msg)) return "Too small for Flash: fees would eat the order. Try $0.50 or more.";
  return msg;
}

function Chip({ on, onClick, children, tone }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: "up" | "down" }) {
  const active = tone === "up" ? "border-up bg-up/10 text-up" : tone === "down" ? "border-down bg-down/10 text-down" : "border-ink bg-ink text-white";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold tabular-nums transition-colors ${on ? active : "border-rule text-slate hover:border-ink hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: React.ReactNode }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-paper p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${value === o.value ? "bg-card text-ink shadow-sm" : "text-slate hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-sm text-slate tabular-nums">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function TradeTicket({
  wallet,
  onPlaced,
  onViewOrders,
}: {
  wallet: ConnectedWallet | null;
  onPlaced: () => void;
  onViewOrders: () => void;
}) {
  const prices = useUsdPrices();
  const [asset, setAsset] = useState<Asset>("ETH");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [limit, setLimit] = useState("");
  const [tp, setTp] = useState<number | null>(10);
  const [sl, setSl] = useState<number | null>(5);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const [source, setSource] = useState<{ postId: string; caller: string | null } | null>(null);
  const [via, setVia] = useState<OrderContext["source"]>("desk");
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const summaryRef = useRef<HTMLDivElement>(null);

  /** Fill the form from a typed order or a link. Returns an error, or null when applied. */
  function apply(text: string): string | null {
    const parsed = parseOrder(text);
    if (!parsed.ok) return parsed.error;
    const o = parsed.order;
    if (o.assetStated && o.asset !== "ETH" && o.asset !== "BTC") return `${o.asset} isn’t tradable on Base yet. Try ETH or BTC.`;
    if (o.assetStated) setAsset(o.asset as Asset);
    setSide(o.side);
    if (o.amountUsd !== null) setAmount(String(o.amountUsd));
    setKind(o.limitPrice === null ? "market" : "limit");
    setLimit(o.limitPrice === null ? "" : String(o.limitPrice));
    setTp(o.takeProfitPct === null ? null : Math.round(o.takeProfitPct * 1000) / 10);
    setSl(o.stopLossPct === null ? null : Math.round(o.stopLossPct * 1000) / 10);
    return null;
  }

  // Links from the extension, keyboard and @Kallr bot: /app?order=copy+$2+of+BTC+tp+10%+sl+5%&post=123&caller=kol
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fromLink = q.get("order");
    if (fromLink) apply(fromLink.slice(0, 200));
    const src = q.get("src");
    if (src === "keyboard" || src === "extension") setVia(src);
    const post = q.get("post");
    if (post && /^[0-9]{1,30}$/.test(post)) {
      const caller = q.get("caller");
      setSource({ postId: post, caller: caller && /^[A-Za-z0-9_]{1,15}$/.test(caller) ? caller : null });
    }
    // Runs once on load: apply only reads the link.
  }, []);

  const market = prices[asset] ?? null;
  const amountUsd = Number(amount);
  const amountOk = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(amount) && amountUsd > 0;
  const limitPrice = kind === "limit" && /^[0-9]+(\.[0-9]+)?$/.test(limit) && Number(limit) > 0 ? Number(limit) : null;
  const exitsOn = side === "buy";
  const pairBroken = exitsOn && (tp === null) !== (sl === null);

  const order: ParsedOrder | null = amountOk
    ? {
        side,
        asset,
        amountUsd,
        limitPrice,
        takeProfitPct: exitsOn && tp !== null ? tp / 100 : null,
        stopLossPct: exitsOn && sl !== null ? sl / 100 : null,
        copy: Boolean(source),
        assetStated: true,
      }
    : null;
  const entry = limitPrice ?? market;
  const exits = order && entry ? exitPrices(order, market ?? entry) : null;
  const flash = order && exits && wallet && !pairBroken && !(kind === "limit" && !limitPrice) ? toFlashOrder(order, exits, wallet.address, source?.postId) : null;
  const busy = run.kind === "working";

  const problem = useMemo(() => {
    if (!amountOk) return "Enter an amount.";
    if (kind === "limit" && !limitPrice) return "Set a limit price.";
    if (pairBroken) return "Flash places take-profit and stop-loss as a pair: set both, or neither.";
    if (!wallet) return "Your wallet is still loading.";
    if (flash && !flash.ok) return flash.error;
    return null;
  }, [amountOk, kind, limitPrice, pairBroken, wallet, flash]);

  // Keep the summary (button, steps, result) in view while placing, on any screen size.
  useEffect(() => {
    if (run.kind !== "idle") summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [run.kind]);

  async function place() {
    if (!flash?.ok || !wallet || busy || !order) return;
    const seen: PlaceStep[] = [];
    let at: PlaceStep | null = null;
    const summary =
      kind === "limit" && limitPrice
        ? `Limit ${side} placed: ${usd(amountUsd)} of ${asset} at ${usd(limitPrice)}`
        : `${side === "buy" ? "Bought" : "Sold"} ${usd(amountUsd)} of ${asset}`;
    try {
      const res = await placeFlashOrder(
        flash.input,
        wallet,
        (step) => {
          at = step;
          if (!seen.includes(step)) seen.push(step);
          setRun({ kind: "working", step, seen: [...seen] });
        },
        { source: via, caller: source?.caller ?? null },
      );
      setRun({ kind: "done", orderId: res.orderId, seen: [...seen], summary, exits: res.bracketStatus });
      onPlaced();
    } catch (err) {
      setRun({ kind: "error", message: friendlyError(err), seen: [...seen], at });
    }
  }

  const seen = run.kind === "idle" ? [] : run.seen;
  const visibleSteps = STEPS.filter((s) => !s.optional || seen.includes(s.step));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---- Order form ---- */}
      <section aria-labelledby="ticket-heading" className="space-y-7 rounded-2xl border border-rule bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="ticket-heading" className="font-display text-xl font-semibold">
            {source ? (
              <>
                Copy{" "}
                <a href={`https://x.com/${source.caller ?? "i"}/status/${source.postId}`} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
                  {source.caller ? `@${source.caller}’s call` : "this call"}
                </a>
              </>
            ) : (
              "New order"
            )}
          </h2>
          <Segmented label="Side" value={side} onChange={setSide} options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />
        </div>

        <Field label="Asset">
          <div className="grid grid-cols-2 gap-3">
            {ASSETS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={asset === a}
                onClick={() => setAsset(a)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${asset === a ? "border-ink ring-1 ring-ink" : "border-rule hover:border-slate"}`}
              >
                <span>
                  <span className="block font-semibold">{a}</span>
                  <span className="block text-sm text-slate">{NAMES[a]}</span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{prices[a] ? usd(prices[a] as number) : "…"}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label={side === "buy" ? "Spend (USDC)" : "Sell (in USD)"} hint={amountOk && amountUsd < MIN_USD ? <span className="text-down">Under $0.50 Flash may refuse it</span> : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex w-36 items-center rounded-full border border-rule bg-paper px-4 py-2 focus-within:border-ink">
              <span className="text-slate">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                aria-label="Amount in USD"
                className="ml-1 w-full bg-transparent font-semibold tabular-nums outline-none"
              />
            </label>
            {AMOUNTS.map((a) => (
              <Chip key={a} on={amount === String(a)} onClick={() => setAmount(String(a))}>
                ${a}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Price">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label="Order type" value={kind} onChange={setKind} options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }]} />
            {kind === "limit" && (
              <label className="flex w-44 items-center rounded-full border border-rule bg-paper px-4 py-2 focus-within:border-ink">
                <span className="text-slate">$</span>
                <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.trim())} placeholder={market ? market.toFixed(0) : "price"} aria-label="Limit price in USD" className="ml-1 w-full bg-transparent font-semibold tabular-nums outline-none" />
              </label>
            )}
            {kind === "market" && <span className="text-sm text-slate">Fills now at the best Flash route</span>}
          </div>
        </Field>

        {exitsOn ? (
          <Field label="Exits" hint={exits && tp !== null && sl !== null ? <><span className="text-up">TP {usd(exits.takeProfit ?? 0)}</span> · <span className="text-down">SL {usd(exits.stopLoss ?? 0)}</span></> : "None"}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm text-slate">Take-profit</span>
                {TPS.map((v) => (
                  <Chip key={v} tone="up" on={tp === v} onClick={() => setTp(v)}>+{v}%</Chip>
                ))}
                <Chip on={tp === null} onClick={() => setTp(null)}>None</Chip>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-sm text-slate">Stop-loss</span>
                {SLS.map((v) => (
                  <Chip key={v} tone="down" on={sl === v} onClick={() => setSl(v)}>−{v}%</Chip>
                ))}
                <Chip on={sl === null} onClick={() => setSl(null)}>None</Chip>
              </div>
            </div>
          </Field>
        ) : (
          <p className="rounded-xl bg-paper px-4 py-3 text-sm text-slate">Sells don’t take a take-profit or stop-loss: you receive USDC.</p>
        )}

        <form
          className="border-t border-rule pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            const err = typed.trim() ? apply(typed) : "Type an order first.";
            setTypedError(err);
            if (!err) setTyped("");
          }}
        >
          <label htmlFor="typed-order" className="text-sm font-semibold">
            Or type it
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="typed-order"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setTypedError(null);
              }}
              placeholder="copy $2 of ETH tp 10% sl 5%"
              className="min-w-0 flex-1 rounded-full border border-rule bg-paper px-4 py-2.5 text-[15px] placeholder:text-slate/70 focus:border-ink focus:outline-none"
            />
            <button type="submit" className="rounded-full border border-ink px-4 py-2.5 text-sm font-semibold hover:bg-ink hover:text-white">
              Fill
            </button>
          </div>
          <p className="mt-2 min-h-5 text-sm text-down" aria-live="polite">{typedError}</p>
        </form>
      </section>

      {/* ---- Sticky summary: what will happen, the button, progress and result ---- */}
      <div ref={summaryRef} className="scroll-mt-6 lg:sticky lg:top-6">
        <section aria-labelledby="summary-heading" className="space-y-5 rounded-2xl border border-rule bg-card p-6">
          <h2 id="summary-heading" className="font-display text-lg font-semibold">Order summary</h2>
          <dl className="space-y-2.5 text-sm">
            {[
              ["You " + (side === "buy" ? "spend" : "sell"), amountOk ? usd(amountUsd) + (side === "buy" ? " USDC" : ` of ${asset}`) : "—"],
              ["You get ≈", amountOk && entry ? (side === "buy" ? `${(amountUsd / entry).toLocaleString("en-US", { maximumSignificantDigits: 5 })} ${asset === "ETH" ? "WETH" : "cbBTC"}` : `${usd(amountUsd)} USDC`) : "—"],
              ["Entry", kind === "limit" ? (limitPrice ? `Limit ${usd(limitPrice)}` : "Set a price") : market ? `Market ≈ ${usd(market)}` : "…"],
              ["Exits", exitsOn && exits && tp !== null && sl !== null ? `TP ${usd(exits.takeProfit ?? 0)} · SL ${usd(exits.stopLoss ?? 0)}` : "None"],
              ["Route", "Definitive Flash · MEV-protected"],
              ["Network", "Base mainnet · real funds"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-slate">{k}</dt>
                <dd className="text-right font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {run.kind === "idle" || run.kind === "error" ? (
            <>
              <button
                type="button"
                onClick={place}
                disabled={!flash?.ok || busy}
                className="w-full rounded-full bg-ink px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity disabled:opacity-40"
              >
                {side === "buy" ? "Buy" : "Sell"} {asset}
                {amountOk ? ` · ${usd(amountUsd)}` : ""}
              </button>
              <p className="min-h-5 text-sm text-slate" aria-live="polite">
                {run.kind === "error" ? <span className="text-down">{run.message}</span> : problem}
              </p>
            </>
          ) : null}

          {run.kind !== "idle" && (
            <ol className="space-y-2.5 rounded-xl bg-paper p-4 text-sm" aria-live="polite">
              {visibleSteps.map((s) => {
                const idx = visibleSteps.findIndex((v) => v.step === s.step);
                const currentStep = run.kind === "working" ? run.step : run.kind === "error" ? run.at : null;
                const currentIdx = currentStep ? visibleSteps.findIndex((v) => v.step === currentStep) : visibleSteps.length;
                const state = run.kind === "done" || idx < currentIdx ? "done" : idx === currentIdx ? (run.kind === "error" ? "failed" : "active") : "todo";
                return (
                  <li key={s.step} className={`flex items-center gap-3 ${state === "todo" ? "text-slate" : state === "failed" ? "font-semibold text-down" : state === "active" ? "font-semibold" : ""}`}>
                    <span
                      aria-hidden="true"
                      className={`grid size-5 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold ${
                        state === "done" ? "border-up bg-up text-white" : state === "failed" ? "border-down bg-down text-white" : state === "active" ? "animate-spin border-ink border-t-transparent" : "border-rule"
                      }`}
                    >
                      {state === "done" ? "✓" : state === "failed" ? "!" : ""}
                    </span>
                    {s.label}
                  </li>
                );
              })}
            </ol>
          )}

          {run.kind === "done" && (
            <div className="space-y-3 rounded-xl border border-up/40 bg-up/10 p-4">
              <p className="font-semibold">{run.summary} ✓</p>
              <p className="text-sm text-slate">
                {run.exits === "pending_activation" ? "Your TP/SL arm on the first fill. " : ""}Order {run.orderId.slice(0, 8)}… is with Definitive.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={onViewOrders} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
                  View in Orders
                </button>
                <button type="button" onClick={() => setRun({ kind: "idle" })} className="rounded-full border border-rule px-4 py-2 text-sm font-semibold hover:border-ink">
                  New order
                </button>
              </div>
            </div>
          )}
        </section>
        <p className="mt-3 px-2 text-xs leading-relaxed text-slate">
          You sign every step in your own wallet. Kallr never holds your keys or funds.
        </p>
      </div>
    </div>
  );
}
