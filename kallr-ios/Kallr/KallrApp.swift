import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

@main
struct KallrApp: App {
    init() {
        // Black tab bar with lime selection, to match the keyboard.
        let bar = UITabBarAppearance()
        bar.configureWithOpaqueBackground()
        bar.backgroundColor = UIColor(red: 0.039, green: 0.039, blue: 0.039, alpha: 1)
        UITabBar.appearance().standardAppearance = bar
        UITabBar.appearance().scrollEdgeAppearance = bar
    }

    var body: some Scene {
        WindowGroup {
            RootView().preferredColorScheme(.dark)
        }
    }
}

/** Wallet (balances, deposit, swap), History (every trade) and Keyboard (setup). */
struct RootView: View {
    enum Tab { case wallet, history, keyboard }
    @State private var tab = Tab.wallet
    @StateObject private var store = AppStore()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        TabView(selection: $tab) {
            WalletHome(store: store, seeHistory: { tab = .history })
                .tabItem { Label("Wallet", systemImage: "wallet.pass") }.tag(Tab.wallet)
            HistoryView(store: store, setUp: { tab = .keyboard })
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }.tag(Tab.history)
            KeyboardSetup()
                .tabItem { Label("Keyboard", systemImage: "keyboard") }.tag(Tab.keyboard)
        }
        .tint(Kallr.lime)
        .task { await store.refresh() }
        // Back from signing in with X on the web app: kallmarkets://link?key=…&address=…&expires=…
        .onOpenURL { url in if store.linked(url) { tab = .wallet } }
        // Back from a wallet app after a deposit: read the balances again.
        .onChange(of: phase) { _, now in if now == .active { Task { await store.refresh() } } }
    }
}

extension Kallr.Order: Identifiable { var id: String { orderId } }

/** The Kall wallet, its orders, and which call each order copied. */
@MainActor
final class AppStore: ObservableObject {
    @Published var wallet: Kallr.Wallet?
    @Published var feed: Kallr.Feed?
    @Published var orders: [Kallr.Order]?
    @Published var loading = false
    @Published var note: String?
    @Published var cancelling: Set<String> = []
    /** The last read of Flash orders failed; what's shown (if anything) is from before. */
    @Published var ordersFailed = false
    /** "+10.00 USDC arrived", shown once after a deposit lands. */
    @Published var received: String?
    /** The person's own wallets (X with the extension, the web app), kept on this phone; History reads them too. */
    @Published var linkedWallets: [String] = UserDefaults.standard.stringArray(forKey: "kall.linkedWallets") ?? [] {
        didSet { UserDefaults.standard.set(linkedWallets, forKey: "kall.linkedWallets") }
    }

    /** The Kall wallet's address (or the debug override). */
    var kallAddress: String? { historyFunder ?? wallet?.address }
    /** Placed by the Kall wallet (keyboard and app): the only orders this app can cancel. */
    func isKall(_ o: Kallr.Order) -> Bool {
        guard let funder = o.funderAddress, let kall = kallAddress else { return true }
        return funder.lowercased() == kall.lowercased()
    }
    var kallOrders: [Kallr.Order]? { orders?.filter(isKall) }

