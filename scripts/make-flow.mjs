/** Draws docs/flow.svg: one call and one trade, start to finish, as lanes. Black and lime, logos embedded. */
import { readFile, writeFile } from "node:fs/promises";

const R = new URL("..", import.meta.url).pathname;
const b64 = async (p, t) => `data:${t};base64,${(await readFile(R + p)).toString("base64")}`;
const DEF = await b64("kallr-webapp/public/sponsors/definitive.svg", "image/svg+xml");
const ARK = await b64("kallr-webapp/public/sponsors/arkiv.png", "image/png");
const MARK = await b64("kallr-webapp/public/brand/mark.png", "image/png");

const INK = "#0b0d0c", CARD = "#141816", RULE = "#26302b", TEXT = "#e6ebe3", MUTE = "#8a968f", LIME = "#c6f25a";
const F = `font-family="Inter, Helvetica Neue, Helvetica, Arial, sans-serif"`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const t = (x, y, s, size = 15, fill = TEXT, w = 400, a = "start") =>
  `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${a}">${esc(s)}</text>`;
const rect = (x, y, w, h, { fill = CARD, stroke = RULE, r = 12, sw = 1.5 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

// Lanes
const L0 = 60, LW = 246, GAP = 8;
const lanes = [
  { n: "Caller", sub: "X · Telegram" },
  { n: "You", sub: "Kall app + wallet" },
  { n: "Kall server", sub: "one API on Vercel" },
  { n: "Definitive", sub: "Flash", logo: DEF, lw: 150, lh: 17 },
  { n: "Arkiv", sub: "the receipts", logo: ARK, lw: 92, lh: 23 },
  { n: "Base", sub: "where trades settle" },
];
const cx = (i) => L0 + i * (LW + GAP) + LW / 2;
const W = L0 * 2 + lanes.length * LW + (lanes.length - 1) * GAP;

// Steps: [phase] or { from, to, n, label, note, hot }
const S = [
  ["A · THE CALL IS POSTED"],
  { from: 0, to: 1, label: "“Long $ETH, 1 week”", note: "Extension sees it on X, or you copy it into the keyboard" },
  { from: 1, to: 2, label: "read this post" },
  { from: 2, to: 2, label: "AI: real call · Long · ETH · 1 week", note: "Call check: the coin and contract match, or it’s blocked" },
  { from: 2, to: 5, label: "Chainlink ETH price at the post’s minute", note: "the entry price" },
  { from: 2, to: 4, label: "write the call", note: "kallr.calls" },
  { from: 4, to: 1, label: "caller’s record: hits, misses, returns", note: "shown on the card before you trade" },
  ["B · YOU TRADE IT"],
  { from: 1, to: 2, label: "Trade $50 of ETH", hot: true },
  { from: 2, to: 3, label: "quote", hot: true },
  { from: 3, to: 1, label: "you get · impact · fee · ✓ best price", hot: true },
  { from: 1, to: 1, label: "approve + sign (EIP-712) in your wallet", note: "MetaMask or Privy: your keys, always", hot: true },
  { from: 2, to: 3, label: "place the signed order", hot: true },
  { from: 3, to: 5, label: "best route across Base venues → filled", hot: true },
  { from: 3, to: 2, label: "fill: tx hash + venues", hot: true },
  { from: 2, to: 4, label: "write the trade", note: "kallr.trades" },
  { from: 5, to: 1, label: "receipt + new balance", note: "read privately over Nym; Basescan link" },
  ["C · THE CALL IS SCORED"],
  { from: 2, to: 5, label: "when the week ends: Chainlink price again" },
  { from: 2, to: 2, label: "hit or miss, with its real return" },
  { from: 2, to: 4, label: "write the result", note: "kallr.call-results · can’t be edited or deleted" },
  { from: 4, to: 1, label: "the caller’s record updates for everyone" },
];

const TOP = 200, ROW = 58, PH = 46;
let y = TOP + 30, n = 0, body = "";
for (const st of S) {
  if (Array.isArray(st)) {
    y += 12;
    body += `<rect x="${L0}" y="${y - 22}" width="${W - 2 * L0}" height="32" rx="8" fill="#151b12"/>` + t(L0 + 16, y, st[0], 13, LIME, 700);
    y += PH - 12;
    continue;
  }
  n++;
  const c = st.hot ? LIME : "#9fb2a6";
  const num = (x) => `<circle cx="${x}" cy="${y}" r="12" fill="${st.hot ? LIME : "#26302b"}"/>` + t(x, y + 5, String(n), 12, st.hot ? INK : TEXT, 700, "middle");
  if (st.from === st.to) {
    const x = cx(st.from), w = Math.max(st.label.length * 7.4 + 60, 200);
    body += rect(x - w / 2, y - 18, w, 36, { fill: st.hot ? "#1d2614" : "#171c19", stroke: st.hot ? LIME : RULE, r: 18 });
    body += num(x - w / 2 + 18) + t(x + 10, y + 5, st.label, 14, st.hot ? LIME : TEXT, 600, "middle");
    if (st.note) body += t(x + w / 2 + 12, y + 5, st.note, 13, MUTE);
  } else {
    const x1 = cx(st.from), x2 = cx(st.to), dir = Math.sign(x2 - x1);
    body += `<line x1="${x1 + dir * 6}" y1="${y}" x2="${x2 - dir * 8}" y2="${y}" stroke="${c}" stroke-width="${st.hot ? 2.5 : 1.8}" marker-end="url(#${st.hot ? "h" : "m"})"/>`;
    body += `<circle cx="${x1}" cy="${y}" r="4" fill="${c}"/>`;
    const mid = (x1 + x2) / 2, lw = st.label.length * 7.3 + 52;
    body += rect(mid - lw / 2, y - 15, lw, 30, { fill: INK, stroke: st.hot ? LIME : RULE, r: 15 });
    body += num(mid - lw / 2 + 16) + t(mid + 12, y + 5, st.label, 13.5, st.hot ? LIME : TEXT, 600, "middle");
    if (st.note) {
      const right = Math.max(x1, x2);
      const nx = right + 14, fits = nx + st.note.length * 6.6 < W - 20;
      body += fits ? t(nx, y + 5, st.note, 12.5, MUTE) : t(Math.min(x1, x2) - 14, y + 5, st.note, 12.5, MUTE, 400, "end");
    }
  }
  y += ROW;
}
const H = y + 90;

let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <marker id="m" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#9fb2a6"/></marker>
  <marker id="h" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${LIME}"/></marker>
  <radialGradient id="g" cx="50%" cy="0%" r="60%"><stop offset="0" stop-color="${LIME}" stop-opacity=".09"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="${INK}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
<image href="${MARK}" x="${L0}" y="40" width="40" height="40"/>
${t(L0 + 54, 70, "One call, one trade: start to finish", 28, TEXT, 700)}
${t(W - L0, 70, "Lime = the trade, through Definitive Flash", 15, LIME, 600, "end")}
`;
lanes.forEach((l, i) => {
  const x = L0 + i * (LW + GAP);
  s += `<rect x="${x}" y="${TOP - 80}" width="${LW}" height="${H - TOP + 30}" rx="16" fill="#101412" stroke="${RULE}"/>`;
  s += `<line x1="${cx(i)}" y1="${TOP}" x2="${cx(i)}" y2="${H - 60}" stroke="#222a26" stroke-dasharray="4 6"/>`;
  if (l.logo) s += `<image href="${l.logo}" x="${cx(i) - l.lw / 2}" y="${TOP - 62}" width="${l.lw}" height="${l.lh}"/>`;
  else s += t(cx(i), TOP - 44, l.n, 19, TEXT, 700, "middle");
  s += t(cx(i), TOP - 20, l.sub, 13, l.n === "Definitive" ? LIME : MUTE, 500, "middle");
});
s += body;
s += t(L0, H - 24, "Kall never holds your keys or funds: you sign every trade in your own wallet. Records on Arkiv are read-only.", 14, MUTE);
s += t(W - L0, H - 24, "Made with Claude", 13, MUTE, 500, "end");
s += "</svg>\n";
await writeFile(R + "docs/flow.svg", s);
console.log(`docs/flow.svg ${W}x${H}`);
