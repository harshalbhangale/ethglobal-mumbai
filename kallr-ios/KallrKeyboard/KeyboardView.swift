import SwiftUI
import UIKit

/** The Kall Keyboard: Calls, Trade, Orders and Wallet. Typing stays on the iPhone keyboard (globe key). */
@MainActor
final class KeyboardModel: ObservableObject {
    enum Tab: String, CaseIterable { case following = "FOLLOWING", trade = "TRADE", orders = "ORDERS", wallet = "WALLET" }
    enum Scope: CaseIterable { case following, explore }
    enum Filter: CaseIterable {
        case active, settled, favorites
        func label(count: Int) -> String { (self == .active ? "Active" : self == .settled ? "Settled" : "★ Favorites") + (count > 0 ? " \(count)" : "") }
    }
    /** A call or a settled result, as the Following list shows it. */
    struct Item: Identifiable {
        let postId: String; let caller: String; let asset: String; let short: Bool
        let postedAt: Double?; let deadline: Double?; let entry: Double?; let text: String?
        let status: String?; let returnBps: Int?
        var id: String { postId }
    }
    /** Idle → quoting → review (a fresh quote, nothing sent) → placing → done or failed. */
    enum Placing { case idle, quoting, review(Kallr.Placed), placing, done(String), failed(String) }
    enum Kind: String, CaseIterable { case market = "Market", limit = "Limit", twap = "TWAP" }

    weak var controller: KeyboardViewController?
    @Published var tab = Tab.following
    @Published var showsGlobe = true
    @Published var fullAccess = false

