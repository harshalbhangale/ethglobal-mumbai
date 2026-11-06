"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import type { Address } from "viem";
import { useAgent } from "@/components/agent";
import { type Session, SignInButton } from "@/components/auth";
import { KolAvatar } from "@/components/kol-avatar";
import { Logo } from "@/components/logo";
import { AssetIcon, SOURCE_STYLE, SourceIcon, TradeAvatar } from "@/components/trade-icons";
import { type Balances, formatAmount, getBalances, shortAddress } from "@/lib/chain";
import { type CallItem, copyCall, type FeedItem, type ResultItem, type TradeItem } from "@/lib/feed";

export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : n < 1000 ? 2 : 0 });
export const pct = (bps: number) => `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

export function ago(seconds: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function left(seconds: number) {
  const s = seconds - Math.floor(Date.now() / 1000);
  if (s <= 0) return "settling";
  if (s < 3600) return `${Math.ceil(s / 60)}m left`;
  if (s < 86400) return `${Math.round(s / 3600)}h left`;
  return `${Math.round(s / 86400)}d left`;
}

/** Counts up to a number once it appears. */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

// ---------- Shell: X-style three columns ----------

const NAV = [
  { href: "/app", label: "Home", icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" /> },
  { href: "/kol", label: "Callers", icon: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17 11a3 3 0 1 0 0-6M21 19v-1a4 4 0 0 0-3-3.87" /> },
  { href: "/trades", label: "Trades", icon: <path d="M4 17l6-6 4 4 6-8M14 7h6v6" /> },
  { href: "/app", label: "Desk", icon: <path d="M3 5h18v11H3zM8 20h8M12 16v4" /> },
];

export function Shell({ session, children, rail }: { session: Session; children: ReactNode; rail?: ReactNode }) {
  const path = usePathname();
  const agent = useAgent();
  const active = (href: string) => (href === "/kol" ? path.startsWith("/kol") : path === href);
  return (
    <div className="relative min-h-dvh">
      <div className="mx-auto grid max-w-[1280px] lg:grid-cols-[240px_minmax(0,1fr)_340px] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <aside className="sticky top-0 hidden h-dvh flex-col px-4 py-6 lg:flex">
          <Logo href="/app" />
          <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={`flex items-center gap-4 rounded-full px-4 py-3 text-[17px] transition-colors hover:bg-card ${active(n.href) ? "bg-card font-bold shadow-sm" : "text-ink-soft"}`}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active(n.href) ? 2.4 : 1.9} strokeLinecap="round" strokeLinejoin="round">
                  {n.icon}
                </svg>
                {n.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => agent.open()}
            className="mt-6 rounded-lg border border-rule-strong py-3.5 font-semibold text-ink transition-colors hover:border-lime hover:text-lime"
            >
            Ask the agent
          </button>
          <div className="mt-auto">
            {session.authenticated ? (
              <div className="flex items-center gap-3 rounded-full p-2 hover:bg-card">
                <KolAvatar handle={session.handle ?? "you"} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{session.handle ? `@${session.handle}` : "Signed in"}</p>
                  <button type="button" onClick={() => session.logout()} className="text-xs text-slate hover:text-ink">
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <SignInButton />
            )}
          </div>
        </aside>

        <main className="min-h-dvh min-w-0 border-rule bg-card/70 pb-24 backdrop-blur lg:border-x lg:pb-0">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3 lg:hidden">
            <Logo href="/app" />
            {!session.authenticated && <SignInButton />}
          </div>
          {children}
        </main>

        <aside className="hidden space-y-5 px-5 py-6 lg:block">{rail}</aside>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-rule bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${active(n.href) ? "text-ink" : "text-slate"}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {n.icon}
            </svg>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// ---------- Tabs with a sliding underline ----------

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="sticky top-0 z-20 flex border-b border-rule bg-card/85 backdrop-blur" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`relative flex-1 py-4 text-[15px] transition-colors hover:bg-paper/70 ${value === t.id ? "font-bold text-ink" : "text-slate"}`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-paper px-1.5 text-xs tabular-nums">{t.count}</span>}
          {value === t.id && <span className="tab-underline absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-sky" />}
        </button>
      ))}
    </div>
  );
}

// ---------- Posts ----------

function Pill({ children, tone }: { children: ReactNode; tone: "up" | "down" | "flat" | "violet" | "sky" }) {
  const map = {
    up: "bg-up/12 text-up",
    down: "bg-down/12 text-down",
    flat: "bg-slate/12 text-slate",
    violet: "bg-violet/12 text-violet",
    sky: "bg-sky/12 text-sky",
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold uppercase ${map[tone]}`}>{children}</span>;
}

