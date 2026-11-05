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
button:focus-visible { outline: 3px solid var(--muted); outline-offset: 2px; }
`;
