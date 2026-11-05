"use client";

import {
  arkivPublic,
  readOpenCalls,
  readResults,
  readTrades,
} from "@kallr/integrations/arkiv";
import { median } from "@kallr/integrations/after-market";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { PRIVY_ENABLED } from "@/app/providers";
import { type Session, SignInButton, WithSession } from "@/components/auth";
import { Logo } from "@/components/logo";
import { bracketText, statusText, useFlashOrders } from "@/components/order-desk";
import { SOURCE_STYLE, SourceChip, SourceIcon, TradeAvatar } from "@/components/trade-icons";

/**
 * Every trade placed through Kallr, read from Arkiv in the browser. Trades run on Base
 * through Flash; their records live on Arkiv, created by our writer and owned by the trader.
 * Live order status comes from Flash for your own trades.
 */

type Config = { writer: Hex | null; chainId: number; explorer: string; accessKey: string };
type TradeRow = Awaited<ReturnType<typeof readTrades>>[number];
type ResultRow = Awaited<ReturnType<typeof readResults>>[number];
type CallRow = Awaited<ReturnType<typeof readOpenCalls>>[number];

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 });
const pct = (bps: number) => `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (seconds: bigint | number) =>
  new Date(Number(seconds) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function TradesPage() {
  return PRIVY_ENABLED ? <WithSession>{(s) => <Dashboard session={s} />}</WithSession> : <Dashboard session={null} />;
}

function useArkivConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/arkiv")
      .then((r) => r.json() as Promise<Config>)
      .then(setConfig, () => setError("Couldn’t reach the Kallr server."));
  }, []);
  return { config, error };
}

function Dashboard({ session }: { session: Session | null }) {
  const { config, error: configError } = useArkivConfig();
  const signedIn = Boolean(session?.authenticated && session.address);
  const [scope, setScope] = useState<"yours" | "everyone">("everyone");
  useEffect(() => {
    if (signedIn) setScope("yours");
  }, [signedIn]);

  const client = useMemo(() => (config ? arkivPublic(config.accessKey) : null), [config]);
  const trader = scope === "yours" && session?.address ? session.address : undefined;

  const [trades, setTrades] = useState<readonly TradeRow[] | null>(null);
  const [results, setResults] = useState<readonly ResultRow[] | null>(null);
  const [openCalls, setOpenCalls] = useState<readonly CallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !config?.writer) return;
    try {
      const [t, r, o] = await Promise.all([
        readTrades(client, config.writer, trader),
        readResults(client, config.writer),
        readOpenCalls(client, config.writer, Math.floor(Date.now() / 1000)),
      ]);
      setTrades(t);
      setResults(r);
      setOpenCalls(o);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? `Arkiv: ${e.message}` : "Couldn’t read Arkiv.");
    }
  }, [client, config?.writer, trader]);

  useEffect(() => {
    setTrades(null);
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  const flash = useFlashOrders(scope === "yours" ? (session?.address ?? null) : null);
  const flashById = useMemo(() => new Map((flash.orders ?? []).map((o) => [o.orderId, o])), [flash.orders]);

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-rule bg-card px-6 py-4">
        <Logo href="/" />
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/dashboard" className="text-slate hover:text-ink">
            Dashboard
          </Link>
          <Link href="/app" className="text-slate hover:text-ink">
            Desk
          </Link>
          <span className="font-semibold">Trades</span>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6 lg:px-10">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Trades</h1>
          <p className="mt-2 max-w-2xl text-slate">
            Every order placed through Kallr, from the desk, the extension on X or the keyboard. Orders run on
            Base through Definitive Flash; their records are read here straight from Arkiv, owned by the trader’s wallet.
          </p>
        </div>

        {(configError || error) && <p className="rounded-xl border border-down/40 px-4 py-3 text-sm text-down">{configError ?? error}</p>}
        {config && !config.writer && (
          <p className="rounded-xl border border-rule bg-card px-4 py-3 text-sm text-slate">
            Arkiv isn’t set up on this server yet: add <code className="font-semibold">ARKIV_PRIVATE_KEY</code> to{" "}
            <code className="font-semibold">.env.local</code>.
          </p>
        )}

        <section aria-labelledby="trades-heading" className="rounded-2xl border border-rule bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="trades-heading" className="font-display text-lg font-semibold">
              {scope === "yours" ? "Your trades" : "Everyone’s trades"}
            </h2>
            <div className="flex items-center gap-1 rounded-full border border-rule p-1 text-sm" role="tablist">
              {(["yours", "everyone"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={scope === s}
                  disabled={s === "yours" && !signedIn}
                  onClick={() => setScope(s)}
                  className={`rounded-full px-3 py-1 disabled:opacity-40 ${scope === s ? "bg-ink text-white" : "text-slate hover:text-ink"}`}
                >
                  {s === "yours" ? "Yours" : "Everyone"}
                </button>
              ))}
            </div>
          </div>
          {!signedIn && PRIVY_ENABLED && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate">
              <SignInButton label="Sign in to see yours" />
            </div>
          )}

          {trades && trades.length > 0 && <SourceSummary trades={trades} />}

          {trades === null && config?.writer && !error && <p className="mt-6 text-sm text-slate">Reading Arkiv…</p>}
          {trades?.length === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-rule px-6 py-10 text-center">
              <p className="font-semibold">No trades yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate">
                Copy a call from the extension on X, the keyboard, or the desk. Each order shows up here once Flash accepts it.
              </p>
            </div>
          )}
          {trades && trades.length > 0 && (
            <ul className="mt-4 divide-y divide-rule">
              {trades.map((t) => {
                const live = flashById.get(t.flashOrderId.value);
                const owned = t.$owner.toLowerCase() === t.trader.value.toLowerCase();
                return (
                  <li key={t.$key} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-4">
                    <TradeAvatar asset={t.asset.value} source={t.source.value} />
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {t.side.value === "buy" ? `Buy $${t.qty.value} of ${t.asset.value}` : `Sell ${t.qty.value} ${t.asset.value}`}
                        {t.caller?.value && (
                          <>
                            {" · copied "}
                            <a
                              className="underline decoration-rule underline-offset-4 hover:text-ink"
                              href={`https://x.com/${t.caller.value}/status/${t.postId?.value ?? ""}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              @{t.caller.value}
                            </a>
                          </>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-slate tabular-nums">
                        <SourceChip source={t.source.value} /> {when(t.placedAt.value)}
                        {t.takeProfit?.value && <span className="text-up"> · TP {usd(Number(t.takeProfit.value))}</span>}
                        {t.stopLoss?.value && <span className="text-down"> · SL {usd(Number(t.stopLoss.value))}</span>}
                        {scope === "everyone" && <> · {short(t.trader.value)}</>}
                      </p>
                      <p className="mt-1 text-xs text-slate">
                        <a
                          className="hover:text-ink"
                          href={`${config?.explorer}/entity/${t.$key}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Arkiv record ↗
                        </a>
                        {" · "}
                        {owned ? "owned by the trader" : "being handed to the trader"}
                      </p>
                    </div>
                    </div>
                    {live ? (
                      <span className="shrink-0 self-start rounded-full border border-rule px-3 py-1 text-sm text-slate">
                        {statusText[live.status] ?? live.status}
                        {live.attachedBracket && ` · ${bracketText[live.attachedBracket.status] ?? live.attachedBracket.status}`}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <CallerBoard results={results} openCalls={openCalls} />

        <CallArchive results={results} openCalls={openCalls} explorer={config?.explorer ?? ""} />

        {config?.writer && (
          <section className="rounded-2xl border border-rule bg-card p-6 text-sm text-slate">
            <h2 className="font-display text-base font-semibold text-ink">Check it yourself</h2>
            <p className="mt-2">
              Every record above was created by{" "}
              <a className="font-mono hover:text-ink" href={`${config.explorer}/address/${config.writer}`} target="_blank" rel="noreferrer">
                {config.writer}
              </a>{" "}
              on Arkiv’s Rabdi testnet (chain {config.chainId}). Query it without us:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-paper p-4 text-xs text-ink">
              {`arkiv.schema = str('kallr.trades') AND $creator = addr(${config.writer})`}
            </pre>
          </section>
        )}
      </main>
    </div>
  );
}

function SourceSummary({ trades }: { trades: readonly TradeRow[] }) {
  const counts = trades.reduce<Record<string, number>>((acc, t) => {
    acc[t.source.value] = (acc[t.source.value] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-3">
      {(["desk", "extension", "keyboard"] as const).map((s) => (
        <div key={s} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: SOURCE_STYLE[s].tint }}>
          <SourceIcon source={s} size={32} />
          <div className="min-w-0">
            <dt className="truncate text-xs text-slate">{SOURCE_STYLE[s].label}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{counts[s] ?? 0}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

function CallerBoard({ results, openCalls }: { results: readonly ResultRow[] | null; openCalls: readonly CallRow[] | null }) {
  const rows = useMemo(() => {
    const by = new Map<string, { hits: number; scored: number; returns: number[]; open: number }>();
    for (const r of results ?? []) {
      const e = by.get(r.caller.value) ?? { hits: 0, scored: 0, returns: [], open: 0 };
      e.scored++;
      if (r.status.value === "hit") e.hits++;
      e.returns.push(Number(r.returnBps.value));
      by.set(r.caller.value, e);
    }
    for (const c of openCalls ?? []) {
      const e = by.get(c.caller.value) ?? { hits: 0, scored: 0, returns: [], open: 0 };
      e.open++;
      by.set(c.caller.value, e);
    }
    return [...by.entries()]
      .map(([caller, e]) => ({ caller, ...e, median: median(e.returns) }))
      .sort((a, b) => b.scored - a.scored || b.open - a.open);
  }, [results, openCalls]);

  return (
    <section aria-labelledby="callers-heading" className="rounded-2xl border border-rule bg-card p-6">
      <h2 id="callers-heading" className="font-display text-lg font-semibold">
        Caller records
      </h2>
      <p className="mt-1 text-sm text-slate">
        Calls priced at the minute they were posted (Chainlink on Base). An open call disappears from Arkiv on its own after
        its timeframe; its result stays, and nobody can edit it.
      </p>
      {results === null && <p className="mt-6 text-sm text-slate">Reading Arkiv…</p>}
      {results !== null && rows.length === 0 && <p className="mt-6 text-sm text-slate">No calls priced yet.</p>}
      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-slate">
              <tr>
                <th className="py-2 pr-4 font-normal">Caller</th>
                <th className="py-2 pr-4 font-normal">Hit rate</th>
                <th className="py-2 pr-4 font-normal">Median</th>
                <th className="py-2 font-normal">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.map((r) => (
                <tr key={r.caller}>
                  <td className="py-2 pr-4 font-semibold">
                    <a href={`https://x.com/${r.caller}`} target="_blank" rel="noreferrer" className="hover:underline">
                      @{r.caller}
                    </a>
                  </td>
                  <td className="py-2 pr-4">{r.scored ? `${r.hits} of ${r.scored} (${Math.round((r.hits / r.scored) * 100)}%)` : "—"}</td>
                  <td className={`py-2 pr-4 ${r.median === null ? "" : r.median > 0 ? "text-up" : r.median < 0 ? "text-down" : ""}`}>
                    {r.median === null ? "—" : pct(r.median)}
                  </td>
                  <td className="py-2">{r.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const SWARM_GATEWAY = "https://api.gateway.ethswarm.org";

/**
 * Recent calls and results with their Swarm snapshots: the post as Kallr saw it when it priced the
 * call, stored on Swarm and referenced from the Arkiv entity, so it stays provable if the post goes.
 */
function CallArchive({
  results,
  openCalls,
  explorer,
}: {
  results: readonly ResultRow[] | null;
  openCalls: readonly CallRow[] | null;
  explorer: string;
}) {
  const rows = [
    ...(openCalls ?? []).map((c) => ({
      key: c.$key,
      postId: c.postId.value,
      caller: c.caller.value,
      line: `$${c.asset.value} ${c.direction.value} · open until ${when(c.deadline.value)}`,
      swarmRef: c.swarmRef?.value ?? null,
      at: Number(c.postedAt.value),
    })),
    ...(results ?? []).map((r) => ({
      key: r.$key,
      postId: r.postId.value,
      caller: r.caller.value,
      line: `$${r.asset.value} ${r.direction.value} · ${r.status.value} ${pct(Number(r.returnBps.value))}`,
      swarmRef: r.swarmRef?.value ?? null,
      at: Number(r.postedAt.value),
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);

  return (
    <section aria-labelledby="archive-heading" className="rounded-2xl border border-rule bg-card p-6">
      <h2 id="archive-heading" className="font-display text-lg font-semibold">
        Call archive
      </h2>
      <p className="mt-1 text-sm text-slate">
        Each call is snapshotted to Swarm when Kallr first prices it, and its Arkiv record keeps the Swarm reference, so a
        deleted post stays provable.
      </p>
      {rows.length === 0 && <p className="mt-6 text-sm text-slate">No calls archived yet.</p>}
      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-rule text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                <a
                  href={`https://x.com/${r.caller}/status/${r.postId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold hover:underline"
                >
                  @{r.caller}
                </a>{" "}
                <span className="text-slate tabular-nums">{r.line}</span>
              </span>
              <span className="flex gap-4 text-xs text-slate">
                {r.swarmRef ? (
                  <a className="hover:text-ink" href={`${SWARM_GATEWAY}/bzz/${r.swarmRef}/`} target="_blank" rel="noreferrer">
                    Snapshot on Swarm ↗
                  </a>
                ) : (
                  <span>No snapshot</span>
                )}
                {explorer && (
                  <a className="hover:text-ink" href={`${explorer}/entity/${r.key}`} target="_blank" rel="noreferrer">
                    Arkiv record ↗
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
