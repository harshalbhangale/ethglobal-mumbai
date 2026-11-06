import SwiftUI
import UIKit

/**
 * The Kall Keyboard: a typing keyboard with a TRADE key, and the Kall panel it opens (Following, Trade,
 * Orders, Wallet). ABC in the panel goes back to typing.
 */
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

    // Typing
    enum Mode { case typing, panel }
    enum Layer { case letters, numbers, symbols }
    enum Shift { case off, once, locked }
    @Published var mode = Mode.typing { didSet { if mode != oldValue { controller?.modeChanged(mode) } } }
    @Published var layer = Layer.letters
    @Published var shift = Shift.once
    @Published var returnLabel = "return"
    private var lastShiftTap: Date?
    private var lastSpace: Date?
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
    /** Take-profit and stop-loss, as percents from where the order buys; set under Advanced. */
    @Published var tpPct = 10.0
    @Published var slPct = 5.0
    @Published var exitsOn = true
    @Published var advancedOpen = false
    /** What You pay is in: USDC buys the coin; ETH swaps the wallet's ETH to USDC. */
    @Published var payAsset = "USDC"
    var payingETH: Bool { payAsset == "ETH" }
    /** ETH above the gas reserve (about $1 stays for gas), in dollars rounded down to cents. */
    var swappableUsd: Double? {
        guard let eth = wallet?.ethValue, let p = feed?.prices["ETH"] ?? nil, p > 0 else { return nil }
        return max(0, ((eth - 0.0004) * p * 100).rounded(.down) / 100)
    }

    func togglePay() {
        Haptics.layer()
        payAsset = payingETH ? "USDC" : "ETH"
        placing = .idle
        if payingETH { kind = .market; advancedOpen = false }
    }

    // Any Base token: `asset` is ETH, BTC or a contract address; these describe an address.
    @Published var assetSymbol = ""
    @Published var assetPrice: Double?
    @Published var assetLogo: URL?
    // The token picker: search by name, symbol or a pasted contract.
    @Published var picking = false { didSet { if picking != oldValue { controller?.updateHeight() } } }
    @Published var query = ""
    @Published var hits: [Kallr.TokenHit]?
    @Published var searching = false
    @Published var pickerNote: String?
    /** Something's copied (checked without reading it, so iOS shows no paste prompt). */
    @Published var clipboardHasText = false
    private var searchTask: Task<Void, Never>?
    @Published var kind = Kind.market
    @Published var limitPct = -5.0
    @Published var twapMinutes = 60
    @Published var source: (handle: String, postId: String, line: String)?
    @Published var editingAmount = false
    /** The pad just opened: the first digit replaces the amount instead of adding to it. */
    @Published var freshEntry = false
    @Published var placing = Placing.idle
    /** The order the last Confirm placed, for the success screen. */
    @Published var lastPlaced: Kallr.Placed?

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

    // MARK: Live price

    @Published var live: Kallr.LivePrice?
    /** This session's prices for the coin on screen, for the sparkline. */
    @Published var ticks: [Double] = []
    /** +1 when the last tick went up, −1 down: the ticker flashes that way. */
    @Published var tickMove = 0
    private var liveTask: Task<Void, Never>?
    private var liveKey = ""
    /** The coin the ticker follows: ETH when swapping it, otherwise what you're buying. */
    var tickerKey: String { payingETH ? "ETH" : asset }

    /** Follow the coin on screen every 4 seconds while Trade is open. */
    func startLive() {
        let key = tickerKey
        if liveTask != nil, key == liveKey { return }
        liveTask?.cancel()
        if key != liveKey { live = nil; ticks = []; tickMove = 0 }
        liveKey = key
        liveTask = Task { [weak self] in
            while !Task.isCancelled {
                if let q = await Kallr.livePrice(key) {
                    guard let self, !Task.isCancelled, self.liveKey == key else { return }
                    if let before = self.live?.price, before != q.price { self.tickMove = q.price > before ? 1 : -1 }
                    self.live = q
                    if self.ticks.last != q.price {
                        self.ticks.append(q.price)
                        if self.ticks.count > 40 { self.ticks.removeFirst() }
                    }
                    // Estimates follow the market.
                    if key.hasPrefix("0x"), self.asset == key { self.assetPrice = q.price }
                }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }

    func stopLive() {
        liveTask?.cancel()
        liveTask = nil
    }

    // MARK: Anon-RPC

    /** A line in Trade's Anon-RPC log: real reads only. */
    struct AnonEntry: Identifiable {
        enum Tone { case info, ok, direct }
        let id = UUID()
        let text: String
        let tone: Tone
    }
    @Published var anonState = AnonBridge.State.idle
    @Published var anonLog: [AnonEntry] = []
    var anonStartedAt: Date?
    let anon = AnonBridge()

    /** Boot the private reader when Trade opens, so the mixnet is up by the time you review. */
    func warmAnon() {
        guard fullAccess, anonState == .idle, let host = controller?.view else { return }
        anonStartedAt = Date()
        anon.onState = { [weak self] state in self?.anonChanged(state) }
        anon.start(in: host)
    }

    private func anonChanged(_ state: AnonBridge.State) {
        anonState = state
        switch state {
        case .ready(let ms):
            logAnon("✓ Nym connected" + (ms.map { " · " + Self.seconds($0) } ?? ""), .ok)
        case .failed(let why):
            logAnon("✕ Nym: \(why) · reads go direct", .direct)
        default: break
        }
    }

    private func logAnon(_ text: String, _ tone: AnonEntry.Tone) {
        anonLog.append(AnonEntry(text: text, tone: tone))
        if anonLog.count > 12 { anonLog.removeFirst() }
    }

    private func logRead(_ what: String, _ read: AnonBridge.Read) {
        if let error = read.error {
            logAnon("✕ \(what) · \(error)", .direct)
        } else if read.isPrivate {
            logAnon("✓ \(what) · private · \(Self.seconds(read.ms))", .ok)
        } else {
            logAnon("⚠ \(what) · DIRECT\(read.why.map { " (\($0))" } ?? "") · \(Self.seconds(read.ms))", .direct)
        }
    }

    static func seconds(_ ms: Int) -> String { String(format: "%.1fs", Double(ms) / 1000) }

    /** Before a trade: the Kall wallet's ETH and USDC and Chainlink's ETH price, in one private batch. */
    private func readBeforeTrade() {
        guard let owner = wallet?.address else { return }
        Task {
            let reads = await anon.batch([
                ("eth_getBalance", [owner, "latest"]),
                ("eth_call", [["to": BaseRead.usdc, "data": BaseRead.balanceOf(owner)], "latest"]),
                ("eth_call", [["to": BaseRead.ethUsdFeed, "data": BaseRead.latestRoundData], "latest"]),
            ], waitMs: 15_000)
            guard reads.count == 3 else { return }
            let eth = BaseRead.number(reads[0].result, decimals: 18).map { String(format: "%.5f ETH", $0) } ?? "?"
            let usdc = BaseRead.number(reads[1].result, decimals: 6).map { String(format: "%.2f USDC", $0) } ?? "?"
            let price = BaseRead.number(reads[2].result, decimals: 8, word: 1).map { "$" + Self.money($0) } ?? "?"
            logRead("Balance \(eth)", reads[0])
            logRead("USDC \(usdc)", reads[1])
            logRead("ETH/USD \(price) (Chainlink)", reads[2])
        }
    }

    /** With the quote: the allowance Flash's spender has now, read privately. */
    private func readAllowance(_ approval: Kallr.Details.Approval?) {
        guard let approval, let owner = wallet?.address else { return }
        Task {
            let reads = await anon.batch([("eth_call", [["to": approval.token, "data": BaseRead.allowance(owner, approval.spender)], "latest"])], waitMs: 15_000)
            guard let read = reads.first else { return }
            let decimals = approval.token.lowercased() == BaseRead.usdc.lowercased() ? 6 : 18
            let amount = BaseRead.number(read.result, decimals: decimals)
            let shown = amount.map { $0 > 1e12 ? "unlimited" : $0 == 0 ? "0, approve on confirm" : String(format: "%g", $0) } ?? "?"
            logRead("Allowance \(shown)", read)
        }
    }

    /** After a fill: the swap's receipt on Base, read privately. */
    private func readReceipt(orderId: String?) {
        guard let orderId, let owner = wallet?.address else { return }
        Task {
            var tx: String?
            for _ in 0..<10 {
                if let t = await Kallr.fills(orderId: orderId, funder: owner)?.transaction { tx = t; break }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
            guard let tx else { logAnon("… No fill on Base yet to check", .info); return }
            let reads = await anon.batch([("eth_getTransactionReceipt", [tx])], waitMs: 15_000)
            guard let read = reads.first else { return }
            let receipt = read.result as? [String: Any]
            let ok = (receipt?["status"] as? String) == "0x1"
            let block = BaseRead.number(receipt?["blockNumber"], decimals: 0).map { "block \(Int($0))" } ?? ""
            logRead("Receipt \(ok ? "success" : "pending") \(block)", read)
        }
    }

    // MARK: Swap view

    var isAddress: Bool { asset.hasPrefix("0x") }
    var symbol: String { isAddress ? assetSymbol : asset }
    var price: Double? {
        if !payingETH, liveKey == asset, let p = live?.price { return p }
        return isAddress ? assetPrice : (feed?.prices[asset] ?? nil)
    }
    /** Where the order buys: the live price, or the limit below it. */
    var entryPrice: Double? { price.map { kind == .limit ? $0 * (1 + limitPct / 100) : $0 } }
    /** About how much of the coin the dollars buy, before fees. */
    var estimate: Double? {
        guard let n = Double(usd), n > 0, let e = entryPrice, e > 0 else { return nil }
        return n / e
    }
    var priceLine: String {
        guard let p = price else { return "Reading the price…" }
        switch kind {
        case .market: return "1 \(symbol) = $" + Self.money(p)
        case .limit: return "Buys at $" + Self.money(entryPrice ?? p) + " (−\(Kallr.fmt(-limitPct))%)"
        case .twap: return "Over " + (twapMinutes >= 60 ? "\(twapMinutes / 60)h" : "\(twapMinutes)m") + " · now $" + Self.money(p)
        }
    }
    var exitsSummary: String { exitsOn ? "TP +\(Kallr.fmt(tpPct))% · SL −\(Kallr.fmt(slPct))%" : "Add TP / SL" }
    var exitsPriceLine: String? {
        guard exitsOn, let e = entryPrice else { return nil }
        return "Sells at $\(Self.money(e * (1 + tpPct / 100))) up, or $\(Self.money(e * (1 - slPct / 100))) down"
    }
    /** Dollar amounts grouped the US way in every locale: 75,973 · 2.23 · 0.000506. */
    static func money(_ v: Double) -> String {
        let us = Locale(identifier: "en_US")
        if v >= 100 { return v.formatted(.number.precision(.fractionLength(0)).locale(us)) }
        if v >= 1 { return v.formatted(.number.precision(.fractionLength(2)).locale(us)) }
        return v.formatted(.number.precision(.significantDigits(3)).locale(us))
    }

    // MARK: Token picker

    /** Keys type into the token search while the picker is up on Trade. */
    var searchActive: Bool { picking && mode == .panel && tab == .trade }

    func openPicker() {
        query = ""
        hits = nil
        pickerNote = nil
        layer = .letters
        shift = .off
        picking = true
    }

    func closePicker() {
        searchTask?.cancel()
        searching = false
        picking = false
    }

    func pickCore(_ key: String) {
        asset = key
        placing = .idle
        closePicker()
    }

    func pick(_ hit: Kallr.TokenHit) {
        if hit.riskFlagged == true {
            Haptics.error()
            pickerNote = "Definitive flags \(hit.symbol) as risky, so Kall won't trade it."
            return
        }
        Haptics.modifier()
        switch hit.address.lowercased() {
        case "0x4200000000000000000000000000000000000006": asset = "ETH"
        case "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": asset = "BTC"
        default:
            asset = hit.address
            assetSymbol = hit.symbol
            assetPrice = hit.priceValue
            assetLogo = hit.logo
        }
        placing = .idle
        closePicker()
    }

    /** Paste a contract address from what you copied (iOS asks for Full Access to read it). */
    func pasteAddress() {
        Haptics.modifier()
        guard fullAccess else { pickerNote = "Turn on Allow Full Access to paste."; return }
        let text = Kallr.copiedText() ?? ""
        guard let r = text.range(of: "0x[0-9a-fA-F]{40}", options: .regularExpression) else {
            pickerNote = "No contract address in what you copied."
            return
        }
        query = String(text[r])
        searchSoon()
    }

    private func searchSoon() {
        pickerNote = nil
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { hits = nil; searching = false; return }
        searching = true
        searchTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let found = await Kallr.searchTokens(q)
            guard !Task.isCancelled else { return }
            hits = found ?? []
            if found == nil { pickerNote = "Couldn't reach Kall Markets." }
            searching = false
        }
    }

    /** MAX: all the USDC the Kall wallet holds, up to the per-order cap. */
    func useMax() {
        if payingETH {
            if let most = swappableUsd, most >= 1 { usd = String(format: "%.2f", most) }
            freshEntry = false
            return
        }
        guard let usdc = wallet?.usdcValue else { return }
        let most = (min(usdc, wallet?.maxUsd ?? 25) * 100).rounded(.down) / 100
        if most > 0 { usd = String(format: "%.2f", most) }
        freshEntry = false
    }

    init(controller: KeyboardViewController) { self.controller = controller }

    // MARK: Typing

    private var proxy: UITextDocumentProxy? { controller?.textDocumentProxy }

    func type(_ c: String) {
        if searchActive {
            query += c
            if shift == .once { shift = .off }
            searchSoon()
            return
        }
        proxy?.insertText(layer == .letters && shift != .off ? c.uppercased() : c)
        if shift == .once { shift = .off }
        // Like iOS: an apostrophe in the numbers layer goes back to letters.
        if layer != .letters, c == "'" { layer = .letters }
        controller?.afterTyping()
    }

    /** Space; a quick second space after a word becomes ". " */
    func space() {
        if searchActive { query += " "; searchSoon(); return }
        let before = proxy?.documentContextBeforeInput ?? ""
        if let last = lastSpace, Date().timeIntervalSince(last) < 0.4, before.hasSuffix(" "),
           let prev = before.dropLast().last, prev.isLetter || prev.isNumber {
            proxy?.deleteBackward()
            proxy?.insertText(". ")
            lastSpace = nil
        } else {
            proxy?.insertText(" ")
            lastSpace = Date()
        }
        if layer != .letters { layer = .letters }
        controller?.afterTyping()
    }

    func backspace() {
        if searchActive {
            if !query.isEmpty { query.removeLast() }
            searchSoon()
            return
        }
        proxy?.deleteBackward()
        controller?.afterTyping()
    }

    func returnKey() {
        if searchActive {
            if let first = hits?.first { pick(first) }
            return
        }
        proxy?.insertText("\n")
        controller?.afterTyping()
    }

    /** Tap for one capital; double-tap for caps lock; tap again to turn it off. */
    func shiftTap() {
        let now = Date()
        if let last = lastShiftTap, now.timeIntervalSince(last) < 0.3, shift == .once {
            shift = .locked
            Haptics.capsLock()
        } else {
            shift = shift == .off ? .once : .off
        }
        lastShiftTap = now
    }

    /** Capitalize the start of a sentence, as the field asks. */
    func autoShift() {
        guard layer == .letters, shift != .locked, !searchActive else { return }
        let caps = proxy?.autocapitalizationType ?? .sentences
        if caps == UITextAutocapitalizationType.none { shift = .off; return }
        if caps == .allCharacters { shift = .once; return }
        let before = proxy?.documentContextBeforeInput ?? ""
        let trimmed = before.trimmingCharacters(in: .whitespaces)
        let start = trimmed.isEmpty || before.hasSuffix("\n")
            || (before.hasSuffix(" ") && (trimmed.hasSuffix(".") || trimmed.hasSuffix("!") || trimmed.hasSuffix("?")))
            || (caps == .words && before.hasSuffix(" "))
        shift = start ? .once : .off
    }

    /** TRADE: open the Kall panel, on a tab if given, or where you left it. */
    func openPanel(_ tab: Tab?) {
        if let tab { self.tab = tab }
        mode = .panel
        if self.tab == .orders { startPolling() }
        Task { await load() }
    }

    /** The newest open calls from the callers you follow, for the strip above the keys. */
    var latestFollowed: [Item] {
        Array(mine(openItems).sorted { ($0.postedAt ?? 0) > ($1.postedAt ?? 0) }.prefix(6))
    }

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

    func tap(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) { Haptics.impact(style) }

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
            tpPct: exitsOn ? tpPct : nil,
            slPct: exitsOn ? slPct : nil,
            postId: source?.postId,
            caller: source?.handle
        )
    }

    func applyCopied(_ r: Kallr.Result) {
        copied = r
        if let t = r.trade, t.token.hasPrefix("0x") {
            asset = t.token
            assetSymbol = t.symbol
            assetPrice = t.price
            assetLogo = t.logo.flatMap(URL.init(string:))
        } else if let symbol = (r.trade?.symbol ?? r.call?.asset)?.uppercased(), ["ETH", "WETH", "BTC", "CBBTC"].contains(symbol) {
            asset = symbol.hasSuffix("BTC") ? "BTC" : "ETH"
        }
        if let p = r.prefill {
            if let v = p.usd { usd = Kallr.fmt(v) }
            if let tp = p.tpPct, let sl = p.slPct, tp > 0, sl > 0 { exitsOn = true; tpPct = tp; slPct = sl }
        }
        if let post = r.post { source = (post.handle, post.postId, r.call.map { "@\(post.handle) · \($0.line)" } ?? "@\(post.handle)") }
    }

    var blocked: String? {
        if let w = copied?.warning { return w.hasPrefix("Fake") ? "No buy: fake contract" : "No buy: risky token" }
        guard let n = Double(usd), n > 0 else { return "Enter an amount" }
        if payingETH {
            guard let most = swappableUsd else { return "Reading your wallet…" }
            if most < 1 { return "Deposit ETH in the Kall app" }
            if n < 1 { return "Swap at least $1" }
            if n > most { return "Up to $\(String(format: "%.2f", most)) of ETH, keeping gas" }
            return nil
        }
        if let max = wallet?.maxUsd, n > max { return "Up to $\(Kallr.fmt(max)) per order" }
        if let usdc = wallet?.usdcValue, usdc < n {
            return (swappableUsd ?? 0) >= 1 ? "No USDC yet: tap USDC above to pay with ETH" : "Deposit ETH in the Kall app"
        }
        return nil
    }

    /** Buy: a fresh Definitive quote for the review card. Nothing is approved, signed or sent yet. */
    func review() {
        guard blocked == nil, !busy else { return }
        tap(.medium)
        placing = .quoting
        readBeforeTrade()
        Task {
            let result = payingETH ? await Kallr.swap(usd: usd, dryRun: true) : await Kallr.execute(order, dryRun: true)
            switch result {
            case .success(let quote):
                placing = .review(quote)
                readAllowance(quote.details?.approval)
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
        let swapping = payingETH
        Task {
            let result = swapping ? await Kallr.swap(usd: usd) : await Kallr.execute(order)
            switch result {
            case .success(let placed):
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                lastPlaced = placed
                readReceipt(orderId: placed.orderId)
                placing = .done("\(placed.preview.title) · \(placed.preview.get)")
                if swapping {
                    // The USDC lands a moment after the fill: read the wallet again, then buy with it.
                    Task {
                        for _ in 0..<6 {
                            try? await Task.sleep(nanoseconds: 3_000_000_000)
                            await load()
                        }
                        payAsset = "USDC"
                    }
                } else {
                    Task { await load() }
                }
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
        if model.mode == .typing {
            TypingKeyboard(model: model)
                .task { await model.load() }
        } else {
            panel
        }
    }

    private var panel: some View {
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
            Button { Haptics.layer(); model.closePicker(); model.mode = .typing } label: {
                Text("ABC").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.bone)
                    .frame(width: 44, height: 38).background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(Press())
            .accessibilityLabel("Back to typing")
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
        Group {
            if model.picking {
                TokenPicker(model: model)
            } else if model.editingAmount {
                AmountPad(model: model)
            } else if case .review(let quote) = model.placing {
                ReviewCard(model: model, quote: quote)
            } else if case .placing = model.placing {
                ReviewCard(model: model, quote: nil)
            } else if case .done = model.placing, let placed = model.lastPlaced {
                DoneCard(model: model, placed: placed)
            } else {
                form
            }
        }
        // Trade open: follow the coin's price, and start the private reader so it's up by review.
        .onAppear {
            model.startLive()
            model.warmAnon()
        }
        .onDisappear { model.stopLive() }
        .onChange(of: model.tickerKey) { _, _ in model.startLive() }
    }

    /** Like a swap: what you pay in dollars, what you get, the order type, and Advanced folded away. */
    private var form: some View {
        VStack(spacing: 6) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 6) {
                    LiveTicker(model: model)
                    ZStack {
                        VStack(spacing: 4) {
                            PayBox(model: model, editing: false)
                            GetBox(model: model)
                        }
                        Image(systemName: "arrow.down")
                            .font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.bone)
                            .frame(width: 28, height: 28)
                            .background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Kallr.black, lineWidth: 3))
                            .offset(y: (PayBox.height - GetBox.height) / 2)
                            .allowsHitTesting(false)
                    }
                    if !model.payingETH { OrderTypeRow(model: model) }
                    if model.advancedOpen, !model.payingETH {
                        AdvancedPanel(model: model).transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 2)
            }
            .modifier(NoEdgeBlur())
            VStack(alignment: .leading, spacing: 5) {
                // The post this trade copies, just above the footer.
                if let source = model.source {
                    Label(source.line, systemImage: "quote.bubble.fill")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.bone).lineLimit(1)
                        .labelStyle(PostLabel())
                } else if let copied = model.copied, copied.trade != nil, copied.warning == nil, let line = copied.headline(typed: nil) {
                    Label(line, systemImage: "doc.on.clipboard.fill")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.bone).lineLimit(1)
                        .labelStyle(PostLabel())
                }
                AnonStrip(model: model)
                status
                Button { model.review() } label: {
                    Text(model.busy ? "GETTING A QUOTE…" : model.blocked ?? reviewTitle)
                        .font(.system(size: 15, weight: .heavy)).tracking(0.5).lineLimit(1).minimumScaleFactor(0.75)
                        .foregroundStyle(model.blocked == nil ? Kallr.black : Kallr.muted)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(model.blocked == nil ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(Press())
                .disabled(model.blocked != nil || model.busy)
            }
            .padding(.horizontal, 8)
        }
        .padding(.bottom, 6)
    }

    private var reviewTitle: String {
        if model.payingETH { return "REVIEW · SWAP $\(model.usd) OF ETH TO USDC  ↗" }
        let what = model.kind == .market ? "BUY" : model.kind == .limit ? "LIMIT BUY" : "TWAP BUY"
        return "REVIEW · \(what) $\(model.usd) OF \(model.symbol)  ↗"
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

/** You pay: dollars of USDC from the Kall wallet. Tap to type; MAX fills what it can spend. */
private struct PayBox: View {
    static let height: CGFloat = 66
    @ObservedObject var model: KeyboardModel
    let editing: Bool
    @State private var blink = false

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("YOU PAY").font(.system(size: 9, weight: .heavy)).tracking(0.6).foregroundStyle(Kallr.muted)
                HStack(spacing: 2) {
                    Text("$").font(.system(size: 22, weight: .black)).foregroundStyle(Kallr.muted)
                    Text(model.usd.isEmpty ? "0" : model.usd)
                        .font(.system(size: 28, weight: .black).monospacedDigit())
                        .foregroundStyle(model.usd.isEmpty ? Kallr.muted : Kallr.bone)
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .padding(.horizontal, editing && model.freshEntry ? 3 : 0)
                        .background(editing && model.freshEntry ? Kallr.lime.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: 4))
                    if editing {
                        Rectangle().fill(Kallr.lime).frame(width: 2, height: 26).opacity(blink ? 1 : 0)
                            .onAppear { withAnimation(.easeInOut(duration: 0.5).repeatForever()) { blink = true } }
                    }
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 5) {
                Button { model.togglePay() } label: { TokenBadge(symbol: model.payAsset, chevron: true) }
                    .buttonStyle(Press())
                    .accessibilityLabel("Pay with \(model.payingETH ? "USDC" : "ETH")")
                HStack(spacing: 5) {
                    Text(model.payingETH
                         ? (model.swappableUsd.map { String(format: "Can swap $%.2f", $0) } ?? "Bal …")
                         : (model.wallet?.usdcValue.map { String(format: "Bal $%.2f", $0) } ?? "Bal …"))
                        .font(.system(size: 10, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.muted)
                    // While typing, MAX sits with the quick amounts under the box.
                    if !editing {
                        Button { Haptics.modifier(); model.useMax() } label: {
                            Text("MAX").font(.system(size: 9, weight: .heavy)).foregroundStyle(Kallr.lime)
                                .padding(.horizontal, 5).frame(height: 16)
                                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Kallr.lime.opacity(0.6)))
                        }
                        .buttonStyle(Press())
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: Self.height)
        .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(editing ? Kallr.lime : Kallr.hairline, lineWidth: editing ? 1.5 : 1))
        .contentShape(Rectangle())
        .onTapGesture { if !editing { model.startTyping() } }
    }
}