    /** Links the first wallet address in `text`; false when there isn't one. */
    @discardableResult
    func link(_ text: String) -> Bool {
        guard let r = text.range(of: #"0x[0-9a-fA-F]{40}"#, options: .regularExpression) else { return false }
        let address = String(text[r])
        if address.lowercased() == kallAddress?.lowercased() { note = "That's the Kall wallet: its trades are already here."; return true }
        if !linkedWallets.contains(where: { $0.lowercased() == address.lowercased() }) { linkedWallets.append(address) }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        Task { await refresh() }
        return true
    }

    func unlink(_ address: String) {
        linkedWallets.removeAll { $0.lowercased() == address.lowercased() }
        orders = orders?.filter { ($0.funderAddress ?? "").lowercased() != address.lowercased() }
        Task { await refresh() }
    }

    var ethPrice: Double? { price("ETH") }
    func price(_ symbol: String) -> Double? { feed?.prices[symbol] ?? nil }
    func caller(of o: Kallr.Order) -> String? { o.caller ?? feed?.trades?.first { $0.flashOrderId == o.orderId }?.caller }
    /** Kall wrote this order to Arkiv as a trade record. */
    func recorded(_ o: Kallr.Order) -> Bool { o.arkivKey != nil || (feed?.trades?.contains { $0.flashOrderId == o.orderId } ?? false) }
    /** Callers with settled calls, best hit rate first. */
    var topCallers: [Kallr.FeedCaller] {
        (feed?.callers ?? []).filter { $0.settled > 0 }
            .sorted { ($0.hitRate ?? 0, $0.settled) > ($1.hitRate ?? 0, $1.settled) }
            .prefix(3).map { $0 }
    }

    /** Your Kall wallet once linked with X; the keyboard and app trade from it. */
    @Published var link: Kallr.Link? = Kallr.link
    /** The old shared keyboard wallet, while it still holds funds to move to your Kall wallet. */
    @Published var oldWallet: Kallr.Wallet?

    /** Saves the link from the web app's sign-in and reads the wallet again. */
    func linked(_ url: URL) -> Bool {
        guard Kallr.handleLink(url) else { return false }
        link = Kallr.link
        wallet = nil
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        Task { await refresh() }
        return true
    }

    func unlink() {
        Kallr.unlink()
        link = nil
        wallet = nil
        oldWallet = nil
        Task { await refresh() }
    }

    func refresh() async {
        loading = true
        link = Kallr.link
        async let w = Kallr.wallet()
        async let f = Kallr.feed()
        async let old = link == nil ? nil : Kallr.sharedWallet()
        let (wallet, feed, oldWallet) = await (w, f, old)
        if let wallet {
            if let before = self.wallet, before.address == wallet.address { noteDeposit(from: before, to: wallet) }
            self.wallet = wallet
        }
        self.oldWallet = oldWallet
        if let feed { self.feed = feed }
        // The Kall wallet (keyboard and app) and the person's own wallets (X and the web app), in one list.
        var wallets = kallAddress.map { [$0] } ?? []
        if let old = oldWallet?.address, !wallets.contains(where: { $0.lowercased() == old.lowercased() }) { wallets.append(old) }
        for a in linkedWallets where !wallets.contains(where: { $0.lowercased() == a.lowercased() }) { wallets.append(a) }
        if !wallets.isEmpty {
            var fresh = await Kallr.history(wallets: wallets)
            // A server without /api/history yet: the Kall wallet's orders straight from Flash.
            if fresh == nil, let kall = kallAddress { fresh = await Kallr.orders(funder: kall) }
            // A wallet that hasn't traded yet: every trade placed through Kall.
            if let mine = fresh, mine.isEmpty, let all = await Kallr.allHistory(), !all.isEmpty { fresh = all }
            if let fresh {
                orders = fresh
                ordersFailed = false
            } else {
                ordersFailed = true
            }
        } else if wallet == nil {
            ordersFailed = true
        }
        loading = false
    }

    /** Debug builds can show another wallet's orders: defaults write <bundle id> kall.funder 0x… */
    private var historyFunder: String? {
        #if DEBUG
        return UserDefaults.standard.string(forKey: "kall.funder")
        #else
        return nil
        #endif
    }

    private func noteDeposit(from old: Kallr.Wallet, to new: Kallr.Wallet) {
        var parts: [String] = []
        if let a = old.usdcValue, let b = new.usdcValue, b - a >= 0.01 { parts.append(String(format: "+%.2f USDC", b - a)) }
        if let a = old.ethValue, let b = new.ethValue, b - a >= 0.00001 { parts.append(String(format: "+%.5f ETH", b - a)) }
        guard !parts.isEmpty else { return }
        received = parts.joined(separator: " and ") + " arrived in your Kall wallet."
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    func cancel(_ orderId: String) async {
        cancelling.insert(orderId)
        switch await Kallr.cancel(orderId: orderId) {
        case .success:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            note = "Order cancelled on Flash."
        case .failure(let error):
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            note = error.localizedDescription
        }
        cancelling.remove(orderId)
        await refresh()
    }
}

// MARK: - Wallet

private struct WalletHome: View {
    @ObservedObject var store: AppStore
    let seeHistory: () -> Void
    @State private var depositing = false
    @State private var withdrawing = false
    @State private var moving = false
    @State private var copied = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Header(eyebrow: "KALL MARKETS", title: "WALLET")
                if Kallr.linkingEnabled { LinkCard(store: store) }
                balances
                if let address = store.wallet?.address {
                    HStack(spacing: 10) {
                        Text(address).font(.system(size: 12, design: .monospaced)).foregroundStyle(Kallr.bone)
                            .lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 4)
                        Button {
                            UIPasteboard.general.string = address
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                            copied = true
                        } label: {
                            Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(Kallr.bone)
                        }
                        Button { if let url = BaseScan.address(address) { openURL(url) } } label: {
                            Image(systemName: "arrow.up.right.square").font(.system(size: 15, weight: .semibold)).foregroundStyle(Kallr.muted)
                        }
                        .accessibilityLabel("View on BaseScan")
                    }
                    .padding(12)
                    .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                }
                if let received = store.received {
                    Label(received, systemImage: "checkmark.circle.fill")
                        .font(.footnote.weight(.semibold)).foregroundStyle(Kallr.lime)
                }
                if let link = store.link, let old = store.oldWallet, old.holdsFunds {
                    OldFunds(wallet: old) { moving = true }
                        .sheet(isPresented: $moving, onDismiss: { Task { await store.refresh() } }) {
                            WithdrawSheet(store: store, source: old, presetTo: link.address)
                        }
                }
                HStack(spacing: 10) {
                    Button { depositing = true } label: {
                        Label("DEPOSIT", systemImage: "arrow.down.circle.fill")
                            .font(.system(size: 15, weight: .heavy)).tracking(0.5)
                            .foregroundStyle(Kallr.black)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
                    }
                    // Withdraw sends from the old shared wallet; a linked Kall wallet sends from the web app.
                    if store.link == nil { Button { withdrawing = true } label: {
                        Label("WITHDRAW", systemImage: "arrow.up.circle")
                            .font(.system(size: 15, weight: .heavy)).tracking(0.5)
                            .foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Kallr.hairline))
                    } }
                }
                .disabled(store.wallet?.address == nil)
                hint
                SwapCard(store: store)
                PoweredByDefinitive(height: 12, suffix: "Flash on Base")
                Text(store.link == nil ? "Shared demo wallet held by Kall Markets. Up to $\(Kallr.fmt(store.wallet?.maxUsd ?? 25)) per order."
                     : "Your Kall wallet, signed by Kall's Privy signer. Up to $\(Kallr.fmt(store.wallet?.maxUsd ?? 25)) per order.")
                    .font(.footnote).foregroundStyle(Kallr.muted)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Kallr.black.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.refresh() }
        .sheet(isPresented: $depositing, onDismiss: { Task { await store.refresh() } }) {
            if let address = store.wallet?.address { DepositSheet(address: address, ethPrice: store.ethPrice) }
        }
        .sheet(isPresented: $withdrawing, onDismiss: { Task { await store.refresh() } }) {
            WithdrawSheet(store: store, source: store.wallet)
        }
    }

    private var balances: some View {
        HStack(spacing: 10) {
            Amount(label: "ETH", value: store.wallet?.ethValue.map { String(format: "%.5f", $0) },
                   sub: store.wallet?.ethValue.flatMap { eth in store.ethPrice.map { "≈ $" + (eth * $0).formatted(.number.precision(.fractionLength(2))) } })
            Amount(label: "USDC", value: store.wallet?.usdcValue.map { String(format: "%.2f", $0) })
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var hint: some View {
        if let w = store.wallet, let usdc = w.usdcValue, let eth = w.ethValue {
            if usdc < 1 || eth < 0.0002 {
                Label(eth < 0.0008 ? "Deposit ETH, then swap some to USDC." : usdc < 1 ? "Swap ETH to USDC to trade." : "Add $1 of ETH for gas.",
                      systemImage: "info.circle")
                    .font(.footnote).foregroundStyle(Kallr.muted)
            }
        }
    }


}

/**
 * Swap ETH to USDC: type dollars (or pick), get a fresh Flash quote, confirm. The keyboard's buys spend
 * the USDC; about $1 of ETH always stays for gas.
 */
private struct SwapCard: View {
    enum Step { case idle, quoting, review(Kallr.Placed), swapping, done(String), failed(String) }
    @ObservedObject var store: AppStore
    @State private var usd = ""
    @State private var step = Step.idle
    @FocusState private var typing: Bool

    /** ETH above the gas reserve, in dollars. */
    private var most: Double? {
        guard let eth = store.wallet?.ethValue, let p = store.ethPrice else { return nil }
        return max(0, ((eth - 0.0004) * p * 100).rounded(.down) / 100)
    }
    private var blocked: String? {
        guard let most else { return "Reading your wallet…" }
        if most < 1 { return "Deposit ETH to swap" }
        guard let n = Double(usd), n > 0 else { return "Enter an amount" }
        if n < 1 { return "Swap at least $1" }
        if n > most { return "Up to $\(String(format: "%.2f", most)), keeping gas" }
        return nil
    }
    private var quoting: Bool { if case .quoting = step { return true }; return false }
    private var busy: Bool { if case .swapping = step { return true }; return quoting }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("SWAP ETH TO USDC").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
                Spacer()
                PoweredByDefinitive(height: 9, suffix: "Flash")
            }
            if case .review(let quote) = step {
                review(quote)
            } else {
                form
            }
            switch step {
            case .done(let line):
                Label(line, systemImage: "checkmark.circle.fill").font(.footnote.weight(.semibold)).foregroundStyle(Kallr.lime)
            case .failed(let message):
                Text(message).font(.footnote).foregroundStyle(Kallr.danger)
            default:
                EmptyView()
            }
        }
        .padding(16)
        .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Kallr.hairline))
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 4) {
                Text("$").font(.system(size: 26, weight: .black)).foregroundStyle(Kallr.muted)
                TextField("0", text: $usd)
                    .keyboardType(.decimalPad)
                    .focused($typing)
                    .font(.system(size: 30, weight: .black).monospacedDigit())
                    .foregroundStyle(Kallr.bone)
                    .onChange(of: usd) { _, v in
                        let clean = Self.dollars(v)
                        if clean != v { usd = clean }
                    }
                    .toolbar {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("Done") { typing = false }.font(.body.weight(.semibold)).tint(Kallr.lime)
                        }
                    }
                Text("of ETH").font(.footnote.weight(.semibold)).foregroundStyle(Kallr.muted)
            }
            .padding(.horizontal, 14).frame(height: 58)
            .background(Kallr.black, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(typing ? Kallr.lime : Kallr.hairline, lineWidth: typing ? 1.5 : 1))
            .onTapGesture { typing = true }
            HStack(spacing: 8) {
                ForEach(["5", "10", "25"], id: \.self) { v in
                    preset("$\(v)", on: usd == v) { usd = v }
                }
                preset("MAX", on: most.map { usd == String(format: "%.2f", $0) } ?? false) {
                    if let most, most >= 1 { usd = String(format: "%.2f", most) }
                }
            }
            if let most, most >= 1 {
                Text("Up to $\(String(format: "%.2f", most)) · $1 of ETH stays for gas")
                    .font(.caption).foregroundStyle(Kallr.muted)
            }
            Button(action: quote) {
                Text(quoting ? "GETTING A QUOTE…" : blocked ?? "REVIEW SWAP  ↗")
                    .font(.system(size: 14, weight: .heavy)).tracking(0.5)
                    .foregroundStyle(blocked == nil ? Kallr.black : Kallr.muted)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(blocked == nil ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 11))
            }
            .disabled(blocked != nil || busy)
        }
    }

    private func review(_ q: Kallr.Placed) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(q.preview.title).font(.system(size: 17, weight: .black)).foregroundStyle(Kallr.bone)
            line("You pay", q.preview.pay)
            line("You get", q.preview.get)
            line("Impact · fee", [q.details?.impactPct.map { String(format: "%.2f%%", abs($0)) }, q.details?.feeUsd.map { String(format: "$%.2f", $0) }]
                .compactMap { $0 }.joined(separator: " · "))
            line("On Base", q.preview.approval)
            line("Best price", "✓ Definitive Flash · best route on Base")
            HStack(spacing: 8) {
                Button { step = .idle } label: {
                    Text("BACK").font(.system(size: 13, weight: .heavy)).foregroundStyle(Kallr.bone)
                        .frame(width: 80, height: 48).overlay(RoundedRectangle(cornerRadius: 11).stroke(Kallr.hairline))
                }
                HoldToConfirm(label: "HOLD TO SWAP", height: 48, cornerRadius: 11, action: confirm)
            }
            .padding(.top, 4)
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.footnote).foregroundStyle(Kallr.muted)
            Spacer(minLength: 8)
            Text(value.isEmpty ? "—" : value).font(.system(size: 14, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.bone)
                .multilineTextAlignment(.trailing)
        }
    }

    private func preset(_ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            typing = false
            action()
        } label: {
            Text(label).font(.system(size: 14, weight: .bold))
                .foregroundStyle(on ? Kallr.black : Kallr.bone)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(on ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 9))
        }
    }

    private func quote() {
        guard blocked == nil, !busy else { return }
        typing = false
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        step = .quoting
        Task {
            switch await Kallr.swap(usd: usd, dryRun: true) {
            case .success(let q): step = .review(q)
            case .failure(let e):
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                step = .failed(e.message)
            }
        }
    }

    private func confirm() {
        guard !busy else { return }
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        step = .swapping
        Chime.prepare()
        Task {
            switch await Kallr.swap(usd: usd) {
            case .success(let placed):
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                Chime.play()
                step = .done("Swapped on Flash: \(placed.preview.get) is on its way.")
                usd = ""
                // The fill takes a moment: read the balances until the USDC shows.
                for _ in 0..<8 {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    await store.refresh()
                }
            case .failure(let e):
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                step = .failed(e.message)
            }
        }
    }

    /** Digits and one dot, two decimals at most. */
    static func dollars(_ v: String) -> String {
        var out = ""
        var dot = false
        var decimals = 0
        for ch in v.replacingOccurrences(of: ",", with: ".") {
            if ch == "." {
                if dot { continue }
                dot = true
                out.append(out.isEmpty ? "0." : ".")
            } else if ch.isNumber {
                if dot { if decimals >= 2 { continue }; decimals += 1 }
                if out.count >= 7 { continue }
                out.append(ch)
            }
        }
        return out
    }
}

