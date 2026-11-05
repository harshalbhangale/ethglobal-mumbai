import { byAssetDirection, callStats, formatBps, MIN_SAMPLE, profitFactor, type SeenCall, worstCall } from "./card-metrics";
import { el, metricPanel } from "./dom";

export const RECORD_GROUP = "Seen on X · priced from post time";

/**
 * A caller's record in Xtrading's metric style: stat tiles for what was seen, rows for caveats, and
 * a "No data" dropdown for anything that can't be computed yet. Covers only calls this browser saw.
 */
export function recordPanel(calls: SeenCall[]) {
  const panel = metricPanel();
  const stats = callStats(calls);
  const scored = stats?.scored ?? 0;
  const group = RECORD_GROUP;

  panel.set("detected", { label: "Detected calls", value: String(calls.length), kind: "stat", group });
  panel.set(
    "hits",
    scored
      ? { label: "Moved their way", value: `${stats?.hits}/${scored}`, kind: "stat", group }
      : { label: "Moved their way", value: null, reason: stats?.open ? `${stats.open} still open` : "none scored yet" },
  );
  const median = stats?.medianBps ?? null;
  panel.set(
    "median",
    median === null
      ? { label: "Median since post", value: null, reason: "none scored yet" }
      : {
          label: "Median since post",
          value: formatBps(median),
          kind: "stat",
          group,
          tone: median > 0 ? "good" : median < 0 ? "bad" : undefined,
        },
  );
  const up = calls.filter((c) => c.direction === "up").length;
  if (calls.length) {
    panel.set("up", { label: "Bullish", value: String(up), kind: "stat", group });
    panel.set("down", { label: "Bearish", value: String(calls.length - up), kind: "stat", group });
  }
  const pf = profitFactor(calls);
  panel.set(
    "pf",
    pf === null
      ? { label: "Profit factor", value: null, reason: scored ? "no losing calls yet" : "none scored yet" }
      : { label: "Profit factor", value: pf.toFixed(2), kind: "row", group }
  );
  const worst = worstCall(calls);
  if (worst && worst.returnBps < 0)
    panel.set("worst", {
      label: "Worst call",
      value: el("span", { class: "down" }, `${formatBps(worst.returnBps)} on $${worst.asset}`),
      kind: "row",
      group,
    });
  if (scored < MIN_SAMPLE)
    panel.set("sample", {
      label: "Sample",
      value: `${scored} scored · too few to judge`,
      kind: "row",
      group,
    });
  if (calls.some((c) => c.status === "unpriced"))
    panel.set("unpriced", { label: "Unpriced", value: null, reason: "no price at posting time for some calls" });
  return panel.root;
}

/** Hit rate and median by asset and direction, for "Show details". */
export function breakdown(calls: SeenCall[]) {
  const groups = byAssetDirection(calls);
  if (!groups.length) return el("p", { class: "note" }, "Nothing scored yet to break down.");
  const panel = metricPanel();
  groups.forEach((g, i) =>
    panel.set(`g${i}`, {
      label: `$${g.asset} ${g.direction === "up" ? "bullish" : "bearish"}`,
      value: el(
        "span",
        {},
        `${g.hits}/${g.scored} moved their way · median `,
        el("span", { class: g.medianBps >= 0 ? "up" : "down" }, formatBps(g.medianBps)),
      ),
      kind: "row",
      group: "By asset",
    }),
  );
  return panel.root;
}