/** You get: ETH or BTC, about how much, and the price it buys at. */
private struct GetBox: View {
    static let height: CGFloat = 58
    @ObservedObject var model: KeyboardModel

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("YOU GET").font(.system(size: 9, weight: .heavy)).tracking(0.6).foregroundStyle(Kallr.muted)
                Text(model.payingETH ? (Double(model.usd).map { String(format: "≈ %.2f", $0 * 0.97) } ?? "—")
                     : (model.estimate.map { "≈ " + Self.amount($0) } ?? "—"))
                    .font(.system(size: 22, weight: .black).monospacedDigit()).foregroundStyle(Kallr.bone)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 5) {
                if model.payingETH {
                    TokenBadge(symbol: "USDC")
                } else {
                    Button { Haptics.modifier(); model.openPicker() } label: {
                        TokenBadge(symbol: model.symbol, logo: model.isAddress ? model.assetLogo : nil, chevron: true)
                    }
                    .buttonStyle(Press())
                    .accessibilityLabel("Pick a token")
                }
                Text(model.payingETH ? "Swap on Flash · ~$1 of ETH stays for gas" : model.priceLine)
                    .font(.system(size: 10, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.muted).lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: Self.height)
        .background(Kallr.graphite.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Kallr.hairline))
    }

    static func amount(_ v: Double) -> String {
        if v >= 1000 { return v.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: "en_US"))) }
        return String(format: v >= 1 ? "%.4f" : "%.6f", v)
    }
}