enum BaseScan {
    static func address(_ a: String) -> URL? { URL(string: "https://basescan.org/address/\(a)") }
    static func tx(_ hash: String) -> URL? { URL(string: "https://basescan.org/tx/\(hash)") }
}

/** "0xa840…8072". */
private func shortAddress(_ a: String) -> String { a.count > 12 ? "\(a.prefix(6))…\(a.suffix(4))" : a }

private struct Amount: View {
    let label: String
    let value: String?
    var sub: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
            Text(value ?? "…").font(.system(size: 30, weight: .black).monospacedDigit()).foregroundStyle(Kallr.lime)
                .minimumScaleFactor(0.6).lineLimit(1)
            if let sub { Text(sub).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.muted).lineLimit(1).minimumScaleFactor(0.8) }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Kallr.hairline))
    }
}

// MARK: - Deposit

/** Pick USDC or ETH and an amount; copy the address, open a wallet app with the transfer filled in, or scan the QR. */
/** Sign in with X to trade from your own Kall wallet; once linked, which wallet it is and Unlink. */
private struct LinkCard: View {
    @ObservedObject var store: AppStore
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let link = store.link {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Kallr.lime)
                Text("Your Kall wallet · \(shortAddress(link.address))").font(.footnote.weight(.semibold)).foregroundStyle(Kallr.bone)
                Spacer(minLength: 4)
                Button("Unlink") { store.unlink() }.font(.footnote.weight(.semibold)).tint(Kallr.muted)
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Trade from your Kall wallet").font(.system(size: 15, weight: .heavy)).foregroundStyle(Kallr.bone)
                Text("The same wallet as X and the web app.").font(.footnote).foregroundStyle(Kallr.muted)
                Button { openURL(Kallr.linkPage) } label: {
                    Text("SIGN IN WITH X  ↗").font(.system(size: 14, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 11))
                }
            }
            .padding(14)
            .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Kallr.lime.opacity(0.4)))
        }
    }
}

