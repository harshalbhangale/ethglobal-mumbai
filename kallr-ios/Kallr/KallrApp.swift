import SwiftUI

@main
struct KallrApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

/** Setting up the keyboard, trying it, and checking a call without it. */
struct ContentView: View {
    @Environment(\.openURL) private var openURL
    @State private var tryText = ""
    @State private var callText = ""
    @State private var result: Kallr.Result?
    @State private var checking = false
    @State private var checked = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                setup
                WalletCard()
                tryIt
                checkCall
                Button { openURL(Kallr.origin.appendingPathComponent("dashboard")) } label: {
                    Text("OPEN KALL MARKETS  ↗")
                        .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                        .foregroundStyle(Kallr.bone)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
                }
                PoweredByDefinitive(height: 12, suffix: "Flash on Base")
                Text("Not financial advice.").font(.footnote).foregroundStyle(Kallr.muted)
            }
            .padding(24)
        }
        .background(Kallr.black.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("KALL MARKETS / CALLS FROM X. TRADES ON BASE.")
                .font(.system(size: 11, design: .monospaced)).foregroundStyle(Kallr.muted)
            (Text("SEE THE CALL.\nTRADE IT").foregroundColor(Kallr.bone) + Text(".").foregroundColor(Kallr.lime))
                .font(.system(size: 40, weight: .black)).tracking(-1).lineSpacing(-4)
            Text("The Kall Keyboard shows calls from the callers you follow, checks what you copy, and places the trade on Definitive Flash in one tap, from your Kall wallet.")
                .font(.subheadline).foregroundStyle(Kallr.muted)
        }
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("SET UP", systemImage: "keyboard").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
            Step(n: 1, text: "Settings → General → Keyboard → Keyboards → Add New Keyboard → Kall Keyboard")
            Step(n: 2, text: "Tap Kall Keyboard and turn on Allow Full Access, so it can reach Kall Markets, read what you copy when you tap Check, and use haptics.")
            Step(n: 3, text: "Fund your Kall wallet below, then in X or Telegram hold the globe key and pick Kall Keyboard.")
            Button { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } } label: {
                Text("OPEN KALL SETTINGS  ↗")
                    .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                    .foregroundStyle(Kallr.black)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(16)
        .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Kallr.hairline))
    }

    private var tryIt: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("TRY IT", systemImage: "text.cursor").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
            Text("Type “buy $20 of eth tp 10% sl 5%” here, then switch to Kall Keyboard: the order is filled in.")
                .font(.footnote).foregroundStyle(Kallr.muted)
            TextField("Type here", text: $tryText, axis: .vertical)
                .lineLimit(2...4)
                .padding(12)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(Kallr.bone)
        }
    }

    private var checkCall: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("CHECK A CALL", systemImage: "checkmark.seal").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
            TextField("Paste an X post link or a $TICKER message", text: $callText, axis: .vertical)
                .lineLimit(2...5)
                .padding(12)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(Kallr.bone)
            Button {
                Task {
                    checking = true
                    result = await Kallr.lookup(text: Kallr.reference(fromCopied: callText) ?? callText, typed: nil)
                    checked = true
                    checking = false
                }
            } label: {
                Text(checking ? "CHECKING…" : "CHECK")
                    .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                    .foregroundStyle(Kallr.black)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 10))
            }
            .disabled(callText.isEmpty || checking)
            if checked {
                VStack(alignment: .leading, spacing: 4) {
                    if let r = result, let line = r.headline(typed: nil) {
                        Text(line).font(.subheadline.weight(.semibold)).foregroundStyle(r.warning != nil ? Kallr.danger : Kallr.bone)
                        if let record = r.record?.line { Text(record).font(.footnote).foregroundStyle(Kallr.muted) }
                        if let token = r.token?.line { Text(token).font(.footnote).foregroundStyle(Kallr.muted) }
                    } else {
                        Text("Nothing Kall Markets can read there. Paste a post link, or a message with a $TICKER or a contract.")
                            .font(.footnote).foregroundStyle(Kallr.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
            }
        }
    }
}

private struct Step: View {
    let n: Int
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("0\(n)").font(.system(size: 12, design: .monospaced)).foregroundStyle(Kallr.lime)
            Text(text).font(.subheadline).foregroundStyle(Kallr.bone)
        }
    }
}

/** The Kall wallet the keyboard trades from: where to send funds, and what it holds. */
private struct WalletCard: View {
    @State private var wallet: Kallr.Wallet?
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("YOUR KALL WALLET", systemImage: "wallet.pass").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
            if let w = wallet, let address = w.address {
                HStack(spacing: 10) {
                    amount("USDC TO TRADE", w.usdcValue.map { String(format: "%.2f", $0) })
                    amount("ETH FOR GAS", w.ethValue.map { String(format: "%.5f", $0) })
                }
                Text(address).font(.system(size: 12, design: .monospaced)).foregroundStyle(Kallr.bone).textSelection(.enabled)
                Button {
                    UIPasteboard.general.string = address
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    copied = true
                } label: {
                    Text(copied ? "ADDRESS COPIED" : "COPY ADDRESS")
                        .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                        .foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 10))
                }
                Text("Send USDC, plus about $1 of ETH for gas, on Base only, from your Privy wallet or MetaMask. The keyboard places orders from it, up to $\(Kallr.fmt(w.maxUsd ?? 25)) each.")
                    .font(.footnote).foregroundStyle(Kallr.muted)
            } else {
                Text("Reading your Kall wallet…").font(.footnote).foregroundStyle(Kallr.muted)
            }
        }
        .padding(16)
        .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Kallr.hairline))
        .task { wallet = await Kallr.wallet() }
        .refreshable { wallet = await Kallr.wallet() }
    }

    private func amount(_ label: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
            Text(value ?? "…").font(.system(size: 22, weight: .black).monospacedDigit()).foregroundStyle(Kallr.lime)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
