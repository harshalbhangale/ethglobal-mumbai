"use client";

import { arkivPublic, readTrades } from "@kallr/integrations/arkiv";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { type Session, SignInButton, WithSession } from "@/components/auth";
import { Logo, LogoMark } from "@/components/logo";
import { AssetIcon, SOURCE_STYLE, type Source, SourceChip, SourceIcon, TradeAvatar } from "@/components/trade-icons";
import { type Balances, formatAmount, getBalances, shortAddress } from "@/lib/chain";

/**
 * Home after sign-in: the wallet, live prices, and the latest trades from every surface
 * (desk, extension on X, keyboard). Trades are read from Arkiv like /trades; this page shows
 * only the signed-in wallet's and links to the full history.
 */

type Config = { writer: Hex | null; accessKey: string };
type TradeRow = Awaited<ReturnType<typeof readTrades>>[number];
type Price = { asset: string; price: string };

const SOURCES: Source[] = ["extension", "keyboard", "desk"];
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 });
const when = (seconds: bigint | number) =>
  new Date(Number(seconds) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function DashboardPage() {
  return <WithSession>{(s) => <Gate session={s} />}</WithSession>;
}

function Gate({ session }: { session: Session }) {
  if (!session.ready) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }
  if (!session.authenticated) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center">
            <LogoMark size={48} />
          </div>
          <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">Your dashboard</h1>
          <p className="mt-3 text-slate">Sign in to see your wallet and every trade you copied from X, the keyboard or the desk.</p>
          <div className="mt-8 flex justify-center">
            <SignInButton />
          </div>
        </div>
      </div>
    );
  }
  return <Dashboard session={session} />;
}

