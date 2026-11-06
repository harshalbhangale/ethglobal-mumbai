"use client";

import { type ExitPrices, type ParsedOrder, exitPrices, parseOrder } from "@kallr/domain/order";
import type { FlashOrderInput } from "@kallr/integrations/definitive";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { type OrderContext, type PlaceStep, placeFlashOrder } from "@/lib/flash-client";
import { toDecimal, toFlashOrder } from "@/lib/flash-order";
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

/** A call to copy into the ticket, from a tweet on the same screen; `nonce` re-applies the same call. */
export type TicketPrefill = { order: string; postId: string; caller: string; nonce: number };

export function TradeTicket({
  wallet,
  onPlaced,
  onViewOrders,
  prefill,
  signIn,
}: {
  wallet: ConnectedWallet | null;
  onPlaced: () => void;
  onViewOrders: () => void;
  prefill?: TicketPrefill | null;
  /** Signed out: shown in place of the Buy / Sell button. */
  signIn?: React.ReactNode;
}) {
  const prices = useUsdPrices();
  const [asset, setAsset] = useState<Asset>("ETH");
  // Any other Base token, picked from search; overrides the ETH/BTC choice while set.
  const [custom, setCustom] = useState<TokenHit | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [limit, setLimit] = useState("");
  // TP/SL is opt-in: a plain swap needs one approval (first time) and one signature.
  const [tp, setTp] = useState<number | null>(null);
  const [sl, setSl] = useState<number | null>(null);
  const [advanced, setAdvanced] = useState(false);
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
    setAdvanced(o.takeProfitPct !== null || o.stopLossPct !== null);
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

  // Copy call on a tweet: fill the ticket in place and link the trade to that post.
  useEffect(() => {
    if (!prefill) return;
    setCustom(null);
    setTypedError(apply(prefill.order));
    setSource({ postId: prefill.postId, caller: prefill.caller });
    setRun({ kind: "idle" });
    // apply only sets form state; nonce re-runs it for the same call.
  }, [prefill?.nonce]);

  const customPrice = custom?.price ? Number(custom.price) : null;
  const market = custom ? (customPrice && Number.isFinite(customPrice) ? customPrice : null) : (prices[asset] ?? null);
  const symbol = custom ? custom.symbol : asset;
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
  const flash =
    order && exits && wallet && !pairBroken && !(kind === "limit" && !limitPrice)
      ? custom
        ? customFlashOrder(custom, order, exits, wallet.address, source?.postId)
        : toFlashOrder(order, exits, wallet.address, source?.postId)
      : null;
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
        ? `Limit ${side} placed: ${usd(amountUsd)} of ${symbol} at ${usd(limitPrice)}`
        : `${side === "buy" ? "Bought" : "Sold"} ${usd(amountUsd)} of ${symbol}`;
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
    <div className="space-y-4">
      <section aria-labelledby="ticket-heading" className="overflow-hidden rounded-xl border border-rule bg-card">
        {/* Buy / Sell, like an exchange ticket. */}
        <div className="grid grid-cols-2" role="group" aria-label="Side">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className={`py-3 text-sm font-bold uppercase tracking-wide transition-colors ${
                side === s ? (s === "buy" ? "bg-up text-paper" : "bg-down text-paper") : "bg-paper text-slate hover:text-ink"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-5 p-4">
          <h2 id="ticket-heading" className="flex items-center justify-between gap-2 text-sm">
            {source ? (
              <span className="min-w-0 truncate">
                <span className="text-slate">Copying </span>
                <a href={`https://x.com/${source.caller ?? "i"}/status/${source.postId}`} target="_blank" rel="noreferrer" className="font-semibold underline decoration-rule underline-offset-4 hover:decoration-ink">
                  {source.caller ? `@${source.caller}` : "this call"}
                </a>
              </span>
            ) : (
              <span className="font-semibold">New order</span>
            )}
            {source && (
              <button type="button" onClick={() => setSource(null)} className="shrink-0 text-xs text-slate hover:text-ink">
                Clear
              </button>
            )}
          </h2>

          {/* Asset */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {ASSETS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={!custom && asset === a}
                  onClick={() => {
                    setAsset(a);
                    setCustom(null);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${!custom && asset === a ? "border-lime bg-lime/10" : "border-rule hover:border-slate"}`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{a}</span>
                    <span className="text-xs text-slate tabular-nums">{prices[a] ? usd(prices[a] as number) : "…"}</span>
                  </span>
                  <span className="block text-xs text-slate">{NAMES[a]}</span>
                </button>
              ))}
            </div>
            <TokenSearch selected={custom} onPick={setCustom} />
          </div>

          {/* Order type */}
          <div className="flex items-center gap-4 border-b border-rule text-sm" role="group" aria-label="Order type">
            {(["market", "limit"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`-mb-px border-b-2 pb-2 font-semibold capitalize ${kind === k ? "border-lime text-ink" : "border-transparent text-slate hover:text-ink"}`}
              >
                {k}
              </button>
            ))}
            <span className="ml-auto pb-2 text-xs text-slate">{kind === "market" ? "Best Flash route" : "Fills at your price"}</span>
          </div>

          {kind === "limit" && (
            <label className="flex items-center rounded-lg border border-rule bg-paper px-3 py-2.5 focus-within:border-lime">
              <span className="w-16 text-xs text-slate">Price</span>
              <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.trim())} placeholder={market ? market.toFixed(2) : "price"} aria-label="Limit price in USD" className="w-full bg-transparent text-right font-semibold tabular-nums outline-none" />
              <span className="ml-2 text-xs text-slate">USD</span>
            </label>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <label className="flex items-center rounded-lg border border-rule bg-paper px-3 py-2.5 focus-within:border-lime">
              <span className="w-16 text-xs text-slate">{side === "buy" ? "Spend" : "Sell"}</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} aria-label="Amount in USD" className="w-full bg-transparent text-right text-lg font-semibold tabular-nums outline-none" />
              <span className="ml-2 text-xs text-slate">{side === "buy" ? "USDC" : "USD"}</span>
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={amount === String(a)}
                  onClick={() => setAmount(String(a))}
                  className={`rounded-md border py-1.5 text-xs font-semibold tabular-nums ${amount === String(a) ? "border-lime text-lime" : "border-rule text-slate hover:text-ink"}`}
                >
                  ${a}
                </button>
              ))}
            </div>
            {amountOk && amountUsd < MIN_USD && <p className="text-xs text-down">Under $0.50 Flash may refuse it.</p>}
          </div>

          {/* Take-profit / stop-loss */}
          {exitsOn ? (
            <div className="rounded-lg border border-rule">
              <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="font-semibold">Take-profit / Stop-loss</span>
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(e) => {
                    setAdvanced(e.target.checked);
                    setTp(e.target.checked ? 10 : null);
                    setSl(e.target.checked ? 5 : null);
                  }}
                  className="size-4 accent-[var(--color-lime)]"
                />
              </label>
              {advanced && (
                <div className="space-y-2 border-t border-rule px-3 py-3">
                  <PctRow label="TP" values={TPS} value={tp} onPick={setTp} tone="up" price={exits?.takeProfit ?? null} />
                  <PctRow label="SL" values={SLS} value={sl} onPick={setSl} tone="down" price={exits?.stopLoss ?? null} />
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-lg bg-paper px-3 py-2.5 text-xs text-slate">Sells pay out in USDC, so no take-profit or stop-loss.</p>
          )}

          {/* Summary and the one button */}
          <div ref={summaryRef} className="scroll-mt-6 space-y-3">
            <dl className="space-y-1.5 text-xs">
              {[
                ["You get ≈", amountOk && entry ? (side === "buy" ? `${(amountUsd / entry).toLocaleString("en-US", { maximumSignificantDigits: 5 })} ${custom ? custom.symbol : asset === "ETH" ? "WETH" : "cbBTC"}` : `${usd(amountUsd)} USDC`) : "—"],
                ["Entry", kind === "limit" ? (limitPrice ? `Limit ${usd(limitPrice)}` : "Set a price") : market ? `≈ ${usd(market)}` : "…"],
                ["Route", "Definitive Flash · Base"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-slate">{k}</dt>
                  <dd className="text-right font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            {signIn ? (
              <div className="space-y-2 text-center">
                {signIn}
                <p className="text-xs text-slate">Sign in with X to get a wallet on Base, or connect MetaMask.</p>
              </div>
            ) : run.kind === "idle" || run.kind === "error" ? (
              <>
                <button
                  type="button"
                  onClick={place}
                  disabled={!flash?.ok || busy}
                  className={`w-full rounded-lg px-6 py-3.5 text-[15px] font-bold transition-opacity disabled:opacity-40 ${side === "buy" ? "bg-up text-paper" : "bg-down text-paper"}`}
                >
                  {side === "buy" ? "Buy" : "Sell"} {symbol}
                  {amountOk ? ` · ${usd(amountUsd)}` : ""}
                </button>
                <p className="min-h-4 text-xs text-slate" aria-live="polite">
                  {run.kind === "error" ? <span className="text-down">{run.message}</span> : problem}
                </p>
              </>
            ) : null}

            {run.kind !== "idle" && (
              <ol className="space-y-2 rounded-lg bg-paper p-3 text-sm" aria-live="polite">
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
                          state === "done" ? "border-up bg-up text-on-lime" : state === "failed" ? "border-down bg-down text-paper" : state === "active" ? "animate-spin border-lime border-t-transparent" : "border-rule"
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

            {run.kind !== "idle" && (
              <p className="flex items-center justify-between gap-3 rounded-lg border border-rule px-3 py-2 text-xs" title="Definitive Flash routes this order across Base's venues">
                <span className="text-slate">Best price</span>
                <span className="font-semibold text-up">
                  ✓ Definitive Flash · best route on Base
                </span>
              </p>
            )}

            {run.kind === "done" && (
              <div className="space-y-3 rounded-lg border border-up/40 bg-up/10 p-3">
                <p className="font-semibold">{run.summary} ✓</p>
                <p className="text-xs text-slate">
                  {run.exits === "pending_activation" ? "Your TP/SL arm on the first fill. " : ""}Order {run.orderId.slice(0, 8)}… is with Definitive.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={onViewOrders} className="rounded-md bg-lime px-3 py-1.5 text-sm font-semibold text-on-lime">
                    View in Orders
                  </button>
                  <button type="button" onClick={() => setRun({ kind: "idle" })} className="rounded-md border border-rule px-3 py-1.5 text-sm font-semibold hover:border-ink">
                    New order
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Type an order instead of picking. */}
      <form
        className="rounded-xl border border-rule bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const err = typed.trim() ? apply(typed) : "Type an order first.";
          setTypedError(err);
          if (!err) setTyped("");
        }}
      >
        <label htmlFor="typed-order" className="text-xs font-semibold text-slate">
          Or type it
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="typed-order"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setTypedError(null);
            }}
            placeholder="buy $2 of ETH tp 10% sl 5%"
            className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-2 text-sm placeholder:text-slate/70 focus:border-lime focus:outline-none"
          />
          <button type="submit" className="rounded-md border border-rule-strong px-3 py-2 text-sm font-semibold hover:border-lime hover:text-lime">
            Fill
          </button>
        </div>
        {typedError && (
          <p className="mt-1.5 text-xs text-down" aria-live="polite">
            {typedError}
          </p>
        )}
      </form>

      <p className="px-1 text-xs leading-relaxed text-slate">You sign every step in your own wallet. Kall Markets never holds your keys or funds.</p>
    </div>
  );
}

function PctRow({ label, values, value, onPick, tone, price }: { label: string; values: number[]; value: number | null; onPick: (v: number) => void; tone: "up" | "down"; price: number | null }) {
  const on = tone === "up" ? "border-up text-up bg-up/10" : "border-down text-down bg-down/10";
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-6 text-xs font-bold ${tone === "up" ? "text-up" : "text-down"}`}>{label}</span>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onPick(v)}
          className={`flex-1 rounded-md border py-1 text-xs font-semibold tabular-nums ${value === v ? on : "border-rule text-slate hover:text-ink"}`}
        >
          {tone === "up" ? "+" : "−"}
          {v}%
        </button>
      ))}
      <span className="w-20 text-right text-xs text-slate tabular-nums">{price ? usd(price) : ""}</span>
    </div>
  );
}