    // Following: who you follow and which calls you starred are kept on this phone.
    @Published var scope = Scope.following
    @Published var filter = Filter.active
    @Published var selectedCaller: String?
    @Published var follows: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "kall.follows") ?? [])
    @Published var favorites: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "kall.favorites") ?? [])
    @Published var refreshing = false
    @Published var feed: Kallr.Feed?
    @Published var feedError: String?
    @Published var copied: Kallr.Result?
    @Published var checking = false
    @Published var note: String?

    // Trade
    @Published var asset = "ETH"
    @Published var usd = "5"
    @Published var exits: Exits = .tp10
    @Published var kind = Kind.market
    @Published var limitPct = -5.0
    @Published var twapMinutes = 60
    @Published var source: (handle: String, postId: String, line: String)?
    @Published var editingAmount = false
    /** The pad just opened: the first digit replaces the amount instead of adding to it. */
    @Published var freshEntry = false
    @Published var placing = Placing.idle

    // Orders and wallet
    @Published var orders: [Kallr.Order]?
    @Published var wallet: Kallr.Wallet?
    private var polling: Task<Void, Never>?
    @Published var cancelling: Set<String> = []
    @Published var ordersNote: String?

    /** Cancel a working order on Flash (final: Flash never reopens it), then re-read the list. */
    func cancel(_ orderId: String) {
        guard !cancelling.contains(orderId) else { return }
        tap(.heavy)
        cancelling.insert(orderId)
        Task {
            let result = await Kallr.cancel(orderId: orderId)
            cancelling.remove(orderId)
            switch result {
            case .success:
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                ordersNote = "Order cancelled on Flash."
            case .failure(let error):
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                ordersNote = error.localizedDescription
            }
            await loadOrders()
        }
    }

    var busy: Bool { if case .quoting = placing { return true }; if case .placing = placing { return true }; return false }

    /** Which call an order copied, from the Arkiv trade records. */
    func caller(of orderId: String) -> String? { feed?.trades?.first { $0.flashOrderId == orderId }?.caller }

    /** While Orders is open and something is working, re-read Flash every 5 seconds. */
    func startPolling() {
        polling?.cancel()
        polling = Task { @MainActor in
            while !Task.isCancelled, tab == .orders {
                await loadOrders()
                let open = orders?.contains { $0.open } ?? false
                try? await Task.sleep(nanoseconds: open ? 5_000_000_000 : 15_000_000_000)
            }
        }
    }

    enum Exits: String, CaseIterable {
        case none = "No exits", tp10 = "TP 10% · SL 5%", tp20 = "TP 20% · SL 10%"
        var pcts: (Double, Double)? { self == .none ? nil : self == .tp10 ? (10, 5) : (20, 10) }
    }

    init(controller: KeyboardViewController) { self.controller = controller }

    var trackedHandles: [String] { feed?.callers?.filter(\.tracked).map(\.handle) ?? feed?.following ?? [] }
    var followedCallers: [Kallr.FeedCaller] { feed?.callers?.filter { follows.contains($0.handle) } ?? [] }

    func toggleFollow(_ handle: String) {
        tap(.medium)
        if follows.contains(handle) { follows.remove(handle) } else { follows.insert(handle) }
        UserDefaults.standard.set(Array(follows), forKey: "kall.follows")
    }

    func followAll(_ handles: [String]) {
        tap(.medium)
        follows.formUnion(handles)
        UserDefaults.standard.set(Array(follows), forKey: "kall.follows")
    }

    func toggleFavorite(_ postId: String) {
        tap()
        if favorites.contains(postId) { favorites.remove(postId) } else { favorites.insert(postId) }
        UserDefaults.standard.set(Array(favorites), forKey: "kall.favorites")
    }

    private var openItems: [Item] {
        (feed?.calls ?? []).map { Item(postId: $0.postId, caller: $0.caller, asset: $0.asset, short: $0.direction == "down", postedAt: $0.postedAt, deadline: $0.deadline, entry: $0.entry, text: $0.text, status: nil, returnBps: nil) }
    }
    private var settledItems: [Item] {
        (feed?.results ?? []).map { Item(postId: $0.postId, caller: $0.caller, asset: $0.asset, short: $0.direction == "down", postedAt: $0.postedAt, deadline: nil, entry: nil, text: $0.text, status: $0.status, returnBps: $0.returnBps) }
    }
    private func mine(_ items: [Item]) -> [Item] {
        items.filter { follows.contains($0.caller.lowercased()) && (selectedCaller == nil || $0.caller.lowercased() == selectedCaller) }
    }
    func count(_ f: Filter) -> Int {
        switch f {
        case .active: return mine(openItems).count
        case .settled: return mine(settledItems).count
        case .favorites: return (openItems + settledItems).filter { favorites.contains($0.postId) }.count
        }
    }
    var visibleItems: [Item] {
        switch filter {
        case .active: return mine(openItems)
        case .settled: return mine(settledItems)
        case .favorites: return (openItems + settledItems).filter { favorites.contains($0.postId) }
        }
    }

    /** The live move since the post, in the called direction. */
    func move(_ item: Item) -> Double? {
        guard let entry = item.entry, entry > 0, let price = feed?.prices[item.asset] ?? nil else { return nil }
        let m = (price - entry) / entry * 100
        return item.short ? -m : m
    }

    func refresh() async {
        refreshing = true
        await load()
        refreshing = false
    }

    /** Trade a call from the list: fills the Trade tab with its coin and the post it came from. */
    func trade(_ item: Item) {
        tap(.medium)
        asset = item.asset
        source = (item.caller, item.postId, "@\(item.caller) · \(item.short ? "SHORT" : "LONG") $\(item.asset)")
        placing = .idle
        tab = .trade
    }

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


    private var order: Kallr.KeyboardOrder {
        Kallr.KeyboardOrder(
            token: asset,
            kind: kind == .market ? "swap" : kind == .limit ? "limit" : "twap",
            usd: usd,
            limitPct: kind == .limit ? limitPct : nil,
            twapMinutes: kind == .twap ? twapMinutes : nil,
            tpPct: exits.pcts?.0,
            slPct: exits.pcts?.1,
            postId: source?.postId,
            caller: source?.handle
        )
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
        if let usdc = wallet?.usdcValue, usdc < n {
            let ethUsd = (wallet?.ethValue ?? 0) * ((feed?.prices["ETH"] ?? nil) ?? 0)
            return ethUsd > n + 1 ? "Swap ETH to USDC in the Kall app" : "Deposit ETH in the Kall app"
        }
        return nil
    }

    /** Buy: a fresh Definitive quote for the review card. Nothing is approved, signed or sent yet. */
    func review() {
        guard blocked == nil, !busy else { return }
        tap(.medium)
        placing = .quoting
        Task {
            switch await Kallr.execute(order, dryRun: true) {
            case .success(let quote): placing = .review(quote)
            case .failure(let error):
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                placing = .failed(error.localizedDescription)
            }
        }
    }

    /** Confirm: the server re-quotes, approves this amount, signs and places the order on Flash. */
    func confirm() {
        guard !busy else { return }
        tap(.heavy)
        placing = .placing
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

    /** Open the number pad on the amount bar. */
    func startTyping() {
        tap()
        editingAmount = true
        freshEntry = true
    }

    func keypad(_ k: String) {
        tap()
        if freshEntry {
            freshEntry = false
            usd = ""
            if k == "⌫" { return }
        }
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
                case .following: FollowingTab(model: model)
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
                        if t == .orders { model.startPolling() }
                        if t == .wallet || t == .following { Task { await model.load() } }
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

// MARK: - Following

private struct FollowingTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                HStack(spacing: 2) {
                    ForEach(KeyboardModel.Scope.allCases, id: \.self) { sc in
                        Button { model.tap(); model.scope = sc } label: {
                            Text(sc == .following ? "FOLLOWING \(model.follows.count)" : "EXPLORE")
                                .font(.system(size: 10, weight: .heavy)).tracking(0.5)
                                .foregroundStyle(model.scope == sc ? Kallr.black : Kallr.bone)
                                .frame(maxWidth: .infinity, minHeight: 28)
                                .background(model.scope == sc ? Kallr.bone : .clear, in: RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(Press())
                    }
                }
                .padding(2)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
                IconButton(symbol: "doc.on.clipboard", label: "Check what you copied") { model.controller?.checkCopied() }
                IconButton(symbol: model.refreshing ? "hourglass" : "arrow.clockwise", label: "Refresh") { Task { await model.refresh() } }
            }
            .padding(.horizontal, 6)

            if model.checking || model.note != nil || model.copied?.headline(typed: nil) != nil { CopiedBanner(model: model) }

            if model.scope == .explore { ExploreList(model: model) } else { FollowingList(model: model) }
        }
    }
}

