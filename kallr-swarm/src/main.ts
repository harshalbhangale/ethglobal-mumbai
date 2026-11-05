import { arkivPublic, readOpenCalls, readResults, readTrades } from "../../packages/integrations/src/arkiv";

/**
 * Kallr's dashboard as a static page on Swarm. It reads Arkiv from the browser, trusting only
 * entities Kallr's writer created, and links each call to its Swarm snapshot.
 */

const WRITER = "0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53" as const;
const EXPLORER = "https://rabdi.explorer.arkiv.network";
const SWARM = "https://api.gateway.ethswarm.org";

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (bps: number) => `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;
const when = (s: bigint | number) =>
  new Date(Number(s) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function list(id: string, items: string[], empty: string) {
  $(id).innerHTML = items.length ? items.join("") : `<li class="muted">${esc(empty)}</li>`;
}

async function main() {
  $("writer").textContent = WRITER;
  const client = arkivPublic("");
  const now = Math.floor(Date.now() / 1000);
  const [results, open, trades] = await Promise.all([
    readResults(client, WRITER),
    readOpenCalls(client, WRITER, now),
    readTrades(client, WRITER),
  ]);

  const by = new Map<string, { hits: number; scored: number; open: number }>();
  for (const r of results) {
    const e = by.get(r.caller.value) ?? { hits: 0, scored: 0, open: 0 };
    e.scored++;
    if (r.status.value === "hit") e.hits++;
    by.set(r.caller.value, e);
  }
  for (const c of open) {
    const e = by.get(c.caller.value) ?? { hits: 0, scored: 0, open: 0 };
    e.open++;
    by.set(c.caller.value, e);
  }
  list(
    "callers",
    [...by.entries()]
      .sort((a, b) => b[1].scored - a[1].scored || b[1].open - a[1].open)
      .map(
        ([caller, e]) =>
          `<li><a href="https://x.com/${esc(caller)}">@${esc(caller)}</a><span class="num">${
            e.scored ? `${e.hits} of ${e.scored} hit` : "no results yet"
          } · ${e.open} open</span></li>`,
      ),
    "No calls priced yet.",
  );

  const archive = [
    ...open.map((c) => ({
      key: c.$key, postId: c.postId.value, caller: c.caller.value, ref: c.swarmRef?.value ?? null, at: Number(c.postedAt.value),
      line: `$${c.asset.value} ${c.direction.value} · open until ${when(c.deadline.value)}`, cls: "",
    })),
    ...results.map((r) => ({
      key: r.$key, postId: r.postId.value, caller: r.caller.value, ref: r.swarmRef?.value ?? null, at: Number(r.postedAt.value),
      line: `$${r.asset.value} ${r.direction.value} · ${r.status.value} ${pct(Number(r.returnBps.value))}`,
      cls: Number(r.returnBps.value) > 0 ? "up" : Number(r.returnBps.value) < 0 ? "down" : "",
    })),
  ].sort((a, b) => b.at - a.at);
  list(
    "archive",
    archive.slice(0, 30).map(
      (c) =>
        `<li><span><a href="https://x.com/${esc(c.caller)}/status/${esc(c.postId)}">@${esc(c.caller)}</a> <span class="num ${c.cls}">${esc(c.line)}</span></span><span>${
          c.ref ? `<a href="${SWARM}/bzz/${esc(c.ref)}/">Snapshot on Swarm</a> · ` : ""
        }<a href="${EXPLORER}/entity/${esc(c.key)}">Arkiv record</a></span></li>`,
    ),
    "No calls archived yet.",
  );

  list(
    "trades",
    trades.slice(0, 30).map(
      (t) =>
        `<li><span>${t.side.value === "buy" ? `Buy $${esc(t.qty.value)} of ${esc(t.asset.value)}` : `Sell ${esc(t.qty.value)} ${esc(t.asset.value)}`}${
          t.caller?.value ? ` · copied @${esc(t.caller.value)}` : ""
        }</span><span><span class="pill">${esc(t.source.value)}</span> <span class="num muted">${when(t.placedAt.value)} · ${short(t.trader.value)}</span> · <a href="${EXPLORER}/entity/${esc(t.$key)}">Arkiv record</a></span></li>`,
    ),
    "No trades yet.",
  );
}

main().catch((err) => {
  for (const id of ["callers", "archive", "trades"]) list(id, [], `Couldn't read Arkiv: ${err instanceof Error ? err.message : err}`);
});
