"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { KolAvatar } from "@/components/kol-avatar";
import { type CallItem, copyCall, type ResultItem, useFollows, useKallrData } from "@/lib/feed";

/**
 * Calls from the callers you follow and the ones Kallr tracks, read from Arkiv: what each post said,
 * whether it is still running or how it ended, with a star to keep the ones you care about.
 */

type Filter = "active" | "settled" | "favorites";
type Row = (CallItem | ResultItem) & { open: boolean };

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
const ago = (s: number) => {
  const m = Math.max(0, Math.round((Date.now() / 1000 - s) / 60));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

const left = (deadline: number) => {
  const m = Math.max(0, Math.round((deadline - Date.now() / 1000) / 60));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export function CallsBoard() {
  const data = useKallrData(null);
  const follows = useFollows();
  const { favs, toggle } = useFavorites();
  const [filter, setFilter] = useState<Filter>("active");
  const [onlyFollowing, setOnlyFollowing] = useState(false);

  const rows = useMemo(() => {
    const all: Row[] = [...data.calls.map((c) => ({ ...c, open: true })), ...data.results.map((r) => ({ ...r, open: false }))];
    return all
      .filter((r) => !onlyFollowing || follows.handles.has(r.caller))
      .filter((r) => (filter === "favorites" ? favs.has(r.postId) : filter === "active" ? r.open : !r.open))
      .sort((a, b) => b.postedAt - a.postedAt);
  }, [data.calls, data.results, filter, favs, onlyFollowing, follows.handles]);

  const count = (f: Filter) =>
    f === "favorites" ? favs.size : f === "active" ? data.calls.length : data.results.length;

  return (
    <section className="rounded-lg border border-rule bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="flex gap-1" role="tablist" aria-label="Calls">
          {(["active", "settled", "favorites"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${filter === f ? "bg-ink text-paper" : "text-slate hover:text-ink"}`}
            >
              {f === "favorites" ? "★ Favorites" : f} <span className="tabular-nums opacity-70">{count(f)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate">
          <input type="checkbox" checked={onlyFollowing} onChange={(e) => setOnlyFollowing(e.target.checked)} />
          Only callers I follow
        </label>
      </div>

      {data.loading ? (
        <p className="px-4 py-10 text-center text-sm text-slate">Reading calls from Arkiv…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate">
          {filter === "favorites"
            ? "Star a call to keep it here."
            : filter === "active"
              ? "No open calls right now. New ones arrive as Kallr reads callers' posts on X."
              : "No settled calls yet."}
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((r) => (
            <CallRow key={r.id} row={r} fav={favs.has(r.postId)} onFav={() => toggle(r.postId)} />
          ))}
        </ul>
      )}
      {data.error && <p className="border-t border-rule px-4 py-2 text-xs text-down">{data.error}</p>}
    </section>
  );
}

function CallRow({ row, fav, onFav }: { row: Row; fav: boolean; onFav: () => void }) {
  const up = row.direction === "long";
  const result = row.open ? null : (row as ResultItem);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Link href={`/kol/${row.caller}`} className="shrink-0">
        <KolAvatar handle={row.caller} size={36} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <Link href={`/kol/${row.caller}`} className="font-semibold hover:underline">
            @{row.caller}
          </Link>{" "}
          <span className="text-slate">· {ago(row.postedAt)}</span>
        </p>
        <p className="mt-0.5">
          <span className={`font-semibold ${up ? "text-up" : "text-down"}`}>{up ? "Long" : "Short"}</span> ${row.asset}{" "}
          <span className="text-slate">from {usd(row.entry)}</span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm">
          {result ? (
            <span className={result.status === "hit" ? "text-up" : result.status === "miss" ? "text-down" : "text-slate"}>
              {result.status === "hit" ? "Hit" : result.status === "miss" ? "Miss" : "Flat"} {pct(result.returnBps)} · exit {usd(result.exit)}
            </span>
          ) : (
            <span className="text-slate">Open · settles in {left(row.deadline)}</span>
          )}
          <a href={`https://x.com/${row.caller}/status/${row.postId}`} target="_blank" rel="noreferrer" className="text-slate hover:text-ink">
            Post on X ↗
          </a>
          {row.open && <CopyLink row={row} />}
        </p>
      </div>
      <button
        type="button"
        onClick={onFav}
        aria-pressed={fav}
        aria-label={fav ? "Remove from favorites" : "Add to favorites"}
        className={`text-xl leading-none ${fav ? "text-lime-strong" : "text-rule-strong hover:text-slate"}`}
      >
        {fav ? "★" : "☆"}
      </button>
    </li>
  );
}

function CopyLink({ row }: { row: Row }) {
  const r = copyCall(row);
  return "href" in r ? (
    <Link href={r.href} className="font-semibold hover:underline">
      Copy call
    </Link>
  ) : (
    <span className="text-slate" title={r.reason}>
      Can't copy here
    </span>
  );
}
