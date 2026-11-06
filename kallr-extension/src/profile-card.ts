import { formatBps, MIN_SAMPLE, type SeenCall } from "./card-metrics";
import { el, safeLink } from "./dom";

/** The compact record card on an X profile. Pure DOM: no chrome APIs, so it's testable. */

export const PROFILE_CARD_CSS = `
:host { all: initial; }
.pc { --fg: #0f1419; --mute: #536471; --line: #e6e9ec; --tile: #f7f9f9; --up: #00a86b; --down: #e5484d; --lime: #c6f25a;
  margin: 12px 0 4px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 16px; color: var(--fg);
  font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
:host([data-theme="dark"]) .pc { --fg: #e7e9ea; --mute: #8b98a5; --line: #2f3336; --tile: #16181c; }
.pc-head { display: flex; align-items: center; gap: 8px; }
.pc-mark { width: 18px; height: 18px; border-radius: 5px; background: #0b0d0c; display: grid; place-items: center; flex: none; }
.pc-mark i { width: 8px; height: 8px; border-radius: 2px; background: var(--lime); }
.pc-title { font-weight: 700; flex: 1; min-width: 0; }
.pc-title span { color: var(--mute); font-weight: 400; }
.pc-follow { font: inherit; font-weight: 700; padding: 4px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--fg); }
.pc-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
.pc-stat { background: var(--tile); border-radius: 10px; padding: 7px 9px; }
.pc-stat b { display: block; font-size: 16px; font-variant-numeric: tabular-nums; }
.pc-stat small { color: var(--mute); font-size: 11px; }
.pc-calls { list-style: none; margin: 10px 0 0; padding: 0; }
.pc-calls li { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); }
.pc-calls li:first-child { border-top: 0; }
.pc-dir { font-weight: 700; min-width: 74px; }
.pc-res { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; }
.pc-tag { font-size: 11px; color: var(--mute); }
.pc-calls a { color: var(--mute); text-decoration: none; }
.up { color: var(--up); } .down { color: var(--down); }
.pc-foot { margin-top: 8px; color: var(--mute); font-size: 11.5px; }
.pc-foot a { color: var(--mute); }
.pc-empty { margin-top: 10px; color: var(--mute); }
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

const stat = (value: string, label: string, tone = "") => el("div", { class: "pc-stat" }, el("b", { class: tone }, value), el("small", {}, label));

function callRow(handle: string, c: SeenCall) {
  const long = c.direction === "up";
  const res =
    c.status === "open"
      ? el("span", { class: "pc-res pc-tag" }, "open")
      : c.returnBps === null
        ? el("span", { class: "pc-res pc-tag" }, "unpriced")
        : el("span", { class: `pc-res ${c.returnBps >= 0 ? "up" : "down"}` }, `${formatBps(c.returnBps)} ${c.status === "hit" ? "✓" : c.status === "miss" ? "✕" : "·"}`);
  return el(
    "li",
    {},
    el("span", { class: `pc-dir ${long ? "up" : "down"}` }, `${long ? "Long" : "Short"} $${c.asset}`),
    el("span", { class: "pc-tag" }, ago(c.postedAt)),
    res,
    safeLink(`https://x.com/${handle}/status/${c.postId}`, "↗"),
  );
}

/**
 * Header (who, Follow), four numbers (calls, hit rate, avg return, open), the last three calls, and one
 * line saying how it's measured and where it's stored. Nothing else.
 */
export function callerCard(opts: {
  handle: string;
  calls: SeenCall[] | null;
  writer?: string | null;
  follow: HTMLElement;
  deskUrl: string;
}) {
  const { handle, calls, writer, follow, deskUrl } = opts;
  const head = el(
    "div",
    { class: "pc-head" },
    el("span", { class: "pc-mark", "aria-hidden": "true" }, el("i", {})),
    el("span", { class: "pc-title" }, "Kall record ", el("span", {}, `@${handle}`)),
    follow,
  );
  if (calls === null) return el("div", { class: "pc" }, head, el("p", { class: "pc-empty" }, "Loading the record from Arkiv…"));
  if (!calls.length)
    return el("div", { class: "pc" }, head, el("p", { class: "pc-empty" }, `No calls by @${handle} scored on Kall yet.`));

  const s = summarize(calls);
  const sorted = [...calls].sort((a, b) => b.postedAt - a.postedAt);
  const rate = s.hitRate === null ? "—" : `${Math.round(s.hitRate * 100)}%`;
  const avg = s.avgBps === null ? "—" : formatBps(s.avgBps);
  return el(
    "div",
    { class: "pc" },
    head,
    el(
      "div",
      { class: "pc-stats" },
      stat(String(s.total), "calls"),
      stat(rate, s.scored ? `hit rate · ${s.hits}/${s.scored}` : "hit rate", s.hitRate === null ? "" : s.hitRate >= 0.5 ? "up" : "down"),
      stat(avg, "avg return", s.avgBps === null ? "" : s.avgBps >= 0 ? "up" : "down"),
      stat(String(s.open), "open"),
    ),
    el("ul", { class: "pc-calls" }, ...sorted.slice(0, 3).map((c) => callRow(handle, c))),
    el(
      "p",
      { class: "pc-foot" },
      s.scored < MIN_SAMPLE ? `${s.scored} scored, too few to judge · ` : "",
      "Priced at post time · ",
      writer ? safeLink(`https://rabdi.explorer.arkiv.network/address/${writer}`, "Arkiv ↗") : "Arkiv",
      " · ",
      safeLink(deskUrl, "Open on Kall ↗"),
    ),
  );
}