/** A coin's mark: its logo, or its colour with a glyph. */
private struct TokenIcon: View {
    let symbol: String
    var logo: URL? = nil
    var size: CGFloat = 18

    private var tint: Color {
        switch symbol {
        case "ETH": return Color(red: 0.384, green: 0.494, blue: 0.918)
        case "BTC": return Color(red: 0.969, green: 0.576, blue: 0.102)
        case "USDC": return Color(red: 0.153, green: 0.459, blue: 0.792)
        default: return Color(white: 0.32)
        }
    }
    private var glyph: String {
        switch symbol {
        case "ETH": return "Ξ"
        case "BTC": return "₿"
        case "USDC": return "$"
        default: return String(symbol.prefix(1))
        }
    }

    var body: some View {
        let fallback = Text(glyph).font(.system(size: size * 0.55, weight: .black)).foregroundStyle(.white)
            .frame(width: size, height: size).background(tint, in: Circle())
        if let logo {
            AsyncImage(url: logo) { image in
                image.resizable().scaledToFill().frame(width: size, height: size).clipShape(Circle())
            } placeholder: { fallback }
        } else {
            fallback
        }
    }
}

/** A coin pill: its mark, the symbol, and a chevron when it opens the picker. */
private struct TokenBadge: View {
    let symbol: String
    var selected = true
    var logo: URL? = nil
    var chevron = false

