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

## Proposed repo layout

The repo is a single Next.js app today. Move to a workspace once a second runtime (the bots) lands:

```
apps/
  web/            current Next.js PWA (landing + /app)
  extension/      Chrome MV3 extension (content script on x.com)
services/
  x-bot/          mention poller + reply writer
  telegram-bot/   grammY bot, alerts
  agent/          order executor + exit watcher, x402 client
packages/
  core/           order parser, call classifier, scoring (shared by everything)
  chain/          Base client, Definitive Flash client, Chainlink feeds
cre/              Chainlink CRE workflows (last)
docs/
```

`lib/order.ts` moves to `packages/core` first, since the bots and the extension all need it.

## Build order

### 1. Definitive Flash execution (first)
- [ ] Flash client: quote → build → user signs (Privy embedded wallet) → submit
- [ ] `attachedBracket` for TP/SL on each order
- [ ] Composer "Queue order" becomes "Place order"; open orders read from Flash, not localStorage
- [ ] USDC approval flow and low-gas warning (wallet panel already detects it)
- [ ] Order status: pending, filled, TP hit, SL hit, cancelled

### 2. Call data
Classify a post into asset + direction, bind X handles to wallets, and score calls at expiry (`directional-return-v1`, hypothetical returns, not wallet returns).
- [ ] Classifier + scoring in `packages/core`
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
- [ ] MV3 content script on x.com: detect calls in the timeline, show an after market badge
- [ ] Popup: copy with one click, opens the PWA to sign
- [ ] Reuse the PWA's design tokens and `packages/core`

### 6. Agent + payments
- [ ] Agent loop: watch new calls from followed KOLs, apply user rules (max size, only KOLs with hit rate > X), place orders through Flash within a pre-approved budget
- [ ] Payments with x402: the agent pays per request for call data and scoring, and KOLs can charge for premium calls
- [ ] Session keys / spend limits on the embedded wallet so the agent can't drain it

### 7. "Archive" integration
- [ ] **To confirm:** which sponsor/tool is this? (Arkiv data layer for storing calls permanently? Something else?)

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