/** A token from /api/tokens/search. */
export type TokenHit = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: string | null;
  liquidity: string | null;
  change24h: string | null;
  imageUrl: string | null;
  riskFlagged: boolean;
};

const compactUsd = (v: string | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}` : "—";
};

/** Flash order input for a token picked from search: the contract address is the asset. */
export function customFlashOrder(
  token: TokenHit,
  order: ParsedOrder,
  exits: ExitPrices,
  funderAddress: string,
  sourcePostId?: string,
): { ok: true; input: FlashOrderInput } | { ok: false; error: string } {
  if (token.riskFlagged) return { ok: false, error: `${token.symbol} is flagged as risky by Definitive.` };
  if (order.amountUsd === null) return { ok: false, error: "Enter an amount." };
  const price = order.limitPrice ?? exits.entry;
  if (!(price > 0)) return { ok: false, error: `No price for ${token.symbol} yet.` };
  const qty = order.side === "buy" ? toDecimal(order.amountUsd, 6) : toDecimal(order.amountUsd / price, Math.min(token.decimals, 8));
  if (qty === "0") return { ok: false, error: "Amount is too small." };
  // Prices of long-tail tokens can be tiny (0.0008 USDC): keep enough decimals.
  const p = (n: number) => toDecimal(n, 12);
  const input: FlashOrderInput = { asset: token.address, side: order.side, qty, orderType: order.limitPrice === null ? "market" : "limit", funderAddress };
  if (order.limitPrice !== null) input.limitPrice = p(order.limitPrice);
  if (exits.takeProfit !== null && exits.stopLoss !== null) {
    input.takeProfit = { notionalPrice: p(exits.takeProfit) };
    input.stopLoss = { notionalPrice: p(exits.stopLoss) };
  }
  if (sourcePostId) input.sourcePostId = sourcePostId;
  return { ok: true, input };
}

/** "Other token": search Base by name, symbol or contract address. Flagged tokens can't be picked. */
function TokenSearch({ selected, onPick }: { selected: TokenHit | null; onPick: (t: TokenHit | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TokenHit[] | null>(null);
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/tokens/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .catch(() => ({ tokens: [] }));
      if (alive) setHits((res as { tokens?: TokenHit[] }).tokens ?? []);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  if (selected)
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-ink px-4 py-3 ring-1 ring-ink">
        <span className="min-w-0">
          <span className="block font-semibold">{selected.symbol}</span>
          <span className="block truncate text-sm text-slate">
            {selected.name} · {selected.address.slice(0, 6)}…{selected.address.slice(-4)} · {compactUsd(selected.liquidity)} liquidity
          </span>
        </span>
        <button type="button" onClick={() => onPick(null)} className="shrink-0 text-sm font-semibold text-slate underline underline-offset-4 hover:text-ink">
          Change
        </button>
      </div>
    );

  return (
    <div className="space-y-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Other Base token: name or address"
        aria-label="Search tokens on Base"
        className="w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm placeholder:text-slate/70 focus:border-lime focus:outline-none"
      />
      {hits && (
        <ul className="max-h-64 divide-y divide-rule overflow-y-auto overscroll-contain rounded-xl border border-rule">
          {hits.length === 0 && <li className="px-4 py-3 text-sm text-slate">Nothing tradable on Base matches.</li>}
          {hits.map((t) => (
            <li key={t.address}>
              <button
                type="button"
                disabled={t.riskFlagged}
                onClick={() => {
                  onPick(t);
                  setQ("");
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{t.symbol}</span>
                  <span className="block truncate text-sm text-slate">
                    {t.name} · {t.address.slice(0, 6)}…{t.address.slice(-4)}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {t.riskFlagged ? <span className="text-down">Flagged</span> : `${compactUsd(t.liquidity)} liq`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hits && hits.length > 0 && <p className="text-xs text-slate">Symbols aren’t unique: check the contract and liquidity.</p>}
    </div>
  );
}
