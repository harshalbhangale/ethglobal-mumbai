# How we use Arkiv

**What existed before the event:** the X extension's post card and ticker button (ported from our earlier X
trading extension on Monad) and an Android keyboard forked from FlorisBoard. **Added at Mumbai:** every call,
result and trade record on Arkiv, the reads that show them, the scoring and the Swarm snapshots. See the README's
"What we reused".

| What we filter on | Why |
| --- | --- |
| `caller` | a caller's record |
| `deadline` | open calls, and the scoring queue |
| `status`, `returnBps` | hit rate and results |
| `trader`, `source` | a wallet's trades, and which surface placed them |
| `flashOrderId`, `postId` | link a trade to its order and to the call it copied |

**Who can edit each entity:** nobody. Calls, results and callers are written read-only. A trade is created
read-only and then handed to the trader's wallet, so it's theirs to keep or delete.

**When each expires:** an open call at its deadline plus 48 hours to score it; results, trades and callers at about
182 days, with extension open to anyone.

**Each Arkiv feature changes something users see:**
- `readonly`: the "nobody can edit this result" promise on the caller's record.
- `changeOwnership`: "Trade record on Arkiv" on a receipt is a record the trader owns.
- `ExpirationTime`: open calls disappear from the board by themselves.
- `permissionlessExtension`: if we vanish, anyone can keep a record alive.
- Indexed queries: the caller pages, your trades and History, and the scoring queue.

**Where users see it:** "On Arkiv ↗" under the caller on X; each feed post and each trade links its entity; the
iPhone keyboard's caller page lists every call with its Arkiv link.
