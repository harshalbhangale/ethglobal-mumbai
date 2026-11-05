# Why Arkiv

## If we swapped Arkiv for Postgres, what would users lose?

- **Checking without asking us.** A caller's record decides whether people copy their trades with real money. In
  Postgres only we can read it, and users take our word for it. On Arkiv anyone can run
  `arkiv.schema = str('kallr.call-results') AND caller = str('<handle>')` against a public node. `/trades`
  does exactly that from the browser.
- **Records nobody can quietly edit.** Results are `readonly`, so a bad call stays a miss, and we couldn't fix it in a
  database console either.
- **Owning your trade history.** Each trade record is handed to the trader's wallet. In Postgres it would be a row in
  our database that disappears with us.
- **Other apps reading the same data.** A wallet, a Telegram bot or a rival dashboard can show the same caller records
  and trades without an API key from us.
- **Expiry built in.** Open calls are temporary by nature. Arkiv drops them at their deadline; in Postgres that's a
  cron job and a `deleted_at` column.

## What we kept off Arkiv, and why

| Kept off | Why |
| --- | --- |
| Private keys, Privy sessions, signatures | Secrets; users sign in their own wallets and nothing is stored |
| The Definitive API key and quotes | Server secrets; quotes expire in seconds |
| Live order status, fills | Flash is the source of truth; we show it next to the Arkiv record rather than copy it |
| Post text | X's content; we store the post ID and what we measured (asset, direction, prices) |
| Token safety checks | Third-party data (GoPlus, Dexscreener) that changes; recomputed and cached for 10 minutes |
| Follows | Still in each browser for now; the next candidate for Arkiv (owned by the follower) |
