# Kall Markets on Definitive Flash

Every trade in Kall goes through Definitive Flash on Base: from the web app, from the card under a post on X, and
from the keyboard in a chat. Kall decides *whether* a call is worth copying; Flash does the trade.

## What we use

- **Market, limit and TWAP orders.** TWAP is what we use for "buy this over a few hours". Flash has no DCA order
  type, so long TWAP is the nearest thing.
- **Take-profit and stop-loss attached to the entry.** One quote, two signatures, one submit. That's what makes
  "copy this call with its TP/SL" a single action. Flash needs both legs, so we ask for both or neither.
- **Approvals sized to the order** (`forceMinimalAllowance`). Never unlimited, and we say so before the wallet
  prompt.
- **The quote before anything is signed.** Price impact, slippage and fee are shown first.
- **The fill.** After the order runs we read its fills and show the swap transaction on Basescan and the venues
  Flash routed through ("… · via Definitive").
- **Search and risk flags** on any Base token, so you can trade coins beyond ETH and BTC. Flagged or illiquid
  tokens are refused.

The API key stays on our server. Browsers, the extension and the apps only call our `/api/flash` routes, which
validate every order again before it reaches Flash.

## Who signs

| Where | Wallet | How it signs |
| --- | --- | --- |
| Web app | Your Kall wallet (Privy embedded wallet, signed in with X) | In the browser |
| Extension on X | Your Kall wallet | On our server through a Privy signer you turn on in the app, capped at $25 per order. Or MetaMask on the page if you pick it |
| Android keyboard | Your Kall wallet | Privy on the phone, after you confirm |
| iPhone keyboard | A demo wallet our server holds (`0xa8405c…8072`) | On our server, capped at $25 per order |

The iPhone keyboard is the odd one out; moving it to your own Kall wallet is on the list.

## Code

- [`packages/integrations/src/definitive.ts`](../packages/integrations/src/definitive.ts): the Flash client, order
  validation, quote and submit bodies
- [`kallr-webapp/app/api/flash`](../kallr-webapp/app/api/flash): quote, order, orders and fills
- [`kallr-webapp/app/api/x/order`](../kallr-webapp/app/api/x/order/route.ts): extension trades signed by the Kall wallet
- [`kallr-webapp/app/api/keyboard/execute`](../kallr-webapp/app/api/keyboard/execute/route.ts): iPhone keyboard trades
- [`kallr-extension/src/flash-direct.ts`](../kallr-extension/src/flash-direct.ts): the MetaMask path on X

## What got in our way

Seven notes for the Flash team, with the details: [feedback/definitive.md](../feedback/definitive.md). The short
version: search ranked a look-alike DEGEN above the real one, our own key couldn't use search, quote takes native
ETH but submit doesn't, a bracket can't be take-profit only, and a limit price changes field once you add a
bracket.
