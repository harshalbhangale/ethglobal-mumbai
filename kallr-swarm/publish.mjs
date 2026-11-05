// Builds the static Kallr dashboard and uploads it to Swarm as a website.
//   node kallr-swarm/publish.mjs            → bundle + upload, prints the Swarm URL
//   node kallr-swarm/publish.mjs --build    → bundle only (kallr-swarm/dist)
// Uploads go through the Swarm Foundation's public gateway, which stamps them with its own batch,
// unless SWARM_API_URL (your Bee node) and SWARM_POSTAGE_BATCH_ID (your batch) are set.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const api = (process.env.SWARM_API_URL ?? "https://api.gateway.ethswarm.org").replace(/\/$/, "");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyFileSync(join(here, "index.html"), join(dist, "index.html"));
await build({
  entryPoints: [join(here, "src/main.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: join(dist, "app.js"),
  logLevel: "warning",
});
console.log("Built kallr-swarm/dist");
if (process.argv.includes("--build")) process.exit(0);

// A Swarm website is a tar collection with an index document.
const tar = execFileSync("tar", ["-cf", "-", "-C", dist, "."]);
const headers = {
  "content-type": "application/x-tar",
  "swarm-collection": "true",
  "swarm-index-document": "index.html",
  "swarm-error-document": "index.html",
};
if (process.env.SWARM_POSTAGE_BATCH_ID) headers["swarm-postage-batch-id"] = process.env.SWARM_POSTAGE_BATCH_ID;
const res = await fetch(`${api}/bzz`, { method: "POST", headers, body: tar });
if (!res.ok) throw new Error(`Swarm upload failed: ${res.status} ${await res.text()}`);
const { reference } = await res.json();
console.log(`Swarm reference: ${reference}`);
console.log(`Open: ${api}/bzz/${reference}/`);
