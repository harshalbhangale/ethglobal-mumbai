# Arkiv + Swarm

A call is only worth scoring if nobody can quietly change what was said. Callers delete posts that went
wrong. So Kallr keeps the post itself on Swarm and the record about it on Arkiv.

| | Arkiv (Rabdi) | Swarm |
| --- | --- | --- |
| What | The call and its result: caller, coin, direction, deadline, entry, exit, hit or miss | The post as Kallr saw it: text, link, the call it read, entry price, when it was captured |
| Why there | Small, typed, queryable, read-only, with expiry and ownership rules | Larger content, addressed by its hash, so it can't be edited after the fact |
| Link | `swarmRef` on `kallr.calls` and `kallr.call-results` | The 64-hex reference |

The dashboard itself is also on Swarm: a static page that reads Arkiv from the browser, with no Kallr server in between.

## How it works

1. The extension or keyboard asks Kallr to price a call (`/api/after-market`, `/api/keyboard`).
2. The first time Kallr sees that post, it uploads a snapshot to Swarm
   (`kallr-webapp/lib/server/swarm.ts`, `uploadJson`):
   ```json
   { "kind": "kallr.call-snapshot", "version": 1, "postId": "…", "url": "https://x.com/<handle>/status/<id>",
     "caller": "<handle>", "text": "<post text, up to 2000 chars>", "asset": "ETH", "direction": "up",
     "postedAt": 1800000000, "deadline": 1800086400, "entry": 3412.5, "priceSource": "chainlink-base", "capturedAt": 1800000300 }
   ```
3. It creates the `kallr.calls` entity with `swarmRef` set to the reference (`kallr-webapp/lib/server/arkiv.ts`, `recordCall`).
4. When the call settles, the `kallr.call-results` entity copies the same `swarmRef`, so the snapshot outlives the
   short-lived call entity.
5. `/trades` and the Swarm dashboard show **Snapshot on Swarm** and **Arkiv record** links on every call.

If Swarm is down, the call is still written to Arkiv, without `swarmRef`. Posts already on Arkiv aren't uploaded again.

## Postage batch

Uploads go through the Swarm Foundation's public gateway, `https://api.gateway.ethswarm.org`, which stamps them with
its own batch. To use your own Bee node and batch, set `SWARM_API_URL` and `SWARM_POSTAGE_BATCH_ID`; both the server and
`kallr-swarm/publish.mjs` send `swarm-postage-batch-id` when it's set.

## Example

- Arkiv entity: `TODO(team)`, once the writer `0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53` has tGLM and has written a call.
- Its snapshot: `TODO(team)`, the `swarmRef` on that entity.
- Swarm dashboard: reference `75976044e7fc84d8bf7d5f20735d1447564a73f385fab23cfcb354e445a2c922`
  (`https://api.gateway.ethswarm.org/bzz/75976044e7fc84d8bf7d5f20735d1447564a73f385fab23cfcb354e445a2c922/`).
  Its script is served; the page waits for the gateway's approval (see below).

## Check it yourself

Find a call and its reference on Arkiv:

```
arkiv.schema = str('kallr.calls') AND $creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53) AND postId = str('<post id>')
```

Read the snapshot:

```sh
curl -s https://api.gateway.ethswarm.org/bzz/<swarmRef>/
```

Upload a snapshot the way the server does:

```sh
curl -s -X POST -H 'content-type: application/json' \
  --data '{"kind":"kallr.call-snapshot","version":1,"postId":"1"}' \
  'https://api.gateway.ethswarm.org/bzz?name=kallr-call-1.json'
# → {"reference":"<64 hex>"}
```

Build and publish the dashboard:

```sh
node kallr-swarm/publish.mjs --build   # bundle only, into kallr-swarm/dist
node kallr-swarm/publish.mjs           # bundle and upload; prints the reference and URL
```

## Code

- `kallr-webapp/lib/server/swarm.ts`: upload and read URLs
- `kallr-webapp/lib/server/arkiv.ts`: `recordCall` uploads the snapshot, then writes the entity with `swarmRef`
- `packages/integrations/src/arkiv.ts`: `swarmRef` columns, `callSnapshot`, `findCall`
- `kallr-webapp/app/trades/page.tsx`: the **Call archive** section
- `kallr-swarm/`: the static dashboard and its publisher

## Demo moment

`TODO(team)`: open a call on X, check it with the keyboard, then open its Arkiv record and follow `swarmRef` to the
snapshot. Delete the post (on a test account) and show the snapshot still there.

## What got in our way

1. **The public gateway holds HTML sites without saying so.** `POST /bzz` with a website collection returns a reference
   right away. Opening it then redirects to `bzz.link/forbidden?hash=…`, while `app.js` from the same upload is
   served with a 200. We found the rule (approval form, an ENS name, or your own Bee node) only after the redirect.
   **Ask:** a response header or field on upload that says the page will be held, and the approval route linked from the gateway docs.
2. **We couldn't find how long gateway-stamped uploads stay.** The gateway picks the batch, and we didn't find its
   TTL documented. For "a deleted post stays provable", that's the number that matters.
   **Ask:** return the batch ID and its expiry with the upload, or document the gateway's retention.
3. **No hosted batch for hackathons.** Our own batch means running Bee and funding it with xDAI and xBZZ.
   **Ask:** a faucet or sponsor batch ID for builders, like Arkiv's tGLM faucet.
