# Kallr: build plan

ETHGlobal Mumbai 2026. This is a living doc, so tick items off as they land. It was cut down on purpose: if something isn't
listed under "Build next", we don't build it before the demo.

## The problem

Crypto Twitter runs on calls ("$ETH to 4k, longing here"), and nobody keeps score:

- Calls are never priced when they're posted, so a caller's record is whatever they say it is.
- To act on a call, a follower leaves X, finds the token and guesses the exits. They end up late, with no take-profit or stop-loss.
- When a call goes bad, nothing links the post, the price at posting and the outcome.

**Kallr** prices every call at the minute it was posted and scores it when its timeframe ends. It lets you copy the call
with one tap: a real Definitive Flash order on Base with TP/SL attached, signed in your own wallet.

## The whole product, in one line per surface

| Surface | What it does | Status |
| --- | --- | --- |
| **Chrome extension** (`kallr-extension`) | On x.com: the caller's record and the call's move under each call, a trade card with TP/SL, token checks on contract posts | Built |
| **Web app** (`kallr-webapp`) | Desk at `/app` (type an order, sign, placed on Flash) and `/trades` (every trade and caller record, read from Arkiv) | Built; first funded mainnet order not run |
| **Terminal** (`/terminal` in the web app) | Live calls, your trades, and a chat box for standing rules (see below) | Not started |
| **Android keyboard** (`kallr-keyboard`) | A Kallr row in any app: paste a post link to see the record; `copy $5 tp 10% sl 5%` opens the desk to sign | Built (debug APK) |

Rules that hold everywhere:

- **The user signs every trade.** No agent wallet, no session keys, no auto-trading.
- Approvals are sized to the order (`forceMinimalAllowance`), never unlimited.
- We show records and checks, never advice.

## Sponsors (max 3)

1. **Definitive:** every trade is a Flash order on Base mainnet with an attached TP/SL bracket. The demo must show a real order.
2. **Arkiv:** trades, calls and call results live on Arkiv (Rabdi testnet). Terminal rules go there next. See [arkiv/README.md](../arkiv/README.md).
3. Third: undecided (ENS names on records, or none). Not built.

## The Terminal

One page that answers "what's happening, and what should Kallr do about it for me":

```
┌ LIVE CALLS ─────────────────────────┬ MY TRADES ───────────────────────────────┐
│ @caller   $BTC ▲  2m ago   +0.4%     │ $5 BTC  TP 82,000 / SL 76,000   Working  │
│ @caller2  $ETH ▼  9m ago   −1.1%     │ $20 ETH  TP hit +10%             Done     │
│ [Copy] [Watch]                       │ History ▸                                 │
├ CHAT ────────────────────────────────┴───────────────────────────────────────────┤
│ > if @caller calls BTC, ask me to copy $10 tp 10% sl 5%                          │
│ ✓ Rule: @caller · BTC · ask me · $10 · TP 10% / SL 5%                            │
│ > ignore posts with a contract address                                           │
│ ✓ Rule: any caller · contract posts · ignore                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Live calls:** open `kallr.calls` from Arkiv (what the extension and keyboard have priced), with the move since posting.
- **My trades:** `kallr.trades` for your wallet from Arkiv, with live status from Flash. This is what `/trades` already reads.
- **Chat:** plain English becomes a stored rule. The rule is shown back so you can see what was understood, and a small
  form does the same job without the chat.

A rule matches on **caller, asset, direction**, plus optionally "record at least N% hit rate", and does one of three things:

| Action | What happens |
| --- | --- |
| Notify me | A push notification: "@caller called BTC ▲" |
| Ask me to approve | A notification with the order filled in; tapping it opens the desk to sign |
| Ignore | Never show these calls |

"Approve" never trades on its own: it opens the order and you sign. Rules are `kallr.rules` entities on Arkiv, owned by
your wallet. They're matched when a new call is written to Arkiv. Notifications are Web Push from the installed PWA
(Android and desktop; no Telegram, no app store).

## Build next (in order)

1. [ ] **First real Flash order on Base mainnet.** Needs a Privy app ID and a funded wallet (~$20 USDC + ~$1 of ETH for gas). Record it for the demo.
2. [ ] **Terminal, read-only:** `/terminal` with live calls and my trades from Arkiv + Flash (reuse `/trades` reads).
3. [ ] **Rules:** `kallr.rules` schema on Arkiv, form + chat to create them, list and delete.
4. [ ] **Matching + notifications:** on each new call, match rules; Web Push for notify and approve; approve opens `/app?order=…`.
5. [ ] **Deploy** the web app (Vercel project `kallr`, HTTPS for the PWA) and allow its origin in Privy.
6. [ ] **Demo video:** call on X → card → copy → signed Flash order on Base → shows on Arkiv and in the Terminal. Post on Discord and X, tagging @DefinitiveFi.

## Done

- Flash client: quote → approve (minimal) → sign entry + TP/SL → submit (`packages/integrations/src/definitive.ts`, `/api/flash/*`)
- Desk order parser and composer, open orders from Flash
- Call classifier and scoring at expiry (`directional-return-v1`, Chainlink prices on Base)
- Extension: trade card, ticker Buy button, record panel, call-check drawer, profile card, follows, trades open in the web app for the Kall wallet to sign, popup
- Token safety checks (GoPlus, Dexscreener) and caller wallet check (Etherscan V2, needs a free key)
- Arkiv: `kallr.trades`, `kallr.calls`, `kallr.call-results`, `/trades` dashboard reading Arkiv from the browser, `/api/arkiv/score`
- Android keyboard row and `/api/keyboard`

## Parked (code may exist, not part of the demo)

| Item | Why parked |
| --- | --- |
| X bot (`kallr-xbot`) | Code works in dry run; a live run costs X API credits and isn't needed for the demo |
| Telegram bot, MCP, agents, x402 | Replaced by the Terminal's rules + notifications, which keep the user signing |
| Postgres / AWS (`packages/database`) | Arkiv is the store |
| PostArchive contract, Envio | Not needed to show the product working |
| World ID | Not one of our three sponsors |
| Cancel from the desk, orders WebSocket | Nice to have; polling works |
| Android Share target in the PWA | The keyboard already covers Android |

## Repo layout

```
kallr-webapp/     Next.js PWA: landing (/), desk (/app), /trades, API routes (Flash, after market, checks, Arkiv, keyboard)
kallr-extension/  Chrome MV3 extension for x.com
kallr-keyboard/   Android keyboard (FlorisBoard fork) with the Kallr row
kallr-xbot/       X bot (parked)
packages/
  domain/         order parser, reputation, signals
  integrations/   call scoring, after market, Definitive Flash, Arkiv, safety checks, X API
  database/       Postgres schema (parked)
arkiv/            Arkiv schema and judging notes
docs/             this plan, brand
```
