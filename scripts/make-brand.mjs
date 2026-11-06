/**
 * Builds every Kall Markets brand asset from docs/brand/logo-source.png (white mark on black):
 * a lime mark on a black tile, the same look as the app: web favicons / PWA / Apple icons, the share
 * card, and the extension icons.
 * Run after changing the logo:  npm run brand
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(`${REPO}/package.json`)("sharp");
const SRC = `${REPO}/docs/brand/logo-source.png`;
const INK = "#0b0d0c"; // black, the app's paper
const LIME = [0xc6, 0xf2, 0x5a]; // the app's lime (#c6f25a)

// 1. Brightness → alpha: a lime mark on transparent, with the soft edge kept but the glow trimmed.
const { data, info } = await sharp(SRC).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
const LO = 60, HI = 215;
const rgba = Buffer.alloc(info.width * info.height * 4, 255);
for (let i = 0; i < info.width * info.height; i++) {
  const v = data[i];
  [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]] = LIME;
  rgba[i * 4 + 3] = v <= LO ? 0 : v >= HI ? 255 : Math.round(((v - LO) * 255) / (HI - LO));
}
const trimmed = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toBuffer()
  .then((b) => sharp(b).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true }));
const W = trimmed.info.width, H = trimmed.info.height;
const side = Math.max(W, H);
// Square, centred, transparent: the master mark.
const mark = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: trimmed.data, left: Math.round((side - W) / 2), top: Math.round((side - H) / 2) }])
  .png()
  .toBuffer();
console.log(`mark: ${W}x${H} → ${side}² master`);

const markAt = (px) => sharp(mark).resize(px, px, { fit: "contain", kernel: "lanczos3" }).png().toBuffer();

/** A tile: `color` background (rounded unless full-bleed) with the lime mark centred at `frac` of the tile. */
async function tile(size, { frac, radius = 0.225, color = INK }) {
  const r = Math.round(size * radius);
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${color}"/></svg>`);
  const m = Math.round(size * frac);
  const offset = Math.round((size - m) / 2);
  return sharp(bg).composite([{ input: await markAt(m), left: offset, top: offset }]).png({ compressionLevel: 9 }).toBuffer();
}

const out = async (path, buf) => {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, buf);
  const meta = await sharp(buf).metadata();
  console.log(`${path.replace(REPO + "/", "")}  ${meta.width}x${meta.height}  ${(buf.length / 1024).toFixed(1)}KB`);
};

// Web app (black and lime)
const web = `${REPO}/kallr-webapp/public`;
await out(`${web}/brand/mark.png`, await markAt(256));
await out(`${web}/icons/icon-192.png`, await tile(192, { frac: 0.68 }));
await out(`${web}/icons/icon-512.png`, await tile(512, { frac: 0.68 }));
await out(`${web}/icons/icon-maskable-512.png`, await tile(512, { frac: 0.54, radius: 0 }));
await out(`${web}/icons/apple-touch-icon.png`, await tile(180, { frac: 0.66, radius: 0 }));
await out(`${web}/icons/favicon-32.png`, await tile(32, { frac: 0.78, radius: 0.22 }));
await out(`${web}/icons/favicon-16.png`, await tile(16, { frac: 0.84, radius: 0.2 }));

// Extension: toolbar/store icons, and the bare mark the cards tint with CSS.
const ext = `${REPO}/kallr-extension/public`;
for (const s of [16, 32, 48, 128]) await out(`${ext}/icons/icon-${s}.png`, await tile(s, { frac: s <= 16 ? 0.84 : s <= 32 ? 0.78 : 0.7, radius: 0.22 }));
await out(`${ext}/brand/mark.png`, await markAt(128));

// Android keyboard: legacy and round launcher icons, plus an adaptive-icon foreground (108dp canvas,
// mark inside the 66dp safe zone) on a black background, for every build variant.
const res = `${REPO}/kallr-keyboard/app/src/main/res`;
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const fgAt = async (px) => {
  const m = Math.round(px * 0.5);
  const o = Math.round((px - m) / 2);
  const clear = { create: { width: px, height: px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
  return sharp(clear).composite([{ input: await markAt(m), left: o, top: o }]).png({ compressionLevel: 9 }).toBuffer();
};
for (const v of ["stable", "beta", "debug"]) {
  for (const [d, k] of Object.entries(dens)) {
    await out(`${res}/mipmap-${d}/ic_app_icon_${v}.png`, await tile(48 * k, { frac: 0.62, radius: 0.18 }));
    await out(`${res}/mipmap-${d}/ic_app_icon_${v}_round.png`, await tile(48 * k, { frac: 0.58, radius: 0.5 }));
    await out(`${res}/mipmap-${d}/ic_app_icon_${v}_fg.png`, await fgAt(108 * k));
  }
  for (const round of ["", "_round"]) {
    await writeFile(
      `${res}/mipmap-anydpi-v26/ic_app_icon_${v}${round}.xml`,
      `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_app_icon_background"/>
    <foreground android:drawable="@mipmap/ic_app_icon_${v}_fg"/>
    <monochrome android:drawable="@mipmap/ic_app_icon_${v}_fg"/>
</adaptive-icon>
`,
    );
  }
}

// Share card (Open Graph / X), 1200×630.
{
const W = 1200, H = 630;
const font = "Helvetica Neue, Helvetica, Arial, sans-serif";
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="78%" cy="38%" r="70%">
      <stop offset="0" stop-color="#1a2410"/><stop offset="1" stop-color="${INK}"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <text x="142" y="142" fill="#ffffff" font-family="${font}" font-size="40" font-weight="700" letter-spacing="-0.5">Kall Markets</text>
  <text x="80" y="300" fill="#ffffff" font-family="${font}" font-size="76" font-weight="700" letter-spacing="-2.5">Every call on X</text>
  <text x="80" y="388" fill="#ffffff" font-family="${font}" font-size="76" font-weight="700" letter-spacing="-2.5">has an after market.</text>
  <text x="80" y="470" fill="#b8c2b7" font-family="${font}" font-size="28" letter-spacing="-0.2">Priced at posting. Copy it on Base with Definitive Flash.</text>
  <text x="80" y="560" fill="#c6f25a" font-family="${font}" font-size="24" font-weight="600">kall-markets.vercel.app</text>
</svg>`);
const mark = await sharp(`${REPO}/kallr-webapp/public/brand/mark.png`).resize(360, 360).png().toBuffer();
const markSmall = await sharp(`${REPO}/kallr-webapp/public/brand/mark.png`).resize(48, 48).png().toBuffer();
// Faint large mark on the right, small mark beside the name.
const faint = await sharp(mark).ensureAlpha().composite([{ input: Buffer.from([255, 255, 255, 60]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }]).png().toBuffer();
await sharp(bg)
  .composite([
    { input: faint, left: W - 360 - 70, top: 120 },
    { input: markSmall, left: 80, top: 104 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(`${REPO}/kallr-webapp/public/brand/og.png`);
console.log("kallr-webapp/public/brand/og.png  1200x630");
}
