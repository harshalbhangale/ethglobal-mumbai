/** Draws docs/architecture.svg: Kall Markets end to end, in the app's black and lime, logos embedded. */
import { readFile, writeFile } from "node:fs/promises";

const R = new URL("..", import.meta.url).pathname;
const b64 = async (p, t) => `data:${t};base64,${(await readFile(R + p)).toString("base64")}`;
const DEF = await b64("kallr-webapp/public/sponsors/definitive.svg", "image/svg+xml");
const ARK = await b64("kallr-webapp/public/sponsors/arkiv.png", "image/png");
const LINK = await b64("kallr-webapp/public/sponsors/chainlink.svg", "image/svg+xml");
const MARK = await b64("kallr-webapp/public/brand/mark.png", "image/png");

const W = 1600, H = 1180;
const INK = "#0b0d0c", CARD = "#141816", RULE = "#26302b", TEXT = "#e6ebe3", MUTE = "#8a968f", LIME = "#c6f25a";
const F = `font-family="Inter, Helvetica Neue, Helvetica, Arial, sans-serif"`;
const t = (x, y, s, size = 16, fill = TEXT, w = 400, a = "start") =>
  `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${a}">${s}</text>`;
const box = (x, y, w, h, { stroke = RULE, fill = CARD, r = 18, sw = 1.5 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const chip = (x, y, s, on = false) => {
  const w = s.length * 8.2 + 28;
  return `${box(x, y, w, 32, { r: 16, fill: on ? "#1d2614" : "#1a1f1c", stroke: on ? LIME : RULE })}${t(x + w / 2, y + 21, s, 14, on ? LIME : TEXT, 500, "middle")}`;
};
const arrow = (x1, y1, x2, y2, label = "", dash = false) => {
  const mid = (y1 + y2) / 2;
  return `<path d="M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}" fill="none" stroke="${LIME}" stroke-width="2" ${dash ? 'stroke-dasharray="6 6"' : ""} marker-end="url(#a)" opacity=".85"/>` +
    (label ? `${box((x1 + x2) / 2 - label.length * 3.9 - 12, mid - 14, label.length * 7.8 + 24, 26, { r: 13, fill: INK, stroke: RULE })}${t((x1 + x2) / 2, mid + 4, label, 12.5, MUTE, 500, "middle")}` : "");
};
const lines = (x, y, arr, size = 15, gap = 26, fill = MUTE) => arr.map((s, i) => t(x, y + i * gap, s, size, fill)).join("");

let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${LIME}"/></marker>
  <radialGradient id="g" cx="50%" cy="0%" r="70%"><stop offset="0" stop-color="${LIME}" stop-opacity=".10"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#1d2420"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="${INK}"/><rect width="${W}" height="${H}" fill="url(#dots)"/><rect width="${W}" height="${H}" fill="url(#g)"/>
<image href="${MARK}" x="60" y="44" width="44" height="44"/>
${t(118, 76, "Kall Markets", 30, TEXT, 700)}${t(306, 76, "· how it works, end to end", 22, MUTE, 400)}
${t(W - 60, 76, "Don’t trust. Check the caller. Trade it.", 18, LIME, 600, "end")}
`;

// 1. Where calls show up → three surfaces
const surf = [
  ["Kall Extension", "Chrome, on X", ["Card under every call", "Caller record + trade in place"]],
  ["Kall Keyboard", "iPhone · Android", ["Copy a call in any chat", "Trade without leaving it"]],
  ["Kall Web App", "kallmarkets.vercel.app", ["Callers, real posts, verdicts", "Orders, wallet, every proof"]],
];
t; s += t(60, 150, "1 · WHERE CALLS SHOW UP", 13, MUTE, 600);
surf.forEach(([n, sub, l], i) => {
  const x = 60 + i * 500;
  s += box(x, 168, 480, 150) + t(x + 28, 212, n, 22, TEXT, 700) + t(x + 452, 212, sub, 14, LIME, 500, "end") + lines(x + 28, 252, l);
});

// 2. One server
s += t(60, 396, "2 · ONE SERVER", 13, MUTE, 600);
s += box(60, 414, 1480, 196, { stroke: LIME, sw: 2, fill: "#111511" });
s += t(92, 458, "Kall API", 24, TEXT, 700) + t(208, 458, "one Next.js server on Vercel · every app talks to it, keys never leave it", 15, MUTE);
let cx = 92;
["AI call reader", "Coin check", "Flash quote + order relay", "Chainlink prices", "Caller records", "Receipt writer"].forEach((c, i) => {
  s += chip(cx, 480, c, i === 2); cx += c.length * 8.2 + 44;
});
s += lines(92, 552, ["Reads a post → real call? long or short? → checks the coin → prices it → quotes it → relays your signed order → writes the receipt."], 15, 26, TEXT);
s += t(92, 584, "Clients only sign. The server holds the Definitive and Arkiv keys; Chainlink CRE nodes check coins and score calls on their own.", 14, MUTE);
for (let i = 0; i < 3; i++) s += arrow(300 + i * 500, 318, 300 + i * 500, 414);

// 3. Built on: three columns
s += t(60, 690, "3 · BUILT ON", 13, MUTE, 600);
const cols = [
  { x: 60, w: 480, hot: true },
  { x: 560, w: 480 },
  { x: 1060, w: 480 },
];
const [d, c, a] = cols;
for (const k of cols) s += box(k.x, 708, k.w, 360, { stroke: k.hot ? LIME : RULE, sw: k.hot ? 2.5 : 1.5 });
s += arrow(300, 610, d.x + 240, 708, "quote · order");
s += arrow(800, 610, c.x + 240, 708, "prices · verdicts");
s += arrow(1300, 610, a.x + 240, 708, "calls · results · trades");

// Definitive
s += `<image href="${DEF}" x="${d.x + 28}" y="734" width="200" height="23"/>`;
s += t(d.x + d.w - 28, 754, "EVERY TRADE", 13, LIME, 700, "end");
s += t(d.x + 28, 800, "Definitive Flash", 22, TEXT, 700);
let sx = d.x + 28;
["Quote", "Sign", "Order", "Fill"].forEach((st, i) => { s += chip(sx, 822, st, true); sx += st.length * 8.2 + 28 + (i < 3 ? 22 : 0); if (i < 3) s += t(sx - 16, 843, "→", 15, LIME, 700, "middle"); });
s += lines(d.x + 28, 896, [
  "Best route across Base’s venues",
  "Impact, slippage and fee before you sign",
  "Approvals sized to the order, never unlimited",
  "Market, limit, TWAP, take-profit, stop-loss",
  "Fill returns the Basescan tx and venues",
], 15, 30, TEXT);

// Chainlink
s += `<image href="${LINK}" x="${c.x + 28}" y="730" width="150" height="32"/>`;
s += t(c.x + c.w - 28, 754, "THE TRUTH", 13, LIME, 700, "end");
s += t(c.x + 28, 800, "Prices and verdicts", 22, TEXT, 700);
s += chip(c.x + 28, 822, "Price feeds on Base") + chip(c.x + 28, 864, "CRE · check-coin", true) + chip(c.x + 218, 864, "CRE · score-calls", true);
s += lines(c.x + 28, 940, [
  "Entry price at the minute of the post",
  "CRE nodes agree, sign, write the verdict",
  "KallVerdicts contract on Base Sepolia",
  "A fake coin is blocked before any trade",
], 15, 30, TEXT);

// Arkiv
s += `<image href="${ARK}" x="${a.x + 28}" y="728" width="132" height="33"/>`;
s += t(a.x + a.w - 28, 754, "RECEIPTS", 13, LIME, 700, "end");
s += t(a.x + 28, 800, "Read-only records", 22, TEXT, 700);
["kallr.calls", "kallr.call-results", "kallr.trades", "kallr.tracked-callers"].forEach((k, i) => { s += chip(a.x + 28 + (i % 2) * 150, 822 + Math.floor(i / 2) * 42, k); });
s += lines(a.x + 28, 940, [
  "A miss can’t be edited or deleted",
  "Each trade is owned by the trader",
  "Posts snapshotted to Swarm",
  "Arkiv Rabdi testnet · chain 7794095",
], 15, 30, TEXT);

// Base strip
s += box(60, 1092, 1480, 56, { r: 28, fill: "#111511" });
s += `<circle cx="96" cy="1120" r="12" fill="#0052ff"/>`;
s += t(120, 1126, "Base mainnet", 17, TEXT, 700) + t(250, 1126, "· every Kall trade settles here, with a Basescan link in the app", 15, MUTE);
s += t(1510, 1126, "Made with Claude", 14, MUTE, 500, "end");
s += `</svg>\n`;
await writeFile(R + "docs/architecture.svg", s);
console.log("docs/architecture.svg");