    var body: some View {
        HStack(spacing: 5) {
            TokenIcon(symbol: symbol, logo: logo)
            Text(symbol).font(.system(size: 12, weight: .heavy)).foregroundStyle(selected ? Kallr.bone : Kallr.muted).lineLimit(1)
            if chevron { Image(systemName: "chevron.down").font(.system(size: 9, weight: .heavy)).foregroundStyle(Kallr.muted) }
        }
        .padding(.leading, 4).padding(.trailing, 8).frame(height: 26)
        .background(selected ? Kallr.keyDark : .clear, in: Capsule())
        .overlay(Capsule().stroke(selected && symbol != "USDC" ? Kallr.lime.opacity(0.7) : Kallr.hairline))
        .opacity(selected ? 1 : 0.65)
    }
}

/**
 * Pick the coin, like a swap's token list: ETH and BTC up top; type a name or symbol on the keys below,
 * or paste a contract address, and Definitive's search lists what Flash can trade on Base.
 */
private struct TokenPicker: View {
    @ObservedObject var model: KeyboardModel
    @State private var blink = false

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(Kallr.muted)
                    if model.query.isEmpty {
                        caret
                        Text("Name, symbol or 0x address").font(.system(size: 13)).foregroundStyle(Kallr.muted).lineLimit(1)
                    } else {
                        Text(model.query).font(.system(size: 14, weight: .semibold)).foregroundStyle(Kallr.bone)
                            .lineLimit(1).truncationMode(.head)
                        caret
                    }
                    Spacer(minLength: 0)
                    if model.searching { ProgressView().scaleEffect(0.6).tint(Kallr.lime) }
                }
                .padding(.horizontal, 10).frame(height: 36)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Kallr.lime, lineWidth: 1.5))
                IconButton(symbol: "doc.on.clipboard", label: "Paste a contract address") { model.pasteAddress() }
                IconButton(symbol: "xmark", label: "Close") { Haptics.layer(); model.closePicker() }
            }
            .padding(.horizontal, 8)
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) { rows }.padding(.horizontal, 8)
            }
            .frame(height: 132)
            .modifier(NoEdgeBlur())
            GeometryReader { geo in KeyRows(model: model, width: geo.size.width) }
                .frame(height: 216)
        }
        .onAppear { withAnimation(.easeInOut(duration: 0.5).repeatForever()) { blink = true } }
    }

    private var caret: some View {
        Rectangle().fill(Kallr.lime).frame(width: 2, height: 18).opacity(blink ? 1 : 0)
    }

    @ViewBuilder private var rows: some View {
        if let note = model.pickerNote {
            Text(note).font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.danger)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
        }
        if model.query.isEmpty {
            Button { model.pickCore("ETH") } label: {
                TokenRow(symbol: "ETH", name: "Ethereum", logo: nil, price: model.feed?.prices["ETH"] ?? nil, detail: nil, selected: model.asset == "ETH")
            }
            Button { model.pickCore("BTC") } label: {
                TokenRow(symbol: "BTC", name: "Bitcoin (cbBTC)", logo: nil, price: model.feed?.prices["BTC"] ?? nil, detail: nil, selected: model.asset == "BTC")
            }
            if model.isAddress {
                TokenRow(symbol: model.assetSymbol, name: "Picked", logo: model.assetLogo, price: model.assetPrice, detail: nil, selected: true)
            }
            Text("Search any token Definitive Flash trades on Base, or paste its contract.")
                .font(.system(size: 11)).foregroundStyle(Kallr.muted)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
        } else if let hits = model.hits {
            if hits.isEmpty {
                Text("Nothing on Base matches “\(model.query)”.").font(.system(size: 12)).foregroundStyle(Kallr.muted)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
            }
            ForEach(hits) { hit in
                Button { model.pick(hit) } label: {
                    TokenRow(symbol: hit.symbol, name: hit.name ?? hit.symbol, logo: hit.logo, price: hit.priceValue, detail: hit.detail,
                             risky: hit.riskFlagged == true, selected: model.asset.lowercased() == hit.address.lowercased())
                }
            }
        }
    }
}