function Dashboard({ session }: { session: Session }) {
  const trades = useMyTrades(session.address);
  const prices = usePrices();

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-4 border-b border-rule bg-card px-4 py-4 sm:px-6">
        <Logo href="/dashboard" />
        <nav className="flex items-center gap-4 text-sm sm:gap-5">
          <span className="font-semibold">Dashboard</span>
          <Link href="/app" className="text-slate hover:text-ink">
            Desk
          </Link>
          <Link href="/trades" className="text-slate hover:text-ink">
            Trades
          </Link>
          <button type="button" onClick={() => session.logout()} className="hidden text-slate hover:text-ink sm:inline">
            Sign out
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            {session.handle ? `Hi, @${session.handle}` : "Your dashboard"}
          </h1>
          <p className="mt-2 text-slate">Your wallet and the calls you copied, wherever you copied them.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {session.address ? (
            <WalletCard address={session.address} embedded={session.embedded} />
          ) : (
            <section className="rounded-2xl border border-rule bg-card p-6 text-sm text-slate">Setting up your wallet…</section>
          )}
          <PricesCard prices={prices} />
        </div>

        <SourceTiles trades={trades.rows} />

        <section aria-labelledby="recent-heading" className="rounded-2xl border border-rule bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-heading" className="font-display text-lg font-semibold">
              Recent trades
            </h2>
            <Link href="/trades" className="text-sm text-slate hover:text-ink">
              See all →
            </Link>
          </div>
          {trades.error && <p className="mt-4 text-sm text-down">{trades.error}</p>}
          {trades.rows === null && !trades.error && <p className="mt-6 text-sm text-slate">Reading Arkiv…</p>}
          {trades.rows?.length === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-rule px-6 py-10 text-center">
              <div className="flex justify-center gap-2">
                {SOURCES.map((s) => (
                  <SourceIcon key={s} source={s} size={32} />
                ))}
              </div>
              <p className="mt-4 font-semibold">No trades yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate">
                Copy a call from the extension on X, the keyboard, or the desk. It shows up here once Flash accepts it.
              </p>
              <Link href="/app" className="mt-5 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink-soft">
                Open the desk
              </Link>
            </div>
          )}
          {trades.rows && trades.rows.length > 0 && (
            <ul className="mt-4 divide-y divide-rule">
              {trades.rows.slice(0, 6).map((t) => (
                <li key={t.$key} className="flex items-center gap-4 py-3">
                  <TradeAvatar asset={t.asset.value} source={t.source.value} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {t.side.value === "buy" ? `Bought $${t.qty.value} of ${t.asset.value}` : `Sold ${t.qty.value} ${t.asset.value}`}
                      {t.caller?.value && <span className="font-normal text-slate"> · @{t.caller.value}</span>}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate tabular-nums">
                      <SourceChip source={t.source.value} />
                      {when(t.placedAt.value)}
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right text-xs tabular-nums sm:block">
                    {t.takeProfit?.value && <div className="text-up">TP {usd(Number(t.takeProfit.value))}</div>}
                    {t.stopLoss?.value && <div className="text-down">SL {usd(Number(t.stopLoss.value))}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function WalletCard({ address, embedded }: { address: Address; embedded: boolean }) {
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
      className="relative overflow-hidden rounded-2xl p-6 text-white shadow-[0_8px_24px_rgba(20,33,61,0.25)]"
      style={{ background: "linear-gradient(135deg, #14213d 0%, #2a3a5c 55%, #3b2f6b 100%)" }}
    >
      <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
      <div aria-hidden className="absolute -bottom-16 right-16 h-40 w-40 rounded-full bg-amber/15" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-white/70">{embedded ? "Embedded wallet" : "Connected wallet"}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold">
            <span className="h-2 w-2 rounded-full bg-[#0052ff]" /> Base
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-full border border-white/25 px-3 py-1.5 font-mono text-xs hover:border-white"
          title={address}
        >
          {copied ? "Copied" : shortAddress(address)}
        </button>
      </div>

      <div className="relative mt-8">
        <p className="text-sm text-white/70">USDC balance</p>
        <p className="font-display mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
          {balances ? `$${formatAmount(balances.usdc)}` : error ? "—" : "…"}
        </p>
        <p className="mt-2 text-sm text-white/70 tabular-nums">
          {balances ? `${formatAmount(balances.eth, 5)} ETH for gas` : error ? "Couldn’t read balances from Base" : "Reading Base…"}
        </p>
      </div>

      <div className="relative mt-6 flex flex-wrap gap-2">
        <Link href="/app" className="rounded-full bg-amber px-4 py-2 text-sm font-semibold text-ink hover:bg-amber/90">
          Copy a call
        </Link>
        <a
          href={`https://basescan.org/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold hover:border-white"
        >
          View on Basescan ↗
        </a>
      </div>
    </section>
  );
}

function PricesCard({ prices }: { prices: Price[] | null | "error" }) {
  return (
    <section aria-labelledby="prices-heading" className="rounded-2xl border border-rule bg-card p-6">
      <h2 id="prices-heading" className="font-display text-lg font-semibold">
        Markets
      </h2>
      <p className="mt-1 text-sm text-slate">Chainlink price feeds on Base</p>
      {prices === null && <p className="mt-6 text-sm text-slate">Reading feeds…</p>}
      {prices === "error" && <p className="mt-6 text-sm text-down">Price feeds unavailable right now.</p>}
      {Array.isArray(prices) && (
        <ul className="mt-4 space-y-3">
          {prices.map((p) => (
            <li key={p.asset} className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2.5">
              <AssetIcon asset={p.asset} size={32} />
              <span className="flex-1 font-semibold">{p.asset}</span>
              <span className="font-display text-lg font-semibold tabular-nums">{usd(Number(p.price))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SourceTiles({ trades }: { trades: readonly TradeRow[] | null }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of trades ?? []) c[t.source.value] = (c[t.source.value] ?? 0) + 1;
    return c;
  }, [trades]);
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {SOURCES.map((s) => (
        <div key={s} className="flex items-center gap-4 rounded-2xl border border-rule bg-card p-4">
          <SourceIcon source={s} size={44} />
          <div>
            <dt className="text-sm text-slate">{SOURCE_STYLE[s].label}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{trades ? (counts[s] ?? 0) : "…"}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

function useMyTrades(address: Address | null) {
  const [config, setConfig] = useState<Config | null>(null);
  const [rows, setRows] = useState<readonly TradeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/arkiv")
      .then((r) => r.json() as Promise<Config>)
      .then(setConfig, () => setError("Couldn’t reach the Kallr server."));
  }, []);

  const client = useMemo(() => (config ? arkivPublic(config.accessKey) : null), [config]);

  const load = useCallback(async () => {
    if (!config) return;
    if (!config.writer) {
      setError("Arkiv isn’t set up on this server yet: add ARKIV_PRIVATE_KEY to .env.local.");
      return;
    }
    if (!client || !address) return;
    try {
      setRows(await readTrades(client, config.writer, address));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? `Arkiv: ${e.message}` : "Couldn’t read Arkiv.");
    }
  }, [client, config, address]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  return { rows, error };
}

function usePrices() {
  const [prices, setPrices] = useState<Price[] | null | "error">(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      fetch("/api/prices")
        .then((r) => (r.ok ? (r.json() as Promise<{ prices: Price[] }>) : Promise.reject()))
        .then(
          (j) => live && setPrices(j.prices),
          () => live && setPrices((p) => (Array.isArray(p) ? p : "error")),
        );
    read();
    const id = setInterval(read, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return prices;
}
