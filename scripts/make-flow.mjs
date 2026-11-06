/** Draws docs/flow.svg: three apps feed one pipeline, from a caller's post to a scored record. */
import { readFile, writeFile } from "node:fs/promises";

const R = new URL("..", import.meta.url).pathname;
const b64 = async (p, t) => `data:${t};base64,${(await readFile(R + p)).toString("base64")}`;
const DEF = await b64("kallr-webapp/public/sponsors/definitive.svg", "image/svg+xml");
const ARK = await b64("kallr-webapp/public/sponsors/arkiv.png", "image/png");
const MARK = await b64("kallr-webapp/public/brand/mark.png", "image/png");

const W = 1600, H = 900;
const INK = "#0b0d0c", CARD = "#131715", RULE = "#242c28", TEXT = "#e9eee6", MUTE = "#7f8b84", LIME = "#c6f25a";
const F = `font-family="Inter, Helvetica Neue, Helvetica, Arial, sans-serif"`;
const t = (x, y, s, size = 15, fill = TEXT, w = 400, a = "start", ls = 0) =>
  `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${a}" letter-spacing="${ls}">${s}</text>`;

let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <radialGradient id="g" cx="72%" cy="42%" r="55%"><stop offset="0" stop-color="${LIME}" stop-opacity=".10"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
  <linearGradient id="track" gradientUnits="userSpaceOnUse" x1="520" x2="1520" y1="0" y2="0"><stop offset="0" stop-color="${LIME}" stop-opacity=".25"/><stop offset=".5" stop-color="${LIME}"/><stop offset="1" stop-color="${LIME}" stop-opacity=".25"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
  <marker id="m" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="${LIME}"/></marker>
</defs>
<rect width="${W}" height="${H}" fill="${INK}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
<image href="${MARK}" x="70" y="62" width="40" height="40"/>
${t(124, 92, "How Kall works", 30, TEXT, 700)}
${t(W - 70, 92, "From a caller’s post to a record nobody can edit", 17, MUTE, 400, "end")}
`;

// Left: three ways in
const apps = [
  ["Kall Extension", "A card under the call on X"],
  ["Kall Keyboard", "Copy a call in any chat"],
  ["Kall Web App", "The callers you follow"],
];
const AX = 70, AW = 300, AH = 92, AY = [250, 380, 510];
s += t(AX, 220, "THREE WAYS IN", 12, LIME, 700, "start", 2);
apps.forEach(([n, d], i) => {
  s += `<rect x="${AX}" y="${AY[i]}" width="${AW}" height="${AH}" rx="20" fill="${CARD}" stroke="${RULE}" stroke-width="1.5"/>`;
  s += t(AX + 26, AY[i] + 40, n, 20, TEXT, 700) + t(AX + 26, AY[i] + 66, d, 15, MUTE);
});

// Merge into the server
const MX = 470, MY = 425;
AY.forEach((y) => {
  const y0 = y + AH / 2;
  s += `<path d="M${AX + AW} ${y0} C${AX + AW + 60} ${y0} ${MX - 70} ${MY} ${MX - 6} ${MY}" fill="none" stroke="${LIME}" stroke-opacity=".55" stroke-width="2"/>`;
});
s += `<circle cx="${MX + 22}" cy="${MY}" r="30" fill="${LIME}" opacity=".35" filter="url(#glow)"/>`;
s += `<circle cx="${MX + 22}" cy="${MY}" r="22" fill="${INK}" stroke="${LIME}" stroke-width="2.5"/><circle cx="${MX + 22}" cy="${MY}" r="7" fill="${LIME}"/>`;
s += t(MX + 22, MY - 44, "Kall server", 14, TEXT, 700, "middle");

// The track
const stages = [
  { n: "Read", d: ["AI: is it a real call?", "Long or short, which coin"] },
  { n: "Check", d: ["Fake contract?", "Then no trade"] },
  { n: "Price", d: ["Chainlink on Base", "price at the post"] },
  { n: "Trade", d: ["Quote → you sign →", "best route → filled"], logo: DEF, hot: true },
  { n: "Record", d: ["Call and trade,", "read-only forever"], logo: ARK },
  { n: "Score", d: ["Time’s up: hit or miss,", "the real return"] },
];
const TX0 = MX + 52, TX1 = W - 150, STEP = (TX1 - TX0 - 60) / (stages.length - 1);
s += `<line x1="${TX0}" y1="${MY}" x2="${TX1}" y2="${MY}" stroke="url(#track)" stroke-width="3"/>`;
stages.forEach((st, i) => {
  const x = TX0 + 60 + i * STEP;
  if (st.hot) {
    s += `<rect x="${x - 112}" y="${MY - 175}" width="224" height="370" rx="26" fill="${LIME}" fill-opacity=".06" stroke="${LIME}" stroke-opacity=".7" stroke-width="1.5"/>`;
    s += `<circle cx="${x}" cy="${MY}" r="34" fill="${LIME}" opacity=".45" filter="url(#glow)"/>`;
  }
  s += `<circle cx="${x}" cy="${MY}" r="${st.hot ? 26 : 20}" fill="${st.hot ? LIME : INK}" stroke="${LIME}" stroke-width="2"/>`;
  s += t(x, MY + 6, String(i + 1), st.hot ? 18 : 15, st.hot ? INK : LIME, 800, "middle");
  s += t(x, MY - 62, st.n, st.hot ? 26 : 22, st.hot ? LIME : TEXT, 700, "middle");
  if (st.logo) s += st.logo === DEF
    ? `<image href="${DEF}" x="${x - 75}" y="${MY - 140}" width="150" height="17"/>`
    : `<image href="${ARK}" x="${x - 40}" y="${MY - 146}" width="80" height="20"/>`;
  st.d.forEach((l, k) => { s += t(x, MY + 66 + k * 24, l, 14.5, st.hot ? TEXT : MUTE, st.hot ? 500 : 400, "middle"); });
});

// Loop back: the record shows on every card
const lx = TX0 + 60 + 5 * STEP;
const px = 800;
s += `<path d="M${lx} ${MY + 128} C${lx} ${760} ${AX + AW / 2 + 40} ${760} ${AX + AW / 2} ${AY[2] + AH + 14}" fill="none" stroke="${LIME}" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round" marker-end="url(#m)"/>`;
s += `<rect x="${px - 215}" y="${712}" width="430" height="36" rx="18" fill="${INK}" stroke="${LIME}" stroke-opacity=".5"/>`;
s += t(px, 736, "The caller’s record shows up in all three apps", 14.5, TEXT, 500, "middle");

// Footer: who holds the keys
s += `<line x1="70" y1="832" x2="${W - 70}" y2="832" stroke="${RULE}"/>`;
s += `<circle cx="80" cy="862" r="6" fill="${LIME}"/>` + t(96, 867, "Your Kall wallet (Privy, made when you sign in with X) signs every trade with no pop-up; pick MetaMask to sign yourself.", 14, MUTE);
s += "</svg>\n";
await writeFile(R + "docs/flow.svg", s);
console.log("docs/flow.svg");
