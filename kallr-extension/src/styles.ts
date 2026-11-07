// Scoped to shadow roots so X's styles never leak in and ours never leak out.
// Card styles that sit naturally in the timeline: X's own card style for the post
// card (following X's light/dark theme), the dark brand surface with lime accents for creator UI.
export const css = `
:host { all: initial; }
:host(.kallr-host) { display: block; width: 100%; }
:host(.kallr-profile-host) { display: block; width: 100%; box-sizing: border-box; }
:host(.kallr-badge-host) { display: inline-flex; align-items: center; vertical-align: middle; margin-left: 4px; line-height: 0; }
:host(.kallr-xbuy) { display: block; }
* { box-sizing: border-box; font-family: Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; }
[hidden] { display: none !important; }

/* Brand palette (creator surfaces): same on every X theme. */
:host {
  --paper: #050605; --surface: #0d110f; --raised: #131815; --hover: #19201b;
  --foreground: #e6ebe3; --soft: #b8c2b7; --muted: #8b978d; --line: #1e2621; --line-strong: #2c3830;
  --lime: #c6f25a; --on-lime: #0e1407; --positive: #8ad97c; --negative: #ff8a7a; --warning: #f0c766;
}
.wordmark { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; letter-spacing: -0.02em; color: var(--foreground); }
.brand-mark-glyph { display: inline-block; flex: 0 0 auto; background-color: var(--lime);
  -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center; }
.card .title .wordmark { font: 800 15px/1 Inter, system-ui, sans-serif; gap: 8px; }
.swap-powered .wordmark { gap: 5px; }
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
/* Lime mark on X's dark themes; on the white theme lime is too faint, so it goes black. */
:host([data-theme="light"]) .inline-card .brand-mark-glyph { background-color: #0e1407; }
.inline-card a { color: #1d9bf0; }
.inline-card button:focus-visible, .inline-card summary:focus-visible, .inline-card input:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 3px; }
.inline-card.inline-attached { margin-top: 8px; }
.swap-card { box-shadow: 0 0 0 1px rgba(214,245,138,.08), 0 10px 30px rgba(0,0,0,.35); border-color: var(--line-strong); }
:host([data-theme="light"]) .swap-card { box-shadow: 0 6px 22px rgba(15,20,25,.12); }
.swap-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.swap-icon { display: inline-grid; place-items: center; flex: 0 0 auto; border-radius: 50%; color: #fff; font-weight: 700; line-height: 1; }
.swap-title { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; }
.swap-title strong { font-size: 15px; line-height: 1.25; }
.swap-title span { color: var(--muted); font-size: 13px; white-space: nowrap; }
.swap-title b { color: var(--foreground); font-weight: 700; }
.swap-title em { font-style: normal; font-weight: 600; }
.swap-title em.up { color: var(--positive); } .swap-title em.down { color: var(--negative); }
.swap-spark { flex: 1 1 auto; min-width: 40px; }
.inline-buy, .inline-close { cursor: pointer; border-radius: 99px; padding: 6px 13px; border: 1px solid var(--line); white-space: nowrap;
  font-size: 13px; font-weight: 700; line-height: 1.3; }
.inline-buy { background: var(--foreground); color: var(--surface); }
.inline-close { background: transparent; color: var(--foreground); }

/* Call receipt strip */
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
.inline-panel { padding: 4px 14px 12px; display: grid; gap: 8px; }
.swap-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.swap-row-end { display: inline-flex; align-items: center; gap: 8px; }
.seg { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: 99px; }
.seg button { border: 0; background: transparent; color: var(--muted); font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 6px 13px; border-radius: 99px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--foreground); color: var(--surface); }
.swap-chain-pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 99px;
  padding: 4px 10px 4px 5px; font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--foreground); }
.base-logo { flex: 0 0 auto; display: block; }
.swap-wallet { border: 1px solid var(--line); border-radius: 99px; padding: 5px 10px; font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--foreground); }
.swap-box { display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--raised); border: 1px solid transparent; }
.swap-pay { border-color: var(--line); background: transparent; transition: border-color .15s; }
.swap-pay:focus-within { border-color: #1d9bf0; }
.inline-card input.swap-amount:focus-visible { outline: none; }
.swap-label, .swap-usd { color: var(--muted); font-size: 12px; }
.swap-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.swap-amount { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--foreground); font: 700 24px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 0; }
.swap-out { font-size: 24px; line-height: 1.2; font-weight: 700; overflow-wrap: anywhere; }
.swap-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 4px; border: 1px solid var(--line); border-radius: 99px; font-size: 13px; font-weight: 700; white-space: nowrap; }
.swap-arrow { justify-self: center; margin: -15px 0; z-index: 1; width: 26px; height: 26px; font-size: 13px; display: grid; place-items: center;
  border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--foreground); }
.swap-meta { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.inline-note { font-size: 12px; color: var(--muted); margin: 4px 0; }
.inline-note:empty { display: none; }
.link-button { all: unset; cursor: pointer; color: var(--accent, #1d9bf0); font-weight: 700; }
.link-button:hover { text-decoration: underline; }
.inline-submit { width: 100%; border: 0; border-radius: 99px; margin-top: 2px; padding: 11px; background: var(--foreground); color: var(--surface);
  font-size: 15px; font-weight: 700; cursor: pointer; }
.inline-submit:disabled { opacity: .4; cursor: not-allowed; }
.swap-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 12px; color: var(--muted);
  font-size: 12px; padding-top: 10px; margin-top: 2px; border-top: 1px solid var(--line); }
.swap-powered { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; }
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

/* Caller strip under the price header: who called it, their record, and Follow. */
.caller-strip { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 14px 12px; padding: 10px 12px;
  border-radius: 12px; background: color-mix(in srgb, var(--foreground, #e7e9ea) 5%, transparent); }
.caller-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.caller-line { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.caller-strip .x-follow { min-width: 76px; height: 30px; padding: 0 14px; font-size: 13px; }
.inline-card a.caller-handle { color: var(--foreground); font-weight: 700; font-size: 14px; text-decoration: none; }
.inline-card a.caller-handle:hover { text-decoration: underline; }
.caller-side { font: 700 12px/18px system-ui, sans-serif; padding: 0 8px; border-radius: 999px; border: 1px solid currentColor; }
.caller-side.up { color: #00ba7c; } .caller-side.down { color: #f4212e; }
.caller-move { color: var(--muted); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.caller-move.up { color: #00ba7c; } .caller-move.down { color: #f4212e; }
.caller-facts { color: var(--muted); font-size: 13px; }
.inline-card a.caller-arkiv { color: #1d9bf0; font-size: 12px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.inline-card a.caller-arkiv:hover { text-decoration: underline; }

/* Follow pill, as X draws it: white "Follow", outlined "Following", red "Unfollow" on hover. */
.x-follow { flex: 0 0 auto; min-width: 84px; height: 34px; padding: 0 16px; border-radius: 99px; cursor: pointer;
  border: 1px solid transparent; background: #eff3f4; color: #0f1419; font: 700 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.x-follow:hover { background: #d7dbdc; }
:host([data-theme="light"]) .x-follow { background: #0f1419; color: #fff; }
:host([data-theme="light"]) .x-follow:hover { background: #272c30; }
.x-follow[aria-pressed="true"] { background: transparent; color: var(--foreground, #e7e9ea); border-color: #536471; }
:host([data-theme="light"]) .x-follow[aria-pressed="true"] { color: #0f1419; border-color: #cfd9de; }
.x-follow[aria-pressed="true"]:hover { color: #f4212e; border-color: #67070f; background: #f4212e1a; }
:host([data-theme="light"]) .x-follow[aria-pressed="true"]:hover { border-color: #fdc9ce; }
.x-follow:disabled { opacity: .6; cursor: progress; }

/* Quick amounts inside the pay box */
.amount-presets { display: flex; gap: 4px; }
.amount-presets button { padding: 3px 9px; border-radius: 99px; border: 1px solid var(--line); background: transparent; color: var(--muted);
  font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; }
.amount-presets button:hover, .amount-presets button[aria-pressed="true"] { color: var(--foreground); border-color: var(--foreground); }

/* Review before any wallet prompt */
.review { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; padding: 10px 12px; border-radius: 12px;
  border: 1px solid var(--line); font-size: 12px; }
.review dt { color: var(--muted); }
.quote-facts { margin-bottom: 8px; }
.quote-facts .warn { color: #f5a524; }
.review dd { margin: 0; text-align: right; font-weight: 600; color: var(--foreground); }

/* Step tracker while placing */
.progress { display: grid; gap: 10px; }
.steps { list-style: none; margin: 0; padding: 12px 14px; border-radius: 14px; background: var(--raised); display: grid; gap: 8px; font-size: 14px; }
.step { display: flex; align-items: center; gap: 10px; color: var(--muted); }
.step-dot { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 auto; border-radius: 50%; border: 1.5px solid var(--line);
  font: 800 11px/1 -apple-system, sans-serif; }
.step.done { color: var(--foreground); }
.step.done .step-dot { background: var(--positive); border-color: var(--positive); color: #fff; }
.step.active { color: var(--foreground); font-weight: 700; }
.step.active .step-dot { border-color: #1d9bf0; border-top-color: transparent; animation: kallr-spin .8s linear infinite; }
.step.failed { color: var(--negative); font-weight: 700; }
.step.failed .step-dot { background: var(--negative); border-color: var(--negative); color: #fff; }
@keyframes kallr-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .step.active .step-dot { animation: none; border-top-color: #1d9bf0; } }
.done-card { display: grid; gap: 4px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--positive); background: color-mix(in srgb, var(--positive) 10%, transparent); font-size: 14px; }
.done-card strong { color: var(--foreground); }
.done-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.network-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px 3px 4px; border-radius: 99px; border: 1px solid var(--line); color: var(--foreground); font: 600 11px/1 system-ui, sans-serif; }
.receipt { margin: 6px 0 0; padding: 8px 0 0; background: none; border: 0; border-top: 1px solid var(--line); border-radius: 0; font-size: 12px; }
/* Definitive Flash receipt: four rows (quote, signed, sent, filled) that fill in live. Fixed-height
   detail lines so nothing shifts as values arrive. Lime on X's dark themes, ink on the white theme. */
.flash-receipt { --fr-accent: var(--lime); --fr-on-accent: var(--on-lime); margin: 0; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--raised); }
:host([data-theme="light"]) .flash-receipt { --fr-accent: #0e1407; --fr-on-accent: #c6f25a; }
.done-card .flash-receipt { margin: 6px 0 2px; }
.fr-head { display: flex; justify-content: space-between; margin: 0 0 8px; color: var(--muted); font: 700 10.5px/1.2 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.fr-chain { letter-spacing: 0; text-transform: none; }
.fr-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.fr-row { display: flex; gap: 10px; align-items: flex-start; }
.fr-dot { display: grid; place-items: center; width: 18px; height: 18px; flex: 0 0 auto; margin-top: 1px; border-radius: 50%; border: 1.5px solid var(--line-strong); color: var(--muted); font: 700 10px/1 system-ui, sans-serif; }
.fr-row.live .fr-dot { border-color: var(--fr-accent); border-top-color: transparent; animation: kallr-spin .8s linear infinite; }
.fr-row.done .fr-dot { background: var(--fr-accent); border-color: var(--fr-accent); color: var(--fr-on-accent); }
.fr-row.failed .fr-dot { background: var(--negative); border-color: var(--negative); color: #fff; }
@media (prefers-reduced-motion: reduce) { .fr-row.live .fr-dot { animation: none; border-top-color: var(--fr-accent); } }
.fr-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; min-width: 0; flex: 1 1 auto; }
.fr-title { color: var(--foreground); font-size: 13px; font-weight: 700; line-height: 1.3; }
.fr-row.pending .fr-title { color: var(--muted); font-weight: 600; }
.fr-row.failed .fr-title, .fr-row.failed .fr-detail { color: var(--negative); }
.fr-detail { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-height: 16px; color: var(--muted); font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
.fr-row.live .fr-detail { color: var(--soft); }
/* Live text stays on one line (no shift as it changes); an error may wrap so it reads in full. */
.fr-row:not(.failed) .fr-detail-text { min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fr-detail .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.fr-copy { cursor: pointer; padding: 0 6px; border-radius: 5px; border: 1px solid var(--line-strong); background: transparent; color: var(--muted); font: 600 11px/16px system-ui, sans-serif; }
.fr-copy:hover { color: var(--foreground); border-color: var(--foreground); }
.inline-card .fr-link, .fr-link { color: var(--fr-accent); font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
/* "You saved $0.12 vs Uniswap": the one line worth celebrating, under the receipt's rows. */
.fr-saved { display: flex; align-items: center; gap: 6px; margin: 9px 0 0; padding: 7px 10px; border-radius: 9px; background: color-mix(in srgb, var(--fr-accent) 14%, transparent); color: var(--fr-accent); font: 800 12.5px/1.2 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.fr-saved-by { margin-left: auto; color: var(--muted); font-weight: 600; font-size: 11px; }
.swap-pending { color: var(--muted); font-weight: 500; animation: kallr-pulse 1.4s ease-in-out infinite; }
@keyframes kallr-pulse { 50% { opacity: .45; } }

/* ── Success burst: ring draws, lime disc springs in, check strokes, confetti fires (~1.3s) ── */
.sb { --sb-ink: #050605; --sb-bone: #e6ebe3; --sb-soft: #8b978d; --sb-lime: #c6f25a; --sb-lime-2: #d6f985; --sb-on-lime: #0e1407;
  position: relative; display: grid; justify-items: center; gap: 10px; padding: 18px 14px 14px; margin: -2px -4px 4px;
  border-radius: 12px; background: radial-gradient(120% 90% at 50% 0%, #131815 0%, var(--sb-ink) 70%); color: var(--sb-bone);
  text-align: center; animation: sb-pop .34s cubic-bezier(.34,1.56,.64,1) both; }
.sb-mark { position: relative; width: 76px; height: 76px; display: grid; place-items: center;
  animation: sb-thump .3s cubic-bezier(.34,1.8,.5,1) .54s both; }
.sb-svg { width: 76px; height: 76px; overflow: visible; position: relative; z-index: 1; }
.sb-ring { fill: none; stroke: var(--sb-lime); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1;
  transform: rotate(-90deg); transform-origin: 32px 32px; animation: sb-draw .38s cubic-bezier(.65,0,.35,1) forwards; }
.sb-disc { fill: var(--sb-lime); transform: scale(0); transform-origin: 32px 32px;
  animation: sb-fill .42s cubic-bezier(.34,1.7,.5,1) .3s forwards; }
.sb-tick { fill: none; stroke: var(--sb-on-lime); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1; stroke-dashoffset: 1; animation: sb-draw .26s cubic-bezier(.4,0,.2,1) .52s forwards; }
.sb-wave { position: absolute; inset: 6px; border-radius: 50%; border: 2px solid var(--sb-lime); opacity: 0;
  animation: sb-wave .56s cubic-bezier(.2,.7,.3,1) .4s both; }
.sb-piece { position: absolute; left: 50%; top: 50%; width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2);
  background: var(--c); border-radius: 50%; opacity: 0; animation: sb-fly .64s cubic-bezier(.1,.8,.3,1) calc(.44s + var(--d)) both; }
.sb-bar { width: calc(var(--s) * .45); height: calc(var(--s) * 1.5); border-radius: 2px; }
.sb-text { display: grid; gap: 4px; justify-items: center; }
.sb-text > * { margin: 0; opacity: 0; animation: sb-rise .36s cubic-bezier(.34,1.56,.64,1) calc(.66s + var(--i, 0) * 70ms) both; }
.sb-title, .done-card .sb-title { font-size: 19px; font-weight: 800; letter-spacing: -.02em; color: var(--sb-bone); }
.sb-amount { font-size: 14px; color: var(--sb-soft); }
.sb-amount b { color: var(--sb-lime); font-weight: 800; font-size: 16px; }
.sb-exits { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; font-size: 12px; font-weight: 700; }
.sb-exits span { padding: 3px 9px; border-radius: 99px; border: 1px solid #2c3830; }
.sb-tp { color: #8ad97c; } .sb-sl { color: #ff8a7a; }
.sb-link { font-size: 12px; color: var(--sb-soft); }
.inline-card .sb-link a, .sb-link a { color: var(--sb-lime); font-weight: 700; text-decoration: none; }
.sb-link a:hover { text-decoration: underline; }
.sb-pending { animation-name: sb-rise, kallr-pulse; animation-duration: .36s, 1.4s; animation-iteration-count: 1, infinite;
  animation-delay: calc(.66s + var(--i, 0) * 70ms), 1.1s; }
@keyframes sb-pop { from { transform: scale(.94); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes sb-draw { to { stroke-dashoffset: 0; } }
@keyframes sb-fill { to { transform: scale(1); } }
@keyframes sb-thump { 0% { transform: scale(1); } 45% { transform: scale(1.1); } 100% { transform: scale(1); } }
@keyframes sb-wave { 0% { opacity: .7; transform: scale(.85); } 100% { opacity: 0; transform: scale(2.1); } }
@keyframes sb-fly { 0% { opacity: 1; transform: translate(0, 0) scale(.4) rotate(0); }
  70% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--x), var(--y)) scale(1) rotate(var(--r)); } }
@keyframes sb-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .sb, .sb-mark, .sb-text > *, .sb-pending { animation: none; opacity: 1; }
  .sb-ring, .sb-tick { animation: none; stroke-dashoffset: 0; }
  .sb-disc { animation: none; transform: none; }
  .sb-wave, .sb-piece { display: none; }
}

.definitive-logo { display: block; color: var(--foreground); }
.exits-toggle { justify-self: start; border: 0; background: none; padding: 2px 0; color: #1d9bf0; font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; }
.exits-toggle:hover { text-decoration: underline; }
.signer-switch { border: 0; background: none; padding: 0; margin-left: 4px; color: #1d9bf0; font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; }
.signer-switch:hover { text-decoration: underline; }
.review .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.step-error { display: block; margin-top: 2px; font-weight: 500; font-size: 13px; line-height: 1.4; color: var(--negative); }
.card .title { gap: 12px; margin-bottom: 12px; }
.title-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title-sub { color: var(--muted); font: 500 12px/1.2 system-ui, sans-serif; }

/* Token picker (over the trade panel) */
.picker-slot { position: relative; }
.picker { display: grid; gap: 10px; padding: 14px; border-radius: 16px; border: 1px solid var(--line-strong); background: var(--surface);
  box-shadow: 0 12px 40px rgba(0,0,0,.35); }
.picker-head { display: flex; align-items: center; justify-content: space-between; color: var(--foreground); font-size: 15px; }
.picker-close { border: 0; background: none; color: var(--muted); font-size: 18px; cursor: pointer; }
.picker-search { width: 100%; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--raised);
  color: var(--foreground); font: 500 15px -apple-system, BlinkMacSystemFont, sans-serif; outline: none; }
.picker-search:focus { border-color: #1d9bf0; }
.picker-list { display: grid; gap: 2px; max-height: 300px; overflow-y: auto; overscroll-behavior: contain; }
.picker-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: 12px; background: transparent;
  color: var(--foreground); text-align: left; cursor: pointer; font: 14px -apple-system, BlinkMacSystemFont, sans-serif; }
.picker-row:hover { background: var(--raised); }
.picker-row.risky { opacity: .55; cursor: not-allowed; }
.picker-id { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.picker-id small { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.picker-right { color: var(--foreground); font-weight: 600; font-size: 13px; white-space: nowrap; }
.picker-right small { color: var(--muted); font-weight: 500; }
.risk-badge { padding: 2px 8px; border-radius: 99px; background: color-mix(in srgb, var(--negative) 15%, transparent); color: var(--negative); font-size: 12px; }
.picker-note { margin: 0; color: var(--muted); font-size: 12px; }
.picker-note:empty { display: none; }
.pick-token { cursor: pointer; background: transparent; color: var(--foreground); font: 700 15px -apple-system, BlinkMacSystemFont, sans-serif; }
.pick-token:hover { border-color: var(--foreground); }
.pick-caret { color: var(--muted); font-size: 11px; }
.head-icon { display: inline-grid; flex: 0 0 auto; }
`;