private struct IconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(Kallr.bone)
                .frame(width: 36, height: 32).background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(Press())
        .accessibilityLabel(label)
    }
}

/** What Check found in the clipboard: the call, or a red warning. */
private struct CopiedBanner: View {
    @ObservedObject var model: KeyboardModel
    var body: some View {
        let warning = model.copied?.warning != nil || model.note != nil
        HStack(spacing: 8) {
            Text(model.checking ? "Checking what you copied…" : model.note ?? model.copied?.headline(typed: nil) ?? "")
                .font(.system(size: 12, weight: .semibold)).lineLimit(1)
                .foregroundStyle(warning ? Kallr.danger : Kallr.bone)
            Spacer(minLength: 0)
            if !warning, model.copied?.trade != nil {
                SmallButton(label: "TRADE ↗") { model.tap(.medium); model.tab = .trade }
            }
        }
        .padding(.horizontal, 10).frame(height: 32)
        .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal, 6)
    }
}

private struct FollowingList: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        if model.follows.isEmpty {
            VStack(spacing: 8) {
                Text("You don't follow anyone yet.").font(.system(size: 13, weight: .semibold)).foregroundStyle(Kallr.bone)
                Text("Follow callers in Explore, or start with everyone Kall Markets tracks.")
                    .font(.system(size: 11)).foregroundStyle(Kallr.muted).multilineTextAlignment(.center)
                SmallButton(label: "FOLLOW ALL \(model.trackedHandles.count) TRACKED") { model.followAll(model.trackedHandles) }
                    .disabled(model.trackedHandles.isEmpty)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 16)
        } else {
            VStack(spacing: 6) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Chip(label: "All", on: model.selectedCaller == nil) { model.tap(); model.selectedCaller = nil }
                        ForEach(model.followedCallers, id: \.handle) { c in
                            Chip(label: "@\(c.handle)\(c.hitRate.map { " · \(Int(($0 * 100).rounded()))%" } ?? "")", on: model.selectedCaller == c.handle) {
                                model.tap(); model.selectedCaller = model.selectedCaller == c.handle ? nil : c.handle
                            }
                        }
                    }
                    .padding(.horizontal, 6)
                }
                HStack(spacing: 6) {
                    ForEach(KeyboardModel.Filter.allCases, id: \.self) { f in
                        Chip(label: f.label(count: model.count(f)), on: model.filter == f) { model.tap(); model.filter = f }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 6)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        let items = model.visibleItems
                        if model.feed == nil { Empty(text: model.feedError ?? "Reading Arkiv…") }
                        else if items.isEmpty { Empty(text: model.filter == .favorites ? "Star a call to keep it here." : model.filter == .active ? "No open calls from who you follow." : "Nothing settled yet.") }
                        ForEach(items) { item in CallCard(item: item, model: model) }
                    }
                    .padding(.horizontal, 6)
                }
                .refreshable { await model.refresh() }
            }
        }
    }
}