private struct TokenRow: View {
    let symbol: String
    let name: String
    let logo: URL?
    let price: Double?
    let detail: String?
    var risky = false
    var selected = false

    var body: some View {
        HStack(spacing: 10) {
            TokenIcon(symbol: symbol, logo: logo, size: 28)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(symbol).font(.system(size: 14, weight: .heavy)).foregroundStyle(Kallr.bone).lineLimit(1)
                    if risky {
                        Text("RISKY").font(.system(size: 8, weight: .heavy)).foregroundStyle(Kallr.danger)
                            .padding(.horizontal, 4).frame(height: 14)
                            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Kallr.danger.opacity(0.6)))
                    }
                }
                Text(name).font(.system(size: 11)).foregroundStyle(Kallr.muted).lineLimit(1)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 1) {
                Text(price.map { "$" + KeyboardModel.money($0) } ?? "—")
                    .font(.system(size: 13, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.bone)
                if let detail { Text(detail).font(.system(size: 10)).foregroundStyle(Kallr.muted) }
            }
            if selected { Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)).foregroundStyle(Kallr.lime) }
        }
        .frame(height: 44)
        .contentShape(Rectangle())
    }
}

/** Market, Limit or TWAP, small; and the fold for take-profit and stop-loss. */
private struct OrderTypeRow: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 2) {
                ForEach(KeyboardModel.Kind.allCases, id: \.self) { k in
                    Button {
                        Haptics.layer()
                        withAnimation(.easeOut(duration: 0.18)) {
                            model.kind = k
                            if k != .market { model.advancedOpen = true }
                        }
                    } label: {
                        Text(k.rawValue).font(.system(size: 11, weight: .bold))
                            .foregroundStyle(model.kind == k ? Kallr.black : Kallr.bone)
                            .padding(.horizontal, 10).frame(height: 24)
                            .background(model.kind == k ? Kallr.bone : .clear, in: RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(Press())
                }
            }
            .padding(2)
            .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
            Spacer(minLength: 4)
            Button {
                Haptics.modifier()
                withAnimation(.easeOut(duration: 0.18)) { model.advancedOpen.toggle() }
            } label: {
                HStack(spacing: 5) {
                    Text(model.exitsSummary).font(.system(size: 11, weight: .semibold)).lineLimit(1)
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                        .rotationEffect(.degrees(model.advancedOpen ? 180 : 0))
                }
                .foregroundStyle(model.advancedOpen ? Kallr.lime : Kallr.bone)
                .padding(.horizontal, 10).frame(height: 28)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(Press())
            .accessibilityLabel("Advanced: take profit and stop loss")
        }
    }
}

