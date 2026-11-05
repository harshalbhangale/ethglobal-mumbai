# AfterMarkets

Every call on X has an after market.

Tag **@AfterMarkets** under any crypto call to see how the caller's past calls played out. Reply `copy $2, TP 10%, SL 5%` and it places the trade on Base through Definitive Flash with the exits attached, then calls you when one of them hits.

Built at ETHGlobal Mumbai 2026.

## What's here

- **Landing page** at `/`
- **Web app** at `/app`: laptop-first desk, installable as a PWA (Chrome or Edge: "Install app" in the sidebar or address bar)
- **Privy**: sign in with X, email or a wallet; an embedded Ethereum wallet is created for users who don't have one
- **Base**: live USDC and ETH balances for the trading wallet

## Run it

Node 20+.

```sh
npm install
cp apps/web/.env.example apps/web/.env.local   # add NEXT_PUBLIC_PRIVY_APP_ID
npm run dev                  # http://localhost:3000
```

In the Privy dashboard: enable **Twitter** and **Email** login, enable **embedded wallets** for Ethereum, and add `http://localhost:3000` to allowed origins.

The service worker only registers in production builds: `npm run build && npm start` to test install.

## The X bot

Tag @AfterMarkets under a call and it replies with the caller's record and how this call played out. Reply `copy $2, TP 10%, SL 5%` and it answers with a link to the desk, where you review and sign the order in your own wallet. The bot never trades.

```sh
# Try a reply on any public post, no keys needed (posts nothing):
npm run try -w @aftermarkets/x-bot -- https://x.com/<handle>/status/<id> "copy $2, TP 10%, SL 5%"

# Run the mentions loop (dry run unless X_BOT_POST=1):
cp services/x-bot/.env.example services/x-bot/.env   # bot account keys
node --env-file=services/x-bot/.env --import tsx services/x-bot/src/main.ts
```

The mentions loop needs an X API plan that includes reading mentions and user posts (Basic or higher).

## Structure

```
apps/
  web/                Next.js PWA: landing (/), desk (/app), Privy, PWA manifest + service worker
services/
  x-bot/              @AfterMarkets on X: after market replies, copy links to the desk
packages/
  domain/             reputation, signals, order parser
  integrations/       call scoring, after market, Definitive Flash, X API
  database/           Postgres schema, X ID ↔ wallet identity
docs/PLAN.md          what we are building and in what order
```

## Next

See [docs/PLAN.md](docs/PLAN.md). Short version:

- Flash order flow: quote, sign, submit, with `attachedBracket` for TP/SL
- X bot: read mentions, parse calls, reply with the after market
- Voice callback when an exit fills
