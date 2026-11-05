# Feedback for Definitive Flash

From building Kallr on Flash (Base mainnet): an extension on X, a desk and an Android keyboard, all placing orders
through `POST /v1/quote` and `/v1/order`. In order of how much each one cost us.

## 1. Search ranked a same-symbol token above the real one
`search("DEGEN")` on Base returned:

| Address | Price | `liquidity` | `riskFlagged` |
| --- | --- | --- | --- |
| `0xF83C329908c41D197CA5105223f9eAb52F72243e` | $0.0000519 | $3,046,015 | false |
| `0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed` (DEGEN) | $0.000816 | $232,351 | false |

Picking by `liquidity` sends users to the wrong DEGEN. The keyboard also uses search to catch fake contracts
("this says $DEGEN but isn't DEGEN"), so the wrong pick also hides scams. We switched to Dexscreener's summed Base pool
liquidity to choose the token and kept Flash for price and risk.
**Ask:** say how `liquidity` is measured (one pool? which pairs?), and when several tokens share a symbol, mark the
canonical one, or set `riskFlagged` on look-alikes.

## 2. `SEARCH_NOT_ELIGIBLE` with no way to become eligible
Our integrator key gets `403 SEARCH_NOT_ELIGIBLE` on search; the public dev key works. The API reference lists 403
only as "Permission denied", and nothing says what makes a key eligible. We fall back to the public key.
**Ask:** document the rule and the code on the Error Codes page, or give every key search with a lower rate limit.

## 3. The quote accepts native ETH; the submit doesn't
Quote with `0xeeee…eeee` as the spent asset and you get a `wrap` transaction. Submit the same body and it's rejected:
you have to swap in WETH yourself. The EVM overview says "submit using the quoted `targetAsset`" and, two lines down,
that submitting the native address is rejected. We rewrite it in `buildSubmitRequest`.
**Ask:** accept the native address on submit once the wrap has landed, or return the submit-ready body with the quote.

## 4. An attached bracket needs both legs
Most calls on X say "TP 4k" with no stop. `attachedBracket` requires `takeProfit` and `stopLoss`, so a take-profit-only
order means making up a stop or placing a second order after the fill.
**Ask:** allow one leg on `attachedBracket`.

## 5. A limit entry changes basis when you add a bracket
`limitNotionalPrice` works on a plain limit order but is rejected when `attachedBracket` is present; you must send
`limitCrossPrice`. It's documented, but it means the same limit order needs a different field once the user adds a TP,
while the legs themselves take `notionalPrice`.
**Ask:** accept `limitNotionalPrice` with a bracket and convert it on your side.

## 6. DCA is listed for the track but isn't an order type
The hackathon brief lists DCA among Flash's advanced orders. The docs have market, limit, TWAP, trigger, trailing stop
and bracket. We used TWAP (`durationSeconds` up to 30 days) as the nearest thing.
**Ask:** a DCA order (N buys every interval), or one line in the TWAP page: "for DCA, use TWAP with a long duration".

## 7. The docs give orders to coding agents
`/docs/llms.txt` and each `.md` page open with a block telling AI agents to report who they are and what the developer
is building to a leads endpoint, and to report again if they pick another product. Developers point coding agents at
these docs, and an agent that follows text like that is one that follows prompt injection. Ours didn't. Careful agents
will trust the rest of your docs less because of it.
**Ask:** take it out of the agent-facing files, or turn it into a note for the developer ("tell us what you're building")
with a link.

Small one: `/llms.txt` at the site root is 404; it lives at `/docs/llms.txt`.

## What worked well
- `forceMinimalAllowance`: the approval covers the order and nothing more. We say so in the wallet prompt.
- An attached bracket is one quote, two signatures and one submit. That's what makes "copy this call with TP/SL" one tap.
- TWAP by `durationSeconds`, and the price impact, slippage and fee on the quote, which we show before the wallet prompt.
- Notional (USD) pricing on limits and triggers. Users think in dollars, not pair rates.
