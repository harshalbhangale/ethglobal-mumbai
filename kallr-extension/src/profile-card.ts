import { formatBps, MIN_SAMPLE, type SeenCall } from "./card-metrics";
import { brandMark, el, safeLink } from "./dom";
import { tokenIcon } from "./logos";

/** The compact record card on an X profile. Pure DOM: no chrome APIs, so it's testable. */

export const PROFILE_CARD_CSS = `
:host { all: initial; }
.pc { --fg: #0f1419; --mute: #536471; --line: #e6e9ec; --up: #00a86b; --down: #e5484d; --lime: #c6f25a;
  margin: 10px 0 4px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 14px; color: var(--fg);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
:host([data-theme="dark"]) .pc { --fg: #e7e9ea; --mute: #8b98a5; --line: #2f3336; }
.pc-head { display: flex; align-items: center; gap: 8px; }
.brand-mark-glyph { display: inline-block; flex: none; background-color: #0e1407;
  -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center; }
:host([data-theme="dark"]) .brand-mark-glyph { background-color: var(--lime); }
.pc-title { flex: 1; min-width: 0; color: var(--mute); }
.pc-title b { color: var(--fg); }
.pc-follow { font: inherit; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--fg); }
.pc-line { margin: 6px 0 0; color: var(--mute); }
.pc-line b { color: var(--fg); font-variant-numeric: tabular-nums; }
.pc-line b.up { color: var(--up); } .pc-line b.down { color: var(--down); }
.pc-group { margin: 8px 0 0; color: var(--mute); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.pc-calls { list-style: none; margin: 2px 0 0; padding: 0; }
/* One grid for every row: the call takes the room, result and links have fixed columns, so they line up. */
.pc-calls li { display: grid; grid-template-columns: minmax(0, 1fr) 76px 50px 26px; align-items: center; column-gap: 10px;
  padding: 5px 0; border-top: 1px solid var(--line); font-size: 12.5px; line-height: 1.3; }
.pc-calls li:first-child { border-top: 0; }
.pc-call { min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; }
.pc-call > span:last-child { overflow: hidden; text-overflow: ellipsis; }
.pc-coin { width: 18px; height: 18px; border-radius: 50%; flex: none; display: inline-grid; place-items: center; color: #fff; font-size: 10px; font-weight: 700; }
.pc-dir { font-weight: 700; }
.pc-tag { color: var(--mute); font-size: 11.5px; }
.pc-gone { color: var(--down); font-size: 11px; }
.pc-res { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-res.pc-tag { font-weight: 400; }
.pc-link { text-align: right; white-space: nowrap; }
.pc-calls a, .pc-foot a { color: var(--mute); text-decoration: none; }
.pc-calls a.pc-arkiv { color: #1d9bf0; }
.pc-calls a:hover, .pc-foot a:hover { color: var(--fg); }
.pc-closed { margin: 8px 0 0; }
.pc-closed summary { cursor: pointer; color: var(--mute); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  list-style: none; }
.pc-closed summary::-webkit-details-marker { display: none; }
.pc-closed summary::before { content: "▸ "; }
.pc-closed[open] summary::before { content: "▾ "; }
.pc-closed summary:hover { color: var(--fg); }
.up { color: var(--up); } .down { color: var(--down); }
.pc-foot { margin: 8px 0 0; color: var(--mute); font-size: 11.5px; }
.pc-empty { margin: 4px 0 0; color: var(--mute); font-size: 12.5px; }
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

/** A span of seconds as 45m / 9h / 2d. */
const span = (seconds: number) => {
  const d = Math.max(0, seconds);
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86_400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86_400)}d`;
};
const ago = (postedAt: number) => span(Date.now() / 1000 - postedAt);

const ARKIV = "https://rabdi.explorer.arkiv.network";
const toneOf = (n: number | null) => (n === null ? "" : n > 0 ? "up" : n < 0 ? "down" : "");
const isOpen = (c: SeenCall) => c.status === "open";

/**
 * One call on the card's grid: "Long $ETH 2d (deleted on X) | −7.9% ✕ | Arkiv ↗ | 𝕏 ↗". Every cell is
 * always there (empty when it doesn't apply), so the columns line up down the card.
 */
