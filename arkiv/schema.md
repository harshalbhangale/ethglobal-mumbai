# Arkiv schema

Network: Arkiv testnet **Rabdi**, chain `7794095`, RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`.
Writer wallet: `0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53` (the Kallr server; pays the gas).
Schemas are defined in [`packages/integrations/src/arkiv.ts`](../packages/integrations/src/arkiv.ts) with `defineSchema`,
so every entity carries an indexed `arkiv.schema` tag.

Anyone can write an entity with our tags, so every read we make adds `$creator = addr(<writer>)`
(`.createdBy(writer)` in the SDK). That one filter is what makes these records trustworthy.

## `kallr.trades`: a Flash order placed through Kallr

Written by `kallr-webapp/app/api/flash/order` after Definitive Flash accepts the order on Base mainnet.

| Column | Type | Indexed | Meaning |
| --- | --- | --- | --- |
| `trader` | addr | yes | The wallet that signed the order |
| `source` | str | yes | `desk`, `extension` or `keyboard` |
| `asset` | str | yes | `ETH` or `BTC` |
| `side` | str | yes | `buy` or `sell` |
| `orderType` | str | no | `market` or `limit` |
| `qty` | str | no | As sent to Flash: USDC on a buy, asset units on a sell |
| `limitPrice` | str, optional | no | Limit price in USDC |
| `takeProfit`, `stopLoss` | str, optional | no | Exit trigger prices in USD (Flash attached bracket) |
| `flashOrderId` | str | yes | Definitive's order ID; live status comes from Flash |
| `postId`, `caller` | str, optional | yes | The call on X this trade copied |
| `placedAt` | u64 | yes | Unix seconds |

- **Owner:** created read-only by the writer, then `changeOwnership` to `trader`. `$creator` stays the writer (we saw
  the order on Flash); `$owner` is the trader, who can delete or extend it but never change it.
- **Expires:** `ExpirationTime.max()` (~182 days). The trader can extend it.
- **Queried by:** `trader` (Yours), `$creator` (Everyone), sorted by `placedAt`.

## `kallr.calls`: a call on X while it is open

Written the first time we price a call (`/api/after-market` from the extension, `/api/keyboard` from the keyboard).

| Column | Type | Indexed | Meaning |
| --- | --- | --- | --- |
| `postId` | str | yes | X post ID |
| `caller` | str | yes | X handle, lowercase |
| `asset` | str | yes | `ETH`, `BTC`, … |
| `direction` | str | yes | `up` or `down` |
| `postedAt` | u64 | yes | From the post ID's timestamp |
| `deadline` | u64 | yes | `postedAt` + stated timeframe (or the default horizon) |
| `horizonStated` | bool | no | Whether the post named a timeframe |
| `entry` | dec, optional | no | Chainlink price on Base at the minute it was posted |

- **Owner:** the writer, read-only.
- **Expires:** at `deadline` + 48h scoring window (`ExpirationTime.atDate`), capped at 181 days. Arkiv drops it on its own.
- **Queried by:** `deadline > now` (open calls), `deadline <= now` (due for scoring), `postId` (write once).

## `kallr.call-results`: how a call ended

Written when a call settles, by the same routes or by `/api/arkiv/score`, which prices the exit from Chainlink at the deadline.

| Column | Type | Indexed | Meaning |
| --- | --- | --- | --- |
| `postId`, `caller`, `asset` | str | yes | As above |
| `direction` | str | no | `up` or `down` |
| `status` | str | yes | `hit`, `miss` or `flat` |
| `returnBps` | i32 | yes | Move in the called direction, basis points |
| `entry`, `exit` | dec | no | Prices at posting and at the deadline |
| `postedAt` | u64 | no | |
| `deadline` | u64 | yes | Sort key for a caller's history |

- **Owner:** the writer, read-only, with `permissionlessExtension`: anyone can keep a caller's record alive; nobody can edit a miss.
- **Expires:** `ExpirationTime.max()` (~182 days), extendable by anyone.
- **Queried by:** `caller`, `$creator`, sorted by `deadline`.

## Queries you can run

```
arkiv.schema = str('kallr.trades') AND $creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53)
arkiv.schema = str('kallr.call-results') AND $creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53) AND caller = str('<handle>')
```
