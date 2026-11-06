# Kallr for iPhone

A small Kallr app plus the Kallr keyboard extension, in Kallr black and lime. It talks to the same
server as the Android keyboard (`/api/keyboard` on https://kallr.vercel.app).

- **Typing:** a QWERTY keyboard with numbers and symbols, and the globe key to switch keyboards.
- **Kallr row:** copy a call in X or Telegram and tap **Check**. It shows the call, the caller's
  record and the token check, and warns on fake contracts. An order you type ("buy $20 of eth tp 10%
  sl 5%") is read as you type.
- **Trade panel:** ETH or BTC, an amount, and exits. **Buy** opens the Kallr order page with the order
  filled in. It signs with the same Privy wallet as the desk and the Android keyboard, and the trade is
  recorded on Arkiv as a keyboard trade.

What iOS doesn't allow in a keyboard, so it isn't here: the microphone (voice orders), and holding the
Privy wallet inside the keyboard. Base tokens beyond ETH and BTC trade on Android and the X extension.

## Build and install

Needs Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`), an Apple ID in
Xcode (a free Personal Team works; its installs expire after 7 days) and the iPhone connected with
Developer Mode on. Set `DEVELOPMENT_TEAM` in `project.yml` to your team ID, then:

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
2. **Settings → General → Keyboard → Keyboards → Add New Keyboard → Kallr.**
3. Tap **Kallr** and turn on **Allow Full Access**, so it can reach Kallr and read what you copy when you
   tap Check.
4. In any app, hold the globe key and pick Kallr.