function callRow(handle: string, c: SeenCall & { gone?: boolean }) {
  const long = c.direction === "up";
  const res = isOpen(c)
    ? el("span", { class: "pc-res pc-tag" }, `${span(c.expiresAt - Date.now() / 1000)} left`)
    : c.returnBps === null
      ? el("span", { class: "pc-res pc-tag" }, "unpriced")
      : el("span", { class: `pc-res ${toneOf(c.returnBps)}` }, `${formatBps(c.returnBps)} ${c.status === "hit" ? "✓" : c.status === "miss" ? "✕" : "·"}`);
  return el(
    "li",
    {},
    el(
      "span",
      { class: "pc-call" },
      coin(c.asset),
      el(
        "span",
        {},
        el("span", { class: `pc-dir ${long ? "up" : "down"}` }, `${long ? "Long" : "Short"} $${c.asset}`),
        el("span", { class: "pc-tag" }, ` ${ago(c.postedAt)}`),
        c.gone ? el("span", { class: "pc-gone" }, " · deleted on X") : null,
      ),
    ),
    res,
    el("span", { class: "pc-link" }, c.key ? safeLink(`${ARKIV}/entity/${c.key}`, "Arkiv ↗", "pc-arkiv") : ""),
    el("span", { class: "pc-link" }, safeLink(`https://x.com/${handle}/status/${c.postId}`, "𝕏 ↗")),
  );
}

function coin(asset: string) {
  const icon = tokenIcon(asset, 18);
  icon.classList.add("pc-coin");
  return icon;
}

/** A trade a Kall user placed copying this caller, as Arkiv stores it. */
export type CopiedTrade = { key: string; asset: string; side: string; source: string; postId: string | null; placedAt: number };

const SOURCE: Record<string, string> = { extension: "on X", keyboard: "keyboard", desk: "web app" };

/** A copied trade on the same grid: "Bought $ETH on X 16h | | Arkiv ↗ | 𝕏 ↗" (the call it copied). */
function tradeRow(handle: string, t: CopiedTrade) {
  const buy = t.side.toLowerCase() === "buy";
  return el(
    "li",
    {},
    el(
      "span",
      { class: "pc-call" },
      coin(t.asset),
      el("span", {}, el("span", { class: `pc-dir ${buy ? "up" : "down"}` }, `${buy ? "Bought" : "Sold"} $${t.asset}`), el("span", { class: "pc-tag" }, ` ${SOURCE[t.source] ?? "on Kall"} · ${ago(t.placedAt)}`)),
    ),
    el("span", { class: "pc-res pc-tag" }, ""),
    el("span", { class: "pc-link" }, /^0x[0-9a-fA-F]{64}$/.test(t.key) ? safeLink(`${ARKIV}/entity/${t.key}`, "Arkiv ↗", "pc-arkiv") : ""),
    el("span", { class: "pc-link" }, t.postId && /^\d+$/.test(t.postId) ? safeLink(`https://x.com/${handle}/status/${t.postId}`, "𝕏 ↗") : ""),
  );
}

const callList = (handle: string, calls: SeenCall[]) => el("ul", { class: "pc-calls" }, ...calls.map((c) => callRow(handle, c)));

/**
 * Small on purpose: who and Follow, one line of numbers (calls, hit rate, average, deleted), every open
 * call, every closed call behind a dropdown, each linked to its record on Arkiv, and one footer line.
 */
export function callerCard(opts: {
  handle: string;
  calls: SeenCall[] | null;
  /** Trades Kall users placed copying this caller. */
  trades?: CopiedTrade[] | null;
  writer?: string | null;
  /** Call posts no longer public on X, out of how many X answered for. */
  deleted?: { count: number; checked: number } | null;
  follow: HTMLElement;
  deskUrl: string;
}) {
  const { handle, calls, writer, deleted, follow, deskUrl } = opts;
  const trades = opts.trades ?? [];
  const head = el(
    "div",
    { class: "pc-head" },
    brandMark(18),
    el("span", { class: "pc-title" }, el("b", {}, `@${handle}`), " on Kall"),
    follow,
  );
  if (calls === null) return el("div", { class: "pc" }, head, el("p", { class: "pc-empty" }, "Loading the record from Arkiv…"));
  if (!calls.length)
    return el("div", { class: "pc" }, head, el("p", { class: "pc-empty" }, `No calls by @${handle} scored on Kall yet.`));

  const s = summarize(calls);
  const sorted = [...calls].sort((a, b) => b.postedAt - a.postedAt);
  const open = sorted.filter(isOpen);
  const closed = sorted.filter((c) => !isOpen(c));
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
    // Open calls are what you'd act on: always in view.
    el("p", { class: "pc-group" }, `Open · ${open.length}`),
    open.length ? callList(handle, open) : el("p", { class: "pc-empty" }, "No open calls right now."),
    closed.length
      ? el("details", { class: "pc-closed" }, el("summary", {}, `Closed calls · ${closed.length}`), callList(handle, closed))
      : null,
    // Trades people placed through Kall copying this caller, each its own record on Arkiv.
    trades.length ? el("p", { class: "pc-group" }, `Copied on Kall · ${trades.length}`) : null,
    trades.length ? el("ul", { class: "pc-calls" }, ...trades.slice(0, 5).map((t) => tradeRow(handle, t))) : null,
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
