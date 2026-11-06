# Kall Markets on Chainlink

Two questions decide whether a call is worth copying: is the coin in the post the real one, and was this caller
right last time? We don't want either answer to be "because Kall said so". So both are worked out by Chainlink CRE
workflows and signed onto a contract anyone can read. Calls are priced on Chainlink feeds.

## 1. Is this coin real? (`check-coin`)

Scam posts name a real ticker and paste a look-alike contract. Before you can trade, we ask CRE.

- Trigger: HTTP, with `{ token, claimed }` (the contract and the ticker the post names).
- Each node reads the contract's own `symbol()` on Base mainnet.
- Each node asks Dexscreener which Base token is the real one for that ticker: the most liquid pair, and only if
  it has at least $50k of liquidity. The nodes must agree (`consensusIdenticalAggregation`).
- The verdict is one of: **real**, **fake: wrong symbol**, **fake: impostor** (same name, the real coin lives
  elsewhere), **fake: no token**, or **unknown** (no liquid coin to compare against).
- It's written to `KallVerdicts` on Base Sepolia.

The extension and the iPhone keyboard read that verdict before showing a buy. A fake gets "✕ Fake token · checked
by Chainlink CRE" and no buy button ("Fake token: trading is off" in the keyboard).

Real example: a $TOSHI look-alike at `0x8544FE9D…4a8c`. It really calls itself TOSHI and GoPlus sees nothing wrong.
CRE says **fake: impostor**, because the real TOSHI on Base is `0xAC1Bd248…B2B4`.
[Transaction](https://sepolia.basescan.org/tx/0x07091f3be329eae796dd14d9319b42aeeabd8394594b550590492b96e73d3002).

Code: [`kall-cre/check-coin/main.ts`](../kall-cre/check-coin/main.ts), the decision in
[`kall-cre/shared/verdicts.ts`](../kall-cre/shared/verdicts.ts).

## 2. Did the call hit? (`score-calls`)

- Trigger: cron, every 5 minutes (`0 */5 * * * *`).
- It asks Kall which calls are past their deadline and not scored yet:
  [`/api/cre/due`](https://kallmarkets.vercel.app/api/cre/due).
- Each node reads the 1-minute candle open from Binance at the minute of the post and the minute it expired. The
  nodes take the median (`consensusMedianAggregation`).
- Hit, miss or flat, with the return in basis points, goes to the same contract.

Status: built and runnable in the simulator, but it hasn't written a score on chain yet (the contract has 0
`CallScored` events). Once it runs, the score is readable at `/api/cre/call/<postId>` or from the contract.

Code: [`kall-cre/score-calls/main.ts`](../kall-cre/score-calls/main.ts).

## The contract

[`KallVerdicts`](../kall-cre/contracts/src/KallVerdicts.sol) at
[`0x6bf7fd3d5fa88090f30293aabf81565c3f88bc52`](https://sepolia.basescan.org/address/0x6bf7fd3d5fa88090f30293aabf81565c3f88bc52)
on Base Sepolia. Only the Chainlink forwarder can write to it (`onReport`), so every entry was produced by a CRE
workflow. It emits `CoinChecked` and `CallScored`, and anyone can read `coinCheck(token, ticker)` or
`callScore(postId)`.

The web app only reads it ([`lib/server/cre.ts`](../kallr-webapp/lib/server/cre.ts)):

- `GET /api/cre/coin?token=…&claimed=…` gives a coin's verdict
- `GET /api/cre/call/<postId>` gives a call's score

## Price feeds

Every call's entry price is the Chainlink price on Base at the minute it was posted, and its exit is read the same
way when it's settled (`latestRoundData` in [`lib/chain.ts`](../kallr-webapp/lib/chain.ts), served at
[`/api/prices`](https://kallmarkets.vercel.app/api/prices)). Those prices go into the Arkiv record.

## What's not done

The workflows are not deployed to Chainlink's live network. They run in the CRE simulator with `--broadcast`, which
signs through the forwarder and writes to Base Sepolia for real. So:

- The verdicts on chain are real and signed, but they were produced on our machine, not by a DON.
- The live site can only read verdicts. A coin nobody has checked shows as "not checked yet". A fresh check needs
  `CRE_LOCAL=1` and the `cre` CLI on the server, which is how we run the demo locally.
- `score-calls` has never written a score on chain. The hit or miss you see in the apps is Kall's own scoring on
  Arkiv, priced by the Chainlink feeds on Base (daily cron). Don't say any call was "scored by Chainlink CRE".
- So far the contract holds 4 coin checks (two $TOSHI, two $DEGEN) and no call scores.

If you write about it: "computed by a CRE workflow and signed on Base Sepolia", not "running on Chainlink's network".

## Run it

```sh
cd kall-cre && bun install
cre workflow simulate check-coin --target staging-settings --broadcast \
  --non-interactive --trigger-index 0 \
  --http-payload '{"token":"0x8544FE9D190fD7EC52860abBf45088E81Ee24a8c","claimed":"TOSHI"}'
cre workflow simulate score-calls --target staging-settings --broadcast
```

RPCs are in [`project.yaml`](../kall-cre/project.yaml); the contract address and schedule are in each workflow's
`config.staging.json`. To let the web app start checks, set `CRE_LOCAL=1` and run it from this repo.
