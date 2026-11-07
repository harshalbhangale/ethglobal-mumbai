# Schema

All entities are written by one wallet, `0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53` (Arkiv Rabdi testnet, chain `7794095`). Schemas are in
[`packages/integrations/src/arkiv.ts`](../packages/integrations/src/arkiv.ts). Every read adds
`$creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53)`, so entities forged under our tag are ignored.

| Entity | Fields (indexed = queried) | Owner / who can change it | Expires |
| --- | --- | --- | --- |
| `kallr.calls` | `postId`*, `caller`*, `asset`*, `direction`*, `postedAt`*, `deadline`*, `horizonStated`, `entry`, `swarmRef` | Our writer; read-only | Deadline + 48h scoring window |
| `kallr.call-results` | `postId`*, `caller`*, `asset`*, `direction`, `status`* (hit/miss/flat), `returnBps`*, `entry`, `exit`, `postedAt`, `deadline`*, `swarmRef` | Our writer; read-only; anyone may extend its life | About 182 days (Arkiv's max) |
| `kallr.trades` | `trader`*, `source`* (desk/extension/keyboard), `asset`*, `side`*, `orderType`, `qty`, `limitPrice`, `takeProfit`, `stopLoss`, `flashOrderId`*, `postId`*, `caller`*, `placedAt`* | Created read-only, then **handed to the trader's wallet** (`changeOwnership`) | About 182 days |
| `kallr.tracked-callers` | `handle`*, `focus`, `addedAt`* | Our writer; read-only | About 182 days |

## Queries the product runs

- A caller's record: `schema = kallr.call-results AND caller = <handle>`, newest `deadline` first. Used by the X profile card, the web feed and the keyboard's caller page.
- Open calls: `schema = kallr.calls AND deadline > now`.
- A wallet's trades: `schema = kallr.trades AND trader = <address>`. Used by the app's History.
- The scoring queue: `kallr.calls` past `deadline`, not yet scored.

## One query you can run

```
arkiv.schema = str('kallr.call-results') AND $creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53) AND caller = str('cryptokaleo')
```
Explorer: https://rabdi.explorer.arkiv.network