private struct ExploreList: View {
    @ObservedObject var model: KeyboardModel
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if let callers = model.feed?.callers {
                    ForEach(callers, id: \.handle) { c in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text("@\(c.handle)").font(.system(size: 13, weight: .bold)).foregroundStyle(Kallr.bone)
                                    if c.tracked { Text("TRACKED").font(.system(size: 8, weight: .heavy)).foregroundStyle(Kallr.lime) }
                                }
                                Text([c.focus, c.settled > 0 ? "\(c.hits)/\(c.settled) hit" : "no settled calls", c.open > 0 ? "\(c.open) open" : nil].compactMap { $0 }.joined(separator: " · "))
                                    .font(.system(size: 11)).foregroundStyle(Kallr.muted).lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            let on = model.follows.contains(c.handle)
                            Button { model.toggleFollow(c.handle) } label: {
                                Text(on ? "FOLLOWING" : "FOLLOW").font(.system(size: 10, weight: .heavy))
                                    .foregroundStyle(on ? Kallr.bone : Kallr.black)
                                    .frame(width: 84, height: 28)
                                    .background(on ? Kallr.graphite : Kallr.lime, in: RoundedRectangle(cornerRadius: 7))
                                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(on ? Kallr.hairline : .clear))
                            }
                            .buttonStyle(Press())
                        }
                        .padding(.vertical, 7)
                        .overlay(alignment: .bottom) { Rectangle().fill(Kallr.hairline).frame(height: 1) }
                    }
                } else {
                    Empty(text: model.feedError ?? "Reading Arkiv…")
                }
            }
            .padding(.horizontal, 8)
        }
        .refreshable { await model.refresh() }
    }
}

