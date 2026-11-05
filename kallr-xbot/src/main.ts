import { readFileSync, writeFileSync } from "node:fs";
import { XApiError, xClient } from "@kallr/integrations/x-api";
import { replyFor, type Tag } from "./bot";
import { appUrl, credentialsFromEnv, nowSeconds, recordLookup } from "./runtime";

/**
 * @Kallr mentions loop. Polls mentions, works out the reply, and posts it only when
 * X_BOT_POST=1; otherwise it logs what it would say (dry run).
 */

const creds = credentialsFromEnv();
if (!creds) {
  console.error("Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_SECRET for the bot account.");
  console.error('To try a reply without keys: npm run try -w @kallr/x-bot -- <post url> "copy $2, TP 10%, SL 5%"');
  process.exit(1);
}

const POST = process.env.X_BOT_POST === "1";
const POLL_MS = Math.max(Number(process.env.X_POLL_SECONDS || 90), 30) * 1000;
const STATE_FILE = new URL("../.state.json", import.meta.url);

type State = { sinceId?: string; replied: string[] };
function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return { replied: [] };
  }
}
function saveState(s: State) {
  writeFileSync(STATE_FILE, `${JSON.stringify({ ...s, replied: s.replied.slice(-500) }, null, 2)}\n`);
}

const x = xClient(creds);
const lookup = recordLookup(x);
const me = await x.me();
const state = loadState();
console.log(`@${me.username} watching mentions every ${POLL_MS / 1000}s · ${POST ? "POSTING replies" : "dry run (set X_BOT_POST=1 to post)"}`);

async function tick() {
  const { mentions, newestId } = await x.mentions(me.id, state.sinceId);
  for (const m of mentions) {
    if (state.replied.includes(m.post.id)) continue;
    if (m.parent?.author_id && m.parentAuthor) lookup.remember(m.parentAuthor.username, m.parent.author_id);
    const tag: Tag = {
      postId: m.post.id,
      text: m.post.text,
      fromHandle: m.author?.username ?? "there",
      parent:
        m.parent && m.parentAuthor
          ? { postId: m.parent.id, handle: m.parentAuthor.username.toLowerCase(), text: m.parent.text }
          : null,
    };
    const reply = await replyFor(tag, {
      botHandle: me.username,
      appUrl: appUrl(),
      nowSeconds: nowSeconds(),
      record: lookup.record,
    });
    state.replied.push(m.post.id);
    if (!reply) continue;
    console.log(`\n← @${tag.fromHandle}: ${m.post.text}\n→ ${reply.replace(/\n/g, "\n  ")}`);
    if (POST) console.log(`  posted ${await x.reply(m.post.id, reply)}`);
    saveState(state);
  }
  if (newestId) state.sinceId = newestId;
  saveState(state);
}

for (;;) {
  try {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_MS));
  } catch (err) {
    const rateLimited = err instanceof XApiError && err.status === 429;
    console.error(rateLimited ? "Rate limited by X; backing off." : err);
    await new Promise((r) => setTimeout(r, rateLimited ? 15 * 60_000 : POLL_MS));
  }
}
