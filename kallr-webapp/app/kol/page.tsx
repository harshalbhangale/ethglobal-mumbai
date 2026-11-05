"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentProvider } from "@/components/agent";
import { type Session, WithSession } from "@/components/auth";
import { FeedSkeleton, Markets, pct, Shell, usePriceMap } from "@/components/feed";
import { FollowButton } from "@/components/follow-button";
import { handleGradient, KolAvatar } from "@/components/kol-avatar";
import { LogoMark } from "@/components/logo";
import { normalize } from "@/lib/follows";
import { callerStats, useFollows, useKallrData } from "@/lib/feed";

/** Every caller Kallr has priced, ranked by record, plus the ones you follow. */

export default function CallersPage() {
  return (
    <AgentProvider>
      <WithSession>
        {(s) =>
          s.ready ? (
            <Callers session={s} />
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

function Callers({ session }: { session: Session }) {
  const data = useKallrData(null);
  const follows = useFollows();
  const prices = usePriceMap();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const names = new Set([
      ...data.tracked.map((t) => t.handle),
      ...data.calls.map((c) => c.caller),
      ...data.results.map((r) => r.caller),
      ...follows.entries.map((e) => e.handle),
    ]);
    return [...names]
      .map((h) => ({
        handle: h,
        focus: data.tracked.find((t) => t.handle === h)?.focus ?? null,
        ...callerStats(
          data.results.filter((r) => r.caller === h),
          data.calls.filter((c) => c.caller === h),
        ),
      }))
      .filter((r) => r.handle.includes(q.toLowerCase().replace(/^@/, "")))
      .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.settled - a.settled);
  }, [data.calls, data.results, data.tracked, follows.entries, q]);

  const typed = normalize(q);

  return (
    <Shell session={session} rail={<Markets prices={prices} />}>
      <div className="px-4 pt-5 sm:px-5">
        <h1 className="font-display text-2xl font-bold">Callers</h1>
        <p className="text-sm text-slate">Ranked by how their calls on X actually played out.</p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search or open @handle"
          className="mt-4 w-full rounded-full border border-rule bg-paper px-5 py-3 text-[15px] focus:border-sky focus:outline-none"
        />
        {typed && !rows.some((r) => r.handle === typed) && (
          <Link href={`/kol/${typed}`} className="mt-2 block rounded-xl px-4 py-2 text-sm text-sky hover:bg-sky/5">
            Open @{typed} →
          </Link>
        )}
      </div>
      {data.loading ? (
        <FeedSkeleton />
      ) : (
        <ul className="mt-4 grid gap-3 px-4 pb-6 sm:grid-cols-2 sm:px-5">
          {rows.map((r, i) => (
            <li key={r.handle} className="rise lift overflow-hidden rounded-3xl border border-rule bg-card" style={{ ["--i" as string]: i }}>
              <div className="mesh h-16" style={{ backgroundImage: handleGradient(r.handle, 120) }} />
              <div className="px-4 pb-4">
                <div className="-mt-7 flex items-end justify-between">
                  <Link href={`/kol/${r.handle}`}>
                    <KolAvatar handle={r.handle} size={60} ring />
                  </Link>
                  <FollowButton handle={r.handle} follows={follows} small />
                </div>
                <Link href={`/kol/${r.handle}`} className="mt-2 block font-bold hover:underline">
                  @{r.handle}
                </Link>
                {r.focus && <p className="text-xs text-slate">Tracked by Kallr · {r.focus}</p>}
                <div className="mt-2 flex gap-4 text-sm tabular-nums">
                  <span>
                    <b className="text-up">{r.hitRate === null ? "—" : `${Math.round(r.hitRate * 100)}%`}</b> <span className="text-slate">hit</span>
                  </span>
                  <span>
                    <b className={r.medianBps !== null && r.medianBps < 0 ? "text-down" : "text-sky"}>{r.medianBps === null ? "—" : pct(r.medianBps)}</b>{" "}
                    <span className="text-slate">median</span>
                  </span>
                  <span>
                    <b>{r.open}</b> <span className="text-slate">open</span>
                  </span>
                </div>
              </div>
            </li>
          ))}
          {rows.length === 0 && <p className="col-span-full py-12 text-center text-slate">No callers yet.</p>}
        </ul>
      )}
    </Shell>
  );
}
