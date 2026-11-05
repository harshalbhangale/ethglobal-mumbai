# Kallr keyboard (built on FlorisBoard)

The Kallr Android keyboard is a fork of **[FlorisBoard](https://github.com/florisboard/florisboard)** v0.5.2,
an open-source Android keyboard by The FlorisBoard Contributors, licensed under the
[Apache License 2.0](LICENSE). All typing, layouts, suggestions, emoji and the clipboard
come from FlorisBoard. Thank you to the FlorisBoard team.

Phones can't run browser extensions, but every app has a keyboard. This fork adds a Kallr panel
above FlorisBoard's Smartbar, so you can trade a call from inside X, Telegram or any app:

- **The call:** copy a post link from X (Share → Copy link) or a message with `$PEPE` from
  Telegram. The header shows the call's after market and the caller's record.
- **Trade:** pick the token (the call's coin, ETH or BTC), **Swap / Limit (−3/−5/−10%) / TWAP
  (10 min, 1 h, 4 h)**, the amount ($1/$5/$20) and exits (TP/SL). Typing `copy $20 tp 20% sl 10%`
  in the chat pre-fills it.
- **Confirm sheet:** Buy opens a sheet (no browser) with what you pay, what you get, the exits and
  the approval (this order's USDC only). "Confirm and sign" signs with your **Privy embedded
  wallet**, the same wallet as the Kallr desk, and places the order on **Definitive Flash** on Base,
  tagged as a keyboard trade.
- **Kallr Wallet** (its own launcher icon): sign in with X, see the wallet's USDC and ETH on Base,
  copy the address to fund it from MetaMask.
- **A shared contract address:** a token check (GoPlus + Dexscreener) and no Buy for it.

Keys stay with Privy; the keyboard only asks for signatures on orders you confirm. It sends the
Kallr server only a post link, a contract address or the order phrase being typed, and it shows
nothing in password fields or incognito mode.

## What we changed

| File | Change |
| --- | --- |
| `app/src/main/kotlin/dev/patrickgold/florisboard/ime/kallr/` | New: the panel (`KallrRow.kt`), the server client (`KallrClient.kt`), the Privy wallet (`KallrWallet.kt`), Flash signing (`KallrTrader.kt`), the confirm sheet and wallet screens (`KallrActivities.kt`) |
| `app/src/main/kotlin/dev/patrickgold/florisboard/FlorisApplication.kt` | Starts Privy once at launch |
| `app/src/main/kotlin/dev/patrickgold/florisboard/ime/smartbar/Smartbar.kt` | Puts the Kallr row above the Smartbar |
| `app/build.gradle.kts` | App ID `app.kallr.keyboard`, name "Kallr Keyboard", `-PkallrOrigin`, `-PprivyAppId`, `-PprivyClientId`, Privy Android SDK 0.18.0 |
| `gradle.properties` | Android 9+ (API 28), which Privy's SDK needs |
| `app/src/main/AndroidManifest.xml`, `res/xml/kallr_network_security.xml` | Internet permission; the confirm sheet, wallet screen and Privy's `kallr://` login redirect; plain HTTP only to the local dev server (debug builds: any host, for a laptop on the same Wi-Fi) |
| `lib/native/build.gradle.kts` | Builds the native library for arm64 only |
| `settings.gradle.kts`, `vendor/jetpref/` | FlorisBoard v0.5.2 pins a `jetpref` snapshot (`20251119T222500Z`) that has expired from Maven Central. `vendor/jetpref` is [jetpref](https://github.com/patrickgold/jetpref) (Apache-2.0) at the commit that snapshot was built from (`d6e12dd`), built in its place. Its example app is left out |

Everything else is FlorisBoard as released. The server side is `kallr-webapp/app/api/keyboard`
and `kallr-webapp/lib/keyboard.ts`.

FlorisBoard's [AI policy](AI_POLICY.md) covers contributions to FlorisBoard itself. These
changes were made with AI help and are for Kallr only. Don't send them upstream.

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

`kallrOrigin` defaults to `http://localhost:3000`; use `http://10.0.2.2:3000` for the emulator or
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

On the phone: open **Kallr Keyboard** → enable it as a keyboard → switch to it. Open **Kallr
Wallet**, sign in with X and fund the address with a few USDC and about $1 of ETH on Base. In X,
share a call → Copy link, tap the reply box, then **Trade**.
