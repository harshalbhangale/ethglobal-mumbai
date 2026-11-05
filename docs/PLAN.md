# AfterMarkets: build plan

ETHGlobal Mumbai 2026. Living doc: tick items off as they land.

## The problem: KOL calls have no after market

Crypto Twitter runs on calls. A KOL (key opinion leader) posts "$ETH to 4k, longing here", thousands of people see it, and a lot of them buy. Then:

- **Nobody keeps score.** Calls are never priced at the moment they're posted, so a KOL's track record is whatever they say it is. Wins get screenshotted, losses get deleted.
- **Followers act late and blind.** Between reading a call and buying, the follower has to leave X, open an exchange, find the token, size the trade and guess the exits. By then the price has moved, and they have no take-profit or stop-loss, so they hold losers too long.
- **Incentives are backwards.** KOLs get paid for reach (and sometimes for shilling), not for being right. Paid promotions look exactly like honest calls.
- **No accountability loop.** When a call goes bad there's no record linking the post, the price at posting and the outcome.

**AfterMarkets fixes this where the call happens: in the replies.** Tag @AfterMarkets under any call and it replies with that KOL's after market: how their past calls actually played out, priced at posting time. Reply `copy $2, TP 10%, SL 5%` and it places the trade on Base with the exits attached, then calls you when one of them hits.

## Surfaces

| Surface | What it does | Status |
| --- | --- | --- |
| Landing page `/` | Explains the product, thread demo | Done |
| Web app `/app` (PWA) | Desk on laptop and phone: sign in with X, wallet, order composer, open orders | Desk + order parser done; no real execution yet |
| X bot @AfterMarkets | Reads mentions, replies with the caller's after market, takes `copy` replies as orders | Not started |
| Telegram bot | Same commands in DMs/groups; fill and exit alerts; the "call you back" channel | Not started |
| Chrome extension | Overlays the after market on any call in the X timeline, one-click copy | Not started |
| Agent | Watches calls and positions, places and exits trades, pays for data and execution with x402 | Not started |

## Building blocks

| Piece | Where it lands | Work for AfterMarkets |
| --- | --- | --- |
| Chrome extension (trade cards on cashtags, creator badge, reputation, drawer) | `apps/extension` | Flash ticket with TP/SL, after market badge |
| Creator pages, methodology page | `apps/web` | Next to the PWA desk |
| Call classifier + scoring at expiry (`directional-return-v1`) | `packages/integrations` | Prices from Base / Chainlink |
| Reputation tiers, red flags, view models | `packages/domain` | Ready |
| X ID ↔ wallet identity binding (Privy, nonce/replay protection) | `packages/database` | Ready |
| Postgres schema (drizzle) | `packages/database` | Add orders, bot users, Telegram links |
| Post archive: public posts snapshotted on-chain (text hash + oEmbed) so deleted calls stay provable | `contracts/PostArchive.sol` | Deploy on Base |
| MCP server for agents (unsigned trades + approval links) | `apps/web/app/api/mcp` | Add Flash tools; the agent's toolset |
| Envio indexer | `services/indexer` | Base: Flash fills, archive events (optional) |

Ground rules: keep identity, call record and wallet returns separate; token amounts as bigint, never floats; no automatic signing; honest empty states.

## Repo layout

```
apps/
  web/            Next.js PWA: landing, /app desk, creator + methodology pages
  extension/      Chrome MV3 extension, Flash ticket
services/
  x-bot/          mention poller + reply writer
  telegram-bot/   bot + alerts
  agent/          order executor + exit watcher, x402 client
  indexer/        Envio (optional)
packages/
  domain/         reputation, signals, view models, order parser
  integrations/   calls, scoring, signals, definitive.ts, chainlink.ts
  database/       identity, schema, orders, bot users
contracts/        PostArchive.sol on Base
cre/              Chainlink CRE workflows (last)
docs/
```

## Build order

### 0. Restructure (before anything else)
- [x] Convert this repo to an npm workspace; move the PWA to `apps/web`
- [x] Add `packages/domain`, `packages/integrations` (calls, scoring, signals), `packages/database`
- [ ] Move `lib/order.ts` into `packages/domain`

### 1. Definitive Flash execution (first)
- [x] Flash client: quote → fund → user signs (Privy wallet) → submit (`packages/integrations/src/definitive.ts`, `/api/flash/*`)
- [x] `attachedBracket` for TP/SL on each buy; approvals sized per order (`forceMinimalAllowance`)
- [x] Composer places real orders; open orders read from Flash
- [x] USDC approval flow and low-gas warning
- [ ] First real order on Base mainnet from a funded wallet (not yet run)
- [x] Order status: pending, working, filled, exits armed, cancelled
- [ ] Cancel from the desk (needs a funder-signed cancel message)
- [ ] Orders WebSocket instead of 15s polling

### 2. Call data
- [ ] Wire the imported classifier + scoring into the desk and bot
- [ ] Market list: Base tokens tradable on Flash
- [ ] Price each call at post time and store it: post id, handle, asset, direction, price, time
- [ ] "After market" card: hit rate, median return, last N calls with outcomes
- [ ] Keep identity, call outcomes and wallet returns as separate signals; never blend into one score

### 3. X bot
- [ ] X API access: mentions + post replies need a paid tier; budget for it. Scraping X breaks their terms and gets accounts banned: use the API for the bot, scraping only for offline backfill if at all
- [ ] Poll mentions → parse the parent post (call) → reply with the after market card (image or text)
- [ ] `copy …` replies → parse with `parseOrder` → link X user to their Privy wallet (sign in with X already does this) → confirm link to approve in the PWA
- [ ] Never trade without an explicit signature from the user's wallet

### 4. Telegram bot
- [ ] `/link` to connect a Telegram chat to the AfterMarkets account
- [ ] `/after @handle`, `/copy <post url> $2 tp 10% sl 5%`
- [ ] Push alerts: filled, TP hit, SL hit (this is the "we call you back"; voice call via Twilio is a stretch goal)

### 5. Chrome extension
- [ ] Add `apps/extension`: detects cashtags/ticker cards, shows creator reputation
- [ ] Flash ticket on each call (amount + TP/SL)
- [ ] Load unpacked for the demo

### 6. Agent + payments
- [ ] Agent loop: watch new calls from followed KOLs, apply user rules (max size, only KOLs with hit rate > X), place orders through Flash within a pre-approved budget
- [ ] Payments with x402: the agent pays per request for call data and scoring, and KOLs can charge for premium calls
- [ ] Session keys / spend limits on the embedded wallet so the agent can't drain it

### 7. Post archive
- [ ] Deploy `PostArchive.sol` on Base
- [ ] Bot archives every call it's tagged under (text hash + public oEmbed snapshot), so a deleted call still has a record
- [ ] After market card links each call to its archive transaction

### 8. Chainlink CRE (last)
- [ ] CRE workflow that scores calls at expiry using Chainlink price feeds and writes the result on-chain, so track records are verifiable, not just our database
- [ ] CRE workflow as the exit watcher: trigger TP/SL settlement from Chainlink prices
- [ ] Price feed already wired: ETH/USD on Base `0x7104…Bb70`

## Ship checklist
- [ ] Deploy web to Vercel (PWA works only on HTTPS)
- [ ] Privy app: X + email login, embedded wallets, production origin allowed
- [ ] X developer app + bot account; Telegram bot token
- [ ] Extension packed and loaded unpacked for the demo (Chrome Web Store review is too slow for the hackathon)
- [ ] Demo script: tag bot under a real call → reply → copy → fill on Base → TP alert on Telegram