/** One call: who, which way, the post itself, how it's going, a star, and Trade. */
private struct CallCard: View {
    let item: KeyboardModel.Item
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("@\(item.caller)").font(.system(size: 13, weight: .bold)).foregroundStyle(Kallr.bone)
                Text("\(item.short ? "SHORT" : "LONG") $\(item.asset)").font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(item.short ? Kallr.danger : Kallr.lime)
                Text(Kallr.ago(item.postedAt)).font(.system(size: 10)).foregroundStyle(Kallr.muted)
                Spacer(minLength: 0)
                Button { model.toggleFavorite(item.postId) } label: {
                    Image(systemName: model.favorites.contains(item.postId) ? "star.fill" : "star")
                        .font(.system(size: 13)).foregroundStyle(model.favorites.contains(item.postId) ? Kallr.lime : Kallr.muted)
                        .frame(width: 28, height: 24)
                }
                .buttonStyle(Press())
                .accessibilityLabel("Favorite")
            }
            if let text = item.text {
                Text(text).font(.system(size: 12)).foregroundStyle(Kallr.bone.opacity(0.82)).lineLimit(2)
            }
            HStack(spacing: 6) {
                if let status = item.status {
                    Text(status.uppercased()).font(.system(size: 10, weight: .heavy))
                        .foregroundStyle(status == "hit" ? Kallr.up : status == "miss" ? Kallr.danger : Kallr.muted)
                    if let bps = item.returnBps { Text(String(format: "%+.2f%% called move", Double(bps) / 100)).font(.system(size: 11)).foregroundStyle(Kallr.muted) }
                } else {
                    if let move = model.move(item) {
                        Text(String(format: "%+.2f%% since post", move)).font(.system(size: 11, weight: .semibold)).foregroundStyle(move >= 0 ? Kallr.up : Kallr.danger)
                    }
                    Text(Kallr.left(item.deadline)).font(.system(size: 11)).foregroundStyle(Kallr.muted)
                }
                Spacer(minLength: 0)
                if item.status == nil, !item.short, ["ETH", "BTC"].contains(item.asset) {
                    SmallButton(label: "TRADE ↗") { model.trade(item) }
                } else if item.status == nil {
                    Text(item.short ? "CAN'T COPY SHORTS" : "NOT ON BASE").font(.system(size: 9, weight: .bold)).foregroundStyle(Kallr.muted)
                }
            }
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(Kallr.hairline).frame(height: 1) }
    }
}

private struct SmallButton: View {
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label).font(.system(size: 11, weight: .heavy)).foregroundStyle(Kallr.black)
                .padding(.horizontal, 10).frame(height: 28)
                .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(Press())
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

// MARK: - Trade

private struct TradeTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        if model.editingAmount {
            AmountPad(model: model)
        } else if case .review(let quote) = model.placing {
            ReviewCard(model: model, quote: quote)
        } else if case .placing = model.placing {
            ReviewCard(model: model, quote: nil)
        } else {
            form
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 8) {
            AmountBar(model: model, editing: false)
            HStack(spacing: 6) {
                ForEach(["1", "5", "10", "25"], id: \.self) { a in Chip(label: "$\(a)", on: model.usd == a) { model.tap(); model.usd = a } }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(KeyboardModel.Kind.allCases, id: \.self) { k in Chip(label: k.rawValue, on: model.kind == k) { model.tap(); model.kind = k } }
                    Rectangle().fill(Kallr.hairline).frame(width: 1, height: 20).padding(.horizontal, 2)
                    switch model.kind {
                    case .market:
                        ForEach(KeyboardModel.Exits.allCases, id: \.self) { e in Chip(label: e.rawValue, on: model.exits == e) { model.tap(); model.exits = e } }
                    case .limit:
                        ForEach([-3.0, -5.0, -10.0], id: \.self) { p in Chip(label: "\(Kallr.fmt(p))%", on: model.limitPct == p) { model.tap(); model.limitPct = p } }
                    case .twap:
                        ForEach([(10, "10 min"), (60, "1 hour"), (240, "4 hours")], id: \.0) { m in Chip(label: m.1, on: model.twapMinutes == m.0) { model.tap(); model.twapMinutes = m.0 } }
                    }
                }
            }
            if model.kind != .market {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(KeyboardModel.Exits.allCases, id: \.self) { e in Chip(label: e.rawValue, on: model.exits == e) { model.tap(); model.exits = e } }
                    }
                }
            }
            Spacer(minLength: 0)
            // The post this trade copies, just above the footer.
            if let source = model.source {
                Label(source.line, systemImage: "quote.bubble.fill")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.bone).lineLimit(1)
                    .labelStyle(PostLabel())
            }
            status
            Button { model.review() } label: {
                Text(model.busy ? "GETTING A QUOTE…" : model.blocked ?? "REVIEW $\(model.usd) OF \(model.asset)  ↗")
                    .font(.system(size: 15, weight: .heavy)).tracking(0.5).lineLimit(1).minimumScaleFactor(0.8)
                    .foregroundStyle(model.blocked == nil ? Kallr.black : Kallr.muted)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(model.blocked == nil ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(Press())
            .disabled(model.blocked != nil || model.busy)
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
            PoweredByDefinitive(height: 9, suffix: "Flash · review first · up to $\(Kallr.fmt(model.wallet?.maxUsd ?? 25))")
        }
    }
}

