# Kallr keyboard (built on FlorisBoard)

The Kallr Android keyboard is a fork of **[FlorisBoard](https://github.com/florisboard/florisboard)** v0.5.2,
an open-source Android keyboard by The FlorisBoard Contributors, licensed under the
[Apache License 2.0](LICENSE). All typing, layouts, suggestions, emoji and the clipboard
come from FlorisBoard. Thank you to the FlorisBoard team.

Phones can't run browser extensions, but every app has a keyboard. This fork adds one row
above FlorisBoard's Smartbar so Kallr works inside the X app on Android:

- **Copy a post link** (Share → Copy link in X): the row shows the call's after market
  (`$BTC up from $100,000 → $102,000 (+2.0%), 2d left`) and the caller's record from calls
  looked up on this keyboard, with a one-tap "Copy $5" (TP 10%, SL 5%).
- **Type an order** like `copy $5 tp 10% sl 5%`: the row shows "Sign in desk ↗", which opens
  the Kallr desk prefilled. You review and sign there in your own wallet.
- **A shared contract address**: a token check (GoPlus + Dexscreener) and no copy button.

The keyboard never holds keys and never signs. It sends the Kallr server only an X
post link, a contract address or the order phrase being typed, never anything else from the
clipboard or the text field, and it stays quiet in password fields and incognito mode.

## What we changed

| File | Change |
| --- | --- |
| `app/src/main/kotlin/dev/patrickgold/florisboard/ime/kallr/` | New: the row (`KallrRow.kt`) and the client for `/api/keyboard` (`KallrClient.kt`) |
| `app/src/main/kotlin/dev/patrickgold/florisboard/ime/smartbar/Smartbar.kt` | Puts the Kallr row above the Smartbar |
| `app/build.gradle.kts` | `KALLR_ORIGIN` build setting (`-PkallrOrigin=…`) |
| `app/src/main/AndroidManifest.xml`, `res/xml/kallr_network_security.xml` | Internet permission; plain HTTP only to the local dev server |
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
./gradlew assembleDebug                                              # talks to http://localhost:3000
./gradlew assembleDebug -PkallrOrigin=https://your-app.example  # deployed web app
```

The APK lands in `app/build/outputs/apk/debug/`.

## Run it

```sh
npm run dev                                   # from the repo root: the web app on :3000
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:3000 tcp:3000                 # phone's localhost:3000 → this Mac
```

On the phone: open **FlorisBoard Debug** → enable it as a keyboard → switch to it. In X,
share a call → Copy link, then tap the reply box.
