# Feedback for the Anon-RPC team

From building Kall Markets at ETHGlobal Mumbai (Nov 2026): the web app routes its Base and Arkiv reads through
`@anon-rpc/browser-harness@0.4.0` and the Nym network.

## What worked well

- One class, one `fetch`. Plugging it into viem was a one-line change (`http(url, { fetchFn: worker.fetch })`).
- Hash pinning and the sandbox needed nothing from us: no CSP changes on our site.
- Calls made before `ready` are buffered, so the app didn't need its own queue.

## What we hit

1. **The Nym worker drops request headers.** The same request through the passthrough worker reached Arkiv's
   RPC with `content-type: application/json` and got 200; through Nym it arrived without it and got
   **415 Unsupported Media Type**. Base's public RPC doesn't check the header, so Base reads worked. We added a
   small relay on our server that adds the header. The harness's `normalize-request.ts` forwards headers
   correctly, so this looks like it's in the Nym worker.
2. **Some Nym gateways can't serve browsers.** On some loads the worker never signalled ready, but its fetches
   failed with `gateway selection error … the specified gateway '…' does not support the wss protocol`.
   We now close the worker and start a fresh one (new random gateway) after a tunnel error or 40 s without
   ready. Choosing only wss-capable gateways in the browser would remove the retry.
3. **One call at a time makes a busy page slow.** A page refresh fires about ten small reads; queued one by
   one through the mixnet, later ones waited 15–20 s. JSON-RPC batching fixed it for us (most RPCs accept
   batches). A note in the wallet guide recommending batching would help others.
4. **The bootstrap read failed first.** viem's default mainnet RPC was down (503) during our test, so
   `ready` rejected before the worker even loaded. Worth suggesting a fallback list in the docs.
5. **Tor's demo gateway didn't connect** within 45 s in our tests, so Nym is our default.

## Small asks

- Surface "this worker can't reach the network" as `signalFailed`, instead of a ready that never comes.
- An `onStats` hook (requests, bytes, latency) would make a "private reads" indicator easy for every app.
