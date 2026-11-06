<p align="center"><img src="docs/brand/cover/kall-markets-cover.png" alt="Kall Markets: Don't trust. Check the caller. Trade it. Powered by Definitive." /></p>

# <img src="kallr-webapp/public/icons/icon-512.png" width="36" height="36" align="top" alt="" /> Kall Markets

**Don't trust. Check the caller. Trade it.**

[Web app](https://kallr.vercel.app) · Kall Extension (Chrome, on X) · Kall Keyboard (Android and iOS) · Trades by [Definitive Flash](https://definitive.fi) on Base

## The problem

A KOL tweets: "ETH is going to crash because of the war." If they're right, it becomes an advertisement for
their paid group. If they're wrong, they delete the tweet and pretend it never happened. Their followers only
ever see the winning screenshots, and they find the call on X or in a Telegram group, then have to leave the
conversation for an exchange to act on it.

## What Kall Markets does

**It keeps the receipts.** Every call we capture is priced at the minute it was posted (Chainlink on Base) and
scored when its timeframe ends. The call and its result are recorded on [Arkiv](https://arkiv.network), read-only
so nobody can edit a miss, and the post itself is snapshotted to [Swarm](https://www.ethswarm.org), so deleting
the tweet doesn't delete the record. You judge a caller by their actual track record, not their best screenshot.

**It lets you trade the call where you saw it,** through [Definitive Flash](https://flash.definitive.fi) on Base:
market, limit or TWAP orders with take-profit and stop-loss attached, quoted fresh and reviewed before anything
is placed.

| | Where | What you do there |
| --- | --- | --- |
| **Kall Extension** | Chrome, on X | Every call gets the caller's record under it. Follow callers. Copy a call into a Flash order with exits and sign it in your own wallet, without leaving X. |
| **Kall Keyboard** | iPhone and Android, in any app: X, Telegram, Reddit, WhatsApp | A trading keyboard. Copy a call or paste a contract (fake contracts are flagged), open the trading panel, review a fresh Flash quote and confirm, without switching to an exchange. On iPhone it also shows calls from the callers you follow. |
| **Kall Web App** | [kall-markets.vercel.app](https://kall-markets.vercel.app) | The callers you follow and their posts with Kall Markets' verdict, the trade ticket, your orders and your wallet. |

Kall Markets only shows its own feed and what you choose to copy. It never reads other apps' screens or
conversations.

Built at ETHGlobal Mumbai 2026. Not financial advice.

## How it works

<p align="center"><img src="docs/architecture.svg" alt="Kall Markets architecture: the extension, keyboard and web app talk to one server, which trades through Definitive Flash, keeps receipts on Arkiv and reads Base privately through Anon-RPC." /></p>

Three apps, one server, three rails:

- **Definitive Flash: every trade.** Quote, approve, sign (EIP-712), order, fill. Flash finds the best route across Base's venues, shows impact, slippage and fee before you sign, and returns the Basescan transaction and venues after the fill.
- **Arkiv: the receipts.** Calls, results, trades and the tracked-callers roster are read-only entities, so a miss can't be edited away.
- **Anon-RPC: private reads.** In the browser, balances, Chainlink prices, receipts and the Arkiv feed are read through a hash-pinned Anon-RPC worker over the Nym mixnet, so the RPC provider can't link them to your IP. If a read ever has to go direct, a badge says so.

1. **Read.** A call is captured from X (extension) or a copied message (keyboard). The AI reader decides if it's a real call and its direction.
2. **Check.** A coin named next to a contract that isn't that coin gets "Call check failed" and no trade.
3. **Price and keep.** The entry price comes from Chainlink on Base; the call, its result later, and every trade go to Arkiv; the post is snapshotted to Swarm.
4. **Trade.** Definitive Flash quotes, you sign in your own wallet, it fills on Base. Uniswap is asked for the same quote only to show Flash's edge.
5. **Prove.** You get the Basescan receipt, and the caller's record updates for everyone.

<details><summary>Same flow as a Mermaid diagram</summary>

```mermaid
flowchart LR
  subgraph Where["Where calls show up"]
    X["X post"]
    TG["Telegram · WhatsApp"]
  end

  subgraph Kall["Kall Markets"]
    EXT["Kall Extension<br/>(Chrome, on X)"]
    KB["Kall Keyboard<br/>(Android · iOS)"]
    WEB["Kall Web App<br/>kallr.vercel.app"]
    API["Kall API<br/>(Next.js on Vercel)"]
    AI["AI call reader<br/>real call? long or short?"]
    CHECK["Call check<br/>fake contract → blocked"]
  end

  subgraph Proof["Receipts"]
    CL["Chainlink on Base<br/>price at post time"]
    ARK["Arkiv<br/>calls · results · trades"]
    SW["Swarm<br/>post snapshot"]
  end

  subgraph Trade["Trade"]
    FL["Definitive Flash<br/>quote → sign → fill"]
    UNI["Uniswap API<br/>price benchmark only"]
    WAL["Your wallet<br/>MetaMask · Privy"]
    BASE["Base mainnet<br/>Basescan receipt"]
  end

  X --> EXT
  TG --> KB
  EXT & KB & WEB --> API
  API --> AI --> CL --> ARK
  API --> SW
  API --> CHECK
  ARK -->|caller record| EXT & KB & WEB
  API --> FL
  API -.->|compare| UNI
  FL --> WAL --> BASE
  BASE -->|trade record| ARK
```

</details>

## What's here

Kall Markets is one product in three places. All three trade through Definitive Flash on Base and keep
their records on Arkiv; you sign with MetaMask or the Privy wallet you get when you sign in with X.

| Product | What it does | Status |
| --- | --- | --- |
| **Kall Web App** ([kall-markets.vercel.app/app](https://kall-markets.vercel.app/app), PWA) | One screen: the callers you follow, their real posts from X with Kall Markets' verdict (entry, hit or miss, return) from Arkiv, Following / Explore / Favorites, and the trade ticket always beside them; Copy call fills it. Orders (open, closed, history with Arkiv proofs) and Wallet (MetaMask or the embedded wallet, balances on Base) | Live; reads Arkiv and quotes Flash on mainnet |
| **Kall Extension** (Chrome, X only for now) | On x.com: a trade card under call posts with live prices, the caller's record and the Call receipt; Flash's price impact, slippage and fee before you sign; a Basescan receipt with the route after; signed on X with MetaMask or Rabby | Built; loads unpacked |
| **Kall Keyboard** (Android, built on [FlorisBoard](https://github.com/florisboard/florisboard)) | Works wherever calls are posted (Telegram, X, WhatsApp): reads a call from a copied or shared message, shows the caller's record, and trades it in the keyboard's panel with the Privy wallet | Built; debug APK, talks to the web app's `/api/keyboard` |
| **Kall Keyboard** (iPhone, `kallr-ios`) | A typing keyboard for any app with a Kall key that opens the trading panel: Following (calls from the callers you follow, with the post text, live move and record; Following / Explore; Active, Settled, Favorites), Trade (Market, Limit or TWAP, any amount, exits, a review with a fresh Flash quote, then one tap to place), Orders (live Flash status, Cancel) and Wallet. Orders are placed from a capped Kall wallet the server holds | Built; installed from Xcode; see [kallr-ios/README.md](kallr-ios/README.md) |
| **Safety checks** | Token: honeypot, owner powers, taxes, liquidity, age. Caller: did their wallet sell what they called? | Token checks live (no key); wallet check needs a free Etherscan key |

## Run it

Node 20+ (the repo is tested on Node 24).

```sh
npm install
cp kallr-webapp/.env.example kallr-webapp/.env.local   # add NEXT_PUBLIC_PRIVY_APP_ID, DEFINITIVE_API_KEY
npm run dev                                    # http://localhost:3000
npm test                                       # all packages
```

In the Privy dashboard: enable **Twitter** and **Email** login, enable **embedded wallets** for Ethereum, and add `http://localhost:3000` to allowed origins.

Environment (`kallr-webapp/.env.local`):

| Variable | Needed for | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Sign-in and wallet on `/app` | `/app` shows a setup notice |
| `DEFINITIVE_API_KEY` | Flash quotes and orders | Falls back to Definitive's public dev key |
| `ETHERSCAN_API_KEY` | Caller wallet check | Wallet check reports unavailable; token checks still work |
| `NEXT_PUBLIC_BASE_RPC_URL` | Balances and Chainlink prices | Public Base RPC |
| `ARKIV_PRIVATE_KEY`, `ARKIV_ACCESS_KEY` | Writing trades and calls to Arkiv (writer needs tGLM) | Nothing written to Arkiv |
| `OPENAI_API_KEY` | Keyboard AI: reading calls and plain-word orders | Keyboard falls back to links and cashtags only |
| `ELEVENLABS_API_KEY` | Keyboard voice orders (Scribe) | OpenAI transcription, if set |
| `SWARM_API_URL`, `SWARM_POSTAGE_BATCH_ID` | Your own Bee node and batch for snapshots | Swarm's public gateway |
| `UNISWAP_API_KEY` | The "Best price" line: each Flash quote set beside Uniswap's | The line is hidden; trading is unchanged |

Hosted on Vercel (project `kallr`, root `kallr-webapp`): <https://kall-markets.vercel.app> (kallr.vercel.app still answers, for builds made before the rename), deployed on every push to `main`.

The service worker only registers in production builds: `npm run build && npm start` to test install.

## Placing an order (Definitive Flash)

1. The desk parses the text (`packages/domain/src/order.ts`) and prices TP/SL from Chainlink ETH/USD and BTC/USD on Base.
2. `/api/flash/quote` asks Flash for a quote with an `attachedBracket` (TP/SL). Approvals are sized to the order (`forceMinimalAllowance`), never unlimited.
3. The user's Privy wallet approves if needed and signs the entry and the TP/SL pair.
4. `/api/flash/order` submits; the TP/SL arms on the first fill. The API key stays on the server.

TP/SL attach to buys only (a spot sell leaves you in USDC). Tradable today: ETH (as WETH), BTC (as cbBTC) and any
Base token from search, against USDC on Base.

Where the Flash code lives:
[`buildQuoteRequest`](packages/integrations/src/definitive.ts#L98) and
[`buildSubmitRequest`](packages/integrations/src/definitive.ts#L182) shape every order;
[`flashClient`](packages/integrations/src/definitive.ts#L348) wraps `/quote`, `/order`, `/orders/{id}` and `/search`;
[`/api/flash/quote`](kallr-webapp/app/api/flash/quote/route.ts) and `/api/flash/order` keep the key server-side;
the extension signs on X in [`placeOnX`](kallr-extension/src/flash-direct.ts) and shows the fill's Basescan
transaction and route from `/orders/{id}`.

## Uniswap: the price check on every Flash quote

Kall Markets trades only through Definitive Flash. Uniswap is the benchmark: when Flash quotes a trade, the same
swap (same tokens, same amount, same moment) is quoted through the
[Uniswap Trading API](https://developers.uniswap.org/docs/api-reference/aggregator_quote) on Uniswap's v2, v3 and
v4 pools, and one line under the quote says who gives more:

> **Best price:** ✓ Definitive Flash · +0.42% vs Uniswap

If Uniswap gives more, the line says so (“Uniswap +0.1% · Flash adds MEV protection”). If Uniswap is slow or the
key is missing, the line is hidden and nothing else changes.

- [`uniswapQuote`](packages/integrations/src/uniswap.ts#L37): `POST /v1/quote`, `EXACT_INPUT` on Base (8453),
  `protocols: ["V2","V3","V4"]` for a like-for-like pool price, 2.5s timeout, never throws.
- [`comparePrices`](packages/integrations/src/uniswap.ts#L92): Flash's output against Uniswap's in the output
  token's decimals, as a signed percentage.
- [`uniswapFor`](kallr-webapp/lib/server/uniswap.ts#L39): maps the order to Uniswap's tokenIn/tokenOut (USDC in on
  a buy, the asset in on a sell; native ETH as WETH) and reads a searched token's decimals from Base.
- [`/api/flash/quote`](kallr-webapp/app/api/flash/quote/route.ts#L15): starts the Uniswap quote alongside the Flash
  quote, so the benchmark adds no wait, and returns it as `compare`.
- Shown in the Kall Extension ([`bestPrice`](kallr-extension/src/flash-card.ts#L626)) and the Kall Web App's
  ticket ([`trade-ticket.tsx`](kallr-webapp/components/trade-ticket.tsx#L471)).
- Feedback for the Uniswap team: [FEEDBACK.md](FEEDBACK.md).

## Kall Keyboard on iPhone

The demo surface. `kallr-ios` is a SwiftUI app plus a keyboard extension. Kall Keyboard types like the
iPhone keyboard, with a Kall key (our logo, TRADE) next to 123 that opens the panel:

- **Following:** calls from the callers you follow (kept on the phone), with each post's text from its
  Swarm snapshot, the move since the post and the caller's record. Explore lists everyone Kall Markets
  tracks or has priced, with Follow. Filters for Active, Settled and starred Favorites.
- **Trade:** a call's coin is filled in; pick an amount (or type one), Market, Limit or TWAP, and exits.
  **Review** gets a fresh Definitive Flash quote (pay, get, price impact, fee, exits, approval) without
  sending anything; **Confirm & place** sends it.
- **Orders:** the Kall wallet's Flash orders with live status, the call each one copied, and Cancel for
  working limit and TWAP orders (Flash's signed, gasless cancel).

Orders go through `/api/keyboard/execute`: the server re-quotes, approves exactly the order's USDC, signs
with the Kall keyboard wallet and submits on Flash, then records the trade on Arkiv. The Kall wallet is a
demo hot wallet the server holds; only builds carrying `KALL_EXEC_TOKEN` can spend from it, and each order
is capped by `KALL_EXEC_MAX_USD`. Build and install: [kallr-ios/README.md](kallr-ios/README.md).

## Kall Keyboard

Phones can't run extensions, but every app has a keyboard. `kallr-keyboard` is a fork of
**[FlorisBoard](https://github.com/florisboard/florisboard)** v0.5.2 (Apache-2.0, by The
FlorisBoard Contributors), which does all the typing. What we added:

- **Trade button** (blue, right end of the toolbar). Like the emoji button, it swaps the keys for the
  Kall Markets panel; **ABC** goes back. Tabs: **Swap** (token, Swap / Limit / TWAP, amount, TP/SL),
  **Positions** (your Flash orders and balances) and **Wallet**.
- **Your wallet:** the Privy embedded wallet you get on the desk (sign in with X). Buy opens a
  confirm sheet; "Confirm and sign" places a Flash order on Base. Keys stay with Privy.
- **Check this call:** copy or **Share → Check with Kall Markets** a post or a Telegram message. The AI reads
  coin, direction and timeframe; the caller's record and a token check come from our tools.
- **Fake contracts:** a contract that claims `$PEPE` but isn't the main PEPE on Base is shown as fake
  with the real address, and gets no Buy.
- **Plain words and voice:** type `buy 20 bucks of degen if it dips 10%`, or hold the mic and say it.

It sends Kall Markets only a post link, a coin message, a contract or the order phrase (nothing else you
type) and stays quiet in password fields. Build, install and what changed:
[kallr-keyboard/KALLR.md](kallr-keyboard/KALLR.md).

## Arkiv: trade records and caller records

Trades run on Base mainnet through Flash. Their records, and every call we price, are stored on
[Arkiv](https://arkiv.network) (testnet Rabdi, chain `7794095`), and `/trades` reads them from Arkiv in the
browser, so anyone can check them without asking us.

| Entity | Written when | Owner | Expires |
| --- | --- | --- | --- |
| `kallr.trades` | Flash accepts an order | Created read-only by our writer, then handed to the trader's wallet | ~182 days (Arkiv's max) |
| `kallr.calls` | We first price a call | Our writer, read-only | Its timeframe plus a 48h scoring window |
| `kallr.call-results` | The call settles (hit, miss or flat) | Our writer, read-only; anyone may extend it | ~182 days, extendable by anyone |
| `kallr.tracked-callers` | `npm run arkiv:callers -w kallr-webapp` | Our writer, read-only | ~182 days; re-run to refresh |

- **Writer wallet:** `0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53`. Reads only trust entities it created.
- **One query you can run:** `arkiv.schema = str('kallr.trades') AND $creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53)`
- **Callers Kall Markets follows** (read by `/kol` and the home sidebar): `arkiv.schema = str('kallr.tracked-callers') AND $creator = addr(0x9bA2Ce7b1c3930d3C82Cb18531F8D4483b393B53)`

**On-chain writes so far** (Arkiv Rabdi, block `0x4015f`, one `createEntity` per caller):

| Caller | Transaction | Entity key |
| --- | --- | --- |
| @rektcapital | [`0xd2b96140…`](https://rabdi.explorer.arkiv.network/tx/0xd2b961407f1163a441764757b423315950c858559dcddc7920dc77b5f8194d14) | `0x712eb8bc…07ea0a` |
| @pentosh1 | [`0x5bf7e43a…`](https://rabdi.explorer.arkiv.network/tx/0x5bf7e43a59f28f825a9afb1d256ea4248cdd6697fc47b3db30a1c6fc29acf768) | `0x45a354ed…26bd41` |
| @cryptokaleo | [`0x7738ebcb…`](https://rabdi.explorer.arkiv.network/tx/0x7738ebcbd2897b4c7b40ed7efaa0dc4df39a7eae8375ba942fb4e3e55ecca924) | `0xef7a1ff4…cf31e9` |
| @cryptodonalt | [`0xf6f721c8…`](https://rabdi.explorer.arkiv.network/tx/0xf6f721c8b58b87d9129125305f40c3621613c716f63a3b932f393766ca3c1f56) | `0x573c3896…61e9d3` |
| @hsakatrades | [`0xebd165e0…`](https://rabdi.explorer.arkiv.network/tx/0xebd165e0f5383e98d471999fc3d67ebb28f99bdd42e1099f65271087664f1c5a) | `0x4ef7fced…f50413` |
| @smartcontracter | [`0xa356a934…`](https://rabdi.explorer.arkiv.network/tx/0xa356a934249af49e96ae5ec7c31be5081b20e3e354b3dbe8b97df85d5675ca94) | `0x77c075b6…8667d8` |
| @altcoinsherpa | [`0xe4e56127…`](https://rabdi.explorer.arkiv.network/tx/0xe4e561279ccc1da30cd965157299b777aefacaf4b738d09caf429b92d2272e70) | `0x35b8b617…ab84db` |
| @cryptocred | [`0x058ee232…`](https://rabdi.explorer.arkiv.network/tx/0x058ee2322fbc3771d1e022c04862a45b5b1323967cd50c16cda81f81e9032218) | `0x98af8f9c…8b01ca` |
| @inmortalcrypto | [`0xecda7fb9…`](https://rabdi.explorer.arkiv.network/tx/0xecda7fb9ce2c9cadba37bb14036548d76222f5e4ab859ff7e39f8676536eb897) | `0x2edb0f13…1f895d` |

Full entity keys: run the query above.

**Real calls from X** (each sent through `/api/after-market` exactly as the extension sends a post it sees;
open calls carry a [Swarm](https://www.ethswarm.org) snapshot of the post in `swarmRef`):

| Post on X | Read as | Arkiv transaction | Swarm snapshot |
| --- | --- | --- | --- |
| [@CryptoKaleo: "$ETH … BE MORE BULLISH"](https://x.com/CryptoKaleo/status/2118378232730828998) | ETH up · open (`kallr.calls`) | [`0x1023e8a9…`](https://rabdi.explorer.arkiv.network/tx/0x1023e8a92a926aa7be40c767f2cda73349581ef796e2064262cdd9ce6f0952e5) | [`0399be1f…`](https://api.gateway.ethswarm.org/bzz/0399be1fbfd84eff4957cc1dfb41d28ff89ce44d05469d9c8cbeeedd1dca94dc/) |
| [@CryptoKaleo: "Buy more Bitcoin."](https://x.com/CryptoKaleo/status/2118301291923329528) | BTC up · open (`kallr.calls`) | [`0x6277fe4a…`](https://rabdi.explorer.arkiv.network/tx/0x6277fe4ad3d91f45d6932829e3b75ff2eb3b2dad828584ae31de453fbac38cbc) | [`ead89c2a…`](https://api.gateway.ethswarm.org/bzz/ead89c2aeed4dbcf16a7d65094692e1a4ad4d70a95a380832867a286d101de3e/) |
| [@AltcoinSherpa: "Time to pump $SOL"](https://x.com/AltcoinSherpa/status/2117629619637809255) | SOL up · hit +1.20% (`kallr.call-results`) | [`0x4b9dcd3b…`](https://rabdi.explorer.arkiv.network/tx/0x4b9dcd3bce0f23436abd1de694048e7beb93a848718be564c481ca7760b40ed1) | settled before we saw it |
| [@inmortalcrypto: "accumulate … $BTC"](https://x.com/inmortalcrypto/status/2112240301758964212) | BTC up · hit +1.23% (`kallr.call-results`) | [`0xf597d7db…`](https://rabdi.explorer.arkiv.network/tx/0xf597d7db8fef9635721523a6894b33b17927fce93439b3a97177d736a0d90a57) | settled before we saw it |
| [@inmortalcrypto: "below it, but not for long $BTC"](https://x.com/inmortalcrypto/status/2107186308346974251) | BTC up · miss −0.07% (`kallr.call-results`) | [`0xe685ce07…`](https://rabdi.explorer.arkiv.network/tx/0xe685ce075cd42513251fc2b3f59d11127fafafc8c7be4fe4c98b43fa77719a99) | settled before we saw it |

Then, with the AI reading posts (`readCall`, gpt-4.1-mini; it agreed with a plain reading on 23 of 26 real posts
against 14 for keywords), the same 26 posts went through the live API. It accepted 12 and wrote these:

| Post on X | Read as | Arkiv transaction |
| --- | --- | --- |
| [@AltcoinSherpa: "still think this is a bounce area for bitcoin"](https://x.com/AltcoinSherpa/status/2118389790379028665) | BTC up · open, [Swarm `2695c6b3…`](https://api.gateway.ethswarm.org/bzz/2695c6b3364bdea0bd2ca5f7acc8740e46f55641117c9027868ccc7da0312f45/) | [`0x6392cb48…`](https://rabdi.explorer.arkiv.network/tx/0x6392cb481dceb8edc08f21761f1ab1f40ef0fd0916f0b7f792a799f6c0515fca) |
| [@CryptoKaleo: "$ETH Up only."](https://x.com/CryptoKaleo/status/2118005120076234811) | ETH up · miss −6.47% | [`0xe1488385…`](https://rabdi.explorer.arkiv.network/tx/0xe14883858ab96299246ca9bf4b4bbcecc4c97f3336aeebb1e5087bcdca80daf4) |
| [@CryptoKaleo: "$100K+ IS A MAGNET"](https://x.com/CryptoKaleo/status/2118004723597169006) | BTC up · miss −5.11% | [`0x5346935d…`](https://rabdi.explorer.arkiv.network/tx/0x5346935d9436733485fd9be452f14d3ba05d18a38b60cccf1c7dad0ede1af769) |
| [@AltcoinSherpa: "$BTC in the short term, eyeing 82k"](https://x.com/AltcoinSherpa/status/2117998152859136080) | BTC up · miss −4.45% | [`0x5850e79a…`](https://rabdi.explorer.arkiv.network/tx/0x5850e79a8497b8194c4f6f96a5bdd0af1ff9df6434f86a767728e72f25405f8d) |
| [@AltcoinSherpa: "I think 82k is next for bitcoin"](https://x.com/AltcoinSherpa/status/2117990595591594156) | BTC up · miss −0.18% | [`0x1ebe9530…`](https://rabdi.explorer.arkiv.network/tx/0x1ebe95302e4c094d6b25ae765edfd4a6b97683012ef04085c632dff588d99952) |
| [@inmortalcrypto: "2.8k next, imo $ETH"](https://x.com/inmortalcrypto/status/2107875695317950568) | ETH up · miss −5.49% | [`0x57e30b5e…`](https://rabdi.explorer.arkiv.network/tx/0x57e30b5ede2e0c67d0ac7e4b44f1616bcd264ee494e659f751017712c9d4331f) |
| [@inmortalcrypto: "Run it back. Turbo please. $ETH"](https://x.com/inmortalcrypto/status/2110859502371410195) | ETH up · miss −1.55% | [`0x6f57554b…`](https://rabdi.explorer.arkiv.network/tx/0x6f57554b421803a738d04beb4be013cb83327c035cab4b6ebe5361a1ca7fdf43) |

The other five it accepted were already on Arkiv (above). It rejected sarcasm ("Was I long the BTC breakout? No."),
looking back ("$BTC dropped 50%"), and commentary ("Bitcoin is now down -13%", orderbook stats).

One write was wrong and is deleted: @AltcoinSherpa's "Looking decent for $BTC in the short term" was read as a short
because of "short term" (fixed in `packages/integrations/src/signals.ts`; deletion
[`0xf44153ff…`](https://rabdi.explorer.arkiv.network/tx/0xf44153ff5a8915142f65b56596908f2cf37a5c9948b8d3082fda444379169802)).
Trade transactions are added here as they land.
- Details: [arkiv/schema.md](arkiv/schema.md), [why-arkiv.md](arkiv/why-arkiv.md), [how-you-use-arkiv.md](arkiv/how-you-use-arkiv.md), [reach.md](arkiv/reach.md), [friction.md](arkiv/friction.md).
- Code: `packages/integrations/src/arkiv.ts` (schemas, reads), `kallr-webapp/lib/server/arkiv.ts` (writes), `kallr-webapp/app/trades/page.tsx` (dashboard), `kallr-webapp/app/api/arkiv/score` (settles expired calls, daily Vercel cron).

**Swarm:** when Kall Markets first prices a call, a snapshot of the post (text, link, the call it read)
goes to [Swarm](https://www.ethswarm.org), and the call's Arkiv entity keeps the reference in
`swarmRef`, so a deleted post stays provable. The `/trades` dashboard also exists as a static page on
Swarm (`kallr-swarm/`, `node kallr-swarm/publish.mjs`) that reads Arkiv with no server.
See [arkiv/swarm.md](arkiv/swarm.md).

## Kall Extension

```sh
npm run build -w @kallr/extension                                       # for https://kallr.vercel.app
npm run build:local -w @kallr/extension                                 # for http://localhost:3000
KALLR_APP_ORIGIN=https://your-app.example npm run build -w @kallr/extension
```

Then `chrome://extensions` → Developer mode → Load unpacked → `kallr-extension/dist`, and open x.com with `npm run dev` running.

What it adds to X:

- **Under call posts:** the caller's record (calls seen in this browser), this call's move since posting, and a trade ticket (amount, TP/SL) that places a Flash order.
- **In X's own ticker cards:** a "⇄ Buy" button with the live price.
- **On profiles:** a profile card with the caller's record and a Follow button; Following chips on bylines. Follows are shared with the desk's Following list.
- **Posts that share a contract address:** a token check card (GoPlus + Dexscreener) and no trade, so a ticker copy is never offered next to a possibly fake token.
- **Signing:** with MetaMask or Rabby right on X, or in the desk popup (Privy) as a fallback.
- **Toolbar popup:** connection status.

It reads only what's on screen: no X API, no cookies. The server classifies and scores.

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

## The X bot (parked)

The code works in dry run; we aren't running it live for the demo. Tag @Kallr under a call and it replies with the caller's record and how this call played out. Reply `copy $2, TP 10%, SL 5%` and it answers with a link to the desk, where you review and sign. The bot never trades.

```sh
# Try a reply on any public post, no keys needed (posts nothing):
npm run try -w @kallr/x-bot -- https://x.com/<handle>/status/<id> "copy $2, TP 10%, SL 5%"

# Run the mentions loop (dry run unless X_BOT_POST=1):
cp kallr-xbot/.env.example kallr-xbot/.env   # bot account keys
node --env-file=kallr-xbot/.env --import tsx kallr-xbot/src/main.ts
```

The X API is pay-per-use: about $0.001 per mention read, $0.005 per post read, $0.01 per bot reply ($0.20 if the reply contains a link). Run the loop on an always-on host (Railway, Fly, EC2), not a serverless platform.

## Structure

```
kallr-webapp/       Next.js PWA: landing (/), desk (/app), /trades, Flash + after market + checks + Arkiv APIs
kallr-extension/    Chrome extension for x.com: trade cards, records, profiles, follow, safety checks
kallr-keyboard/     Android keyboard: FlorisBoard fork with a Kall Markets row
kallr-ios/          Kall Keyboard for iPhone: SwiftUI app + keyboard extension (XcodeGen)
kallr-xbot/         @Kallr on X (parked)
packages/
  domain/           order parser, reputation, signals
  integrations/     call scoring, after market, Definitive Flash, Arkiv, safety checks, X API
  database/         Postgres schema (parked; Arkiv is the store)
arkiv/              Arkiv schema and judging notes
docs/PLAN.md        what we are building next, and what is parked
```

## Not done yet

- First funded order on Base mainnet (needs a Privy app ID and a few USDC on Base)
- The Terminal: live calls, your trades, chat rules with notify / ask-to-approve / ignore
- iPhone keyboard: the first funded order from the Kall wallet (dry runs quote and sign on mainnet)
- Kall Keyboard: a real trade from a phone (sign-in works on the emulator); release build
- Swarm dashboard: the public gateway serves the snapshots, but the HTML page waits for Swarm's approval or an ENS name

Parked, not planned for the demo: live X bot, Telegram, agents/MCP, Postgres. See [docs/PLAN.md](docs/PLAN.md).

## Built at ETHGlobal Mumbai: what's new and what we reused

This repo was started at the event (first commit 5 Nov 2026). What we brought in:

- **Kall Extension cards:** the post card, ticker Buy button, caller record, Call receipt drawer, profile card and
  follow chips were ported from **Xtrading**, our earlier X trading extension (on Monad, with Kuru and Perpl). At
  the event we moved them onto Base and Definitive Flash, added token safety checks, and wired them to this app.
- **Landing background:** the particle knot behind the landing hero (`kallr-webapp/components/signal-field.tsx`) and
  the black-and-lime look come from the Xtrading site.
- **Kall Keyboard:** a fork of [FlorisBoard](https://github.com/florisboard/florisboard) v0.5.2 (Apache-2.0),
  which does all the typing. We added the Kall Markets row; the full list of changes is in
  [kallr-keyboard/KALLR.md](kallr-keyboard/KALLR.md).
- **jetpref:** [patrickgold/jetpref](https://github.com/patrickgold/jetpref) (Apache-2.0), vendored at the commit
  FlorisBoard v0.5.2 needs, because its snapshot has expired from Maven Central.

New at the event: the web app and desk, the Flash integration with TP/SL, call scoring, the X bot, the keyboard
row and `/api/keyboard`, the Arkiv data layer and the `/trades` dashboard.

## Sponsor feedback

Short, specific notes from building on their stacks: [Definitive](feedback/definitive.md),
[Arkiv](arkiv/friction.md), [Swarm](arkiv/swarm.md#what-got-in-our-way) and [Uniswap](FEEDBACK.md).

## How we used AI

Much of the code was written with Claude Code (Anthropic's AI coding agent), directed and reviewed by us; those
commits carry `Co-Authored-By: Claude`. The product decisions, sponsor choices and testing on real orders are ours.

## License

[MIT](LICENSE). `kallr-keyboard` (FlorisBoard) and `kallr-keyboard/vendor/jetpref` keep their Apache-2.0 licenses.

## Credits

- [FlorisBoard](https://github.com/florisboard/florisboard) (Apache-2.0): the Android keyboard `kallr-keyboard` is built on.
- [jetpref](https://github.com/patrickgold/jetpref) (Apache-2.0): FlorisBoard's preferences library, vendored.
- [Arkiv](https://arkiv.network): where trade and caller records live.