function SampleTag({ show }: { show?: boolean }) {
  return show ? <span className="rounded-md bg-amber/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-ink-soft uppercase">Sample</span> : null;
}

export function FeedPost({ item, prices, i }: { item: FeedItem; prices: Record<string, number>; i: number }) {
  return (
    <article className="rise border-b border-rule px-4 py-4 transition-colors hover:bg-paper/50 sm:px-5" style={{ ["--i" as string]: Math.min(i, 12) }}>
      {item.kind === "call" && <CallPost c={item} price={prices[item.asset] ?? null} />}
      {item.kind === "result" && <ResultPost r={item} />}
      {item.kind === "trade" && <TradePost t={item} />}
    </article>
  );
}

function Head({ handle, time, extra, sample }: { handle: string; time: number; extra?: ReactNode; sample?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px]">
      <Link href={`/kol/${handle}`} className="font-bold hover:underline">
        {handle}
      </Link>
      <span className="text-slate">@{handle} · {ago(time)}</span>
      {extra}
      <SampleTag show={sample} />
    </div>
  );
}

function CallPost({ c, price }: { c: CallItem; price: number | null }) {
  const copy = copyCall(c);
  const moveBps = c.entry && price ? ((price - c.entry) / c.entry) * 10000 * (c.direction === "long" ? 1 : -1) : null;
  const span = c.deadline - c.postedAt;
  const done = Math.min(1, Math.max(0, (Date.now() / 1000 - c.postedAt) / span));
  return (
    <div className="flex gap-3">
      <Link href={`/kol/${c.caller}`}>
        <KolAvatar handle={c.caller} size={44} />
      </Link>
      <div className="min-w-0 flex-1">
        <Head handle={c.caller} time={c.postedAt} sample={c.sample} extra={<Pill tone="sky">Call</Pill>} />
        <p className="mt-1 text-[15px]">
          Called <b className={c.direction === "long" ? "text-up" : "text-down"}>{c.direction.toUpperCase()}</b> on <b>${c.asset}</b>
          {c.entry ? ` at ${usd(c.entry)}` : ""}.
        </p>
        <div className="lift mt-3 overflow-hidden rounded-2xl border border-rule bg-card">
          <div className="flex items-center gap-3 p-3.5">
            <AssetIcon asset={c.asset} size={38} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate">Since the post</p>
              <p className={`font-display text-2xl font-semibold tabular-nums ${moveBps === null ? "" : moveBps >= 0 ? "text-up" : "text-down"}`}>
                {moveBps === null ? "—" : pct(moveBps)}
              </p>
            </div>
            <div className="text-right text-xs text-slate tabular-nums">
              <div>Now {price ? usd(price) : "…"}</div>
              <div className="mt-0.5 flex items-center justify-end gap-1.5">
                <span className="live-dot text-mint" /> {left(c.deadline)}
              </div>
            </div>
          </div>
          <div className="h-1.5 bg-paper">
            <div className="h-full rounded-r-full" style={{ width: `${done * 100}%`, background: "#c6f25a" }} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {"href" in copy ? (
            <Link
              href={copy.href}
              className="rounded-lg bg-lime px-4 py-1.5 text-sm font-semibold text-on-lime transition-transform hover:bg-lime-strong"
            >
              Copy call
            </Link>
          ) : (
            <span className="rounded-full bg-paper px-3 py-1.5 text-xs text-slate">{copy.reason}</span>
          )}
          <a href={`https://x.com/${c.caller}/status/${c.postId}`} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1.5 text-sm text-slate hover:bg-sky/10 hover:text-sky">
            View on X ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function ResultPost({ r }: { r: ResultItem }) {
  const tone = r.status === "hit" ? "up" : r.status === "miss" ? "down" : "flat";
  return (
    <div className="flex gap-3">
      <Link href={`/kol/${r.caller}`}>
        <KolAvatar handle={r.caller} size={44} />
      </Link>
      <div className="min-w-0 flex-1">
        <Head handle={r.caller} time={r.deadline} sample={r.sample} extra={<Pill tone={tone}>{r.status}</Pill>} />
        <p className="mt-1 text-[15px]">
          {r.direction === "long" ? "Long" : "Short"} <b>${r.asset}</b> settled.
        </p>
        <div
          className="lift mt-3 flex items-center gap-4 rounded-xl border border-rule bg-raised p-4"
        >
          <AssetIcon asset={r.asset} size={40} />
          <div className="flex-1">
            <p className="text-xs text-slate">Called move</p>
            <p className={`font-display text-3xl font-semibold tabular-nums ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink-soft"}`}>{pct(r.returnBps)}</p>
          </div>
          <div className="text-right text-xs text-slate tabular-nums">
            <div>{usd(r.entry)}</div>
            <div>↓</div>
            <div>{usd(r.exit)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TradePost({ t }: { t: TradeItem }) {
  const s = SOURCE_STYLE[t.source];
  return (
    <div className="flex gap-3">
      <span className="self-start">
        <TradeAvatar asset={t.asset} source={t.source} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px]">
          <span className="font-bold">You</span>
          <span className="text-slate">· {ago(t.placedAt)}</span>
          <span className="inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 text-xs font-semibold" style={{ background: s.tint }}>
            <SourceIcon source={t.source} size={16} /> via {s.label}
          </span>
          <SampleTag show={t.sample} />
        </div>
        <p className="mt-1 text-[15px]">
          {t.side === "buy" ? (
            <>
              Bought <b>${t.qty}</b> of <b>${t.asset}</b>
            </>
          ) : (
            <>
              Sold <b>{t.qty} {t.asset}</b>
            </>
          )}
          {t.caller && (
            <>
              {" "}
              copying{" "}
              <Link href={`/kol/${t.caller}`} className="font-semibold text-sky hover:underline">
                @{t.caller}
              </Link>
            </>
          )}
        </p>
        {(t.takeProfit || t.stopLoss) && (
          <div className="mt-2 flex gap-2 text-xs font-semibold tabular-nums">
            {t.takeProfit && <span className="rounded-full bg-up/10 px-2.5 py-1 text-up">TP {usd(t.takeProfit)}</span>}
            {t.stopLoss && <span className="rounded-full bg-down/10 px-2.5 py-1 text-down">SL {usd(t.stopLoss)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 border-b border-rule px-5 py-5">
          <div className="shimmer size-11 rounded-full" />
          <div className="flex-1 space-y-2.5">
            <div className="shimmer h-3.5 w-1/3 rounded" />
            <div className="shimmer h-3.5 w-2/3 rounded" />
            <div className="shimmer h-20 w-full rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Right rail cards ----------

export function WalletCard({ address, embedded }: { address: Address; embedded: boolean }) {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      getBalances(address).then(
        (b) => live && (setBalances(b), setError(false)),
        () => live && setError(true),
      );
    read();
    const id = setInterval(read, 20_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [address]);
  return (
    <section
      aria-label="Wallet"
      className="relative overflow-hidden rounded-2xl border border-rule bg-card p-5"
    >
      <div className="relative flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-1 text-xs font-semibold text-ink-soft">
          <span className="size-2 rounded-full bg-[#0052ff] ring-2 ring-rule" /> {embedded ? "Embedded · Base" : "Wallet · Base"}
        </span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-md bg-raised px-2.5 py-1 font-mono text-xs hover:bg-rule"
          title={address}
        >
          {copied ? "Copied ✓" : shortAddress(address)}
        </button>
      </div>
      <p className="relative mt-6 text-xs text-slate">USDC balance</p>
      <p className="font-display relative text-4xl font-semibold tracking-tight tabular-nums">
        {balances ? <CountUp value={Number(balances.usdc)} format={(n) => `$${n.toFixed(2)}`} /> : error ? "—" : "…"}
      </p>
      <p className="relative mt-1 text-xs text-slate tabular-nums">{balances ? `${formatAmount(balances.eth, 5)} ETH for gas` : error ? "Couldn’t read Base" : "Reading Base…"}</p>
      <a
        href={`https://basescan.org/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="relative mt-4 inline-block rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-on-lime hover:bg-lime-strong"
      >
        Basescan ↗
      </a>
    </section>
  );
}

export function RailCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-rule bg-card">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Markets({ prices }: { prices: Record<string, number> }) {
  const list = Object.entries(prices);
  return (
    <RailCard title="Markets" action={<span className="flex items-center gap-1.5 text-xs text-slate"><span className="live-dot text-mint" /> Chainlink</span>}>
      {list.length === 0 ? (
        <div className="space-y-2 px-4 pb-4">
          <div className="shimmer h-10 rounded-xl" />
          <div className="shimmer h-10 rounded-xl" />
        </div>
      ) : (
        <ul className="pb-2">
          {list.map(([asset, price]) => (
            <li key={asset} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper/60">
              <AssetIcon asset={asset} size={32} />
              <span className="flex-1 font-semibold">{asset}</span>
              <span className="font-display text-lg font-semibold tabular-nums">{usd(price)}</span>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

export function usePriceMap() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    const read = () =>
      fetch("/api/prices")
        .then((r) => (r.ok ? (r.json() as Promise<{ prices: { asset: string; price: string }[] }>) : Promise.reject()))
        .then((j) => live && setPrices(Object.fromEntries(j.prices.map((p) => [p.asset, Number(p.price)]))))
        .catch(() => {});
    read();
    const id = setInterval(read, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return prices;
}