/** Advanced, folded by default: the limit or TWAP setting, take-profit and stop-loss, and where they sell. */
private struct AdvancedPanel: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if model.kind == .limit {
                row("BUY AT") {
                    ForEach([-1.0, -3, -5, -10], id: \.self) { p in
                        MiniChip(label: "−\(Kallr.fmt(-p))%", on: model.limitPct == p) { model.limitPct = p }
                    }
                }
            }
            if model.kind == .twap {
                row("SPREAD OVER") {
                    ForEach([(10, "10m"), (60, "1h"), (240, "4h"), (720, "12h")], id: \.0) { m in
                        MiniChip(label: m.1, on: model.twapMinutes == m.0) { model.twapMinutes = m.0 }
                    }
                }
            }
            row("TAKE PROFIT") {
                MiniChip(label: "Off", on: !model.exitsOn) { model.exitsOn = false }
                ForEach([5.0, 10, 20, 50], id: \.self) { p in
                    MiniChip(label: "+\(Kallr.fmt(p))%", on: model.exitsOn && model.tpPct == p) { model.exitsOn = true; model.tpPct = p }
                }
                if model.exitsOn, ![5.0, 10, 20, 50].contains(model.tpPct) {
                    MiniChip(label: "+\(Kallr.fmt(model.tpPct))%", on: true) {}
                }
            }
            if model.exitsOn {
                row("STOP LOSS") {
                    ForEach([3.0, 5, 10, 20], id: \.self) { p in
                        MiniChip(label: "−\(Kallr.fmt(p))%", on: model.slPct == p, danger: true) { model.slPct = p }
                    }
                    if ![3.0, 5, 10, 20].contains(model.slPct) {
                        MiniChip(label: "−\(Kallr.fmt(model.slPct))%", on: true, danger: true) {}
                    }
                }
                if let line = model.exitsPriceLine {
                    Text(line).font(.system(size: 10, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.muted).lineLimit(1)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Kallr.graphite.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Kallr.hairline))
    }

    private func row<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 5) {
            Text(label).font(.system(size: 9, weight: .heavy)).tracking(0.5).foregroundStyle(Kallr.muted)
                .frame(width: 76, alignment: .leading)
            content()
            Spacer(minLength: 0)
        }
    }
}

private struct MiniChip: View {
    let label: String
    let on: Bool
    var danger = false
    var wide = false
    let action: () -> Void