/** What's still in the old shared keyboard wallet, and one button to move it to your Kall wallet. */
private struct OldFunds: View {
    let wallet: Kallr.Wallet
    let move: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("OLD KEYBOARD WALLET").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
            Text([wallet.usdcValue.map { String(format: "%.2f USDC", $0) }, wallet.ethValue.map { String(format: "%.5f ETH", $0) }]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 17, weight: .heavy).monospacedDigit()).foregroundStyle(Kallr.bone)
            Button(action: move) {
                Text("MOVE TO YOUR KALL WALLET").font(.system(size: 14, weight: .heavy)).foregroundStyle(Kallr.bone)
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(Kallr.hairline))
            }
        }
        .padding(14)
        .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
    }
}

/**
 * Withdraw from the Kall wallet to your own wallet on Base: pick ETH or USDC, an amount (or Max), paste the
 * address, review, then hold to send. The server checks the balance and caps each withdrawal.
 */
private struct WithdrawSheet: View {
    @ObservedObject var store: AppStore
    /** The old shared keyboard wallet: the one /api/keyboard/withdraw sends from. */
    let source: Kallr.Wallet?
    /** Your Kall wallet, when moving the old wallet's funds over. */
    var presetTo: String? = nil
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var asset = "USDC"
    @State private var amount = ""
    @State private var to = ""
    @State private var review: Kallr.Withdrawal?
    @State private var sent: Kallr.Withdrawal?
    @State private var busy = false
    @State private var error: String?

