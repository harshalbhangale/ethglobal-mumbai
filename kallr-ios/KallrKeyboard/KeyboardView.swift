import SwiftUI
import UIKit

/** The Kall Keyboard: Calls, Trade, Orders and Wallet. Typing stays on the iPhone keyboard (globe key). */
@MainActor
final class KeyboardModel: ObservableObject {
    enum Tab: String, CaseIterable { case calls = "CALLS", trade = "TRADE", orders = "ORDERS", wallet = "WALLET" }
    enum Placing: Equatable { case idle, placing, done(String), failed(String) }

    weak var controller: KeyboardViewController?
    @Published var tab = Tab.calls
    @Published var showsGlobe = true
    @Published var fullAccess = false

    // Calls
    @Published var feed: Kallr.Feed?
    @Published var feedError: String?
    @Published var copied: Kallr.Result?
    @Published var checking = false
    @Published var note: String?

    // Trade
    @Published var asset = "ETH"
    @Published var usd = "5"
    @Published var exits: Exits = .tp10
    @Published var source: (handle: String, postId: String, line: String)?
    @Published var editingAmount = false
    @Published var placing = Placing.idle

    // Orders and wallet
    @Published var orders: [Kallr.Order]?
    @Published var wallet: Kallr.Wallet?

    enum Exits: String, CaseIterable {
        case none = "No exits", tp10 = "TP 10% · SL 5%", tp20 = "TP 20% · SL 10%"
        var pcts: (Double, Double)? { self == .none ? nil : self == .tp10 ? (10, 5) : (20, 10) }
    }

    init(controller: KeyboardViewController) { self.controller = controller }

    func tap(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) { UIImpactFeedbackGenerator(style: style).impactOccurred() }

    func load() async {
        async let f = Kallr.feed()
        async let w = Kallr.wallet()
        let (feed, wallet) = await (f, w)
        if let feed { self.feed = feed; feedError = nil } else if self.feed == nil { feedError = fullAccess ? "Couldn't reach Kall Markets." : "Turn on Allow Full Access for Kall Keyboard in Settings." }
        if let wallet { self.wallet = wallet }
    }

    func loadOrders() async {
        guard let address = wallet?.address else { await load(); return }
        orders = await Kallr.orders(funder: address)
    }

    /** Copy a call into the Trade tab. */
    func copy(_ c: Kallr.FeedCall) {
        tap(.medium)
        asset = c.asset
        source = (c.caller, c.postId, "@\(c.caller) · \(c.direction == "down" ? "SHORT" : "LONG") $\(c.asset)")
        placing = .idle
        tab = .trade
    }

    func applyCopied(_ r: Kallr.Result) {
        copied = r
        if let symbol = (r.trade?.symbol ?? r.call?.asset)?.uppercased(), ["ETH", "WETH", "BTC", "CBBTC"].contains(symbol) {
            asset = symbol.hasSuffix("BTC") ? "BTC" : "ETH"
        }
        if let p = r.prefill {
            if let v = p.usd { usd = Kallr.fmt(v) }
            if let tp = p.tpPct, let sl = p.slPct { exits = tp >= 20 ? .tp20 : (tp > 0 && sl > 0 ? .tp10 : .none) }
        }
        if let post = r.post { source = (post.handle, post.postId, r.call.map { "@\(post.handle) · \($0.line)" } ?? "@\(post.handle)") }
    }

    var blocked: String? {
        if let w = copied?.warning { return w.hasPrefix("Fake") ? "No buy: fake contract" : "No buy: risky token" }
        guard let n = Double(usd), n > 0 else { return "Enter an amount" }
        if let max = wallet?.maxUsd, n > max { return "Up to $\(Kallr.fmt(max)) per order" }
        if let usdc = wallet?.usdcValue, usdc < n { return "Add USDC to your Kall wallet" }
        return nil
    }

    func buy() {
        guard blocked == nil, placing != .placing else { return }
        tap(.heavy)
        placing = .placing
        let order = Kallr.KeyboardOrder(token: asset, kind: "swap", usd: usd, tpPct: exits.pcts?.0, slPct: exits.pcts?.1, postId: source?.postId, caller: source?.handle)
        Task {
            switch await Kallr.execute(order) {
            case .success(let placed):
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                placing = .done("\(placed.preview.title) · \(placed.preview.get)")
                Task { await load() }
            case .failure(let error):
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                placing = .failed(error.localizedDescription)
            }
        }
    }