    var body: some View {
        Button { Haptics.letter(); action() } label: {
            Text(label).font(.system(size: 11, weight: .bold).monospacedDigit())
                .foregroundStyle(on ? Kallr.black : Kallr.bone)
                .padding(.horizontal, 8)
                .frame(maxWidth: wide ? .infinity : nil, minHeight: 26)
                .background(on ? (danger ? Kallr.danger : Kallr.lime) : Kallr.keyDark, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(Press())
    }
}

/**
 * The review, like a swap's: what you pay and what you get with their coins, Flash's estimates, the
 * exits and the steps on Base, then one tap to place. While it places, the steps it runs.
 */
private struct ReviewCard: View {
    @ObservedObject var model: KeyboardModel
    let quote: Kallr.Placed?
    @State private var sweep: CGFloat = 0

    private var paySymbol: String { model.payingETH ? "ETH" : "USDC" }
    private var getSymbol: String { model.payingETH ? "USDC" : model.symbol }
    private var getLogo: URL? { model.payingETH || !model.isAddress ? nil : model.assetLogo }
    private var badge: String {
        if model.payingETH { return "SWAP" }
        switch model.kind {
        case .market: return "MARKET BUY"
        case .limit: return "LIMIT BUY"
        case .twap: return "TWAP BUY"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(badge).font(.system(size: 9, weight: .heavy)).tracking(0.6).foregroundStyle(Kallr.black)
                    .padding(.horizontal, 6).frame(height: 17)
                    .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 4))
                Text(quote == nil ? "Placing on Base…" : "Fresh quote · Base")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(Kallr.muted).lineLimit(1)
                Spacer(minLength: 4)
                PoweredByDefinitive(height: 8, suffix: "Flash")
            }
            legs
            if let quote { details(quote) } else { working }
            Spacer(minLength: 0)
            AnonStrip(model: model)
            buttons
        }
        .padding(.horizontal, 8)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }

    // You pay → You get

    private var legs: some View {
        VStack(spacing: 0) {
            leg("YOU PAY", symbol: paySymbol, logo: nil, amount: quote.map { Self.clean($0.preview.pay) } ?? "$\(model.usd)", side: "$\(model.usd)")
            ZStack {
                Rectangle().fill(Kallr.hairline).frame(height: 1)
                Image(systemName: "arrow.down").font(.system(size: 10, weight: .heavy)).foregroundStyle(Kallr.bone)
                    .frame(width: 22, height: 22)
                    .background(Kallr.keyDark, in: Circle())
                    .overlay(Circle().stroke(Kallr.black, lineWidth: 2))
            }
            .frame(height: 22)
            leg("YOU GET", symbol: getSymbol, logo: getLogo, amount: quote.map { Self.clean($0.preview.get) } ?? "…",
                side: quote.map { Self.shortKind($0.preview.kind) } ?? "")
        }
        .padding(.horizontal, 12)
        .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Kallr.hairline))
    }

    private func leg(_ label: String, symbol: String, logo: URL?, amount: String, side: String) -> some View {
        HStack(spacing: 10) {
            TokenIcon(symbol: symbol, logo: logo, size: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 8, weight: .heavy)).tracking(0.6).foregroundStyle(Kallr.muted)
                Text(amount).font(.system(size: 19, weight: .black).monospacedDigit()).foregroundStyle(Kallr.bone)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            Spacer(minLength: 4)
            Text(side).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.muted)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(height: 42)
    }

    // Flash's estimates, the exits and the steps

    private func details(_ q: Kallr.Placed) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                cell("PRICE IMPACT", q.details?.impactPct.map { String(format: "%.2f%%", abs($0)) } ?? "—")
                cell("FEE", q.details?.feeUsd.map { $0 < 0.005 ? "None" : String(format: "$%.2f", $0) } ?? "—")
                cell("ON BASE", Self.steps(q.preview.approval))
            }
            if q.preview.exits != "None" {
                note("arrow.up.right.and.arrow.down.right", "Exits  " + q.preview.exits.replacingOccurrences(of: ".00", with: ""), tint: Kallr.bone)
            }
            note("checkmark.seal.fill", "Definitive Flash · best route on Base", tint: Kallr.lime)
        }
    }

    private func cell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 8, weight: .heavy)).tracking(0.5).foregroundStyle(Kallr.muted)
            Text(value).font(.system(size: 13, weight: .bold).monospacedDigit()).foregroundStyle(Kallr.bone)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Kallr.graphite.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }

    private func note(_ symbol: String, _ text: String, tint: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 10, weight: .bold)).foregroundStyle(tint)
            Text(text).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(Kallr.bone).lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 4)
    }

    // While it places

    private var working: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(workSteps.enumerated()), id: \.offset) { i, step in
                HStack(spacing: 8) {
                    Text("0\(i + 1)").font(.system(size: 10, design: .monospaced)).foregroundStyle(Kallr.lime)
                    Text(step).font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.bone)
                }
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Kallr.keyDark)
                    Capsule().fill(Kallr.lime).frame(width: g.size.width * 0.28).offset(x: sweep * g.size.width * 0.72)
                }
            }
            .frame(height: 4)
            .onAppear { withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { sweep = 1 } }
            Text("About 10–30 seconds on Base. Keep the keyboard open.").font(.system(size: 11)).foregroundStyle(Kallr.muted)
        }
        .padding(.horizontal, 4)
    }

    private var workSteps: [String] {
        model.payingETH
            ? ["A fresh quote from Definitive Flash", "Wrap the ETH, then approve exactly that", "Sign and submit the swap"]
            : ["A fresh quote from Definitive Flash", "Approve exactly $\(model.usd) of USDC", "Sign the order" + (model.exitsOn ? " and its exits" : "") + ", then submit"]
    }

    // Back / Confirm

    private var buttons: some View {
        HStack(spacing: 8) {
            Button { model.tap(); model.placing = .idle } label: {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .heavy)).foregroundStyle(Kallr.bone)
                    .frame(width: 56, height: 52).background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(Press())
            .disabled(quote == nil)
            .accessibilityLabel("Back")
            Button { model.confirm() } label: {
                HStack(spacing: 8) {
                    if quote == nil { ProgressView().tint(Kallr.black).scaleEffect(0.8) }
                    Text(quote == nil ? "PLACING ON FLASH…" : model.payingETH ? "CONFIRM SWAP" : "CONFIRM & PLACE")
                        .font(.system(size: 15, weight: .heavy)).tracking(0.5)
                    if quote != nil { Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .heavy)) }
                }
                .foregroundStyle(Kallr.black)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(Press())
            .disabled(quote == nil)
        }
    }

    /** "about 1.05 USDC" → "≈ 1.05 USDC". */
    static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "up to about ", with: "≤ ").replacingOccurrences(of: "about ", with: "≈ ")
    }
    /** "Market swap on Base through Flash" → "Market swap". */
    static func shortKind(_ s: String) -> String { s.replacingOccurrences(of: " on Base through Flash", with: "") }
    /** What runs on Base before the order: a wrap, an approval, or nothing. */
    static func steps(_ approval: String) -> String {
        if approval.hasPrefix("Wrap") { return "Wrap + approve" }
        if approval == "Not needed" { return "Ready" }
        return "Approve " + (approval.contains("WETH") ? "WETH" : "USDC")
    }
}

/** Placed: a tick that pops, what went through, and where to follow it. */
private struct DoneCard: View {
    @ObservedObject var model: KeyboardModel
    let placed: Kallr.Placed
    @State private var pop = false

    var body: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)
            ZStack {
                Circle().fill(Kallr.lime.opacity(0.16)).frame(width: 66, height: 66).scaleEffect(pop ? 1 : 0.5)
                Circle().fill(Kallr.lime).frame(width: 44, height: 44).scaleEffect(pop ? 1 : 0.7)
                Image(systemName: "checkmark").font(.system(size: 20, weight: .black)).foregroundStyle(Kallr.black)
            }
            .onAppear { withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) { pop = true } }
            Text(placed.preview.title).font(.system(size: 18, weight: .black)).foregroundStyle(Kallr.bone)
            Text(ReviewCard.clean(placed.preview.get) + " · placed on Definitive Flash")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Kallr.muted)
            if let id = placed.orderId {
                Text("ORDER \(id.prefix(8).uppercased())").font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(Kallr.muted)
            }
            PoweredByDefinitive(height: 9, suffix: "Flash on Base")
            Spacer(minLength: 0)
            AnonStrip(model: model)
            HStack(spacing: 8) {
                Button {
                    model.tap()
                    model.placing = .idle
                    model.tab = .orders
                    model.startPolling()
                } label: {
                    Text("VIEW ORDERS").font(.system(size: 14, weight: .heavy)).tracking(0.5).foregroundStyle(Kallr.bone)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Kallr.hairline))
                }
                .buttonStyle(Press())
                Button { model.tap(); model.placing = .idle } label: {
                    Text("NEW TRADE").font(.system(size: 14, weight: .heavy)).tracking(0.5).foregroundStyle(Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(Press())
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 6)
    }
}