    /** What can go out: ETH keeps a little for gas. */
    private var most: Double? {
        asset == "ETH" ? source?.ethValue.map { max(0, $0 - 0.00005) } : source?.usdcValue
    }
    private var mostText: String { most.map { asset == "ETH" ? String(format: "%.6f", floor($0 * 1e6) / 1e6) : String(format: "%.2f", floor($0 * 100) / 100) } ?? "…" }
    private var validTo: Bool { to.range(of: "^0x[0-9a-fA-F]{40}$", options: .regularExpression) != nil }
    private var ready: Bool { validTo && (Double(amount) ?? 0) > 0 && !busy }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(presetTo == nil ? "WITHDRAW" : "MOVE TO YOUR KALL WALLET").font(.system(size: 22, weight: .black)).foregroundStyle(Kallr.bone)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Spacer()
                    Button("Done") { dismiss() }.tint(Kallr.lime)
                }
                if let sent { done(sent) } else { form }
            }
            .padding(20)
        }
        .onAppear { if let presetTo, to.isEmpty { to = presetTo } }
        .background(Kallr.black.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("Asset", selection: $asset) {
                Text("USDC").tag("USDC")
                Text("ETH").tag("ETH")
            }
            .pickerStyle(.segmented)
            .onChange(of: asset) { _, _ in amount = ""; review = nil; error = nil }
            HStack(spacing: 8) {
                TextField("0", text: $amount)
                    .keyboardType(.decimalPad)
                    .font(.system(size: 30, weight: .black).monospacedDigit()).foregroundStyle(Kallr.bone)
                Text(asset).font(.system(size: 15, weight: .heavy)).foregroundStyle(Kallr.muted)
                Button { amount = mostText; review = nil } label: {
                    Text("MAX").font(.system(size: 13, weight: .heavy)).foregroundStyle(Kallr.lime)
                        .padding(.horizontal, 10).frame(height: 32)
                        .overlay(Capsule().stroke(Kallr.lime.opacity(0.5)))
                }
                .disabled(most == nil)
            }
            .padding(.horizontal, 14).frame(minHeight: 64)
            .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 12))
            .onChange(of: amount) { _, _ in review = nil }
            Text("Available \(mostText) \(asset)").font(.footnote.monospacedDigit()).foregroundStyle(Kallr.muted)

            HStack(spacing: 8) {
                TextField("", text: $to, prompt: Text("0x… address on Base").foregroundColor(Kallr.muted))
                    .font(.system(size: 13, design: .monospaced)).foregroundStyle(Kallr.bone)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button {
                    if let s = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) { to = s }
                } label: {
                    Text("PASTE").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.bone)
                }
            }
            .padding(.horizontal, 12).frame(height: 46)
            .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
            .onChange(of: to) { _, _ in review = nil }
            Label("Base only. Other networks lose funds.", systemImage: "exclamationmark.triangle.fill")
                .font(.footnote).foregroundStyle(Kallr.danger)

            if let review {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Send \(review.amount) \(review.asset)").font(.system(size: 18, weight: .heavy)).foregroundStyle(Kallr.bone)
                    if let usd = review.usd { Text(String(format: "≈ $%.2f", usd)).font(.subheadline.monospacedDigit()).foregroundStyle(Kallr.muted) }
                    Text("to \(review.to)").font(.system(size: 12, design: .monospaced)).foregroundStyle(Kallr.bone)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 12))
                HoldToConfirm(label: busy ? "SENDING…" : "HOLD TO WITHDRAW", height: 52, cornerRadius: 12, disabled: busy, action: send)
            } else {
                Button(action: check) {
                    Text(busy ? "CHECKING…" : "REVIEW")
                        .font(.system(size: 15, weight: .heavy)).tracking(0.5)
                        .foregroundStyle(ready ? Kallr.black : Kallr.muted)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(ready ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(!ready)
            }
            if let error { Text(error).font(.footnote).foregroundStyle(Kallr.danger) }
        }
    }

    private func done(_ w: Kallr.Withdrawal) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Sent \(w.amount) \(w.asset)", systemImage: "checkmark.circle.fill")
                .font(.system(size: 20, weight: .heavy)).foregroundStyle(Kallr.lime)
            Text("to \(w.to)").font(.system(size: 12, design: .monospaced)).foregroundStyle(Kallr.bone)
            if let tx = w.tx, let url = BaseScan.tx(tx) {
                Button { openURL(url) } label: {
                    Label("VIEW ON BASESCAN", systemImage: "arrow.up.right.square")
                        .font(.system(size: 15, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    private func check() {
        busy = true; error = nil
        Task {
            switch await Kallr.withdraw(asset: asset, amount: amount, to: to, dryRun: true) {
            case .success(let w): review = w
            case .failure(let f): error = f.message
            }
            busy = false
        }
    }

    private func send() {
        guard let review, !busy else { return }
        busy = true; error = nil
        Task {
            switch await Kallr.withdraw(asset: review.asset, amount: review.amount, to: review.to, dryRun: false) {
            case .success(let w):
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                sent = w
                await store.refresh()
            case .failure(let f): error = f.message
            }
            busy = false
        }
    }
}

private struct DepositSheet: View {
    let address: String
    let ethPrice: Double?
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var asset = "ETH"
    @State private var usd = 10.0
    @State private var note: String?

    private var path: String? { Deposit.path(asset: asset, to: address, usd: usd, ethPrice: ethPrice) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("DEPOSIT").font(.system(size: 22, weight: .black)).foregroundStyle(Kallr.bone)
                    Spacer()
                    Button("Done") { dismiss() }.tint(Kallr.lime)
                }
                Picker("Asset", selection: $asset) {
                    Text("ETH").tag("ETH")
                    Text("USDC").tag("USDC")
                }
                .pickerStyle(.segmented)
                HStack(spacing: 8) {
                    ForEach([5.0, 10, 25, 50], id: \.self) { v in
                        Button { usd = v } label: {
                            Text("$\(Kallr.fmt(v))").font(.system(size: 14, weight: .bold))
                                .foregroundStyle(usd == v ? Kallr.black : Kallr.bone)
                                .frame(maxWidth: .infinity, minHeight: 40)
                                .background(usd == v ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 9))
                        }
                    }
                }
                Text(amountLine).font(.subheadline).foregroundStyle(Kallr.muted)
                if let path, let qr = QR.image(for: "ethereum:\(path)") {
                    Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                        .frame(maxWidth: 220).padding(14)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
                        .frame(maxWidth: .infinity)
                    Text("Scan with Rainbow or any wallet")
                        .font(.footnote).foregroundStyle(Kallr.muted).frame(maxWidth: .infinity)
                }
                Button {
                    UIPasteboard.general.string = address
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    note = "Address copied. Send on Base only."
                } label: {
                    Label("COPY ADDRESS", systemImage: "doc.on.doc")
                        .font(.system(size: 15, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
                }
                Button { open(path.flatMap(Deposit.anyWallet)) } label: {
                    Text("OPEN A WALLET APP").font(.system(size: 13, weight: .bold)).foregroundStyle(Kallr.bone)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                }
                .disabled(path == nil)
                if let note { Text(note).font(.footnote).foregroundStyle(Kallr.lime) }
                Label("Base only. Other networks lose funds.", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote).foregroundStyle(Kallr.danger)
            }
            .padding(20)
        }
        .background(Kallr.black.ignoresSafeArea())
        .presentationDetents([.large])
    }

    private var amountLine: String {
        if asset == "USDC" { return "\(Kallr.fmt(usd)) USDC on Base, to your Kall wallet. Ready to trade as it lands." }
        guard let p = ethPrice, p > 0 else { return "Reading the ETH price…" }
        return String(format: "About %.5f ETH ($%@) on Base. Swap it to USDC in the Wallet tab; about $1 stays for gas.", usd / p, Kallr.fmt(usd))
    }

    private func open(_ url: URL?) {
        guard let url else { return }
        openURL(url) { accepted in
            if !accepted { note = "No wallet app opened that link. Copy the address or scan the QR instead." }
        }
    }
}

// MARK: - History

/** Where an order was placed: the keyboard (Kall wallet), X with the extension, the web app, or just your wallet. */
private enum Origin {
    case keyboard, x, web, ownWallet

    init(_ o: Kallr.Order, kall: Bool) {
        switch o.source {
        case "keyboard": self = .keyboard
        case "extension": self = .x
        case "desk": self = .web
        default: self = kall ? .keyboard : .ownWallet
        }
    }

    var short: String {
        switch self {
        case .keyboard: return "Keyboard"
        case .x: return "On X"
        case .web: return "Web app"
        case .ownWallet: return "Your wallet"
        }
    }

    var long: String {
        switch self {
        case .keyboard: return "Kall Keyboard"
        case .x: return "X, with the Kall extension"
        case .web: return "Kall web app"
        case .ownWallet: return "Your wallet (no Kall record)"
        }
    }
}

private struct OriginIcon: View {
    let origin: Origin
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            Circle().fill(origin == .keyboard ? Kallr.lime : Kallr.graphite)
            Circle().stroke(origin == .keyboard ? .clear : Kallr.hairline)
            switch origin {
            case .keyboard: Image(systemName: "keyboard.fill").font(.system(size: size * 0.4, weight: .bold)).foregroundStyle(Kallr.black)
            case .x: Text("𝕏").font(.system(size: size * 0.48, weight: .heavy)).foregroundStyle(Kallr.bone)
            case .web: Image(systemName: "globe").font(.system(size: size * 0.44, weight: .semibold)).foregroundStyle(Kallr.bone)
            case .ownWallet: Image(systemName: "wallet.pass").font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(Kallr.bone)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(origin.long)
    }
}

/** Every trade, from the keyboard, X and the web app: read live from Definitive Flash, with its Arkiv record. */
private struct HistoryView: View {
    enum Filter: String, CaseIterable { case all = "All", keyboard = "Keyboard", x = "X & web", working = "Working" }
    struct Day: Identifiable {
        let label: String
        let orders: [Kallr.Order]
        var id: String { label }
    }

    @ObservedObject var store: AppStore
    let setUp: () -> Void
    @State private var filter = Filter.all
    @State private var selected: Kallr.Order?

    private var shown: [Kallr.Order] {
        let all = store.orders ?? []
        switch filter {
        case .all: return all
        case .keyboard: return all.filter { store.isKall($0) }
        case .x: return all.filter { !store.isKall($0) }
        case .working: return all.filter(\.open)
        }
    }

    /** By day, newest first: TODAY, YESTERDAY, NOV 4. */
    private var days: [Day] {
        let cal = Calendar.current
        var out: [(day: Date?, orders: [Kallr.Order])] = []
        for o in shown {
            let day = o.placedDate.map { cal.startOfDay(for: $0) }
            if let i = out.firstIndex(where: { $0.day == day }) { out[i].orders.append(o) } else { out.append((day, [o])) }
        }
        return out.map { group in
            guard let day = group.day else { return Day(label: "EARLIER", orders: group.orders) }
            let label = cal.isDateInToday(day) ? "TODAY" : cal.isDateInYesterday(day) ? "YESTERDAY"
                : day.formatted(.dateTime.month(.abbreviated).day()).uppercased()
            return Day(label: label, orders: group.orders)
        }
    }

    /** USDC that changed hands in fills: paid on buys, received on sells. */
    private var volume: Double {
        (store.orders ?? []).compactMap { $0.filled?.contraAmount.flatMap(Double.init) }.reduce(0, +)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Header(eyebrow: "KEYBOARD · X · WEB APP — ON FLASH AND ARKIV", title: "HISTORY")
                if let note = store.note { Text(note).font(.footnote).foregroundStyle(Kallr.muted) }
                if let orders = store.orders {
                    if orders.isEmpty {
                        empty
                    } else {
                        HStack(spacing: 10) {
                            Amount(label: "TRADES", value: "\(orders.count)", sub: "\(orders.filter(\.open).count) working")
                            Amount(label: "FILLED", value: "\(orders.filter { $0.statusLabel == "FILLED" }.count)")
                            Amount(label: "VOLUME", value: String(format: "$%.2f", volume), sub: "USDC")
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        Picker("Show", selection: $filter) {
                            ForEach(Filter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        if shown.isEmpty {
                            Text(filter == .working ? "Nothing working on Flash right now."
                                 : filter == .x ? "No trades from X or the web app yet."
                                 : "No keyboard trades yet.")
                                .font(.footnote).foregroundStyle(Kallr.muted)
                        }
                        ForEach(days) { day in
                            Text(day.label).font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
                                .padding(.top, 4)
                            ForEach(day.orders) { o in
                                OrderRow(order: o, store: store, compact: false)
                                    .contentShape(Rectangle())
                                    .onTapGesture { selected = o }
                            }
                        }
                    }
                } else if store.ordersFailed {
                    Label("Couldn't load orders. Pull to retry.", systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(Kallr.danger)
                } else {
                    ProgressView().tint(Kallr.lime).frame(maxWidth: .infinity)
                }
                PoweredByDefinitive(height: 12, suffix: "Flash on Base").padding(.top, 8)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Kallr.black.ignoresSafeArea())
        .refreshable { await store.refresh() }
        .sheet(item: $selected) { o in OrderDetail(orderId: o.orderId, fallback: o, store: store) }
        .task {
            // While an order is working, re-read Flash every 5 seconds.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: (store.orders?.contains { $0.open } ?? false) ? 5_000_000_000 : 20_000_000_000)
                await store.refresh()
            }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("No trades yet.")
                .font(.subheadline).foregroundStyle(Kallr.muted)
            Button(action: setUp) {
                Text("SET UP THE KALL KEYBOARD")
                    .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                    .foregroundStyle(Kallr.bone)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
            }
        }
    }
}

private struct OrderRow: View {
    let order: Kallr.Order
    @ObservedObject var store: AppStore
    let compact: Bool

    var body: some View {
        let kall = store.isKall(order)
        let origin = Origin(order, kall: kall)
        HStack(alignment: .top, spacing: 10) {
            OriginIcon(origin: origin, size: compact ? 28 : 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(order.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Kallr.bone)
                let sub = [origin.short, store.caller(of: order).map { "@\($0)'s call" }, order.placedAgo, compact ? nil : order.exits]
                    .compactMap { $0 }.filter { !$0.isEmpty }
                Text(sub.joined(separator: " · ")).font(.footnote).foregroundStyle(Kallr.muted).lineLimit(2)
                if !compact, let fill = order.filledLine {
                    Text(fill).font(.footnote.weight(.semibold).monospacedDigit()).foregroundStyle(Kallr.lime).lineLimit(2)
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 6) {
                StatusBadge(order: order)
                if !compact, kall, order.open, order.orderType != "bracket" {
                    Button { Task { await store.cancel(order.orderId) } } label: {
                        Text(store.cancelling.contains(order.orderId) ? "…" : "CANCEL").font(.system(size: 10, weight: .heavy))
                            .foregroundStyle(Kallr.danger).padding(.horizontal, 8).frame(height: 22)
                            .overlay(RoundedRectangle(cornerRadius: 5).stroke(Kallr.danger.opacity(0.5)))
                    }
                }
            }
            if !compact {
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.muted).padding(.top, 5)
            }
        }
        .padding(12)
        .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Kallr.hairline))
    }
}

private struct StatusBadge: View {
    let order: Kallr.Order
    var body: some View {
        Text(order.statusLabel).font(.system(size: 10, weight: .heavy))
            .foregroundStyle(order.open ? Kallr.black : order.statusLabel == "FILLED" ? Kallr.lime : Kallr.muted)
            .padding(.horizontal, 8).frame(height: 22)
            .background(order.open ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 5))
    }
}