    func keypad(_ k: String) {
        tap()
        switch k {
        case "⌫": usd = String(usd.dropLast())
        case ".": if !usd.contains(".") { usd = (usd.isEmpty ? "0" : usd) + "." }
        default:
            if usd == "0" { usd = k } else if usd.count < 7, !(usd.split(separator: ".").count == 2 && usd.split(separator: ".")[1].count >= 2) { usd += k }
        }
    }
}

struct KeyboardView: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: 0) {
            TopBar(model: model)
            Group {
                switch model.tab {
                case .calls: CallsTab(model: model)
                case .trade: TradeTab(model: model)
                case .orders: OrdersTab(model: model)
                case .wallet: WalletTab(model: model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .transition(.opacity)
        }
        .background(Kallr.black)
        .task { await model.load() }
    }
}

// MARK: - Top bar

private struct TopBar: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 2) {
                ForEach(KeyboardModel.Tab.allCases, id: \.self) { t in
                    Button {
                        model.tap()
                        withAnimation(.easeOut(duration: 0.15)) { model.tab = t }
                        if t == .orders { Task { await model.loadOrders() } }
                        if t == .wallet || t == .calls { Task { await model.load() } }
                    } label: {
                        Text(t.rawValue)
                            .font(.system(size: 11, weight: .heavy)).tracking(0.6)
                            .foregroundStyle(model.tab == t ? Kallr.black : Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .background(model.tab == t ? Kallr.lime : .clear, in: RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(Press())
                }
            }
            .padding(3)
            .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
            if model.showsGlobe {
                Button { model.tap(); model.controller?.nextKeyboard() } label: {
                    Image(systemName: "globe").font(.system(size: 17, weight: .medium)).foregroundStyle(Kallr.bone)
                        .frame(width: 40, height: 38).background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(Press())
                .accessibilityLabel("Next keyboard")
            }
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
        .padding(.bottom, 4)
    }
}

// MARK: - Calls

private struct CallsTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: 6) {
            Button { model.tap(); model.controller?.checkCopied() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "doc.on.clipboard").font(.system(size: 13, weight: .semibold))
                    Text(model.checking ? "Checking…" : model.note ?? copiedLine)
                        .font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    Spacer(minLength: 0)
                    if model.copied?.headline(typed: nil) != nil, model.copied?.warning == nil {
                        Text("TRADE ↗").font(.system(size: 11, weight: .heavy)).foregroundStyle(Kallr.black)
                            .padding(.horizontal, 8).frame(height: 22).background(Kallr.lime, in: RoundedRectangle(cornerRadius: 5))
                    }
                }
                .foregroundStyle(model.copied?.warning != nil || model.note != nil ? Kallr.danger : Kallr.bone)
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(Press())
            .simultaneousGesture(TapGesture().onEnded { if model.copied?.warning == nil, model.copied?.headline(typed: nil) != nil { model.tab = .trade } })
            .padding(.horizontal, 6)

            ScrollView {
                LazyVStack(spacing: 0) {
                    if let feed = model.feed {
                        Section(title: "OPEN CALLS · FROM THE CALLERS YOU FOLLOW")
                        ForEach(feed.calls, id: \.postId) { c in CallRow(call: c, price: feed.prices[c.asset] ?? nil, model: model) }
                        if feed.calls.isEmpty { Empty(text: "No open calls right now.") }
                        Section(title: "SETTLED")
                        ForEach(feed.results.prefix(8), id: \.postId) { r in ResultRow(result: r) }
                    } else {
                        Empty(text: model.feedError ?? "Reading Arkiv…")
                    }
                }
                .padding(.horizontal, 6)
            }
        }
    }

    private var copiedLine: String {
        if let r = model.copied, let h = r.headline(typed: nil) { return h }
        return "Check what you copied: an X post or a $TICKER message"
    }
}

private struct Section: View {
    let title: String
    var body: some View {
        Text(title).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 10).padding(.bottom, 4)
    }
}

private struct Empty: View {
    let text: String
    var body: some View { Text(text).font(.system(size: 12)).foregroundStyle(Kallr.muted).frame(maxWidth: .infinity, minHeight: 40) }
}

private struct CallRow: View {
    let call: Kallr.FeedCall
    let price: Double?
    @ObservedObject var model: KeyboardModel

