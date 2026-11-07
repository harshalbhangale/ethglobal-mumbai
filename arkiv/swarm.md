# Arkiv + Swarm

**What's on Swarm:** a snapshot of each call's post, taken the first time we price the call: the text, the link,
the call we read, the entry price and the time captured. **What's on Arkiv:** the call and its result. A caller who
deletes the post still leaves the proof.

**Which field holds the reference:** `swarmRef` (64 hex characters) on `kallr.calls`, copied to
`kallr.call-results`.

**One example:** @CryptoKaleo's "Buy more Bitcoin." (https://x.com/CryptoKaleo/status/2118301291923329528)
- Arkiv: https://rabdi.explorer.arkiv.network/tx/0x6277fe4ad3d91f45d6932829e3b75ff2eb3b2dad828584ae31de453fbac38cbc
- Swarm: https://api.gateway.ethswarm.org/bzz/ead89c2aeed4dbcf16a7d65094692e1a4ad4d70a95a380832867a286d101de3e/

**Postage stamp and node:** we don't buy our own stamp. Uploads go through Swarm's public gateway
(`https://api.gateway.ethswarm.org`), which stamps them; we hold no batch of our own. If `SWARM_API_URL` and
`SWARM_POSTAGE_BATCH_ID` are set, the server uses a Bee node and batch we provide instead (none is set today).

**Code:** upload and read in
[`kallr-webapp/lib/server/swarm.ts`](../kallr-webapp/lib/server/swarm.ts); the snapshot is built where a call is first priced.

**To try one upload and one read:** open the Swarm link above (read). To upload, run the server with an Arkiv
writer key and price a call; it posts the snapshot to the gateway and stores the returned reference in `swarmRef`.
