"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AssetIcon } from "@/components/trade-icons";
import { KolAvatar } from "@/components/kol-avatar";

/**
 * The Kallr agent: one small window where you type what you want in plain words
 * ("buy $50 ETH tomorrow 9am tp 10% sl 5%", "copy @alpha_owl") and it becomes a scheduled order
 * with a printed receipt. Schedules are kept in this browser; nothing is swapped from here.
 */

type Plan = {
  id: string;
  text: string;
  side: "buy" | "sell";
  asset: string;
  amountUsd: number;
  caller: string | null;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  trigger: { asset: string; op: "<" | ">"; price: number } | null;
  runAt: number | null;
  createdAt: number;
  estPrice: number | null;
};

type AgentApi = { open: (prefill?: string) => void };
const AgentContext = createContext<AgentApi>({ open: () => {} });
export const useAgent = () => useContext(AgentContext);

const STORE = "kallr.agent.schedules.v1";
const EXAMPLES = ["buy $50 ETH now tp 10% sl 5%", "buy $25 BTC tomorrow 9am", "sell $40 ETH if ETH > 3800", "copy @alpha_owl $30"];

export function AgentProvider({ children }: { children: ReactNode }) {
  const [openState, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const api = useMemo<AgentApi>(
    () => ({
      open: (p) => {
        setPrefill(p ?? null);
        setOpen(true);
      },
    }),
    [],
  );
  return (
    <AgentContext.Provider value={api}>
      {children}
      <AgentWindow open={openState} onOpenChange={setOpen} prefill={prefill} />
    </AgentContext.Provider>
  );
}

// ---------- Parsing plain words into a plan ----------

export function parsePlan(text: string, prices: Record<string, number>): Plan | string {
  const t = text.toLowerCase().replace(/,/g, "");
  const asset = (t.match(/\b(eth|btc|weth|cbbtc)\b/)?.[1] ?? "eth").replace("weth", "eth").replace("cbbtc", "btc").toUpperCase();
  const side = /\b(sell|short|dump|exit)\b/.test(t) ? "sell" : "buy";
  const amount = Number(t.match(/\$\s*(\d+(?:\.\d+)?)/)?.[1] ?? t.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?)\b/)?.[1] ?? NaN);
  const caller = t.match(/@([a-z0-9_]{1,15})/)?.[1] ?? null;
  if (!Number.isFinite(amount) && !caller) return "Say how much, like “buy $50 ETH”.";
  const tp = t.match(/\b(?:tp|take ?profit)\s*\+?(\d+(?:\.\d+)?)\s*%/)?.[1];
  const sl = t.match(/\b(?:sl|stop ?loss|stop)\s*-?(\d+(?:\.\d+)?)\s*%/)?.[1];

  const trig = t.match(/\b(?:if|when)\s+(eth|btc)\s*(<|>|below|above|under|over|dips to|hits)\s*\$?(\d+(?:\.\d+)?)(k?)/);
  const trigger = trig
    ? {
        asset: trig[1]!.toUpperCase(),
        op: (/[<]|below|under|dips/.test(trig[2]!) ? "<" : ">") as "<" | ">",
        price: Number(trig[3]) * (trig[4] ? 1000 : 1),
      }
    : null;

  let runAt: number | null = null;
  const rel = t.match(/\bin\s+(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)\b/);
  const at = t.match(/\b(tomorrow|today)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.startsWith("m") ? 60 : rel[2]!.startsWith("h") ? 3600 : 86400;
    runAt = Date.now() + n * unit * 1000;
  } else if (at) {
    const d = new Date();
    let hour = Number(at[2]) % 12;
    if (at[4] === "pm") hour += 12;
    d.setHours(hour, Number(at[3] ?? 0), 0, 0);
    if (at[1] === "tomorrow" || (at[1] !== "today" && d.getTime() < Date.now())) d.setDate(d.getDate() + 1);
    runAt = d.getTime();
  } else if (/\btomorrow\b/.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    runAt = d.getTime();
  }

  return {
    id: crypto.randomUUID().slice(0, 8).toUpperCase(),
    text,
    side,
    asset,
    amountUsd: Number.isFinite(amount) ? amount : 25,
    caller,
    takeProfitPct: tp ? Number(tp) : null,
    stopLossPct: sl ? Number(sl) : null,
    trigger,
    runAt,
    createdAt: Date.now(),
    estPrice: prices[asset] ?? null,
  };
}

