# How we use Arkiv

## Do the filters, editors and expiries fit what the app does?

| What users see | Arkiv feature behind it |
| --- | --- |
| **Your trades** on `/trades`: every order you placed from the desk, the extension on X or the keyboard | `trades` filtered by indexed `trader`, sorted by `placedAt` |
| **Everyone's trades**, with a count per surface | `createdBy(writer)`; `source` is indexed |
| "Owned by the trader" on each trade, and its Arkiv record link | `changeOwnership` to the trader after a read-only create; `$owner` vs `$creator` |
| **Open calls** per caller, which vanish when their timeframe is over | `calls` expire at `deadline` + 48h (`ExpirationTime.atDate`); `deadline > now` |
| **Caller records** (hit rate, median move) that a caller can't edit | `call-results` are `readonly`; filtered by indexed `caller` |
| Records that outlive us | `permissionlessExtension` on results: anyone can extend them past ~182 days |

Who can edit each entity:

- **Trades:** nobody can change them (`readonly`). The trader owns them and can delete or extend; we can't touch them after the handoff.
- **Calls and results:** read-only; only our writer created them, and readers filter on `$creator`, so a forged
  entity with our schema tag is ignored.

When each expires:

- **A call** is short-lived on purpose. It's an open position in public, and once it's scored it has no reason to stay.
- **A result** is history, so it gets the longest life Arkiv allows, and anyone can extend it.
- **A trade** lasts as long as a trading journal is useful, and its owner decides whether to keep it.

## Does each feature change something users see?

- `readonly` → the dashboard can say "nobody can edit this result".
- `changeOwnership` → "owned by the trader" on every trade.
- `atDate` expiry → open calls drop off the board on their own, with no cleanup job.
- `permissionlessExtension` → a caller's record can't be quietly lost.
- Indexed `trader`, `caller`, `source`, `deadline` → the Yours/Everyone tabs, per-surface counts, caller board and scoring queue.
- Browser reads (`arkivPublic` in `apps/web/app/trades/page.tsx`) → the dashboard works without our server.
  Live order status still comes from Flash.