/**
 * The coin's live price, every 4 seconds: the price (flashing up or down as it ticks), its 24h move,
 * and a sparkline of the prices seen since Trade opened.
 */
private struct LiveTicker: View {
    @ObservedObject var model: KeyboardModel
    @State private var flash = false

    var body: some View {
        let symbol = model.payingETH ? "ETH" : model.symbol
        HStack(spacing: 6) {
            HStack(spacing: 3) {
                Circle().fill(model.live == nil ? Kallr.muted : Kallr.up).frame(width: 5, height: 5)
                    .opacity(flash ? 0.35 : 1)
                Text("LIVE").font(.system(size: 8, weight: .heavy)).tracking(0.6).foregroundStyle(Kallr.muted)
            }
            Text(symbol).font(.system(size: 11, weight: .heavy)).foregroundStyle(Kallr.bone).lineLimit(1)
            if let live = model.live {
                Text("$" + Self.tick(live.price))
                    .font(.system(size: 13, weight: .black).monospacedDigit())
                    .foregroundStyle(flash ? (model.tickMove >= 0 ? Kallr.up : Kallr.danger) : Kallr.bone)
                    .contentTransition(.numericText(value: live.price))
                    .lineLimit(1)
                if let c = live.change24h {
                    Text(String(format: "%@%.2f%% 24h", c >= 0 ? "▲" : "▼", abs(c)))
                        .font(.system(size: 10, weight: .bold).monospacedDigit())
                        .foregroundStyle(c >= 0 ? Kallr.up : Kallr.danger).lineLimit(1)
                }
            } else {
                Text("Reading the price…").font(.system(size: 10, weight: .semibold)).foregroundStyle(Kallr.muted)
            }
            Spacer(minLength: 4)
            Sparkline(values: model.ticks).frame(width: 64, height: 14)
        }
        .padding(.horizontal, 10)
        .frame(height: 24)
        .background(Kallr.graphite.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
        .onChange(of: model.live?.price) { _, _ in
            withAnimation(.easeOut(duration: 0.15)) { flash = true }
            withAnimation(.easeIn(duration: 0.6).delay(0.25)) { flash = false }
        }
    }
}

extension LiveTicker {
    /** Cents on a ticker so a move shows: 2,225.43 · 90.52 · 0.000123. */
    static func tick(_ v: Double) -> String {
        guard v >= 1 else { return KeyboardModel.money(v) }
        return v.formatted(.number.precision(.fractionLength(2)).locale(Locale(identifier: "en_US")))
    }
}

/** The prices seen so far as a small line, green if it ended up, red if down. */
private struct Sparkline: View {
    let values: [Double]

    var body: some View {
        GeometryReader { g in
            if values.count >= 2, let lo = values.min(), let hi = values.max() {
                let span = max(hi - lo, hi * 0.0001)
                Path { path in
                    for (i, v) in values.enumerated() {
                        let x = g.size.width * CGFloat(i) / CGFloat(values.count - 1)
                        let y = g.size.height * (1 - CGFloat((v - lo) / span))
                        if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                    }
                }
                .stroke((values.last ?? 0) >= (values.first ?? 0) ? Kallr.up : Kallr.danger, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            } else {
                Rectangle().fill(Kallr.hairline).frame(height: 1).frame(maxHeight: .infinity)
            }
        }
    }
}

/**
 * Anon-RPC's live log: the keyboard's Base reads around a trade, newest first. Private reads (through
 * the Nym mixnet) in green; any read that went direct in red, never hidden.
 */
private struct AnonStrip: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "shield.lefthalf.filled").font(.system(size: 9, weight: .heavy)).foregroundStyle(Kallr.lime)
            Text("ANON-RPC").font(.system(size: 8, weight: .heavy)).tracking(0.5).foregroundStyle(Kallr.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    connecting
                    ForEach(model.anonLog.reversed()) { e in
                        Text(e.text).font(.system(size: 10, weight: .semibold).monospacedDigit()).lineLimit(1)
                            .foregroundStyle(e.tone == .ok ? Kallr.up : e.tone == .direct ? Kallr.danger : Kallr.muted)
                    }
                    if model.anonLog.isEmpty, !isConnecting {
                        Text(model.fullAccess ? "Base reads go through the Nym mixnet" : "Turn on Full Access for private reads")
                            .font(.system(size: 10, weight: .semibold)).foregroundStyle(Kallr.muted).lineLimit(1)
                    }
                }
            }
            .modifier(NoEdgeBlur())
        }
        .frame(height: 16)
    }

    private var isConnecting: Bool { model.anonState == .loading || model.anonState == .connecting }

    /** "● Connecting privately (Nym) · 12s", ticking while the mixnet boots. */
    @ViewBuilder private var connecting: some View {
        if isConnecting {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let s = model.anonStartedAt.map { Int(ctx.date.timeIntervalSince($0)) } ?? 0
                Text("● Connecting privately (Nym) · \(s)s").font(.system(size: 10, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Kallr.lime).lineLimit(1)
            }
        }
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

/** Typing the amount: the pay box stays on top, with quick amounts and the keys under it. */
private struct AmountPad: View {
    @ObservedObject var model: KeyboardModel
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"]

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                PayBox(model: model, editing: true)
                Button { model.tap(.medium); model.freshEntry = false; model.editingAmount = false } label: {
                    Text("DONE").font(.system(size: 13, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(width: 64, height: PayBox.height).background(Kallr.lime, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(Press())
            }
            HStack(spacing: 6) {
                ForEach(["1", "5", "10", "25"], id: \.self) { a in
                    MiniChip(label: "$\(a)", on: model.usd == a, wide: true) { model.usd = a; model.freshEntry = false }
                }
                MiniChip(label: "MAX", on: false, wide: true) { model.useMax() }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(keys, id: \.self) { k in
                    Button { model.keypad(k) } label: {
                        Group { if k == "⌫" { Image(systemName: "delete.left") } else { Text(k) } }
                            .font(.system(size: 22, weight: .medium)).foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 38)
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
