# AfterMarkets

Every call on X has an after market.

Crypto Twitter runs on calls, and nobody keeps score. AfterMarkets prices every call at the minute it was posted, scores it when its timeframe ends, and lets you copy it with one tap: a real order on Base through Definitive Flash with take-profit and stop-loss attached. You sign in your own wallet; nothing trades without you.

Built at ETHGlobal Mumbai 2026.

## What's here

| Surface | What it does | Status |
| --- | --- | --- |
| **Web app** (`/app`, PWA) | Sign in with X (Privy), wallet on Base, type an order like `copy $5 of ETH tp 10% sl 5%`, sign, and it's placed on Flash with TP/SL. Open orders come back from Flash. | Works against live Flash quotes; first funded mainnet order not run yet |
| **Chrome extension** | On x.com, call posts get a card: the caller's record, this call's move since posting, token safety checks, and Copy buttons that open the desk prefilled | Built; loads unpacked |
| **@AfterMarkets on X** | Tag it under a call: replies with the caller's record and this call's after market. Reply `copy $2, TP 10%, SL 5%`: replies with a desk link to sign | Works in dry run on real posts; needs X API keys to go live |
| **Safety checks** | Token: honeypot, owner powers, taxes, liquidity, age. Caller: did their wallet sell what they called? | Token checks live (no key); wallet check needs a free Etherscan key |

## Run it

Node 20+ (the repo is tested on Node 24).

```sh
npm install
cp apps/web/.env.example apps/web/.env.local   # add NEXT_PUBLIC_PRIVY_APP_ID, DEFINITIVE_API_KEY
npm run dev                                    # http://localhost:3000
npm test                                       # all packages
```

In the Privy dashboard: enable **Twitter** and **Email** login, enable **embedded wallets** for Ethereum, and add `http://localhost:3000` to allowed origins.

Environment (`apps/web/.env.local`):

| Variable | Needed for | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Sign-in and wallet on `/app` | `/app` shows a setup notice |
| `DEFINITIVE_API_KEY` | Flash quotes and orders | Falls back to Definitive's public dev key |
| `ETHERSCAN_API_KEY` | Caller wallet check | Wallet check reports unavailable; token checks still work |
| `NEXT_PUBLIC_BASE_RPC_URL` | Balances and Chainlink prices | Public Base RPC |

The service worker only registers in production builds: `npm run build && npm start` to test install.

## Placing an order (Definitive Flash)

1. The desk parses the text (`packages/domain/src/order.ts`) and prices TP/SL from Chainlink ETH/USD and BTC/USD on Base.
2. `/api/flash/quote` asks Flash for a quote with an `attachedBracket` (TP/SL). Approvals are sized to the order (`forceMinimalAllowance`), never unlimited.
3. The user's Privy wallet approves if needed and signs the entry and the TP/SL pair.
4. `/api/flash/order` submits; the TP/SL arms on the first fill. The API key stays on the server.

TP/SL attach to buys only (a spot sell leaves you in USDC). Tradable today: ETH (as WETH) and BTC (as cbBTC) against USDC on Base.

## Chrome extension

```sh
npm run build -w @aftermarkets/extension                                       # for http://localhost:3000
AFTERMARKETS_APP_ORIGIN=https://your-app.example npm run build -w @aftermarkets/extension
```

Then `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`, and open x.com with `npm run dev` running.

It reads only what's on screen: no X API, no cookies. The caller's record counts the calls from that caller this browser has seen. The content script is about 6 KB; the server classifies and scores.

## Safety checks

`/api/checks` and the extension card use free public sources:

| Check | Source | Key |
| --- | --- | --- |
| Honeypot, mint, hidden owner, owner can change balances, taxes, closed source | [GoPlus Security](https://gopluslabs.io) | None |
| Liquidity, 24h volume, token age, no market on Base | [Dexscreener](https://dexscreener.com) | None |
| Caller bought before posting / sold after (front-running) | [Etherscan API V2](https://docs.etherscan.io/etherscan-v2) on Base | Free `ETHERSCAN_API_KEY` |

Findings are observations, not verdicts. A source that fails is shown as unavailable, never as clean.

```sh
curl -s localhost:3000/api/checks -H 'content-type: application/json' \
  -d '{"token":"0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"}'
```

## The X bot

Tag @AfterMarkets under a call and it replies with the caller's record and how this call played out. Reply `copy $2, TP 10%, SL 5%` and it answers with a link to the desk, where you review and sign. The bot never trades.

```sh
# Try a reply on any public post, no keys needed (posts nothing):
npm run try -w @aftermarkets/x-bot -- https://x.com/<handle>/status/<id> "copy $2, TP 10%, SL 5%"

# Run the mentions loop (dry run unless X_BOT_POST=1):
cp services/x-bot/.env.example services/x-bot/.env   # bot account keys
node --env-file=services/x-bot/.env --import tsx services/x-bot/src/main.ts
```

The X API is pay-per-use: about $0.001 per mention read, $0.005 per post read, $0.01 per bot reply ($0.20 if the reply contains a link). Run the loop on an always-on host (Railway, Fly, EC2), not a serverless platform.

## Structure

```
apps/
  web/                Next.js PWA: landing (/), desk (/app), Flash + after market + checks APIs
  extension/          Chrome extension for x.com: after market cards, safety checks, copy buttons
services/
  x-bot/              @AfterMarkets on X: after market replies, copy links to the desk
packages/
  domain/             order parser, reputation, signals
  integrations/       call scoring, after market, Definitive Flash, safety checks, X API
  database/           Postgres schema, X ID ↔ wallet identity (not wired in yet)
docs/PLAN.md          what we are building and in what order
```

## Not done yet

- First funded order on Base mainnet (needs a Privy app ID and a few USDC on Base)
- Cancel orders from the desk; live orders stream instead of 15s polling
- Calls stored on a server (Arkiv), creator pages, follow
- Chainlink CRE workflow that scores expired calls
- Android keyboard
