# Arkiv friction

What got in our way building AfterMarkets on Arkiv (SDK `@arkiv-network/sdk` 1.0.1, testnet Rabdi), and how to reproduce it.

## 1. Anyone can write entities with my schema's tag
**Expected:** `select().from(Trades)` returns my app's trades.
**Happened:** a named schema only adds `arkiv.schema = str('...')`, which anyone can write, so a reader that forgets
`.createdBy(writer)` shows forged records. The SDK README does say "anyone can write an entity a query matches",
but only to explain why misfits are skipped; it never says to filter by creator.
**Ask:** say it in the "Define a Schema" section, or let a schema pin its creator so every query through it adds `$creator`.

## 2. Whether writes cost gas isn't on the clients page
**Expected:** the docs page on clients says what a write costs.
**Happened:** only the SDK README says writes are paid in tGLM from the faucet. The docs page sends you to a Networks
page. We found out by reading the README, and our first writer started with 0 balance.
**Ask:** one line on the clients page: "writes cost tGLM; get it at hub.arkiv.network/faucet".

## 3. No documented explorer URLs
**Expected:** a documented link format for an entity, so apps can link to a record.
**Happened:** we read the explorer's JS bundle to find `/entity/<key>`, `/tx/<hash>` and `/address/<addr>`.
**Ask:** document them, or export an `explorerUrl(entityKey)` helper from `@arkiv-network/sdk/chains`.

## 4. Docs URLs move
**Expected:** `/start-here/fundamentals/` (linked from search results) explains the basics.
**Happened:** it redirects to `/start-here/introduction/`. `/writing/change-and-delete/` and `/start-here/connect/` are 404;
the real pages are `/writing/change/` and `/start-here/clients/`. `llms.txt` was the fastest way to find pages.
**Ask:** redirects for old slugs, and link `llms.txt` from the docs home.

## 5. Query results are readonly arrays
**Expected:** `const [rows, setRows] = useState<Row[]>()` then `setRows(page.entities)`.
**Happened:** TypeScript error: `readonly Row[]` isn't assignable to `Row[]`. Fine once you know; easy to trip on in React.
**Ask:** a React snippet in the docs that types state from a query.

## 6. Blocks vs seconds
The docs say lifetimes are counted in blocks (2s on Rabdi), while the getting-started example talks in seconds.
`ExpirationTime.atDate` and `ExpirationTime.max()` made this a non-issue for us, so we'd lead with them.

## 7. One write at a time per account
Concurrent creates from one server key would race the nonce, so we queue writes in-process
(`apps/web/lib/server/arkiv.ts`). A note on concurrency, or a batching helper for "create, then hand to another owner"
(we do `createEntity` then `changeOwnership`, two transactions), would help server-side apps.

## What worked well
- Typed schemas with `defineSchema`: reads and writes are checked at compile time, and `where` refuses unindexed columns.
- `readonly`, `permissionlessExtension` and `changeOwnership` map directly onto product rules ("nobody can edit a miss",
  "the trader owns their record").
- Reading from the browser with no key just works (rate-limited, with a clear console warning).
