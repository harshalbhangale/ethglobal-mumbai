// Scoped to shadow roots so X's styles never leak in and ours never leak out.
// Colours are tokens on :host, switched by data-theme (set from X's own background).
export const css = `
:host { all: initial; display: block; margin-top: 10px;
  --bg: #ffffff; --ink: #14213d; --muted: #5b6b82; --rule: #d9dfe8; --up: #12935f; --down: #d93f45; }
:host([data-theme="dark"]) { --bg: #16181c; --ink: #e7e9ea; --muted: #8b98a5; --rule: #2f3336; --up: #2fbf84; --down: #f2666b; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
a { color: inherit; }
.card { font-size: 14px; line-height: 1.4; border-radius: 14px; border: 1px solid var(--rule);
  background: var(--bg); color: var(--ink); padding: 10px 12px; }
.top { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.brand { font-weight: 700; font-size: 13px; letter-spacing: -0.01em; }
.muted { color: var(--muted); font-size: 13px; }
.line { margin-top: 6px; }
.up { color: var(--up); } .down { color: var(--down); }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
button { font: 600 13px/1 inherit; font-family: inherit; border-radius: 999px; padding: 8px 12px; cursor: pointer;
  border: 1px solid var(--rule); background: transparent; color: var(--ink); }
button.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
button:hover { border-color: var(--ink); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; margin-top: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--rule); }
.tile-value { font-weight: 700; font-size: 16px; font-variant-numeric: tabular-nums; }
.tile-label { color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.tile.good .tile-value { color: var(--up); } .tile.bad .tile-value { color: var(--down); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--rule); color: var(--muted); font-size: 12px; }
.breakdown { margin-top: 8px; font-size: 13px; }
.breakdown summary { cursor: pointer; color: var(--muted); font-weight: 600; }
.breakdown-row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-variant-numeric: tabular-nums; }
.small { font-size: 12px; margin: 6px 0 0; }
.drawer { position: fixed; top: 0; right: 0; width: min(400px, 100vw); height: 100vh; overflow-y: auto;
  z-index: 2147483000; background: var(--bg); color: var(--ink); border-left: 1px solid var(--rule);
  box-shadow: -12px 0 40px rgba(0,0,0,.18); font-size: 14px; line-height: 1.45; }
.drawer header { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px; background: var(--bg); border-bottom: 1px solid var(--rule); }
.drawer .close { border: 0; font-size: 22px; padding: 4px 10px; }
.section { padding: 14px 16px; border-bottom: 1px solid var(--rule); }
.section h3 { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.kv { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
.kv span:first-child { color: var(--muted); }
.kv span:last-child { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
blockquote { margin: 0 0 8px; padding: 8px 10px; border-left: 3px solid var(--rule); white-space: pre-wrap; overflow-wrap: anywhere; }
.calls { list-style: none; margin: 0; padding: 0; }
.calls li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
.calls li:last-child { border-bottom: 0; }
.note { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
.footer { padding: 14px 16px; margin: 0; }
button:focus-visible { outline: 3px solid var(--muted); outline-offset: 2px; }
`;