    private var move: Double? {
        guard let entry = call.entry, let price, entry > 0 else { return nil }
        let m = (price - entry) / entry * 100
        return call.direction == "down" ? -m : m
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("@\(call.caller)").font(.system(size: 13, weight: .bold)).foregroundStyle(Kallr.bone)
                HStack(spacing: 6) {
                    Text("\(call.direction == "down" ? "SHORT" : "LONG") $\(call.asset)").font(.system(size: 11, weight: .heavy)).foregroundStyle(call.direction == "down" ? Kallr.danger : Kallr.lime)
                    if let move { Text(String(format: "%+.2f%% since post", move)).font(.system(size: 11)).foregroundStyle(move >= 0 ? Kallr.up : Kallr.danger) }
                    Text(Kallr.left(call.deadline)).font(.system(size: 11)).foregroundStyle(Kallr.muted)
                }
            }
            Spacer(minLength: 0)
            if call.direction != "down", ["ETH", "BTC"].contains(call.asset) {
                Button { model.copy(call) } label: {
                    Text("COPY").font(.system(size: 11, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(width: 58, height: 30).background(Kallr.lime, in: RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(Press())
            } else {
                Text(call.direction == "down" ? "SHORT" : "NOT ON BASE").font(.system(size: 9, weight: .bold)).foregroundStyle(Kallr.muted).frame(width: 58)
            }
        }
        .padding(.vertical, 7)
        .overlay(alignment: .bottom) { Rectangle().fill(Kallr.hairline).frame(height: 1) }
    }
}

private struct ResultRow: View {
    let result: Kallr.FeedResult
    var body: some View {
        HStack {
            Text("@\(result.caller)").font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.bone)
            Text("$\(result.asset)").font(.system(size: 12)).foregroundStyle(Kallr.muted)
            Spacer()
            Text(result.status.uppercased()).font(.system(size: 10, weight: .heavy)).foregroundStyle(result.status == "hit" ? Kallr.up : result.status == "miss" ? Kallr.danger : Kallr.muted)
            Text(String(format: "%+.1f%%", Double(result.returnBps ?? 0) / 100)).font(.system(size: 12, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.bone)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(Kallr.hairline).frame(height: 1) }
    }
}

// MARK: - Trade

private struct TradeTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        if model.editingAmount { AmountPad(model: model) } else { form }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.source?.line ?? "Buy on Base · Definitive Flash")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(model.source == nil ? Kallr.muted : Kallr.bone).lineLimit(1)
            HStack(spacing: 6) {
                ForEach(["ETH", "BTC"], id: \.self) { a in Chip(label: a, on: model.asset == a) { model.tap(); model.asset = a } }
                Spacer(minLength: 4)
                Button { model.tap(); model.editingAmount = true } label: {
                    HStack(spacing: 4) {
                        Text("$\(model.usd.isEmpty ? "0" : model.usd)").font(.system(size: 22, weight: .black).monospacedDigit()).foregroundStyle(Kallr.bone)
                        Image(systemName: "pencil").font(.system(size: 11, weight: .bold)).foregroundStyle(Kallr.lime)
                    }
                    .padding(.horizontal, 10).frame(height: 36)
                    .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(Press())
            }
            HStack(spacing: 6) {
                ForEach(["1", "5", "10", "25"], id: \.self) { a in Chip(label: "$\(a)", on: model.usd == a) { model.tap(); model.usd = a } }
                Chip(label: "Custom", on: false) { model.tap(); model.editingAmount = true }
            }
            HStack(spacing: 6) {
                ForEach(KeyboardModel.Exits.allCases, id: \.self) { e in Chip(label: e.rawValue, on: model.exits == e) { model.tap(); model.exits = e } }
            }
            Spacer(minLength: 0)
            status
            Button { model.buy() } label: {
                Text(model.placing == .placing ? "PLACING ON FLASH…" : model.blocked ?? "BUY $\(model.usd) OF \(model.asset)  ↗")
                    .font(.system(size: 15, weight: .heavy)).tracking(0.5).lineLimit(1).minimumScaleFactor(0.8)
                    .foregroundStyle(model.blocked == nil ? Kallr.black : Kallr.muted)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(model.blocked == nil ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(Press())
            .disabled(model.blocked != nil || model.placing == .placing)
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 6)
    }

    @ViewBuilder private var status: some View {
        switch model.placing {
        case .done(let line):
            Label(line, systemImage: "checkmark.circle.fill").font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.lime).lineLimit(2)
        case .failed(let message):
            Text(message).font(.system(size: 12)).foregroundStyle(Kallr.danger).lineLimit(2)
        default:
            Text("From your Kall wallet · up to $\(Kallr.fmt(model.wallet?.maxUsd ?? 25)) per order")
                .font(.system(size: 10)).foregroundStyle(Kallr.muted)
        }
    }
}

