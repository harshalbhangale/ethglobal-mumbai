# Kall Markets on Arkiv

A caller's record decides whether people put real money behind their next post. If that record lives in our
database, you're trusting us instead of trusting them, and that's no better. So it lives on Arkiv.

## Why not just Postgres?

Ask what a user would lose if we swapped Arkiv out:

- **Checking without asking us.** Anyone can query a caller's record from a public node. Our `/trades` page does
  exactly that, from the browser, with no Kall server in between.
- **Records nobody can quietly edit.** Results are read-only. A miss stays a miss, and we can't fix it from a
  database console either.
- **Owning your trades.** Each trade record is handed to the wallet that placed it. In Postgres it would be a row
  that disappears with us.
- **Other apps can read it.** A wallet, a Telegram bot or a rival dashboard can show the same records without an
  API key from us.
- **Expiry for free.** An open call is temporary by nature; Arkiv drops it at its deadline, no cron job.

## What we store

Four entity types, all written by one wallet: `0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53` (Rabdi testnet,
chain `7794095`). Schemas: [`packages/integrations/src/arkiv.ts`](../packages/integrations/src/arkiv.ts).

| Entity | What it is | Who can change it | How long it lives |
| --- | --- | --- | --- |
| `kallr.calls` | A call while it's open: caller, coin, direction, entry price, deadline, Swarm snapshot | Nobody (read-only) | Until its deadline + 48h to score it |
| `kallr.call-results` | How it ended: hit, miss or flat, entry, exit, return | Nobody; **anyone** may extend its life | ~182 days (Arkiv's max), extendable |
| `kallr.trades` | A Definitive Flash order placed through Kall, linked to the call it copied | Nobody; owned by the trader, who can delete or extend it | ~182 days |
| `kallr.tracked-callers` | The callers we follow | Nobody | ~182 days |

Each Arkiv feature maps to something a user sees:

- `readonly` → "nobody can edit this result".
- `changeOwnership` → every trade is owned by the trader, not by us.
- `ExpirationTime.atDate` → open calls drop off the board on their own.
- `permissionlessExtension` → if we vanish, anyone can keep a caller's record alive.
- Indexed `caller`, `trader`, `source`, `deadline` → the caller pages, your trades, and the scoring queue.

## The one line that makes it trustworthy

Anyone can write an entity with our schema tag. So every read we make adds `$creator = addr(<our writer>)`, and
a forged record is ignored. Check it yourself:

```
arkiv.schema = str('kallr.call-results') AND $creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53) AND caller = str('cryptokaleo')
```

## Arkiv + Swarm

Callers delete posts that went wrong, so a record about a post isn't enough; we keep the post too. The first
time we price a call, a snapshot (text, link, the call we read, entry price, time captured) goes to Swarm, and
its 64-hex reference is stored as `swarmRef` on the Arkiv call and copied to its result. The snapshot outlives
the tweet. Example: [@CryptoKaleo's "Buy more Bitcoin."](https://x.com/CryptoKaleo/status/2118301291923329528)
→ [Arkiv `0x6277fe4a…`](https://rabdi.explorer.arkiv.network/tx/0x6277fe4ad3d91f45d6932829e3b75ff2eb3b2dad828584ae31de453fbac38cbc)
→ [Swarm `ead89c2a…`](https://api.gateway.ethswarm.org/bzz/ead89c2aeed4dbcf16a7d65094692e1a4ad4d70a95a380832867a286d101de3e/).

## One mistake, in public

We read @AltcoinSherpa's "Looking decent for $BTC in the short term" as a short, because of "short term". We
fixed the reader and deleted the record
([`0xf44153ff…`](https://rabdi.explorer.arkiv.network/tx/0xf44153ff5a8915142f65b56596908f2cf37a5c9948b8d3082fda444379169802)).
The deletion is on chain too, which is how it should be.

## What got in our way

Honest notes for the Arkiv team (SDK `@arkiv-network/sdk` 1.0.1, Rabdi):

1. **A schema doesn't pin its writer.** `defineSchema` only adds a tag anyone can write, so a reader that forgets
   `.createdBy(writer)` shows forged records. Say it loudly in the schema docs, or let a schema pin its creator.
2. **No write-once.** There's no unique key, so "create this call only if it doesn't exist" is a query then a
   create, and two server instances can both write. `uniqueBy: ["postId"]` would fix it.
3. **One write at a time per key.** Concurrent creates race the nonce, so we queue writes in-process. Creating
   then handing an entity to its owner is two transactions.
4. **A server key can't fund itself.** The faucet needs a person in a browser; our writer sat at 0 tGLM and every
   write failed until someone noticed. A faucet API, or an SDK error that says "fund this address", would help.
5. **"Permanent" needs someone to come back.** A caller's record is history, but the max life is ~182 days and
   nothing extends it unless we run a job.
6. **Small things:** explorer URL formats aren't documented (we read the explorer's JS to find `/tx/` and
   `/entity/`), old docs URLs 404, and query results are `readonly` arrays that trip up React state.

## What worked really well

- `defineSchema` gives typed reads and writes, and `where` refuses columns that aren't indexed.
- `readonly`, `changeOwnership` and `permissionlessExtension` map one-to-one onto the product's promises.
  We didn't have to invent any trust logic.
- Reading from the browser with no key just works.

## Code

- [`packages/integrations/src/arkiv.ts`](../packages/integrations/src/arkiv.ts): schemas and reads
- [`kallr-webapp/lib/server/arkiv.ts`](../kallr-webapp/lib/server/arkiv.ts): writes (calls, results, trades)
- [`kallr-webapp/lib/server/swarm.ts`](../kallr-webapp/lib/server/swarm.ts): post snapshots
- [`kallr-webapp/app/api/arkiv/score`](../kallr-webapp/app/api/arkiv/score): settles expired calls (daily cron)
- [`kallr-swarm/`](../kallr-swarm): the dashboard as a static page on Swarm, reading Arkiv with no server