/**
 * One order: where it was placed and from which wallet, what filled, its transaction on Base, its Arkiv
 * record and the post it copied; Cancel while a Kall-wallet order is working.
 */
private struct OrderDetail: View {
    let orderId: String
    let fallback: Kallr.Order
    @ObservedObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var copied = false
    @State private var fills: Kallr.Fills?

    /** The latest copy, so the status moves while the sheet is open. */
    private var order: Kallr.Order { store.orders?.first { $0.orderId == orderId } ?? fallback }
    private var funder: String? { order.funderAddress ?? store.kallAddress }

    var body: some View {
        let kall = store.isKall(order)
        let origin = Origin(order, kall: kall)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    StatusBadge(order: order)
                    Spacer()
                    Button("Done") { dismiss() }.tint(Kallr.lime)
                }
                HStack(spacing: 12) {
                    OriginIcon(origin: origin, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(order.title).font(.system(size: 22, weight: .black)).foregroundStyle(Kallr.bone)
                        Text(origin.long).font(.footnote.weight(.semibold)).foregroundStyle(Kallr.muted)
                    }
                }
                if let fill = order.filledLine {
                    Text(fill).font(.system(size: 15, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.lime)
                }
                VStack(spacing: 0) {
                    row("Placed from", origin.long)
                    if let funder { row("Wallet", "\(kall ? "Kall wallet" : "Your wallet") · \(shortAddress(funder))") }
                    row("Type", order.orderType == "bracket" ? "Exit (take profit / stop loss)" : order.orderType.capitalized)
                    // Flash sizes buys in USDC and sells (and exits) in the asset.
                    row("Size", order.side == "buy" && order.orderType != "bracket" ? "$\(order.qty) of \(order.symbol)" : "\(order.qty) \(order.symbol)")
                    if let when = order.placedDate { row("Placed", when.formatted(date: .abbreviated, time: .shortened)) }
                    if let exits = order.exits, !exits.isEmpty { row("Exits", exits) }
                    if let caller = store.caller(of: order) { row("Copied from", "@\(caller)'s call") }
                    if let fills, !fills.fills.isEmpty {
                        row("On Base", [chainStatus(fills.fills.first?.status), fills.venues.map { "via \($0)" }].compactMap { $0 }.joined(separator: " "))
                    }
                    row("On Arkiv", store.recorded(order) ? "Trade recorded" : "Not recorded", last: true)
                }
                .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Kallr.hairline))

                VStack(spacing: 10) {
                    if let tx = fills?.transaction { link("TRANSACTION ON BASESCAN", BaseScan.tx(tx), primary: true) }
                    if let key = order.arkivKey { link("TRADE RECORD ON ARKIV", URL(string: "https://rabdi.explorer.arkiv.network/entity/\(key)")) }
                    if let post = order.postId { link("THE CALL ON X", URL(string: "https://x.com/i/status/\(post)")) }
                    if let funder { link(kall ? "KALL WALLET ON BASESCAN" : "YOUR WALLET ON BASESCAN", BaseScan.address(funder)) }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("FLASH ORDER ID").font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
                    HStack(spacing: 10) {
                        Text(order.orderId).font(.system(size: 12, design: .monospaced)).foregroundStyle(Kallr.bone)
                            .lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 4)
                        Button {
                            UIPasteboard.general.string = order.orderId
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                            copied = true
                        } label: {
                            Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(Kallr.bone)
                        }
                    }
                    .padding(12)
                    .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                }
                if kall, order.open, order.orderType != "bracket" {
                    Button { Task { await store.cancel(order.orderId) } } label: {
                        Text(store.cancelling.contains(order.orderId) ? "CANCELLING…" : "CANCEL ORDER")
                            .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                            .foregroundStyle(Kallr.danger)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.danger.opacity(0.6)))
                    }
                    .disabled(store.cancelling.contains(order.orderId))
                }
                PoweredByDefinitive(height: 12, suffix: "Flash on Base")
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Kallr.black.ignoresSafeArea())
        .presentationDetents([.large])
        // The fill's transaction on Base, read once (and again if the order fills while the sheet is open).
        .task(id: order.status) {
            guard order.status != "RECORDED" else { return }
            fills = await Kallr.fills(orderId: orderId, funder: funder)
        }
    }

    /** "Finalized", from Flash's "CHAIN_STATUS_FINALIZED". */
    private func chainStatus(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return s.replacingOccurrences(of: "CHAIN_STATUS_", with: "").replacingOccurrences(of: "_", with: " ").capitalized
    }

    private func link(_ title: String, _ url: URL?, primary: Bool = false) -> some View {
        Button { if let url { openURL(url) } } label: {
            Text("\(title)  ↗")
                .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                .foregroundStyle(primary ? Kallr.black : Kallr.bone)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(primary ? Kallr.lime : .clear, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(primary ? .clear : Kallr.hairline))
        }
        .disabled(url == nil)
    }

    private func row(_ label: String, _ value: String, last: Bool = false) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(label).font(.footnote).foregroundStyle(Kallr.muted)
                Spacer(minLength: 8)
                Text(value).font(.system(size: 14, weight: .semibold)).foregroundStyle(Kallr.bone).multilineTextAlignment(.trailing)
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            if !last { Rectangle().fill(Kallr.hairline).frame(height: 1).padding(.leading, 12) }
        }
    }
}

