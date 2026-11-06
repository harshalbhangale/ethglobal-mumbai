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
                tryIt
                checkCall
                Button { openURL(Kallr.origin.appendingPathComponent("dashboard")) } label: {
                    Text("OPEN THE KALLR DESK  ↗")
                        .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                        .foregroundStyle(Kallr.bone)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
                }
                Text("Orders run on Base through Definitive Flash. Not financial advice.")
                    .font(.footnote).foregroundStyle(Kallr.muted)
            }
            .padding(24)
        }
        .background(Kallr.black.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("KALLR / CALLS FROM X. TRADES ON BASE.")
                .font(.system(size: 11, design: .monospaced)).foregroundStyle(Kallr.muted)
            (Text("SEE THE CALL.\nTRADE IT").foregroundColor(Kallr.bone) + Text(".").foregroundColor(Kallr.lime))
                .font(.system(size: 40, weight: .black)).tracking(-1).lineSpacing(-4)
            Text("The Kallr keyboard checks the calls you copy in X or Telegram, shows the caller's record, flags fake contracts, and opens the order with your wallet.")
                .font(.subheadline).foregroundStyle(Kallr.muted)
        }
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("SET UP", systemImage: "keyboard").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
            Step(n: 1, text: "Settings → General → Keyboard → Keyboards → Add New Keyboard → Kallr")
            Step(n: 2, text: "Tap Kallr and turn on Allow Full Access, so it can reach Kallr and read what you copy when you tap Check.")
            Step(n: 3, text: "In any app, hold the globe key and pick Kallr.")
            Button { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } } label: {
                Text("OPEN KALLR SETTINGS  ↗")
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
            Text("Switch to Kallr here and type “buy $20 of eth tp 10% sl 5%”.")
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
                        Text("Nothing Kallr can read there. Paste a post link, or a message with a $TICKER or a contract.")
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
