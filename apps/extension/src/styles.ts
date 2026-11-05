// Scoped to shadow roots so X's styles never leak in and ours never leak out.
// Ported from the Xtrading extension so the cards look the same: X's own card style for the post
// card (following X's light/dark theme), the dark brand surface with lime accents for creator UI.
export const css = `
:host { all: initial; }
:host(.aftermarkets-host) { display: block; width: 100%; }
:host(.aftermarkets-profile-host) { display: block; width: 100%; box-sizing: border-box; }
:host(.aftermarkets-badge-host) { display: inline-flex; align-items: center; vertical-align: middle; margin-left: 4px; line-height: 0; }
:host(.aftermarkets-xbuy) { display: block; }
* { box-sizing: border-box; font-family: Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; }
[hidden] { display: none !important; }

/* Brand palette (creator surfaces): same on every X theme. */
:host {
  --paper: #050605; --surface: #0d110f; --raised: #131815; --hover: #19201b;
  --foreground: #e6ebe3; --soft: #b8c2b7; --muted: #8b978d; --line: #1e2621; --line-strong: #2c3830;
  --lime: #c6f25a; --on-lime: #0e1407; --positive: #8ad97c; --negative: #ff8a7a; --warning: #f0c766;
}
.wordmark { font-weight: 800; letter-spacing: -0.02em; color: var(--foreground); }
.powered { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; color: var(--muted); font: 600 11px system-ui, sans-serif; }
.note { color: var(--muted); font-size: 12px; margin: 6px 0 0; }
.up { color: var(--positive); } .down { color: var(--negative); }
button:focus-visible, a:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid var(--lime); outline-offset: 2px; }

/* ── Post card: X's card style, following X's theme ── */
.inline-card { --surface: #000; --raised: #16181c; --foreground: #e7e9ea; --muted: #71767b; --line: #2f3336;
  --paper: var(--surface); --soft: var(--muted); --hover: var(--raised); --line-strong: #3a4046;
  --positive: #00ba7c; --negative: #f4212e;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--foreground);
  background: var(--surface); border: 1px solid var(--line); border-radius: 18px; margin: 12px 0 4px; overflow: hidden; }
:host([data-theme="light"]) .inline-card { --surface: #fff; --raised: #f7f9f9; --foreground: #0f1419; --muted: #536471;
  --line: #cfd9de; --line-strong: #aab8c2; --positive: #00875a; --negative: #d0182a; }
.inline-card * { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.inline-card a { color: #1d9bf0; }
.inline-card button:focus-visible, .inline-card summary:focus-visible, .inline-card input:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 3px; }
.inline-card.inline-attached { margin-top: 8px; }
.swap-card { box-shadow: 0 0 0 1px rgba(214,245,138,.08), 0 10px 30px rgba(0,0,0,.35); border-color: var(--line-strong); }
:host([data-theme="light"]) .swap-card { box-shadow: 0 6px 22px rgba(15,20,25,.12); }
.swap-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.swap-icon { display: inline-grid; place-items: center; flex: 0 0 auto; border-radius: 50%; color: #fff; font-weight: 700; line-height: 1; }
.swap-title { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; }
.swap-title strong { font-size: 17px; }
.swap-title span { color: var(--muted); font-size: 14px; white-space: nowrap; }
.swap-title b { color: var(--foreground); font-weight: 700; }
.swap-title em { font-style: normal; font-weight: 600; }
.swap-title em.up { color: var(--positive); } .swap-title em.down { color: var(--negative); }
.swap-spark { flex: 1 1 auto; min-width: 40px; }
.inline-buy, .inline-close { cursor: pointer; border-radius: 99px; padding: 8px 15px; border: 1px solid var(--line); white-space: nowrap;
  font-size: 14px; font-weight: 700; line-height: 1.3; }
.inline-buy { background: var(--foreground); color: var(--surface); }
.inline-close { background: transparent; color: var(--foreground); }

/* Call check strip */
.call-insights { border-top: 1px solid var(--line); }
.call-insights > summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 16px; cursor: pointer;
  list-style: none; font-size: 13px; color: var(--muted); }
.call-insights > summary::-webkit-details-marker { display: none; }
.call-insights > summary::after { content: "▾"; margin-left: auto; }
.call-insights[open] > summary::after { content: "▴"; }
.ci-title { color: var(--foreground); font-weight: 700; }
.ci-chip { padding: 2px 9px; border-radius: 99px; border: 1px solid var(--line); font-size: 12px; font-weight: 600; }
.ci-chip.up { color: var(--positive); border-color: currentColor; }
.ci-chip.down { color: var(--negative); border-color: currentColor; }
.call-insights-body { padding: 0 16px 8px; }
.call-insights-body .section { padding: 12px 0; border-bottom: 1px solid var(--line); }
.call-insights-body .section:last-child { border-bottom: 0; }
.section h3 { margin: 0 0 10px; color: var(--muted); font: 700 10px/1 ui-monospace, "SF Mono", monospace; letter-spacing: .12em; text-transform: uppercase; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }
.row span:first-child { color: var(--muted); }
.row span:last-child { text-align: right; font-weight: 600; color: var(--foreground); overflow-wrap: anywhere; }
blockquote { margin: 0 0 8px; padding: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--foreground); }
.dir-up { color: var(--positive); } .dir-down { color: var(--negative); }

/* Trade panel */
.inline-panel { border-top: 1px solid var(--line); padding: 14px 16px 12px; display: grid; gap: 8px; }
.swap-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.swap-row-end { display: inline-flex; align-items: center; gap: 8px; }
.seg { display: inline-flex; padding: 3px; border: 1px solid var(--line); border-radius: 99px; }
.seg button { border: 0; background: transparent; color: var(--muted); font: 700 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 8px 16px; border-radius: 99px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--foreground); color: var(--surface); }
.swap-chain-pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 99px;
  padding: 5px 12px 5px 6px; background: var(--raised); font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--foreground); }
.swap-chain { width: 22px; height: 22px; border-radius: 6px; flex: 0 0 auto; background: #0052ff; display: inline-block; }
.swap-box { display: grid; gap: 4px; padding: 12px 14px; border-radius: 14px; background: var(--raised); border: 1px solid transparent; }
.swap-pay { border-color: #1d9bf0; background: transparent; }
.swap-label, .swap-usd { color: var(--muted); font-size: 13px; }
.swap-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.swap-amount { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--foreground); font: 700 28px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 0; }
.swap-out { font-size: 28px; font-weight: 700; overflow-wrap: anywhere; }
.swap-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px 5px 6px; border: 1px solid var(--line); border-radius: 99px; font-weight: 700; white-space: nowrap; }
.swap-arrow { justify-self: center; margin: -16px 0; z-index: 1; width: 32px; height: 32px; display: grid; place-items: center;
  border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--foreground); }
.swap-meta { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.inline-note { font-size: 12px; color: var(--muted); margin: 4px 0; }
.inline-note:empty { display: none; }
.inline-submit { width: 100%; border: 0; border-radius: 99px; margin-top: 6px; padding: 14px; background: var(--foreground); color: var(--surface);
  font-size: 16px; font-weight: 700; cursor: pointer; }
.inline-submit:disabled { opacity: .4; cursor: not-allowed; }
.swap-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 12px; color: var(--muted);
  font-size: 12px; padding-top: 12px; margin-top: 4px; border-top: 1px solid var(--line); }
.swap-powered { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border: 1px solid rgba(61,220,132,.55); border-radius: 99px;
  background: rgba(61,220,132,.08); box-shadow: 0 0 0 3px rgba(61,220,132,.07); font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; }
.swap-powered-sep { width: 1px; height: 14px; background: var(--line); }
.swap-venue { color: var(--foreground); font-weight: 800; letter-spacing: -0.01em; }

/* Exits: take-profit / stop-loss presets, placed as one Flash bracket */
.exits { display: grid; gap: 8px; padding: 12px 14px; border-radius: 14px; background: var(--raised); }
.exit-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.exit-row > span { color: var(--muted); font-size: 13px; }
.exit-row > span b { color: var(--foreground); font-weight: 700; }
.exit-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.exit-chips button { padding: 4px 10px; border-radius: 99px; border: 1px solid var(--line); background: transparent; color: var(--foreground);
  font: 600 12px ui-monospace, "SF Mono", monospace; cursor: pointer; }
.exit-chips button[aria-pressed="true"] { border-color: currentColor; }
.exit-chips.tp button[aria-pressed="true"] { color: var(--positive); }
.exit-chips.sl button[aria-pressed="true"] { color: var(--negative); }

/* Button inside X's own ticker card */
.xbuy { cursor: pointer; border-radius: 99px; padding: 6px 12px; border: 0; background: #e7e9ea; color: #0f1419; font: 700 13px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; }
:host([data-theme="light"]) .xbuy { background: #0f1419; color: #fff; }

/* ── Metrics (record panel, profile card) ── */
.metrics { display: flex; flex-direction: column; gap: 8px; }
.metric-group { margin-top: 6px; color: var(--muted); font: 700 10px/1 system-ui; letter-spacing: .08em; text-transform: uppercase; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px; }
.stat-tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--raised); border: 1px solid var(--line); min-width: 0; }
.stat-value { font: 750 20px/1.15 system-ui; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; color: var(--foreground); }
.stat-label { color: var(--muted); font: 600 11px/1.2 system-ui; }
.stat-tile.bad .stat-value { color: var(--negative); } .stat-tile.good .stat-value { color: var(--positive); }
.box-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.metric-box { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--raised); }
.metric-box.wide { grid-column: 1 / -1; }
.metric-label { font: 700 10px/1.2 system-ui; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.metric-value { font: 650 14px/1.3 system-ui; overflow-wrap: anywhere; color: var(--foreground); }
.metric-box.bad { border-color: #ff8a7a66; } .metric-box.bad .metric-value { color: var(--negative); }
.metric-box.good .metric-value { color: var(--positive); }
.metric-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 2px; font-size: 13px; border-bottom: 1px solid var(--line); color: var(--foreground); }
.metric-row-label { color: var(--muted); }
.unavailable summary { cursor: pointer; display: block; text-align: center; padding: 8px 10px; border-radius: 10px; border: 1px dashed var(--line);
  color: var(--muted); font: 600 11px/1.3 system-ui; list-style: none; }
.unavailable summary::-webkit-details-marker { display: none; }
.unavailable summary::after { content: " ▾"; }
.unavailable[open] summary::after { content: " ▴"; }
.unavailable-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 2px; font-size: 12px; color: var(--muted); }
.unavailable-row span:first-child { color: var(--foreground); font-weight: 600; }
.recent-calls { margin-top: 10px; font-size: 12px; color: var(--foreground); }
.recent-calls ul { margin: 6px 0 0; padding-left: 16px; }
.recent-calls li { margin: 3px 0; }
.recent-calls a { color: inherit; }

/* ── Profile card: brand surface above the tabs ── */
.card { margin: 8px 16px 12px; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--line); background: var(--surface);
  color: var(--foreground); font: 13px/1.5 system-ui; }
.card .title { display: flex; justify-content: space-between; align-items: center; font: 700 14px system-ui; margin-bottom: 8px; }
.card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.card-actions .cta, .card-toggle, .card-follow { display: inline-flex; flex: 0 1 auto; align-items: center; justify-content: center;
  max-width: 8.5rem; min-width: 0; min-height: 24px; margin: 0; padding: 0 10px; border-radius: 999px;
  font: 700 11px/1 system-ui, sans-serif; white-space: nowrap; text-align: center; text-decoration: none; }
.card-actions .cta { background: #d6f58a; color: #17210c; }
.card-actions .cta:hover { background: #e7fea8; }
.card-toggle, .card-follow { appearance: none; cursor: pointer; background: transparent; color: var(--foreground); border: 1px solid var(--line-strong); }
.card-toggle:hover, .card-follow:hover { background: var(--hover); }
.card-toggle::after { content: " ▾"; }
.card-toggle[aria-expanded="true"]::after { content: " ▴"; }
.card-follow[aria-pressed="true"] { background: #d6f58a; color: #17210c; border-color: #d6f58a; }
.card-follow:disabled { opacity: .55; cursor: default; }
.card-overview { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }

/* Following chip beside a name */
.chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px; font: 600 11px/18px system-ui; border: 1px solid; white-space: nowrap; }
.chip.following { color: var(--lime); background: #c6f25a14; border-color: #c6f25a55; font-weight: 700; letter-spacing: .02em; }
`;
