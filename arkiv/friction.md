# Feedback for Arkiv

SDK `@arkiv-network/sdk` 1.0.1, Rabdi testnet. In order of how much each cost us. Same notes as the end of
[README.md](README.md).

## 1. A schema doesn't pin its writer
**Expected:** records under `kallr.call-results` come from us. **Happened:** `defineSchema` only adds a tag anyone can
write, so a reader that forgets `.createdBy(writer)` shows forged records. We hit this ourselves: a wrong record
appeared in a query until we added the creator filter.
**Repro:** write an entity with the same schema tag from a second wallet; an unfiltered query returns it.
**Ask:** say it loudly in the schema docs, or let a schema pin its creator.

## 2. No write-once
There is no unique key, so "create this call only if it doesn't exist" is a query then a create, and two server
instances can both write. **Ask:** `uniqueBy: ["postId"]` on a schema.

## 3. One write at a time per key
Concurrent creates race the nonce, so we queue writes in one process. Creating a trade and then handing it to its
owner is two transactions. **Ask:** create with an initial owner in one transaction.

## 4. A server key can't fund itself
The faucet needs a person in a browser. Our writer sat at 0 tGLM and every write failed until someone noticed.
**Ask:** a faucet API, or an SDK error that says "fund this address".

## 5. "Permanent" needs someone to come back
A caller's record is history, but the maximum life is about 182 days and nothing extends it unless we run a job.
`permissionlessExtension` helps, but a record with no extender still ends.

## 6. Small things
Explorer URL formats aren't documented (we read the explorer's JavaScript to find `/tx/` and `/entity/`), old docs
URLs 404, and query results are `readonly` arrays that trip up React state.

## What worked well
`readonly`, `changeOwnership` and `permissionlessExtension` mapped straight onto what we promise users, and
`ExpirationTime.atDate` removed a cron job for open calls.