// MARK: - Keyboard setup and tools

private struct KeyboardSetup: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Header(eyebrow: "KALL MARKETS", title: "KEYBOARD")
                setup
                Button { openURL(Kallr.origin.appendingPathComponent("dashboard")) } label: {
                    Text("OPEN THE KALL WEB APP  ↗")
                        .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                        .foregroundStyle(Kallr.bone)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Kallr.black.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("SET UP", systemImage: "keyboard").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
            Step(n: 1, text: "Settings → General → Keyboard → Keyboards → Add New Keyboard → Kall Keyboard")
            Step(n: 2, text: "Turn on Allow Full Access.")
            Step(n: 3, text: "In any chat, hold the globe key and pick Kall Keyboard.")
            Button { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } } label: {
                Text("OPEN SETTINGS  ↗")
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
}

// MARK: - Pieces

/** The Kall mark, a mono eyebrow and a heavy uppercase title ending in a lime full stop. */
private struct Header: View {
    let eyebrow: String
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image("KallMark").resizable().scaledToFit().frame(width: 30, height: 30)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Text(eyebrow).font(.system(size: 11, design: .monospaced)).foregroundStyle(Kallr.muted).lineLimit(1).minimumScaleFactor(0.7)
            }
            (Text(title).foregroundColor(Kallr.bone) + Text(".").foregroundColor(Kallr.lime))
                .font(.system(size: 36, weight: .black)).tracking(-1)
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
