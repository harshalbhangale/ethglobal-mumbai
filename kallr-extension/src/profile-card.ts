import { formatBps, MIN_SAMPLE, type SeenCall } from "./card-metrics";
import { el, safeLink } from "./dom";

/** The compact record card on an X profile. Pure DOM: no chrome APIs, so it's testable. */

export const PROFILE_CARD_CSS = `
:host { all: initial; }
.pc { --fg: #0f1419; --mute: #536471; --line: #e6e9ec; --up: #00a86b; --down: #e5484d; --lime: #c6f25a;
  margin: 10px 0 4px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 14px; color: var(--fg);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
:host([data-theme="dark"]) .pc { --fg: #e7e9ea; --mute: #8b98a5; --line: #2f3336; }
.pc-head { display: flex; align-items: center; gap: 8px; }
.pc-mark { width: 16px; height: 16px; border-radius: 4px; background: #0b0d0c; display: grid; place-items: center; flex: none; }
.pc-mark i { width: 7px; height: 7px; border-radius: 2px; background: var(--lime); }
.pc-title { flex: 1; min-width: 0; color: var(--mute); }
.pc-title b { color: var(--fg); }
.pc-follow { font: inherit; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--fg); }
.pc-line { margin: 6px 0 0; color: var(--mute); }
.pc-line b { color: var(--fg); font-variant-numeric: tabular-nums; }
.pc-line b.up { color: var(--up); } .pc-line b.down { color: var(--down); }
.pc-calls { list-style: none; margin: 6px 0 0; padding: 0; }
.pc-calls li { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-top: 1px solid var(--line); font-size: 12.5px; }
.pc-dir { font-weight: 700; }
.pc-tag { color: var(--mute); font-size: 11.5px; }
.pc-gone { color: var(--down); font-size: 11px; }
.pc-res { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.pc-calls a, .pc-foot a { color: var(--mute); text-decoration: none; }
.pc-calls a:hover, .pc-foot a:hover { color: var(--fg); }
.up { color: var(--up); } .down { color: var(--down); }
.pc-foot { margin: 6px 0 0; color: var(--mute); font-size: 11.5px; }
.pc-empty { margin: 6px 0 0; color: var(--mute); }
`;

export type CallerSummary = {
  total: number;
  scored: number;
  hits: number;
  open: number;
  /** Hits / scored, 0–1, or null with nothing scored. */
  hitRate: number | null;
  /** Mean return of scored calls in bps, or null. */
  avgBps: number | null;
};

export function summarize(calls: SeenCall[]): CallerSummary {
  const scored = calls.filter((c) => (c.status === "hit" || c.status === "miss" || c.status === "flat") && c.returnBps !== null);
  const hits = scored.filter((c) => c.status === "hit").length;
  return {
    total: calls.length,
    scored: scored.length,
    hits,
    open: calls.filter((c) => c.status === "open").length,
    hitRate: scored.length ? hits / scored.length : null,
    avgBps: scored.length ? Math.round(scored.reduce((s, c) => s + (c.returnBps ?? 0), 0) / scored.length) : null,
  };
}

const ago = (s: number) => {
  const d = Math.max(0, Date.now() / 1000 - s);
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86_400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86_400)}d`;
};

const ARKIV = "https://rabdi.explorer.arkiv.network";
const toneOf = (n: number | null) => (n === null ? "" : n > 0 ? "up" : n < 0 ? "down" : "");

/** "Long $ETH · 36h … −7.9% ✕  Arkiv ↗  𝕏 ↗" */
function callRow(handle: string, c: SeenCall & { gone?: boolean }) {
  const long = c.direction === "up";
  const res =
    c.status === "open"
      ? el("span", { class: "pc-res pc-tag" }, "open")
      : c.returnBps === null
        ? el("span", { class: "pc-res pc-tag" }, "unpriced")
        : el("span", { class: `pc-res ${toneOf(c.returnBps)}` }, `${formatBps(c.returnBps)} ${c.status === "hit" ? "✓" : c.status === "miss" ? "✕" : "·"}`);
  return el(
    "li",
    {},
    el("span", { class: `pc-dir ${long ? "up" : "down"}` }, `${long ? "Long" : "Short"} $${c.asset}`),
    el("span", { class: "pc-tag" }, ago(c.postedAt)),
    c.gone ? el("span", { class: "pc-gone" }, "deleted on X") : null,
    res,
    c.key ? safeLink(`${ARKIV}/entity/${c.key}`, "Arkiv ↗") : null,
    safeLink(`https://x.com/${handle}/status/${c.postId}`, "𝕏 ↗"),
  );
}

/**
 * Small on purpose: who and Follow, one line of numbers (calls, hit rate, average, deleted), the last
 * three calls with their records on Arkiv, and one footer line.
 */
export function callerCard(opts: {
  handle: string;
  calls: SeenCall[] | null;
  writer?: string | null;
  /** Call posts no longer public on X, out of how many X answered for. */
  deleted?: { count: number; checked: number } | null;
  follow: HTMLElement;
  deskUrl: string;
}) {
  const { handle, calls, writer, deleted, follow, deskUrl } = opts;
  const head = el(
    "div",
    { class: "pc-head" },
    el("span", { class: "pc-mark", "aria-hidden": "true" }, el("i", {})),
    el("span", { class: "pc-title" }, el("b", {}, `@${handle}`), " on Kall"),
    follow,
  );
  if (calls === null) return el("div", { class: "pc" }, head, el("p", { class: "pc-empty" }, "Loading the record from Arkiv…"));
  if (!calls.length)
    return el("div", { class: "pc" }, head, el("p", { class: "pc-empty" }, `No calls by @${handle} scored on Kall yet.`));

  const s = summarize(calls);
  const sorted = [...calls].sort((a, b) => b.postedAt - a.postedAt);
  const line = el("p", { class: "pc-line" }, el("b", {}, String(s.total)), s.total === 1 ? " call" : " calls");
  if (s.hitRate === null) line.append(" · none settled yet");
  else
    line.append(
      " · ",
      el("b", { class: s.hitRate >= 0.5 ? "up" : "down" }, `${Math.round(s.hitRate * 100)}%`),
      " hit · ",
      el("b", { class: toneOf(s.avgBps) }, formatBps(s.avgBps ?? 0)),
      " avg",
    );
  // Call posts the caller deleted from X: still on the record, and counted here.
  if (deleted && deleted.checked) line.append(" · ", el("b", { class: deleted.count ? "down" : "" }, String(deleted.count)), " deleted");
  return el(
    "div",
    { class: "pc" },
    head,
    line,
    el("ul", { class: "pc-calls" }, ...sorted.slice(0, 3).map((c) => callRow(handle, c))),
    el(
      "p",
      { class: "pc-foot" },
      s.scored < MIN_SAMPLE ? "Too few to judge · " : "",
      "Priced at post time · ",
      writer ? safeLink(`${ARKIV}/address/${writer}`, "All on Arkiv ↗") : "Arkiv",
      " · ",
      safeLink(deskUrl, "Open on Kall ↗"),
    ),
  );
}