/** The fresh Definitive quote, in plain lines, and the one tap that places it. */
private struct ReviewCard: View {
    @ObservedObject var model: KeyboardModel
    let quote: Kallr.Placed?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let quote {
                Text("\(quote.preview.title.uppercased()) · \(quote.preview.kind)")
                    .font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.bone).lineLimit(1).minimumScaleFactor(0.8)
                Line(label: "You pay", value: quote.preview.pay)
                Line(label: "You get", value: quote.preview.get)
                Line(label: "Impact · fee", value: [quote.details?.impactPct.map { String(format: "%.2f%%", $0) }, quote.details?.feeUsd.map { String(format: "$%.2f", $0) }].compactMap { $0 }.joined(separator: " · ").ifEmpty("—"))
                Line(label: "Exits", value: quote.preview.exits)
                Line(label: "Approval", value: quote.preview.approval)
                PoweredByDefinitive(height: 9, suffix: "Flash · fresh quote").padding(.top, 2)
            } else {
                Text("PLACING ON DEFINITIVE FLASH…").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime)
                Text("Re-quoting, approving this amount, signing and submitting on Base. About 10–30 seconds.")
                    .font(.system(size: 12)).foregroundStyle(Kallr.muted)
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Button { model.tap(); model.placing = .idle } label: {
                    Text("BACK").font(.system(size: 13, weight: .heavy)).foregroundStyle(Kallr.bone)
                        .frame(width: 72, height: 50).background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 11))
                }
                .buttonStyle(Press())
                .disabled(quote == nil)
                Button { model.confirm() } label: {
                    Text(quote == nil ? "PLACING…" : "CONFIRM & PLACE  ↗")
                        .font(.system(size: 15, weight: .heavy)).tracking(0.5)
                        .foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 11))
                }
                .buttonStyle(Press())
                .disabled(quote == nil)
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 6)
    }
}

private struct Line: View {
    let label: String
    let value: String
    var body: some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundStyle(Kallr.muted)
            Spacer()
            Text(value).font(.system(size: 12, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.bone).lineLimit(1)
        }
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

/** A post line: lime quote icon, then the caller and their call. */
private struct PostLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 11)).foregroundStyle(Kallr.lime)
            configuration.title
        }
    }
}

/**
 * The dollar amount as an input field: tap it to type on the number pad. ETH or BTC sits at its end.
 * While typing, a lime caret blinks; the amount is selected until the first key replaces it.
 */