const usd = (n: number, d = 2) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d });
const whenText = (p: Plan) =>
  p.trigger
    ? `When ${p.trigger.asset} ${p.trigger.op === "<" ? "drops below" : "rises above"} ${usd(p.trigger.price, 0)}`
    : p.runAt
      ? new Date(p.runAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })
      : "Right away";

function loadSchedules(): Plan[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]") as Plan[];
  } catch {
    return [];
  }
}
function saveSchedules(list: Plan[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, 30)));
  } catch {
    // Storage blocked: the list lasts for this page only.
  }
}

// ---------- The window ----------

type Stage = { kind: "idle" } | { kind: "processing"; plan: Plan; step: number } | { kind: "receipt"; plan: Plan };

const STEPS = ["Reading your instruction", "Pricing on Chainlink · Base", "Checking the route on Definitive Flash", "Saving the plan"];

function AgentWindow({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (o: boolean) => void; prefill: string | null }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [schedules, setSchedules] = useState<Plan[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSchedules(loadSchedules()), []);
  useEffect(() => {
    if (!open) return;
    if (prefill) setInput(prefill);
    setTimeout(() => inputRef.current?.focus(), 50);
    fetch("/api/prices")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { prices?: { asset: string; price: string }[] } | null) => {
        if (j?.prices) setPrices(Object.fromEntries(j.prices.map((p) => [p.asset, Number(p.price)])));
      })
      .catch(() => {});
  }, [open, prefill]);

  // Walk the processing steps, then print the receipt.
  useEffect(() => {
    if (stage.kind !== "processing") return;
    const id = setTimeout(() => {
      if (stage.step < STEPS.length - 1) setStage({ ...stage, step: stage.step + 1 });
      else {
        const next = [stage.plan, ...schedules];
        setSchedules(next);
        saveSchedules(next);
        setStage({ kind: "receipt", plan: stage.plan });
      }
    }, 650);
    return () => clearTimeout(id);
  }, [stage, schedules]);

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const plan = parsePlan(text, prices);
      if (typeof plan === "string") return setError(plan);
      setError(null);
      setInput("");
      setStage({ kind: "processing", plan, step: 0 });
    },
    [prices],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="fixed right-4 bottom-20 z-40 flex items-center gap-2 rounded-lg border border-rule-strong bg-card px-5 py-3 text-sm font-semibold text-ink transition-colors hover:border-lime hover:text-lime lg:bottom-6"
      >
        <Sparkle /> Ask Kallr
        {schedules.length > 0 && <span className="rounded-full bg-lime/15 px-2 text-xs text-lime tabular-nums">{schedules.length}</span>}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Kallr agent"
      className="pop-in fixed inset-x-2 bottom-2 z-50 flex max-h-[86dvh] flex-col overflow-hidden rounded-3xl border border-rule bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]"
    >
      <header className="relative flex items-center gap-3 border-b border-rule bg-raised px-5 py-4">
        <span className="grid size-9 place-items-center rounded-lg bg-lime text-on-lime">
          <Sparkle />
        </span>
        <div className="flex-1">
          <p className="font-display font-semibold">Kallr agent</p>
          <p className="flex items-center gap-1.5 text-xs text-slate">
            <span className="rounded bg-lime/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-lime uppercase">Preview</span> Plans trades in plain words · nothing is placed
          </p>
        </div>
        <button type="button" onClick={() => onOpenChange(false)} aria-label="Minimize" className="rounded-full p-2 hover:bg-card">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 12h12" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {stage.kind === "processing" && <Processing plan={stage.plan} step={stage.step} />}
        {stage.kind === "receipt" && (
          <div>
            <Receipt plan={stage.plan} />
            <button type="button" onClick={() => setStage({ kind: "idle" })} className="mt-4 w-full rounded-full bg-lime py-2.5 text-sm font-semibold text-on-lime hover:bg-lime-strong">
              Done
            </button>
          </div>
        )}
        {stage.kind === "idle" && (
          <>
            <p className="text-sm text-slate">Try one of these, or write your own:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setInput(ex)}
                  className="rounded-full border border-rule bg-paper px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-violet hover:text-violet"
                >
                  {ex}
                </button>
              ))}
            </div>
            <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-slate uppercase">Saved plans</h3>
            {schedules.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-rule px-4 py-6 text-center text-sm text-slate">No saved plans yet.</p>
            ) : (
              <ul className="space-y-2">
                {schedules.map((p, i) => (
                  <li key={p.id} className="rise flex items-center gap-3 rounded-2xl bg-paper px-3 py-2.5" style={{ ["--i" as string]: i }}>
                    <AssetIcon asset={p.asset} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {p.side === "buy" ? "Buy" : "Sell"} {usd(p.amountUsd, 0)} {p.asset}
                        {p.caller && <span className="font-normal text-slate"> · @{p.caller}</span>}
                      </p>
                      <p className="truncate text-xs text-slate">{whenText(p)}</p>
                    </div>
                    <button
                      type="button"
                      aria-label="Cancel"
                      onClick={() => {
                        const next = schedules.filter((s) => s.id !== p.id);
                        setSchedules(next);
                        saveSchedules(next);
                      }}
                      className="rounded-full px-2 py-1 text-xs text-slate hover:bg-card hover:text-down"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <form
        className="border-t border-rule p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        {error && <p className="mb-2 px-2 text-xs text-down">{error}</p>}
        <div className="flex items-center gap-2 rounded-full border border-rule bg-paper py-1.5 pr-1.5 pl-4 focus-within:border-violet">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={stage.kind === "processing"}
            placeholder="buy $50 ETH tomorrow 9am tp 10%"
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-slate/70 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || stage.kind === "processing"}
            className="grid size-9 place-items-center rounded-lg bg-lime text-on-lime transition-colors hover:bg-lime-strong disabled:opacity-40"
            aria-label="Schedule"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

function Sparkle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2zm7 13l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z" />
    </svg>
  );
}

// ---------- Processing and receipt ----------

export function Processing({ plan, step }: { plan: Plan; step: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-rule bg-paper p-4">
      <div className="scan-beam" />
      <div className="relative flex items-center gap-3">
        <span className="relative grid size-12 place-items-center">
          <span className="spin absolute inset-0 rounded-full border-[3px] border-violet/20 border-t-violet" />
          <AssetIcon asset={plan.asset} size={32} />
        </span>
        <div>
          <p className="font-display font-semibold">
            Plan: {plan.side === "buy" ? "buy" : "sell"} {usd(plan.amountUsd, 0)} of {plan.asset}
          </p>
          <p className="text-xs text-slate">“{plan.text}”</p>
        </div>
      </div>
      <ol className="relative mt-4 space-y-2.5">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 text-sm transition-opacity ${i > step ? "opacity-35" : ""}`}>
            <span className={`grid size-6 place-items-center rounded-full ${i < step ? "bg-lime text-on-lime" : i === step ? "bg-violet/15" : "bg-rule/60"}`}>
              {i < step ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path className="draw" d="M5 12l5 5 9-10" />
                </svg>
              ) : i === step ? (
                <span className="spin size-3.5 rounded-full border-2 border-violet/30 border-t-violet" />
              ) : null}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

const CONFETTI = ["#c6f25a", "#d6f985", "#e6ebe3", "#8ad97c", "#b8c2b7"];

export function Receipt({ plan, stampText = "Saved" }: { plan: Plan; stampText?: string }) {
  const qty = plan.estPrice ? plan.amountUsd / plan.estPrice : null;
  const pieces = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        x: `${Math.cos((i / 22) * Math.PI * 2) * (90 + (i % 4) * 25)}px`,
        y: `${Math.sin((i / 22) * Math.PI * 2) * (70 + (i % 3) * 30) - 40}px`,
        r: `${(i % 2 ? 1 : -1) * (180 + i * 20)}deg`,
        c: CONFETTI[i % CONFETTI.length],
      })),
    [],
  );
  const rows: [string, string][] = [
    ["Action", `${plan.side.toUpperCase()} ${plan.asset}`],
    ["Amount", usd(plan.amountUsd)],
    ...(plan.estPrice ? ([["Est. price", usd(plan.estPrice)]] as [string, string][]) : []),
    ...(qty ? ([["Est. size", `${qty.toFixed(qty < 1 ? 5 : 3)} ${plan.asset}`]] as [string, string][]) : []),
    ["Runs", whenText(plan)],
    ...(plan.takeProfitPct ? ([["Take profit", `+${plan.takeProfitPct}%`]] as [string, string][]) : []),
    ...(plan.stopLossPct ? ([["Stop loss", `-${plan.stopLossPct}%`]] as [string, string][]) : []),
    ["Network", "Base · Definitive Flash"],
  ];

  return (
    <div className="relative">
      {/* Printer slot */}
      <div className="relative z-10 mx-auto h-3 w-[92%] rounded-full bg-paper shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]" />
      <div className="relative -mt-1.5 overflow-hidden px-[6%] pb-3">
        <div className="receipt-print receipt-edge relative border border-rule bg-raised px-5 pt-6 pb-8 font-mono text-[12.5px] text-ink">
          <div className="text-center">
            <p className="font-display text-lg font-bold tracking-tight">KALLR</p>
            <p className="text-[11px] text-slate">Receipt #{plan.id}</p>
            <p className="text-[11px] text-slate">{new Date(plan.createdAt).toLocaleString("en-US")}</p>
          </div>
          {plan.caller && (
            <div className="mt-4 flex items-center justify-center gap-2 font-sans text-xs">
              <KolAvatar handle={plan.caller} size={22} />
              <span>
                Copying <b>@{plan.caller}</b>
              </span>
            </div>
          )}
          <div className="my-4 border-t border-dashed border-ink/40" />
          <dl className="space-y-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-slate">{k}</dt>
                <dd className="text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="my-4 border-t border-dashed border-ink/40" />
          <div className="flex justify-between font-bold">
            <span>TOTAL</span>
            <span>{usd(plan.amountUsd)} USDC</span>
          </div>
          <div
            aria-hidden
            className="mx-auto mt-5 h-10 w-4/5"
            style={{ background: "repeating-linear-gradient(90deg,#e6ebe3 0 2px,transparent 2px 4px,#e6ebe3 4px 5px,transparent 5px 8px,#e6ebe3 8px 11px,transparent 11px 12px)" }}
          />
          <p className="mt-2 text-center text-[10px] text-slate">Preview · saved in this browser, not placed. To trade, use Copy call or the desk.</p>

          <span className="stamp absolute right-4 bottom-24 rounded-lg border-[3px] border-mint px-2.5 py-1 font-display text-lg font-bold tracking-wider text-mint uppercase">
            {stampText}
          </span>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
        {pieces.map((p, i) => (
          <span key={i} className="confetti" style={{ background: p.c, ["--x" as string]: p.x, ["--y" as string]: p.y, ["--r" as string]: p.r }} />
        ))}
      </div>
    </div>
  );
}
