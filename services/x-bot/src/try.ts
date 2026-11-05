import { fetchPublicPost, parsePostUrl } from "@aftermarkets/integrations/calls";
import { xClient } from "@aftermarkets/integrations/x-api";
import { replyFor } from "./bot";
import { appUrl, credentialsFromEnv, nowSeconds, recordLookup } from "./runtime";

/**
 * Print the reply @AfterMarkets would post if tagged under a post, without posting anything:
 *   npm run try -w @aftermarkets/x-bot -- https://x.com/kol/status/123 "copy $2, TP 10%, SL 5%"
 * The post is read through X's public embed, so no keys are needed. With X keys set, the
 * caller's track record is included too.
 */

const [url, ...rest] = process.argv.slice(2);
const target = url ? parsePostUrl(url) : null;
if (!target) {
  console.error('Usage: npm run try -w @aftermarkets/x-bot -- <x.com post url> ["copy $2, TP 10%, SL 5%"]');
  process.exit(1);
}

const post = await fetchPublicPost(target.postId);
if (!post) {
  console.error("That post isn't publicly available.");
  process.exit(1);
}

const creds = credentialsFromEnv();
const lookup = recordLookup(creds ? xClient(creds) : null);
const reply = await replyFor(
  {
    postId: "0",
    text: `@${post.authorHandle} @AfterMarkets ${rest.join(" ")}`.trim(),
    fromHandle: "you",
    parent: { postId: post.postId, handle: post.authorHandle, text: post.text },
  },
  { botHandle: "AfterMarkets", appUrl: appUrl(), nowSeconds: nowSeconds(), record: lookup.record },
);

console.log(`@${post.authorHandle}: ${post.text}\n`);
console.log(reply ?? "(no reply)");
if (!creds) console.log("\n(Track record needs X API keys; this call's after market is live.)");
