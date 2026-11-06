"use client";

import { useMemo, useState } from "react";
import { FollowButton } from "@/components/follow-button";
import { KolAvatar } from "@/components/kol-avatar";
import { TweetEmbed } from "@/components/tweet-embed";
import { useUsdPrices } from "@/components/order-desk";
import { type CallItem, callerStats, copyCall, type ResultItem, useFollows, useKallrData } from "@/lib/feed";

/**
 * The middle of the screen: real posts from callers, each with Kallr's verdict from Arkiv underneath.
 * All shows every caller Kallr tracks; Following narrows it to the callers you follow (picked in the sidebar).
 * Picking a caller narrows the feed to them with their record on top. Copy call fills the trade ticket.
 */

export type Scope = "following" | "explore";
type Filter = "active" | "settled";
export type Row = (CallItem | ResultItem) & { open: boolean };

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
  const prices = useUsdPrices();
  const recordOf = (h: string) => {
    const s = callerStats(
      data.results.filter((r) => r.caller === h),
      data.calls.filter((c) => c.caller === h),
    );
    return s.hitRate === null ? "No record yet" : `${Math.round(s.hitRate * 100)}% hit · ${s.settled} settled`;
  };
  const [filter, setFilter] = useState<Filter>("active");

  const all = useMemo<Row[]>(
    () => [...data.calls.map((c) => ({ ...c, open: true })), ...data.results.map((r) => ({ ...r, open: false }))],
    [data.calls, data.results],
  );
  const inScope = (h: string) => (caller ? h === caller : scope === "explore" || follows.handles.has(h));
  const rows = all
    .filter((r) => inScope(r.caller))
    .filter((r) => (filter === "active" ? r.open : !r.open))
    .sort((a, b) => b.postedAt - a.postedAt);
  const count = (f: Filter) => all.filter((r) => inScope(r.caller) && (f === "active" ? r.open : !r.open)).length;

  return (
    <div className="min-w-0">
      {caller ? (
        <CallerHeader handle={caller} data={data} follows={follows} onBack={() => setCaller(null)} />
      ) : (
        <div className="mb-1 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">Feed</h1>
            <p className="text-sm text-slate">Calls from X, checked against Chainlink prices and kept on Arkiv.</p>
          </div>
          <div role="group" aria-label="Whose calls" className="inline-flex shrink-0 rounded-md border border-rule p-0.5 text-sm">
            {(["explore", "following"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={`rounded px-3 py-1 font-semibold ${scope === s ? "bg-ink text-paper" : "text-slate hover:text-ink"}`}
              >
                {s === "explore" ? "All" : "Following"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sticky top-0 z-10 -mx-1 mb-4 flex gap-5 border-b border-rule bg-paper/95 px-1 pt-3 backdrop-blur" role="tablist" aria-label="Calls">
        {(["active", "settled"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`-mb-px border-b-2 pb-2.5 text-sm font-semibold ${filter === f ? "border-lime text-ink" : "border-transparent text-slate hover:text-ink"}`}
          >
            {f === "active" ? "Live" : "Settled"}
            <span className="ml-1.5 rounded bg-card px-1.5 py-0.5 text-xs tabular-nums text-slate">{count(f)}</span>
          </button>
        ))}
      </div>

      {data.loading ? (
        <p className="py-16 text-center text-sm text-slate">Reading calls from Arkiv…</p>
      ) : rows.length === 0 ? (
        <Empty scope={caller ? "caller" : scope} onExplore={() => setScope("explore")} />
      ) : (
        <ul className="space-y-5">
          {rows.map((r) => (
            <PostCard
              key={r.id}
              row={r}
              onCaller={() => setCaller(r.caller)}
              onCopy={() => onCopy(r)}
              record={recordOf(r.caller)}
              live={prices[r.asset as "ETH" | "BTC"] ?? null}
              arkiv={"sample" in r && r.sample ? null : `${data.explorer}/entity/${r.id}`}
            />
          ))}
        </ul>
      )}
      {data.error && <p className="mt-3 text-xs text-down">{data.error}</p>}
    </div>
  );
}

function Empty({ scope, onExplore }: { scope: Scope | "caller"; onExplore: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-6 py-14 text-center">
      <p className="font-semibold">
        {scope === "following" ? "Nothing from the callers you follow yet" : "No calls here yet"}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate">
        {scope === "following"
          ? "Follow callers from the list on the left and their calls land here."
          : "New calls arrive as Kall Markets reads callers' posts on X."}
      </p>
      {scope === "following" && (
        <button type="button" onClick={onExplore} className="mt-4 rounded-md bg-lime px-4 py-2 text-sm font-semibold text-on-lime hover:bg-lime-strong">
          Show all calls
        </button>
      )}
    </div>
  );
}

function PostCard({
  row,
  onCaller,
  onCopy,
  record,
  live,
  arkiv,
}: {
  row: Row;
  onCaller: () => void;
  onCopy: () => void;
  record: string;
  live: number | null;
  /** This call's read-only record on Arkiv; null for sample calls. */
  arkiv: string | null;
}) {
  const up = row.direction === "long";
  const result = row.open ? null : (row as ResultItem);
  const copyable = "href" in copyCall(row);
  const now = Date.now() / 1000;
  // Move since the call, signed so that green means the call is working.
  const move = row.open && live && row.entry ? ((live - row.entry) / row.entry) * (up ? 1 : -1) * 100 : null;
  const elapsed = row.open ? Math.min(1, Math.max(0, (now - row.postedAt) / Math.max(1, row.deadline - row.postedAt))) : 1;
  const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-slate");
  return (
    <li className="overflow-hidden rounded-xl border border-rule bg-card transition-colors hover:border-rule-strong">
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <button type="button" onClick={onCaller} className="flex min-w-0 items-center gap-2.5 text-left">
          <KolAvatar handle={row.caller} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold hover:underline">@{row.caller}</span>
            <span className="block text-xs text-slate tabular-nums">
              {record} · {span(now - row.postedAt)} ago
            </span>
          </span>
        </button>
        <span
          className={`ml-auto shrink-0 rounded-md px-2 py-1 text-xs font-bold tracking-wide ${up ? "bg-up/15 text-up" : "bg-down/15 text-down"}`}
        >
          {up ? "▲ LONG" : "▼ SHORT"} ${row.asset}
        </span>
      </div>

      <div className="px-3">
        <TweetEmbed postId={row.postId} handle={row.caller} />
      </div>

      <div className="mt-3 border-t border-rule bg-paper/40">
        {row.open && (
          <div className="h-0.5 bg-rule" title={`${Math.round(elapsed * 100)}% of the call's window has passed`}>
            <div className="h-full bg-lime/70" style={{ width: `${elapsed * 100}%` }} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
          <Metric label="Entry" value={usd(row.entry)} />
          {result ? (
            <>
              <Metric label="Exit" value={usd(result.exit)} />
              <Metric
                label="Result"
                value={`${result.status.toUpperCase()} ${pct(result.returnBps)}`}
                tone={result.status === "hit" ? "text-up" : result.status === "miss" ? "text-down" : "text-slate"}
              />
            </>
          ) : (
            <>
              <Metric label="Now" value={live ? usd(live) : "…"} />
              <Metric label="Since call" value={move === null ? "—" : `${move >= 0 ? "+" : ""}${move.toFixed(2)}%`} tone={move === null ? "" : tone(move)} />
              <Metric label="Settles in" value={span(row.deadline - now)} />
            </>
          )}
          <span className="ml-auto flex items-center gap-2">
            {arkiv && (
              <a
                href={arkiv}
                target="_blank"
                rel="noreferrer"
                title="This call's record on Arkiv"
                className="rounded-md border border-rule px-2.5 py-1.5 text-xs font-semibold text-slate hover:border-lime hover:text-lime"
              >
                Arkiv ↗
              </a>
            )}
            <a
              href={`https://x.com/${row.caller}/status/${row.postId}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Open on X"
              className="grid size-8 place-items-center rounded-md border border-rule text-slate hover:border-ink hover:text-ink"
            >
              𝕏
            </a>
            {row.open && copyable && (
              <button type="button" onClick={onCopy} className="rounded-md bg-lime px-4 py-1.5 font-semibold text-on-lime hover:bg-lime-strong">
                Copy call
              </button>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-[11px] uppercase tracking-wider text-slate">{label}</span>
      <span className={`block font-semibold tabular-nums ${tone ?? ""}`}>{value}</span>
    </span>
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
