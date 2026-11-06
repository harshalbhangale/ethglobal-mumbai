# Kall Keyboard for iPhone

A small app plus the Kall Keyboard extension, in Kall Markets black and lime. The keyboard types like the
iPhone keyboard (letters, 123, #+=, shift and caps lock, space, return, auto-capitals, a double space for
". ", hold to delete), and where the emoji key would be there's the Kall key: our logo with TRADE under
it. It opens the trading panel below; ABC goes back to typing. A strip above the letters shows the
newest calls from callers you follow (tap one to trade it), an order you're typing, and the clipboard
check. Each key has its own haptic (letters, space, delete, shift, caps lock, 123, the Kall key); iOS
plays keyboard haptics only with Allow Full Access.

- **Following:** calls from the callers you follow (kept on the phone), read from Arkiv by
  `/api/keyboard/feed`: the post's text from its Swarm snapshot, the move since the post, time left, and
  **Trade**. Caller chips with hit rates narrow the list; Active, Settled and starred Favorites filter it.
  **Explore** lists every caller Kall Markets tracks or has priced, with their record and Follow. The
  clipboard button checks a post or $TICKER message you copied.
- **Trade:** laid out like a swap. **You pay** is dollars of USDC (tap to type, with $1, $5, $10, $25 and
  Max; the Kall wallet's balance beside it); **You get** is ETH or BTC, about how much, and the price it
  buys at. Market, Limit or TWAP is a small toggle; take-profit and stop-loss fold into Advanced (with the
  limit offset, −1 to −10%, or the TWAP length, 10 minutes to 12 hours) and show where they'd sell. **Review** gets a fresh
  Definitive Flash quote (you pay, you get, price impact and fee, exits, approval) without sending
  anything; **Confirm & place** sends it.
- **Orders:** the Kall wallet's Flash orders with live status (re-read every 5 seconds while one is
  working), which call each one copied, and **Cancel** for working limit and TWAP orders. Cancelling is
  Flash's gasless signed message and is final.
- **Wallet:** the Kall wallet's address and balances.

**How a trade is placed.** The keyboard sends the order to `/api/keyboard/execute` with a secret only these
builds carry. The server re-quotes on Flash, approves exactly this USDC amount, signs with the Kall wallet
and submits, then records the trade on Arkiv as a keyboard trade. The Kall wallet is a demo hot wallet held
by the server, funded with ETH on Base (swapped to USDC in the app), with a per-order cap (`KALL_EXEC_MAX_USD`, $25).
An order typed on the iPhone keyboard ("buy $20 of eth tp 10% sl 5%") is filled in when you switch to Kall.

iOS doesn't let keyboards use the microphone, so voice orders are Android only, as are Base tokens beyond
ETH and BTC.

## The app

- **Wallet:** the Kall wallet's ETH and USDC, its address (copy, or open it on BaseScan), ETH and BTC
  prices, how many calls are open on Arkiv, the latest orders and the best callers by settled hit rate.
  **Deposit ETH** (USDC also works) picks an amount, then opens MetaMask with the transfer to the Kall
  wallet on Base filled in (an EIP-681 link), hands it to any other wallet app, or shows it as a QR code
  for a wallet on another device. Balances are read again when you come back from the wallet, and a
  deposit that landed is called out.
- **Swap ETH to USDC:** type dollars (or $5, $10, $25, Max), review a fresh Definitive Flash quote, confirm.
  The server (`/api/keyboard/swap`) sells that much of the Kall wallet's ETH for USDC: Flash's wrap to
  WETH, an approval for exactly that amount, then the signed order. About $1 of ETH always stays for gas,
  and one swap goes up to `KALL_EXEC_MAX_SWAP_USD` ($100). The keyboard's buys spend the USDC.
- **History:** every Flash order the Kall wallet placed: totals, All / Working / Done, what each one filled
  at, and a detail sheet with the Flash order ID, the call it copied, whether the trade is recorded on
  Arkiv, and Cancel while it's working. Re-read every 5 seconds while an order is working.
- **Keyboard:** setup steps, a field to try a typed order, and a call checker.

Debug builds can read from a local server and show another wallet's orders, for testing History before
the Kall wallet has traded:

```sh
xcrun simctl spawn booted defaults write com.buddyharshal.kallr kall.origin http://localhost:3004
xcrun simctl spawn booted defaults write com.buddyharshal.kallr kall.funder 0x…
```

## Build and install

Needs Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`), an Apple ID in
Xcode (a free Personal Team works; its installs expire after 7 days) and the iPhone connected with
Developer Mode on. Set `DEVELOPMENT_TEAM` in `project.yml` to your team ID, and create the git-ignored
`Shared/Secrets.swift` with the server's `KALL_EXEC_TOKEN`:

```sh
printf 'enum Secrets {\n    static let execToken = "%s"\n}\n' "$KALL_EXEC_TOKEN" > kallr-ios/Shared/Secrets.swift
```

Then:

```sh
cd kallr-ios
xcodegen generate
xcodebuild -project Kallr.xcodeproj -scheme Kallr -destination 'id=<iPhone UDID>' \
  -derivedDataPath build -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <iPhone UDID> build/Build/Products/Debug-iphoneos/Kallr.app
```

`xcrun devicectl list devices` shows the UDID. Or open `Kallr.xcodeproj` and press Run.

## On the iPhone

1. **Settings → General → VPN & Device Management →** your Apple ID under Developer App **→ Trust**.
2. **Settings → General → Keyboard → Keyboards → Add New Keyboard → Kall Keyboard.**
3. Tap **Kall Keyboard** and turn on **Allow Full Access**, so it can reach Kall Markets and read what you copy when you
   tap Check.
4. In any app, hold the globe key and pick Kall Keyboard.
