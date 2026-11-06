# Kall Keyboard for iPhone

A small app plus the Kall Keyboard extension, in Kall Markets black and lime. The keyboard is a trading
panel; typing stays on the iPhone keyboard (the globe key switches between them).

- **Calls:** open calls from the callers Kall Markets tracks (read from Arkiv by `/api/keyboard/feed`),
  each with the move since the post and time left, and **Copy** to trade it. Settled calls below, and
  **Check** for a post or $TICKER message you copied.
- **Trade:** ETH or BTC; $1, $5, $10, $25 or a custom amount on a number pad; Market, Limit (−3, −5 or
  −10%) or TWAP (10 min, 1 hour, 4 hours); take-profit and stop-loss presets. **Review** gets a fresh
  Definitive Flash quote (you pay, you get, price impact and fee, exits, approval) without sending
  anything; **Confirm & place** sends it.
- **Orders:** the Kall wallet's Flash orders with live status (re-read every 5 seconds while one is
  working) and which call each one copied.
- **Wallet:** the Kall wallet's address and balances.

**How a trade is placed.** The keyboard sends the order to `/api/keyboard/execute` with a secret only these
builds carry. The server re-quotes on Flash, approves exactly this USDC amount, signs with the Kall wallet
and submits, then records the trade on Arkiv as a keyboard trade. The Kall wallet is a demo hot wallet held
by the server, funded with a little USDC and ETH on Base, with a per-order cap (`KALL_EXEC_MAX_USD`, $25).
An order typed on the iPhone keyboard ("buy $20 of eth tp 10% sl 5%") is filled in when you switch to Kall.

iOS doesn't let keyboards use the microphone, so voice orders are Android only, as are Base tokens beyond
ETH and BTC.

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
