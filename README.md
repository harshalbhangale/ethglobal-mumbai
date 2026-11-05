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

## Structure

```
apps/
  web/                Next.js PWA: landing (/), desk (/app), Privy, PWA manifest + service worker
packages/
  domain/             reputation, signals, view models
  integrations/       call classification, scoring, price data
  database/           Postgres schema, X ID ↔ wallet identity
docs/PLAN.md          what we are building and in what order
```

## Next

See [docs/PLAN.md](docs/PLAN.md). Short version:

- Flash order flow: quote, sign, submit, with `attachedBracket` for TP/SL
- X bot: read mentions, parse calls, reply with the after market
- Voice callback when an exit fills
