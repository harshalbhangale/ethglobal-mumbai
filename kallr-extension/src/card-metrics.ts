/**
 * Statistics for the call card, from the caller's calls this browser has seen and the API scored.
 * Pure functions: no DOM, no chrome APIs. Detected calls are not registered calls, so nothing here
 * assigns a tier; tiers come with server-stored calls.
 */

export type SeenCall = {
  /** The call's read-only record on Arkiv, when it came from there. */
  key?: string;
  postId: string;
  asset: string;
  direction: "up" | "down";
  status: "hit" | "miss" | "flat" | "open" | "unpriced";
  /** Move in the called direction, basis points; + means the call was right. */
  returnBps: number | null;
  postedAt: number;
  expiresAt: number;
};

/** Below this many scored calls, a hit rate says more about luck than skill. */
export const MIN_SAMPLE = 5;

const settled = (calls: SeenCall[]) =>
  calls.filter(
    (c): c is SeenCall & { returnBps: number } =>
      (c.status === "hit" || c.status === "miss" || c.status === "flat") && c.returnBps !== null,
  );

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

export type CallStats = { scored: number; hits: number; open: number; medianBps: number | null };

/** Null when there is nothing to show at all. */
export function callStats(calls: SeenCall[]): CallStats | null {
  const done = settled(calls);
  const open = calls.filter((c) => c.status === "open").length;
  if (!done.length && !open) return null;
  return {
    scored: done.length,
    hits: done.filter((c) => c.status === "hit").length,
    open,
    medianBps: done.length ? median(done.map((c) => c.returnBps)) : null,
  };
}

/** Sum of gains over sum of losses. Null when there are no losing calls to divide by. */
export function profitFactor(calls: SeenCall[]) {
  let gains = 0;
  let losses = 0;
  for (const c of settled(calls)) {
    if (c.returnBps > 0) gains += c.returnBps;
    else losses -= c.returnBps;
  }
  return losses ? gains / losses : null;
}

export function worstCall(calls: SeenCall[]) {
  return settled(calls).reduce<(SeenCall & { returnBps: number }) | null>(
    (worst, c) => (!worst || c.returnBps < worst.returnBps ? c : worst),
    null,
  );
}

export type GroupStats = { asset: string; direction: "up" | "down"; scored: number; hits: number; medianBps: number };

/** Settled calls grouped by asset and direction, most-called first. */
export function byAssetDirection(calls: SeenCall[]): GroupStats[] {
  const groups = new Map<string, Array<SeenCall & { returnBps: number }>>();
  for (const c of settled(calls)) {
    const key = `${c.asset}:${c.direction}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()]
    .map((group) => {
      const first = group[0] as SeenCall;
      return {
        asset: first.asset,
        direction: first.direction,
        scored: group.length,
        hits: group.filter((c) => c.status === "hit").length,
        medianBps: median(group.map((c) => c.returnBps)),
      };
    })
    .sort((a, b) => b.scored - a.scored);
}

export function formatBps(bps: number) {
  return `${bps < 0 ? "−" : "+"}${Math.abs(bps / 100).toFixed(1)}%`;
}

export type Tile = { label: string; value: string; tone?: "good" | "bad" };

/** Big-number tiles: hit rate, median return, profit factor. Empty with nothing scored. */
export function statTiles(calls: SeenCall[]): Tile[] {
  const stats = callStats(calls);
  if (!stats?.scored) return [];
  const tiles: Tile[] = [{ label: "Hit rate", value: `${stats.hits}/${stats.scored}` }];
  if (stats.medianBps !== null)
    tiles.push({
      label: "Median move",
      value: formatBps(stats.medianBps),
      tone: stats.medianBps > 0 ? "good" : stats.medianBps < 0 ? "bad" : undefined,
    });
  const pf = profitFactor(calls);
  if (pf !== null) tiles.push({ label: "Profit factor", value: pf.toFixed(2), tone: pf >= 1 ? "good" : "bad" });
  return tiles;
}

/**
 * Honest caveats shown next to the numbers. Never "looks good": the absence of a caveat is not
 * an endorsement.
 */
export function caveats(calls: SeenCall[]): string[] {
  const stats = callStats(calls);
  const out: string[] = [];
  if (!stats || stats.scored < MIN_SAMPLE)
    out.push(`Only ${stats?.scored ?? 0} scored call${stats?.scored === 1 ? "" : "s"} seen: too few to judge`);
  const worst = worstCall(calls);
  if (worst && worst.returnBps <= -1000) out.push(`Worst call ${formatBps(worst.returnBps)} on $${worst.asset}`);
  if (calls.some((c) => c.status === "unpriced")) out.push("Some calls couldn't be priced at posting time");
  return out;
}
