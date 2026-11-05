"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { AgentProvider, useAgent } from "@/components/agent";
import { type Session, WithSession } from "@/components/auth";
import { CountUp, FeedPost, FeedSkeleton, Markets, pct, RailCard, Shell, Tabs, usePriceMap, WalletCard } from "@/components/feed";
import { FollowButton } from "@/components/follow-button";
import { KolAvatar } from "@/components/kol-avatar";
import { LogoMark } from "@/components/logo";
import { SourceIcon } from "@/components/trade-icons";
import { callerStats, type FeedItem, itemTime, useFollows, useKallrData } from "@/lib/feed";

/**
 * Home: an X-style timeline of calls from the callers you follow, how earlier calls settled,
 * and every trade you copied, tagged by where you copied it (extension on X, keyboard, desk).
 * Readable before sign-in; your own trades and wallet appear once you sign in.
 */

type Tab = "all" | "following" | "x" | "keyboard";

export default function DashboardPage() {
  return (
    <AgentProvider>
      <WithSession>
        {(s) =>
          s.ready ? (
            <Home session={s} />
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

function Home({ session }: { session: Session }) {
  const data = useKallrData(session.authenticated ? session.address : null);
  const follows = useFollows();
  const prices = usePriceMap();
  const [tab, setTab] = useState<Tab>("all");
  const agent = useAgent();

  const all = useMemo<FeedItem[]>(
    () => [...data.calls, ...data.results, ...data.trades].sort((a, b) => itemTime(b) - itemTime(a)),
    [data.calls, data.results, data.trades],
  );
  const shown = useMemo(() => {
    if (tab === "x") return data.trades.filter((t) => t.source === "extension");
    if (tab === "keyboard") return data.trades.filter((t) => t.source === "keyboard");
    if (tab === "following")
      return all.filter((i) => (i.kind === "trade" ? Boolean(i.caller && follows.handles.has(i.caller)) : follows.handles.has(i.caller)));
    return all;
  }, [tab, all, data.trades, follows.handles]);

  const counts = {
    x: data.trades.filter((t) => t.source === "extension").length,
    keyboard: data.trades.filter((t) => t.source === "keyboard").length,
  };

  const callers = useMemo(() => {
    const names = new Set([...data.calls.map((c) => c.caller), ...data.results.map((r) => r.caller)]);
    return [...names]
      .map((h) => ({
        handle: h,
        ...callerStats(
          data.results.filter((r) => r.caller === h),
          data.calls.filter((c) => c.caller === h),
        ),
      }))
      .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.settled - a.settled)
      .slice(0, 5);
  }, [data.calls, data.results]);

  const rail = (
    <>
      {session.authenticated && session.address ? (
        <WalletCard address={session.address} embedded={session.embedded} />
      ) : (
        <div className="mesh rounded-3xl p-5 text-white" style={{ backgroundImage: "linear-gradient(135deg,#14213d,#3b2f6b,#7c3aed,#14213d)" }}>
          <p className="font-display text-xl font-semibold">Your wallet lives here</p>
          <p className="mt-1 text-sm text-white/75">Sign in with X to get a wallet on Base and see your copied trades.</p>
        </div>
      )}
      <Markets prices={prices} />
      <RailCard
        title="Top callers"
        action={
          <Link href="/kol" className="text-sm text-sky hover:underline">
            All
          </Link>
        }
      >
        <ul className="pb-2">
          {callers.map((c) => (
            <li key={c.handle} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper/60">
              <Link href={`/kol/${c.handle}`}>
                <KolAvatar handle={c.handle} size={40} />
              </Link>
              <Link href={`/kol/${c.handle}`} className="min-w-0 flex-1">
                <p className="truncate font-bold hover:underline">{c.handle}</p>
                <p className="text-xs text-slate tabular-nums">
                  {c.hitRate === null ? "No settled calls" : `${Math.round(c.hitRate * 100)}% hit${c.medianBps === null ? "" : ` · ${pct(c.medianBps)}`}`}
                </p>
              </Link>
              <FollowButton handle={c.handle} follows={follows} small />
            </li>
          ))}
          {callers.length === 0 && <p className="px-4 pb-3 text-sm text-slate">No callers on Arkiv yet.</p>}
        </ul>
      </RailCard>
    </>
  );

  return (
    <Shell session={session} rail={rail}>
      <div className="px-4 pt-5 sm:px-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{session.handle ? `gm, @${session.handle}` : "Home"}</h1>
            <p className="text-sm text-slate">Calls from X, and every trade you copied from them.</p>
          </div>
          {data.usingSample && <span className="shrink-0 rounded-full bg-amber/20 px-2.5 py-1 text-xs font-semibold">Sample data</span>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Copied from X" value={counts.x} color="#0f1419" icon={<SourceIcon source="extension" size={30} />} />
          <Stat label="From keyboard" value={counts.keyboard} color="#7c3aed" icon={<SourceIcon source="keyboard" size={30} />} />
          <Stat label="Open calls" value={data.calls.length} color="#1d9bf0" icon={<Dot color="#1d9bf0" />} />
          <Stat label="Following" value={follows.entries.length} color="#f2a93b" icon={<Dot color="#f2a93b" />} />
        </div>

        <button
          type="button"
          onClick={() => agent.open()}
          className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-rule bg-card px-4 py-3 text-left text-slate transition-colors hover:border-violet"
        >
          <KolAvatar handle={session.handle ?? "you"} size={36} />
          <span className="min-w-0 flex-1 truncate">Schedule a trade… “buy $50 ETH tomorrow 9am”</span>
          <span className="rounded-full bg-violet px-3 py-1 text-xs font-semibold text-white">Agent</span>
        </button>
      </div>

      <div className="mt-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "all", label: "For you" },
            { id: "following", label: "Following" },
            { id: "x", label: "From X", count: counts.x },
            { id: "keyboard", label: "Keyboard", count: counts.keyboard },
          ]}
        />
      </div>

      {data.error && <p className="border-b border-rule px-5 py-3 text-sm text-down">{data.error}</p>}
      {data.loading ? (
        <FeedSkeleton />
      ) : shown.length === 0 ? (
        <Empty tab={tab} />
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

function Dot({ color }: { color: string }) {
  return (
    <span className="grid size-[30px] place-items-center rounded-full" style={{ background: `${color}22` }}>
      <span className="live-dot" style={{ color }} />
    </span>
  );
}

function Stat({ label, value, color, icon }: { label: string; value: number; color: string; icon: ReactNode }) {
  return (
    <div className="lift relative overflow-hidden rounded-2xl border border-rule bg-card p-3">
      <div aria-hidden className="absolute -top-6 -right-6 size-20 rounded-full opacity-20 blur-md" style={{ background: color }} />
      {icon}
      <p className="font-display mt-2 text-2xl font-bold tabular-nums">
        <CountUp value={value} />
      </p>
      <p className="text-xs text-slate">{label}</p>
    </div>
  );
}

function Empty({ tab }: { tab: Tab }) {
  const text = {
    all: "Nothing on Arkiv yet. Tag a call on X or copy one from the keyboard.",
    following: "Follow a caller from their profile or from X, and their calls land here.",
    x: "Trades you copy with the extension on X show up here.",
    keyboard: "Trades you copy from the Kallr keyboard show up here.",
  }[tab];
  return (
    <div className="px-6 py-16 text-center">
      <div className="flex justify-center gap-2">
        <SourceIcon source="extension" size={36} />
        <SourceIcon source="keyboard" size={36} />
        <SourceIcon source="desk" size={36} />
      </div>
      <p className="mx-auto mt-4 max-w-xs text-slate">{text}</p>
      {tab === "following" && (
        <Link href="/kol" className="mt-4 inline-block rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white">
          Find callers
        </Link>
      )}
    </div>
  );
}
