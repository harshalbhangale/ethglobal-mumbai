import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

// The web app the extension talks to: the live app by default, `npm run build:local` for localhost:3000,
// or KALLR_APP_ORIGIN=https://your-app.example npm run build.
const origin = new URL(process.env.KALLR_APP_ORIGIN || "https://kallmarkets.vercel.app").origin;
if (!origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
  throw new Error("Use an HTTPS app origin, or localhost for development.");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
manifest.host_permissions = [`${origin}/*`];
// The follow-list bridge runs only on the app this build talks to.
manifest.content_scripts.push({ matches: [`${origin}/*`], js: ["app-bridge.js"], run_at: "document_start" });
await writeFile("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

await build({
  entryPoints: ["src/content.ts", "src/background.ts", "src/app-bridge.ts", "src/popup.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  define: { KALLR_APP_ORIGIN: JSON.stringify(origin) },
});
console.log(`Built dist/ for ${origin}. Load it at chrome://extensions → Load unpacked.`);
