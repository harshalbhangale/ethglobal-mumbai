# Kall Markets keyboard (built on FlorisBoard)

The Kall Markets Android keyboard is a fork of **[FlorisBoard](https://github.com/florisboard/florisboard)** v0.5.2,
an open-source Android keyboard by The FlorisBoard Contributors, licensed under the
[Apache License 2.0](LICENSE). All typing, layouts, suggestions, emoji and the clipboard
come from FlorisBoard. Thank you to the FlorisBoard team.

Phones can't run browser extensions, but every app has a keyboard. This fork adds a **Trade**
button to FlorisBoard's toolbar (blue, at the right end, where the mic was). Like the emoji button,
it swaps the keys for the Kall Markets trading panel; **ABC** goes back to typing. The panel has three tabs:

- **Swap:** the call you copied and the caller's record, then token (the call's coin, ETH or BTC),
  **Swap / Limit (−3/−5/−10%) / TWAP (10 min, 1 h, 4 h)**, amount ($1/$5/$20/$50) and exits
  (TP/SL), and Buy. "Powered by Flash · Definitive · on Base".
- **Positions:** your Flash orders with status and TP/SL, and your USDC and ETH on Base.
- **Wallet:** your Privy embedded wallet (the same as the Kall Markets desk), copy the address to fund it
  from MetaMask, sign in with X.

When you copy a call (X post link, or a `$PEPE` message from Telegram), share a contract or type
`copy $20 of btc tp 20% sl 10%`, a slim "Trade this call" suggestion appears above the toolbar and
opens the panel with the order filled in. A shared contract gets a token check and no Buy for it.

**AI layer (server-side; the OpenAI and ElevenLabs keys never ship in the APK):**

- **Check this call:** copy or share (Share → **Check with Kall Markets**) a post or a Telegram message. The
  AI reads the coin, contract, direction and timeframe, the server checks the caller's record and
  the token, and a contract that claims a ticker but isn't the main token with it on Base is shown
  as **fake** with the real address, and gets no Buy.
- **Plain words:** typing `buy 20 bucks of degen if it dips 10%` fills a $20 DEGEN limit at −10%.
- **Hold to say an order** (Swap tab): ElevenLabs Scribe hears it, the AI fills the panel. The mic
  only records while held (Android asks for the microphone once).

