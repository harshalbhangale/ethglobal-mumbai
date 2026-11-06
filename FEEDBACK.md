# Uniswap feedback

From building Kall Markets at ETHGlobal Mumbai 2026. We use the Uniswap Trading API as a price benchmark:
every Definitive Flash quote in the Kall Extension and Kall Web App is set beside Uniswap's quote for the same
swap on Base, and one line says who gives more. Code: [`packages/integrations/src/uniswap.ts`](packages/integrations/src/uniswap.ts),
[`kallr-webapp/lib/server/uniswap.ts`](kallr-webapp/lib/server/uniswap.ts).

## What worked

- **`llms.txt` on both doc sites.** `developers.uniswap.org/llms.txt` gave us the whole map in one request, and
  the `/quote` reference page has a copyable cURL with every header. We had a request shape in minutes.
- **Validation runs before auth.** A keyless `POST /v1/quote` with `{}` answered
  `{"errorCode":"RequestValidationError","detail":"\"swapper\" is required"}`, so we could fix the body before we
  had a key. Clear, specific errors.
- **`protocols` and `routingPreference`.** Restricting to `["V2","V3","V4"]` with `BEST_PRICE` gave us a clean
  like-for-like pool price to compare an aggregator against.

## What got in our way

1. **`swapper` is required for a price-only quote.** We only want “how much would this swap give”, with no
   intent to execute through Uniswap. Requiring a swapper (and simulating for it) makes a pure price check depend
   on a wallet. An indicative mode without `swapper` would fit comparison and analytics use cases.
2. **Two response shapes for one question.** The output amount is `quote.output.amount` on pool routes and
   `quote.orderInfo.outputs[0].startAmount` on UniswapX routes. A top-level `amountOut` on every routing type
   would save every integrator the same branching.
3. **No key-free sandbox for server code.** The docs page has a shared playground key in the browser, but nothing
   we could call from a server to test the happy path before signing up. A low-rate public key for
   `/quote` (like Definitive's public dev key) would let a hackathon team ship the integration first and sign up
   second.
4. **Header defaults.** The cURL lists `x-universal-router-version`, `x-erc20eth-enabled`,
   `x-permit2-disabled` and `x-universal-router-swapsteps`. It is not obvious which are needed for a quote only;
   we sent none. A “minimal request” example would help.

## After the first live run

_To fill in with numbers once the API key is set: response times on Base, how often Uniswap answered within our
2.5s budget, and how Flash compared over the first trades._
