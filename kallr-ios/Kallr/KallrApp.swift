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

/** Wallet (balances, deposit, recent orders), History (every order) and Keyboard (setup and tools). */
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
        // Back from MetaMask after a deposit: read the balances again.
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

    var ethPrice: Double? { price("ETH") }
    func price(_ symbol: String) -> Double? { feed?.prices[symbol] ?? nil }
    func caller(of orderId: String) -> String? { feed?.trades?.first { $0.flashOrderId == orderId }?.caller }
    /** The keyboard wrote this order to Arkiv as a trade record. */
    func recorded(_ orderId: String) -> Bool { feed?.trades?.contains { $0.flashOrderId == orderId } ?? false }
    /** Callers with settled calls, best hit rate first. */
    var topCallers: [Kallr.FeedCaller] {
        (feed?.callers ?? []).filter { $0.settled > 0 }
            .sorted { ($0.hitRate ?? 0, $0.settled) > ($1.hitRate ?? 0, $1.settled) }
            .prefix(3).map { $0 }
    }

    func refresh() async {
        loading = true
        async let w = Kallr.wallet()
        async let f = Kallr.feed()
        let (wallet, feed) = await (w, f)
        if let wallet {
            if let before = self.wallet { noteDeposit(from: before, to: wallet) }
            self.wallet = wallet
        }
        if let feed { self.feed = feed }
        if let address = historyFunder ?? self.wallet?.address {
            if let fresh = await Kallr.orders(funder: address) {
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
    @State private var copied = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Header(eyebrow: "KALL MARKETS / YOUR KALL WALLET", title: "KALL WALLET")
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
                Button { depositing = true } label: {
                    Label("DEPOSIT ETH", systemImage: "arrow.down.circle.fill")
                        .font(.system(size: 15, weight: .heavy)).tracking(0.5)
                        .foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(store.wallet?.address == nil)
                hint
                SwapCard(store: store)
                Markets(store: store)
                recent
                callers
                PoweredByDefinitive(height: 12, suffix: "Flash on Base")
                Text("The Kall wallet is held by Kall Markets for the keyboard, capped at $\(Kallr.fmt(store.wallet?.maxUsd ?? 25)) per order. Keep small amounts in it. Not financial advice.")
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
    }

    private var balances: some View {
        HStack(spacing: 10) {
            Amount(label: "ETH", value: store.wallet?.ethValue.map { String(format: "%.5f", $0) },
                   sub: store.wallet?.ethValue.flatMap { eth in store.ethPrice.map { "≈ $" + (eth * $0).formatted(.number.precision(.fractionLength(2))) } })
            Amount(label: "USDC TO TRADE", value: store.wallet?.usdcValue.map { String(format: "%.2f", $0) }, sub: "keyboard buys spend this")
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var hint: some View {
        if let w = store.wallet, let usdc = w.usdcValue, let eth = w.ethValue {
            if usdc < 1 || eth < 0.0002 {
                Label(eth < 0.0008 ? "Deposit ETH. Swap some to USDC below and the keyboard trades with it; about $1 of ETH stays for gas."
                      : usdc < 1 ? "Swap some ETH to USDC below to trade from the keyboard." : "Add about $1 of ETH for gas.",
                      systemImage: "info.circle")
                    .font(.footnote).foregroundStyle(Kallr.muted)
            } else {
                Label("Ready to trade from the Kall Keyboard.", systemImage: "checkmark.seal.fill")
                    .font(.footnote.weight(.semibold)).foregroundStyle(Kallr.lime)
            }
        }
    }

    @ViewBuilder private var recent: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("RECENT ORDERS").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
                Spacer()
                Button("See all", action: seeHistory).font(.footnote.weight(.semibold)).tint(Kallr.lime)
            }
            if let orders = store.orders, !orders.isEmpty {
                ForEach(orders.prefix(3), id: \.orderId) { o in OrderRow(order: o, store: store, compact: true) }
            } else {
                Text(store.orders == nil ? (store.ordersFailed ? "Couldn't read your orders from Flash. Pull down to try again." : "Reading your orders from Flash…") : "No orders yet. Copy a call from the Kall Keyboard to place one.")
                    .font(.footnote).foregroundStyle(Kallr.muted)
            }
        }
    }

    @ViewBuilder private var callers: some View {
        let top = store.topCallers
        if !top.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("BEST CALLERS, SETTLED ON ARKIV").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
                ForEach(top, id: \.handle) { c in
                    let rate = Int(((c.hitRate ?? 0) * 100).rounded())
                    HStack(spacing: 10) {
                        Text("@\(c.handle)").font(.system(size: 15, weight: .semibold)).foregroundStyle(Kallr.bone).lineLimit(1)
                        Spacer(minLength: 6)
                        Text("\(c.hits)/\(c.settled) right").font(.footnote.monospacedDigit()).foregroundStyle(Kallr.muted)
                        Text("\(rate)%").font(.system(size: 15, weight: .black).monospacedDigit())
                            .foregroundStyle(rate >= 50 ? Kallr.lime : Kallr.danger)
                            .frame(minWidth: 44, alignment: .trailing)
                    }
                    .padding(.horizontal, 12).frame(minHeight: 46)
                    .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
                }
                Text("Follow them from the Kall Keyboard's Following tab, then trade their next call.")
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
                Text("You can swap up to $\(String(format: "%.2f", most)). About $1 of ETH stays for gas.")
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
            if let compare = q.compare { line("Best price", compare.line) }
            HStack(spacing: 8) {
                Button { step = .idle } label: {
                    Text("BACK").font(.system(size: 13, weight: .heavy)).foregroundStyle(Kallr.bone)
                        .frame(width: 80, height: 48).overlay(RoundedRectangle(cornerRadius: 11).stroke(Kallr.hairline))
                }
                Button(action: confirm) {
                    Text("CONFIRM SWAP  ↗").font(.system(size: 14, weight: .heavy)).tracking(0.5)
                        .foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 11))
                }
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
        Task {
            switch await Kallr.swap(usd: usd) {
            case .success(let placed):
                UINotificationFeedbackGenerator().notificationOccurred(.success)
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

/** ETH and BTC on Base right now, and how many calls are open on Arkiv. */
private struct Markets: View {
    @ObservedObject var store: AppStore

    var body: some View {
        HStack(spacing: 0) {
            cell("ETH", store.price("ETH").map(usd))
            Rectangle().fill(Kallr.hairline).frame(width: 1, height: 30)
            cell("BTC", store.price("BTC").map(usd))
            Rectangle().fill(Kallr.hairline).frame(width: 1, height: 30)
            cell("OPEN CALLS", store.feed.map { "\($0.calls.count)" }, lime: true)
        }
        .padding(.vertical, 12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Kallr.hairline))
    }

    private func cell(_ label: String, _ value: String?, lime: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
            Text(value ?? "…").font(.system(size: 17, weight: .bold).monospacedDigit())
                .foregroundStyle(lime ? Kallr.lime : Kallr.bone).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
    }

    private func usd(_ v: Double) -> String { "$" + v.formatted(.number.precision(.fractionLength(0))) }
}

enum BaseScan {
    static func address(_ a: String) -> URL? { URL(string: "https://basescan.org/address/\(a)") }
}

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

/** Pick USDC or ETH and an amount; open MetaMask (or any wallet) with the transfer filled in, or scan the QR. */
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
                    Text("Scan with MetaMask or any wallet on another device.")
                        .font(.footnote).foregroundStyle(Kallr.muted).frame(maxWidth: .infinity)
                }
                Button { open(path.flatMap(Deposit.metaMask)) } label: {
                    Label("OPEN IN METAMASK", systemImage: "arrow.up.right.square")
                        .font(.system(size: 15, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
                }
                .disabled(path == nil)
                HStack(spacing: 10) {
                    Button { open(path.flatMap(Deposit.anyWallet)) } label: {
                        Text("OTHER WALLET APP").font(.system(size: 13, weight: .bold)).foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
                    }
                    .disabled(path == nil)
                    Button {
                        UIPasteboard.general.string = address
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        note = "Address copied. Send on Base only."
                    } label: {
                        Text("COPY ADDRESS").font(.system(size: 13, weight: .bold)).foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
                    }
                }
                if let note { Text(note).font(.footnote).foregroundStyle(Kallr.lime) }
                Label("Base network only. Funds sent on another network are lost.", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote).foregroundStyle(Kallr.danger)
                Text("Or from your Privy wallet on the Kall Web App: send ETH to this address on Base.")
                    .font(.footnote).foregroundStyle(Kallr.muted)
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

enum QR {
    static func image(for text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

// MARK: - History

private struct HistoryView: View {
    enum Filter: String, CaseIterable { case all = "All", working = "Working", done = "Done" }
    @ObservedObject var store: AppStore
    let setUp: () -> Void
    @State private var filter = Filter.all
    @State private var selected: Kallr.Order?

    private var shown: [Kallr.Order] {
        let all = store.orders ?? []
        switch filter {
        case .all: return all
        case .working: return all.filter(\.open)
        case .done: return all.filter { !$0.open }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Header(eyebrow: "DEFINITIVE FLASH / KALL WALLET ORDERS", title: "HISTORY")
                if let note = store.note { Text(note).font(.footnote).foregroundStyle(Kallr.muted) }
                if let orders = store.orders {
                    if orders.isEmpty {
                        empty
                    } else {
                        HStack(spacing: 10) {
                            Amount(label: "ORDERS", value: "\(orders.count)")
                            Amount(label: "WORKING", value: "\(orders.filter(\.open).count)")
                            Amount(label: "FILLED", value: "\(orders.filter { $0.statusLabel == "FILLED" }.count)")
                        }
                        Picker("Show", selection: $filter) {
                            ForEach(Filter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        if shown.isEmpty {
                            Text(filter == .working ? "Nothing working on Flash right now." : "No finished orders yet.")
                                .font(.footnote).foregroundStyle(Kallr.muted)
                        }
                        ForEach(shown) { o in
                            OrderRow(order: o, store: store, compact: false)
                                .contentShape(Rectangle())
                                .onTapGesture { selected = o }
                        }
                    }
                } else if store.ordersFailed {
                    Label("Couldn't read your orders from Definitive Flash. Pull down to try again.", systemImage: "exclamationmark.triangle")
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
            Text("No orders yet. In X or Telegram, switch to the Kall Keyboard, pick a call and tap Trade. Every order lands here, read live from Definitive Flash.")
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
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(order.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Kallr.bone)
                let sub = [store.caller(of: order.orderId).map { "from @\($0)'s call" }, order.placedAgo, compact ? nil : order.exits].compactMap { $0 }
                if !sub.isEmpty { Text(sub.joined(separator: " · ")).font(.footnote).foregroundStyle(Kallr.muted).lineLimit(2) }
                if !compact, let fill = order.filledLine {
                    Text(fill).font(.footnote.weight(.semibold).monospacedDigit()).foregroundStyle(Kallr.lime).lineLimit(2)
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 6) {
                StatusBadge(order: order)
                if !compact, order.open, order.orderType != "bracket" {
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

/** One order: what it is, where it came from, its Flash ID, and Cancel while it's working. */
private struct OrderDetail: View {
    let orderId: String
    let fallback: Kallr.Order
    @ObservedObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var copied = false

    /** The latest copy, so the status moves while the sheet is open. */
    private var order: Kallr.Order { store.orders?.first { $0.orderId == orderId } ?? fallback }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    StatusBadge(order: order)
                    Spacer()
                    Button("Done") { dismiss() }.tint(Kallr.lime)
                }
                Text(order.title).font(.system(size: 24, weight: .black)).foregroundStyle(Kallr.bone)
                VStack(spacing: 0) {
                    row("Type", order.orderType == "bracket" ? "Exit (take profit / stop loss)" : order.orderType.capitalized)
                    row("Side", order.side.capitalized)
                    // Flash sizes buys in USDC and sells (and exits) in the asset.
                    row("Size", order.side == "buy" && order.orderType != "bracket" ? "$\(order.qty) of \(order.symbol)" : "\(order.qty) \(order.symbol)")
                    if let when = order.placedDate { row("Placed", when.formatted(date: .abbreviated, time: .shortened)) }
                    if let fill = order.filledLine { row("Filled", fill) }
                    if let exits = order.exits, !exits.isEmpty { row("Exits", exits) }
                    if let caller = store.caller(of: order.orderId) { row("Copied from", "@\(caller)'s call") }
                    row("On Arkiv", store.recorded(order.orderId) ? "Trade recorded" : "Not recorded yet", last: true)
                }
                .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Kallr.hairline))
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
                if order.open, order.orderType != "bracket" {
                    Button { Task { await store.cancel(order.orderId) } } label: {
                        Text(store.cancelling.contains(order.orderId) ? "CANCELLING…" : "CANCEL ORDER")
                            .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                            .foregroundStyle(Kallr.danger)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.danger.opacity(0.6)))
                    }
                    .disabled(store.cancelling.contains(order.orderId))
                }
                if let address = store.wallet?.address, let url = BaseScan.address(address) {
                    Button { openURL(url) } label: {
                        Text("KALL WALLET ON BASESCAN  ↗")
                            .font(.system(size: 14, weight: .heavy)).tracking(0.6)
                            .foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.hairline))
                    }
                }
                PoweredByDefinitive(height: 12, suffix: "Flash on Base")
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Kallr.black.ignoresSafeArea())
        .presentationDetents([.large])
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
    @State private var tryText = ""
    @State private var callText = ""
    @State private var result: Kallr.Result?
    @State private var checking = false
    @State private var checked = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Header(eyebrow: "KALL MARKETS / CALLS FROM X. TRADES ON BASE.", title: "SEE THE CALL.\nTRADE IT")
                Text("The Kall Keyboard shows calls from the callers you follow, checks what you copy, and places the trade on Definitive Flash after you review a fresh quote, from your Kall wallet.")
                    .font(.subheadline).foregroundStyle(Kallr.muted)
                setup
                tryIt
                checkCall
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
            Step(n: 2, text: "Tap Kall Keyboard and turn on Allow Full Access, so it can reach Kall Markets, read what you copy when you tap Check, and use haptics.")
            Step(n: 3, text: "Deposit ETH in the Wallet tab and swap some to USDC, then in X or Telegram hold the globe key and pick Kall Keyboard.")
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
