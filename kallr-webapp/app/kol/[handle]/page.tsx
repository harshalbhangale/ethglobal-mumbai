"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AgentProvider, useAgent } from "@/components/agent";
import { type Session, WithSession } from "@/components/auth";
import { CountUp, FeedPost, FeedSkeleton, Markets, pct, RailCard, Shell, Tabs, usePriceMap } from "@/components/feed";
import { FollowButton } from "@/components/follow-button";
import { handleGradient, KolAvatar } from "@/components/kol-avatar";
import { LogoMark } from "@/components/logo";
import { callerStats, type FeedItem, itemTime, useFollows, useKallrData } from "@/lib/feed";

/** A caller's profile: their record from Arkiv, open calls, settled calls and what you copied. */

type Tab = "calls" | "results" | "copied";

export default function KolPage() {
  return (
    <AgentProvider>
      <WithSession>
        {(s) =>
          s.ready ? (
            <Profile session={s} />
          ) : (
            <div className="grid min-h-dvh place-items-center">
              <LogoMark size={40} />
            </div>
          )
        }
      </WithSession>
    </AgentProvider>
  );
}

function Profile({ session }: { session: Session }) {
  const handle = String(useParams<{ handle: string }>().handle ?? "").toLowerCase();
  const data = useKallrData(session.authenticated ? session.address : null);
  const follows = useFollows();
  const prices = usePriceMap();
  const agent = useAgent();
  const [tab, setTab] = useState<Tab>("calls");

  const calls = useMemo(() => data.calls.filter((c) => c.caller === handle), [data.calls, handle]);
  const results = useMemo(() => data.results.filter((r) => r.caller === handle), [data.results, handle]);
  const copied = useMemo(() => data.trades.filter((t) => t.caller === handle), [data.trades, handle]);
  const stats = callerStats(results, calls);
  const shown: FeedItem[] = (tab === "calls" ? [...calls, ...results] : tab === "results" ? results : copied).sort((a, b) => itemTime(b) - itemTime(a));
  const lastCall = calls[0];

  // Streak strip: last settled calls as colored squares, oldest to newest.
  const strip = [...results].sort((a, b) => a.deadline - b.deadline).slice(-14);

  const rail = (
    <>
      <RailCard title="Record">
        <div className="space-y-3 px-4 pb-4">
          <Ring value={stats.hitRate} />
          <div className="flex flex-wrap gap-1.5" aria-label="Last settled calls">
            {strip.map((r) => (
              <span
                key={r.id}
                title={`${r.asset} ${pct(r.returnBps)}`}
                className="size-5 rounded-md"
                style={{ background: r.status === "hit" ? "#10b981" : r.status === "miss" ? "#f43f5e" : "#94a3b8" }}
              />
            ))}
            {strip.length === 0 && <p className="text-sm text-slate">No settled calls yet.</p>}
          </div>
        </div>
      </RailCard>
      <Markets prices={prices} />
    </>
  );

  return (
    <Shell session={session} rail={rail}>
      <div className="sticky top-0 z-30 flex items-center gap-4 bg-card/85 px-4 py-2 backdrop-blur">
        <Link href="/dashboard" aria-label="Back" className="rounded-full p-2 hover:bg-paper">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </Link>
        <div>
          <p className="font-display font-bold">{handle}</p>
          <p className="text-xs text-slate">{stats.settled + stats.open} calls tracked</p>
        </div>
      </div>

      <div className="mesh h-36 sm:h-44" style={{ backgroundImage: handleGradient(handle, 120) }} />
      <div className="px-4 sm:px-5">
        <div className="-mt-12 flex items-end justify-between">
          <KolAvatar handle={handle} size={104} ring />
          <div className="flex gap-2 pb-1">
            <a
              href={`https://x.com/${handle}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Open on X"
              className="grid size-10 place-items-center rounded-full border border-rule bg-card hover:bg-paper"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z" />
              </svg>
            </a>
            <FollowButton handle={handle} follows={follows} />
          </div>
        </div>
        <h1 className="font-display mt-3 text-2xl font-bold">{handle}</h1>
        <p className="text-slate">@{handle}</p>
        <p className="mt-2 text-[15px]">Every call priced on Chainlink the minute it was posted, and settled on Arkiv when its window closes.</p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Big label="Hit rate" value={stats.hitRate === null ? null : stats.hitRate * 100} format={(n) => `${Math.round(n)}%`} color="#10b981" />
          <Big label="Median move" value={stats.medianBps} format={(n) => pct(n)} color={stats.medianBps !== null && stats.medianBps < 0 ? "#f43f5e" : "#1d9bf0"} />
          <Big label="Best call" value={stats.best} format={(n) => pct(n)} color="#7c3aed" />
          <Big label="Open now" value={stats.open} format={(n) => String(Math.round(n))} color="#f2a93b" />
        </div>

        {lastCall && (
          <button
            type="button"
            onClick={() => agent.open(`copy @${handle} ${lastCall.direction === "long" ? "buy" : "sell"} $50 ${lastCall.asset} now tp 10% sl 5%`)}
            className="mesh mt-4 w-full rounded-2xl py-3 font-semibold text-white"
            style={{ backgroundImage: "linear-gradient(120deg,#14213d,#7c3aed,#1d9bf0,#14213d)" }}
          >
            Copy latest call · {lastCall.direction.toUpperCase()} {lastCall.asset}
          </button>
        )}
      </div>

      <div className="mt-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "calls", label: "Calls", count: calls.length + results.length },
            { id: "results", label: "Settled", count: results.length },
            { id: "copied", label: "You copied", count: copied.length },
          ]}
        />
      </div>
      {data.loading ? (
        <FeedSkeleton />
      ) : shown.length === 0 ? (
        <p className="px-6 py-16 text-center text-slate">
          {tab === "copied" ? `You haven’t copied @${handle} yet.` : `No calls from @${handle} on Arkiv yet. Tag one of their posts on X with the extension.`}
        </p>
      ) : (
        <div key={tab}>
          {shown.map((item, i) => (
            <FeedPost key={item.id} item={item} prices={prices} i={i} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function Big({ label, value, format, color }: { label: string; value: number | null; format: (n: number) => string; color: string }) {
  return (
    <div className="lift relative overflow-hidden rounded-2xl border border-rule bg-card p-3">
      <div aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <p className="text-xs text-slate">{label}</p>
      <p className="font-display mt-1 text-2xl font-bold tabular-nums" style={{ color }}>
        {value === null ? "—" : <CountUp value={value} format={format} />}
      </p>
    </div>
  );
}

/** Animated ring for the hit rate. */
function Ring({ value }: { value: number | null }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg width="110" height="110" viewBox="0 0 110 110" className="-rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#eef1f6" strokeWidth="10" />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke="url(#ring)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (value ?? 0))}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)" }}
        />
        <defs>
          <linearGradient id="ring" x1="0" x2="1">
            <stop offset="0" stopColor="#10b981" />
            <stop offset="1" stopColor="#1d9bf0" />
          </linearGradient>
        </defs>
      </svg>
      <div>
        <p className="font-display text-3xl font-bold tabular-nums">{value === null ? "—" : <CountUp value={value * 100} format={(n) => `${Math.round(n)}%`} />}</p>
        <p className="text-sm text-slate">of settled calls hit</p>
      </div>
    </div>
  );
}