private struct AmountPad: View {
    @ObservedObject var model: KeyboardModel
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"]

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Text("$\(model.usd.isEmpty ? "0" : model.usd)").font(.system(size: 30, weight: .black).monospacedDigit()).foregroundStyle(Kallr.bone)
                Spacer()
                Button { model.tap(.medium); model.editingAmount = false } label: {
                    Text("DONE").font(.system(size: 13, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(width: 72, height: 34).background(Kallr.lime, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(Press())
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(keys, id: \.self) { k in
                    Button { model.keypad(k) } label: {
                        Group { if k == "⌫" { Image(systemName: "delete.left") } else { Text(k) } }
                            .font(.system(size: 22, weight: .medium)).foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(k == "⌫" || k == "." ? Kallr.keyDark : Kallr.graphite, in: RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(Press())
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 6)
    }
}

// MARK: - Orders

private struct OrdersTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                Section(title: "YOUR KALL WALLET ORDERS · DEFINITIVE FLASH")
                if let orders = model.orders {
                    if orders.isEmpty { Empty(text: "No orders yet. Copy a call from Calls, or buy from Trade.") }
                    ForEach(orders, id: \.orderId) { o in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(o.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Kallr.bone).lineLimit(1)
                                if let exits = o.exits { Text(exits).font(.system(size: 11)).foregroundStyle(Kallr.muted).lineLimit(1) }
                            }
                            Spacer()
                            Text(o.statusLabel).font(.system(size: 10, weight: .heavy))
                                .foregroundStyle(o.open ? Kallr.black : o.statusLabel == "FILLED" ? Kallr.lime : Kallr.muted)
                                .padding(.horizontal, 8).frame(height: 22)
                                .background(o.open ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 5))
                        }
                        .padding(.vertical, 8)
                        .overlay(alignment: .bottom) { Rectangle().fill(Kallr.hairline).frame(height: 1) }
                    }
                } else {
                    Empty(text: "Reading your orders from Flash…")
                }
            }
            .padding(.horizontal, 8)
        }
        .refreshable { await model.loadOrders() }
    }
}

// MARK: - Wallet

private struct WalletTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let w = model.wallet, let address = w.address {
                HStack(spacing: 8) {
                    Balance(label: "USDC TO TRADE", value: w.usdcValue.map { String(format: "%.2f", $0) } ?? "…")
                    Balance(label: "ETH FOR GAS", value: w.ethValue.map { String(format: "%.5f", $0) } ?? "…")
                }
                HStack(spacing: 8) {
                    Text(address).font(.system(size: 11, design: .monospaced)).foregroundStyle(Kallr.bone).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    Button {
                        UIPasteboard.general.string = address
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        model.note = "Kall wallet address copied"
                    } label: {
                        Text("COPY").font(.system(size: 11, weight: .heavy)).foregroundStyle(Kallr.black)
                            .frame(width: 58, height: 30).background(Kallr.lime, in: RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(Press())
                }
                .padding(10)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                Text("Fund it from your Privy wallet or MetaMask: send USDC, plus about $1 of ETH for gas, on Base only. The keyboard places orders from it, up to $\(Kallr.fmt(w.maxUsd ?? 25)) each.")
                    .font(.system(size: 11)).foregroundStyle(Kallr.muted)
            } else {
                Empty(text: model.fullAccess ? "Reading your Kall wallet…" : "Turn on Allow Full Access for Kall Keyboard in Settings.")
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
    }
}

private struct Balance: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
            Text(value).font(.system(size: 20, weight: .black).monospacedDigit()).foregroundStyle(Kallr.lime)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Pieces

private struct Chip: View {
    let label: String
    let on: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label).font(.system(size: 12, weight: .bold)).foregroundStyle(on ? Kallr.black : Kallr.bone)
                .padding(.horizontal, 11).frame(height: 32)
                .background(on ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(Press())
    }
}

/** Buttons dip and brighten under the finger, like keys. */
private struct Press: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(configuration.isPressed ? 0.1 : 0)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}