private struct AmountBar: View {
    @ObservedObject var model: KeyboardModel
    let editing: Bool
    @State private var blink = false

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 3) {
                Text("$").font(.system(size: 20, weight: .black)).foregroundStyle(Kallr.muted)
                Text(model.usd.isEmpty ? "0" : model.usd)
                    .font(.system(size: 24, weight: .black).monospacedDigit())
                    .foregroundStyle(model.usd.isEmpty ? Kallr.muted : Kallr.bone)
                    .padding(.horizontal, editing && model.freshEntry ? 3 : 0)
                    .background(editing && model.freshEntry ? Kallr.lime.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: 4))
                if editing {
                    Rectangle().fill(Kallr.lime).frame(width: 2, height: 24).opacity(blink ? 1 : 0)
                        .onAppear { withAnimation(.easeInOut(duration: 0.5).repeatForever()) { blink = true } }
                }
                Spacer(minLength: 4)
                if !editing {
                    Text("TYPE AMOUNT").font(.system(size: 9, weight: .heavy)).tracking(0.4).foregroundStyle(Kallr.muted)
                }
            }
            .padding(.horizontal, 12).frame(height: 44)
            .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(editing ? Kallr.lime : Kallr.hairline, lineWidth: editing ? 1.5 : 1))
            .contentShape(Rectangle())
            .onTapGesture { if !editing { model.startTyping() } }
            if !editing {
                HStack(spacing: 2) {
                    ForEach(["ETH", "BTC"], id: \.self) { a in
                        Button { model.tap(); model.asset = a } label: {
                            Text(a).font(.system(size: 13, weight: .heavy))
                                .foregroundStyle(model.asset == a ? Kallr.black : Kallr.bone)
                                .frame(width: 48, height: 36)
                                .background(model.asset == a ? Kallr.lime : .clear, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(Press())
                    }
                }
                .padding(4)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

private struct AmountPad: View {
    @ObservedObject var model: KeyboardModel
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"]

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                AmountBar(model: model, editing: true)
                Button { model.tap(.medium); model.freshEntry = false; model.editingAmount = false } label: {
                    Text("DONE").font(.system(size: 13, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(width: 64, height: 44).background(Kallr.lime, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(Press())
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(keys, id: \.self) { k in
                    Button { model.keypad(k) } label: {
                        Group { if k == "⌫" { Image(systemName: "delete.left") } else { Text(k) } }
                            .font(.system(size: 22, weight: .medium)).foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 42)
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
                HStack {
                    Section(title: "YOUR KALL WALLET ORDERS")
                    PoweredByDefinitive(height: 8, suffix: "Flash").padding(.top, 6)
                }
                if let note = model.ordersNote { Text(note).font(.system(size: 11)).foregroundStyle(Kallr.muted).frame(maxWidth: .infinity, alignment: .leading) }
                if let orders = model.orders {
                    if orders.isEmpty { Empty(text: "No orders yet. Copy a call from Calls, or buy from Trade.") }
                    ForEach(orders, id: \.orderId) { o in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(o.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Kallr.bone).lineLimit(1)
                                let sub = [model.caller(of: o.orderId).map { "from @\($0)'s call" }, o.exits].compactMap { $0 }.joined(separator: " · ")
                                if !sub.isEmpty { Text(sub).font(.system(size: 11)).foregroundStyle(Kallr.muted).lineLimit(1) }
                            }
                            Spacer()
                            if o.open, o.orderType != "bracket" {
                                Button { model.cancel(o.orderId) } label: {
                                    Text(model.cancelling.contains(o.orderId) ? "…" : "CANCEL").font(.system(size: 10, weight: .heavy)).foregroundStyle(Kallr.danger)
                                        .padding(.horizontal, 8).frame(height: 22)
                                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Kallr.danger.opacity(0.5)))
                                }
                                .buttonStyle(Press())
                            }
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
        .onAppear { model.startPolling() }
    }
}

// MARK: - Wallet

private struct WalletTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let w = model.wallet, let address = w.address {
                HStack(spacing: 8) {
                    Balance(label: "ETH", value: w.ethValue.map { String(format: "%.5f", $0) } ?? "…")
                    Balance(label: "USDC TO TRADE", value: w.usdcValue.map { String(format: "%.2f", $0) } ?? "…")
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
                Text("Deposit ETH from the Kall Keyboard app (MetaMask opens with it filled in), then swap some to USDC there. About $1 of ETH stays for gas. Orders go up to $\(Kallr.fmt(w.maxUsd ?? 25)) each, Base only.")
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
