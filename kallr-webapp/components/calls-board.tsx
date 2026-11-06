"use client";

import { useEffect, useMemo, useState } from "react";
import { FollowButton } from "@/components/follow-button";
import { KolAvatar } from "@/components/kol-avatar";
import { TweetEmbed } from "@/components/tweet-embed";
import { type CallItem, callerStats, copyCall, type ResultItem, type TrackedCaller, useFollows, useKallrData } from "@/lib/feed";

/**
 * The middle of the screen: real posts from callers, each with Kallr's verdict from Arkiv underneath.
 * Following shows the callers you follow; Explore shows every caller Kallr tracks, with Follow buttons.
 * Picking a caller narrows the feed to them with their record on top. Copy call fills the trade ticket.
 */

export type Scope = "following" | "explore";
type Filter = "active" | "settled" | "favorites";
export type Row = (CallItem | ResultItem) & { open: boolean };

const FAV_KEY = "kallr.favoriteCalls";
function useFavorites() {
  const [favs, setFavs] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setFavs(new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as string[]));
    } catch {}
  }, []);
  const toggle = (postId: string) =>
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  return { favs, toggle };
}

const pct = (bps: number) => `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
const usd = (n: number | null) => (n === null ? "unpriced" : `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 0 })}`);
const span = (secs: number) => {
  const m = Math.max(0, Math.round(secs / 60));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export function CallsBoard({
  data,
  follows,
  scope,
  setScope,
  caller,
  setCaller,
  onCopy,
}: {
  data: ReturnType<typeof useKallrData>;
  follows: ReturnType<typeof useFollows>;
  scope: Scope;
  setScope: (s: Scope) => void;
  caller: string | null;
  setCaller: (h: string | null) => void;
  onCopy: (row: Row) => void;
}) {
  const { favs, toggle } = useFavorites();
  const [filter, setFilter] = useState<Filter>("active");

  const all = useMemo<Row[]>(
    () => [...data.calls.map((c) => ({ ...c, open: true })), ...data.results.map((r) => ({ ...r, open: false }))],
    [data.calls, data.results],
  );
  const inScope = (h: string) => (caller ? h === caller : scope === "explore" || follows.handles.has(h));
  const rows = all
    .filter((r) => inScope(r.caller))
    .filter((r) => (filter === "favorites" ? favs.has(r.postId) : filter === "active" ? r.open : !r.open))
    .sort((a, b) => b.postedAt - a.postedAt);
  const count = (f: Filter) => all.filter((r) => inScope(r.caller) && (f === "favorites" ? favs.has(r.postId) : f === "active" ? r.open : !r.open)).length;

  return (
    <div className="min-w-0">
      {caller ? (
        <CallerHeader handle={caller} data={data} follows={follows} onBack={() => setCaller(null)} />
      ) : (
        <div className="mb-4 flex gap-6 border-b border-rule" role="tablist" aria-label="Feed">
          {(["following", "explore"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={`-mb-px border-b-2 pb-3 text-[15px] font-semibold capitalize ${scope === s ? "border-lime text-ink" : "border-transparent text-slate hover:text-ink"}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {!caller && scope === "explore" && <ExploreStrip tracked={data.tracked} data={data} follows={follows} onOpen={setCaller} />}

      <div className="mb-3 flex gap-1">
        {(["active", "settled", "favorites"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${filter === f ? "bg-ink text-paper" : "text-slate hover:text-ink"}`}
          >
            {f === "favorites" ? "★ Favorites" : f} <span className="tabular-nums opacity-70">{count(f)}</span>
          </button>
        ))}
      </div>

      {data.loading ? (
        <p className="py-16 text-center text-sm text-slate">Reading calls from Arkiv…</p>
      ) : rows.length === 0 ? (
        <Empty scope={caller ? "caller" : scope} filter={filter} onExplore={() => setScope("explore")} />
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <PostCard
              key={r.id}
              row={r}
              fav={favs.has(r.postId)}
              onFav={() => toggle(r.postId)}
              onCaller={() => setCaller(r.caller)}
              onCopy={() => onCopy(r)}
            />
          ))}
        </ul>
      )}
      {data.error && <p className="mt-3 text-xs text-down">{data.error}</p>}
    </div>
  );
}

function Empty({ scope, filter, onExplore }: { scope: Scope | "caller"; filter: Filter; onExplore: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-6 py-14 text-center">
      <p className="font-semibold">
        {filter === "favorites" ? "No favorites yet" : scope === "following" ? "Nothing from the callers you follow yet" : "No calls here yet"}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate">
        {filter === "favorites"
          ? "Star a post to keep it here."
          : scope === "following"
            ? "Follow callers from Explore and their calls land here."
            : "New calls arrive as Kallr reads callers' posts on X."}
      </p>
      {scope === "following" && filter !== "favorites" && (
        <button type="button" onClick={onExplore} className="mt-4 rounded-md bg-lime px-4 py-2 text-sm font-semibold text-on-lime hover:bg-lime-strong">
          Explore callers
        </button>
      )}
    </div>
  );
}

function PostCard({ row, fav, onFav, onCaller, onCopy }: { row: Row; fav: boolean; onFav: () => void; onCaller: () => void; onCopy: () => void }) {
  const up = row.direction === "long";
  const result = row.open ? null : (row as ResultItem);
  const copyable = "href" in copyCall(row);
  const now = Date.now() / 1000;
  return (
    <li className="overflow-hidden rounded-lg border border-rule bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <button type="button" onClick={onCaller} className="flex min-w-0 items-center gap-2 text-left">
          <KolAvatar handle={row.caller} size={28} />
          <span className="truncate text-sm font-semibold hover:underline">@{row.caller}</span>
        </button>
        <button
          type="button"
          onClick={onFav}
          aria-pressed={fav}
          aria-label={fav ? "Remove from favorites" : "Add to favorites"}
          className={`text-xl leading-none ${fav ? "text-lime-strong" : "text-rule-strong hover:text-slate"}`}
        >
          {fav ? "★" : "☆"}
        </button>
      </div>
      <div className="px-3 pt-2">
        <TweetEmbed postId={row.postId} handle={row.caller} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule bg-paper/40 px-4 py-3 text-sm">
        <span className="font-semibold">
          <span className={up ? "text-up" : "text-down"}>{up ? "LONG" : "SHORT"}</span> ${row.asset}
        </span>
        <span className="text-slate">Entry {usd(row.entry)}</span>
        {result ? (
          <span className={`font-semibold ${result.status === "hit" ? "text-up" : result.status === "miss" ? "text-down" : "text-slate"}`}>
            {result.status.toUpperCase()} {pct(result.returnBps)} <span className="font-normal text-slate">· exit {usd(result.exit)}</span>
          </span>
        ) : (
          <span className="text-slate">Open · settles in {span(row.deadline - now)}</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <a href={`https://x.com/${row.caller}/status/${row.postId}`} target="_blank" rel="noreferrer" className="text-slate hover:text-ink">
            X ↗
          </a>
          {row.open && copyable && (
            <button type="button" onClick={onCopy} className="rounded-md bg-lime px-3 py-1.5 font-semibold text-on-lime hover:bg-lime-strong">
              Copy call
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className={`font-display text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      <p className="text-xs text-slate">{label}</p>
    </div>
  );
}

function CallerHeader({ handle, data, follows, onBack }: { handle: string; data: ReturnType<typeof useKallrData>; follows: ReturnType<typeof useFollows>; onBack: () => void }) {
  const s = callerStats(
    data.results.filter((r) => r.caller === handle),
    data.calls.filter((c) => c.caller === handle),
  );
  const focus = data.tracked.find((t) => t.handle === handle)?.focus;
  return (
    <div className="mb-4 rounded-lg border border-rule bg-card p-4">
      <button type="button" onClick={onBack} className="text-sm text-slate hover:text-ink">
        ← Back to feed
      </button>
      <div className="mt-3 flex items-center gap-3">
        <KolAvatar handle={handle} size={52} />
        <div className="min-w-0 flex-1">
          <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer" className="font-display text-lg font-semibold hover:underline">
            @{handle}
          </a>
          {focus && <p className="text-sm text-slate">{focus}</p>}
        </div>
        <FollowButton handle={handle} follows={follows} small />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3">
        <Stat label="Hit rate" value={s.hitRate === null ? "—" : `${Math.round(s.hitRate * 100)}%`} tone="text-up" />
        <Stat label="Median" value={s.medianBps === null ? "—" : pct(s.medianBps)} tone={s.medianBps !== null && s.medianBps < 0 ? "text-down" : ""} />
        <Stat label="Settled" value={String(s.settled)} />
        <Stat label="Open" value={String(s.open)} />
      </div>
    </div>
  );
}

function ExploreStrip({ tracked, data, follows, onOpen }: { tracked: TrackedCaller[]; data: ReturnType<typeof useKallrData>; follows: ReturnType<typeof useFollows>; onOpen: (h: string) => void }) {
  if (!tracked.length) return null;
  return (
    <div className="-mx-1 mb-4 flex gap-3 overflow-x-auto px-1 pb-1">
      {tracked.map((t) => {
        const s = callerStats(
          data.results.filter((r) => r.caller === t.handle),
          data.calls.filter((c) => c.caller === t.handle),
        );
        return (
          <div key={t.handle} className="w-44 shrink-0 rounded-lg border border-rule bg-card p-3">
            <button type="button" onClick={() => onOpen(t.handle)} className="flex w-full items-center gap-2 text-left">
              <KolAvatar handle={t.handle} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">@{t.handle}</span>
                <span className="block text-xs text-slate tabular-nums">
                  {s.hitRate === null ? "No record yet" : `${Math.round(s.hitRate * 100)}% hit · ${s.settled}`}
                </span>
              </span>
            </button>
            <div className="mt-2">
              <FollowButton handle={t.handle} follows={follows} small />
            </div>
          </div>
        );
      })}
    </div>
  );
}
