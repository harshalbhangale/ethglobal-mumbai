/**
 * The callers the Kall Keyboard's Following tab lists: everyone Kall Markets tracks plus anyone whose
 * call it has priced, each with their record. Same math as the web's callerStats (lib/feed.ts), which
 * is browser-only.
 */

export type RosterEntry = { handle: string; focus: string | null };
export type CallRow = { caller: string; postedAt: number | null };
export type ResultRow = { caller: string; status: string; returnBps: number | null };

export type CallerRow = {
  handle: string;
  focus: string | null;
  /** On Kall Markets' tracked roster (Arkiv), not just seen once. */
  tracked: boolean;
  open: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  medianBps: number | null;
  lastCallAt: number | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function callerRows(roster: RosterEntry[], calls: CallRow[], results: ResultRow[]): CallerRow[] {
  const handles = new Map<string, string | null>();
  for (const r of roster) handles.set(r.handle.toLowerCase(), r.focus);
  for (const c of [...calls, ...results]) if (!handles.has(c.caller.toLowerCase())) handles.set(c.caller.toLowerCase(), null);
  const tracked = new Set(roster.map((r) => r.handle.toLowerCase()));

  return [...handles.entries()]
    .map(([handle, focus]) => {
      const mine = results.filter((r) => r.caller.toLowerCase() === handle);
      const open = calls.filter((c) => c.caller.toLowerCase() === handle);
      const hits = mine.filter((r) => r.status === "hit").length;
      const last = open.map((c) => c.postedAt ?? 0).reduce((a, b) => Math.max(a, b), 0);
      return {
        handle,
        focus,
        tracked: tracked.has(handle),
        open: open.length,
        settled: mine.length,
        hits,
        hitRate: mine.length ? hits / mine.length : null,
        medianBps: median(mine.map((r) => r.returnBps ?? 0)),
        lastCallAt: last || null,
      };
    })
    .sort((a, b) => b.open - a.open || b.settled - a.settled || Number(b.tracked) - Number(a.tracked) || a.handle.localeCompare(b.handle));
}

/** A post's text from its Swarm snapshot, trimmed for a keyboard card. */
export function snapshotExcerpt(snapshot: unknown, max = 280): string | null {
  const text = (snapshot as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || !text.trim()) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