Buy opens a confirm sheet (no browser) with what you pay, what you get, the exits and the approval
(this order's USDC only). "Confirm and sign" signs with the embedded wallet and places the order on
**Definitive Flash** on Base, tagged as a keyboard trade.

Keys stay with Privy; the keyboard only asks for signatures on orders you confirm. It sends the
Kall Markets server only a post link, a contract address or the order phrase being typed, and it shows
nothing in password fields or incognito mode.

## What we changed

| File | Change |
| --- | --- |
| `app/src/main/kotlin/dev/patrickgold/florisboard/ime/kallr/` | New: the trading panel (`KallrPanel.kt`), the suggestion row (`KallrRow.kt`), the server client (`KallrClient.kt`), the Privy wallet (`KallrWallet.kt`), Flash signing (`KallrTrader.kt`), the confirm sheet and wallet screens (`KallrActivities.kt`) |
| `app/src/main/kotlin/dev/patrickgold/florisboard/FlorisApplication.kt` | Starts Privy once at launch |
| `ime/kallr/KallrDesign.kt` | Kall Markets's look: near-black, bone-white type and one lime accent. Motion is quiet and linear: a lime glint across buttons, a lime streak along the row's border and the panel's top line, and a dot field with a lime band drifting through it. It animates in the draw phase, so it never recomposes the keyboard |
| `assets/ime/theme/org.florisboard.themes/` (`kallr_night.json`, `kallr_day.json`), `app/AppPrefs.kt` | Kall Markets Black (graphite keys on black, lime Enter and Caps Lock), the default in light and dark mode, and Kall Markets Paper (the same on off-white) |
| `app/src/main/kotlin/dev/patrickgold/florisboard/ime/smartbar/Smartbar.kt` | Puts the Kall Markets suggestion above the Smartbar |
| `ime/ImeUiMode.kt`, `ime/text/key/KeyCode.kt`, `ime/text/keyboard/TextKeyData.kt`, `ime/keyboard/KeyboardManager.kt`, `ime/keyboard/ComputingEvaluator.kt`, `ime/smartbar/quickaction/*`, `ime/popup/PopupUiController.kt`, `FlorisImeService.kt`, `res/values/strings.xml` | The Trade key (`IME_UI_MODE_KALLR`), its panel mode, lime chart icon and label, and Trade as the toolbar's sticky action |
| `app/build.gradle.kts` | App ID `app.kallr.keyboard`, name "Kall Markets", `-PkallrOrigin`, `-PprivyAppId`, `-PprivyClientId`, Privy Android SDK 0.18.0 |
| `gradle.properties` | Android 9+ (API 28), which Privy's SDK needs |
| `app/src/main/AndroidManifest.xml`, `res/xml/kallr_network_security.xml` | Internet permission; the confirm sheet, wallet screen and Privy's `kallr://` login redirect; plain HTTP only to the local dev server (debug builds: any host, for a laptop on the same Wi-Fi) |
| `lib/native/build.gradle.kts` | Builds the native library for arm64 only |
| `settings.gradle.kts`, `vendor/jetpref/` | FlorisBoard v0.5.2 pins a `jetpref` snapshot (`20251119T222500Z`) that has expired from Maven Central. `vendor/jetpref` is [jetpref](https://github.com/patrickgold/jetpref) (Apache-2.0) at the commit that snapshot was built from (`d6e12dd`), built in its place. Its example app is left out |

Everything else is FlorisBoard as released. The server side is `kallr-webapp/app/api/keyboard`
and `kallr-webapp/lib/keyboard.ts`.

FlorisBoard's [AI policy](AI_POLICY.md) covers contributions to FlorisBoard itself. These
changes were made with AI help and are for Kall Markets only. Don't send them upstream.

## Build

Needs JDK 17, the Android SDK (platform 36, build-tools 35.0.0, NDK 26.1.10909125,
CMake 4.0.2) and Rust 1.83 with the `aarch64-linux-android` target.

On macOS with a newer SDK than Rust 1.83's linker understands ("unknown architecture
arm64e.x1"), point Rust's host builds at an older SDK first:

```sh
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.sdk
```

```sh
cd kallr-keyboard
echo "sdk.dir=$HOME/Library/Android/sdk" | tee local.properties vendor/jetpref/local.properties
./gradlew assembleDebug -PkallrOrigin=https://your-app.example \
  -PprivyAppId=<NEXT_PUBLIC_PRIVY_APP_ID> -PprivyClientId=<client-…>
```

`gradle.properties` sets the defaults: `kallrOrigin=https://kallr.vercel.app` and the Kall Markets Privy app and
Android client IDs (both public), so a plain `./gradlew assembleDebug` builds a working APK. Otherwise
`kallrOrigin` falls back to `http://localhost:3000`; use `http://10.0.2.2:3000` for the emulator or
the laptop's Wi-Fi address for a phone on the same network.

**Privy setup (once):** in the Privy dashboard, App settings → Clients → add an Android client with
app identifier `app.kallr.keyboard` and URL scheme `kallr`, and keep Twitter/X login enabled. The
client ID goes in `-PprivyClientId`. Without it the keyboard works but can't sign in or trade.

The APK lands in `app/build/outputs/apk/debug/`.

## Run it

```sh
npm run dev                                   # from the repo root: the web app on :3000
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:3000 tcp:3000                 # phone's localhost:3000 → this Mac
```

On the phone: open **Kall Markets** → enable it as a keyboard → switch to it. Open **Kall Markets**
icon (the wallet), sign in with X and fund the address with a few USDC and about $1 of ETH on Base. In X,
share a call → Copy link, tap the reply box, then **Trade**.
