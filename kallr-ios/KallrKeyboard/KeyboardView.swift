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
        /** Kall's own demo call (ETH → USDC), pinned on top so the swap can be tried from a post. */
        var demo = false
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
    /** The post opened in full from Following. */
    @Published var opened: Item?
    private let demoPostedAt = Date().timeIntervalSince1970 - 25 * 60
    /** A clearly labelled demo call from Kall itself: rotate ETH into USDC. */
    var demoItem: Item {
        Item(postId: "kall-demo-eth-usdc", caller: "kallmarkets", asset: "ETH", short: true,
             postedAt: demoPostedAt, deadline: demoPostedAt + 86_400, entry: nil,
             text: "Demo call from Kall Markets: taking profit on $ETH here. Swapping ETH to USDC on Base and waiting for a better entry. Tap Swap to try it from the keyboard. Not financial advice.",
             status: nil, returnBps: nil, demo: true)
    }
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
        if source?.postId == demoItem.postId { source = nil }
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

    // MARK: Chainlink CRE

    /** CRE is checking the coin a copied post names, or has decided. */
    enum CreState { case checking(String), decided(Kallr.CreVerdict) }
    @Published var cre: CreState?
    private var creTask: Task<Void, Never>?
    /** A fake: Trade shows the red card and no Trade button. */
    var creFake: Kallr.CreVerdict? { if case .decided(let v) = cre, v.isFake { return v }; return nil }
    var creReal: Kallr.CreVerdict? { if case .decided(let v) = cre, v.isReal { return v }; return nil }
    var creChecking: String? { if case .checking(let claimed) = cre { return claimed }; return nil }

    /**
     * Before a coin from a post can be traded, Chainlink CRE checks that the contract is really that coin:
     * its verdict if it has one, otherwise a fresh check (about 10 seconds). A fake opens Trade on the red card.
     */
    func checkCre(token: String, claimed: String, reveal: Bool) {
        creTask?.cancel()
        cre = .checking(claimed)
        creTask = Task {
            var verdict = await Kallr.creVerdict(token: token, claimed: claimed)
            if verdict?.checked != true, verdict?.canRun == true, !Task.isCancelled {
                verdict = await Kallr.runCre(token: token, claimed: claimed)
            }
            guard !Task.isCancelled else { return }
            guard let verdict, verdict.checked, verdict.verdict != "unknown" else { cre = nil; return }
            cre = .decided(verdict)
            if verdict.isFake {
                Haptics.error()
                placing = .idle
                tab = .trade
                if reveal { mode = .panel }
            }
        }
    }

    func clearCre() {
        creTask?.cancel()
        cre = nil
    }

    /** Drops the warning and CRE's signed verdict into the chat. */
    func shareCreProof() {
        guard let v = creFake, let proof = v.proof else { return }
        tap(.medium)
        controller?.textDocumentProxy.insertText("Fake $\(v.claimed ?? v.symbol ?? "token") contract: \(v.reason ?? "not the real coin"). Checked by Chainlink CRE: \(proof)")
        mode = .typing
    }

    // MARK: The fill on Base

    /** Drops the trade and its BaseScan link into the chat you're typing in. */
    func shareReceipt() {
        guard let tx = fillTx, let placed = lastPlaced else { return }
        tap(.medium)
        let got = placed.preview.get.replacingOccurrences(of: "about ", with: "")
        controller?.textDocumentProxy.insertText("\(placed.preview.title), got \(got) on Definitive Flash: https://basescan.org/tx/\(tx)")
        placing = .idle
        mode = .typing
    }

    /** The swap's transaction once Flash fills it, for the done card's BaseScan link. */
    @Published var fillTx: String?

    private func findFill(orderId: String?) {
        fillTx = nil
        guard let orderId, let owner = wallet?.address else { return }
        Task {
            for _ in 0..<10 {
                if let tx = await Kallr.fills(orderId: orderId, funder: owner)?.transaction {
                    if lastPlaced?.orderId == orderId { fillTx = tx }
                    return
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
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
    /** Options, folded: "Market · TP +10% SL −5%". */
    var optionsSummary: String {
        [kind == .market ? nil : kind.rawValue, exitsOn ? "+\(Kallr.fmt(tpPct))% / −\(Kallr.fmt(slPct))%" : "Options"]
            .compactMap { $0 }.joined(separator: " · ")
    }
    /** Under the amount: about what it gets, and what you can spend. */
    var amountSubline: String {
        let spend = payingETH
            ? swappableUsd.map { String(format: "can swap $%.2f", $0) }
            : wallet?.usdcValue.map { String(format: "balance $%.2f", $0) }
        let gets: String? = payingETH
            ? Double(usd).map { String(format: "≈ %.2f USDC", $0 * 0.97) }
            : estimate.map { "≈ " + Self.coinAmount($0) + " " + symbol }
        return [gets, spend].compactMap { $0 }.joined(separator: " · ")
    }
    static func coinAmount(_ v: Double) -> String {
        if v >= 1000 { return v.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: "en_US"))) }
        return String(format: v >= 1 ? "%.4f" : "%.6f", v)
    }
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
        clearCre()
        asset = key
        placing = .idle
        closePicker()
    }

    func pick(_ hit: Kallr.TokenHit) {
        clearCre()
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
        controller?.checkContext()
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
        case .active: return mine(openItems).count + 1  // the demo call
        case .settled: return mine(settledItems).count
        case .favorites: return (openItems + settledItems).filter { favorites.contains($0.postId) }.count
        }
    }
    var visibleItems: [Item] {
        switch filter {
        case .active: return [demoItem] + mine(openItems)
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
        opened = nil
        clearCre()
        if item.demo {
            // The demo call is a swap: pay with the wallet's ETH, get USDC.
            payAsset = "ETH"
            kind = .market
            advancedOpen = false
            if let most = swappableUsd, most >= 1 { usd = String(format: "%.2f", min(most, 5)) }
            source = (item.caller, item.postId, "@\(item.caller) · SWAP ETH → USDC")
            placing = .idle
            tab = .trade
            return
        }
        payAsset = "USDC"
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
        if let claimed = creChecking { return "Checking $\(claimed) with Chainlink CRE…" }
        if creFake != nil { return "Fake token: trading is off" }
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
        Task {
            let result = payingETH ? await Kallr.swap(usd: usd, dryRun: true) : await Kallr.execute(order, dryRun: true)
            switch result {
            case .success(let quote):
                placing = .review(quote)
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
                findFill(orderId: placed.orderId)
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

    private func title(_ t: KeyboardModel.Tab) -> String {
        switch t {
        case .following: return "Following"
        case .trade: return "Trade"
        case .orders: return "Orders"
        case .wallet: return "Wallet"
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            Button { Haptics.layer(); model.closePicker(); model.opened = nil; model.mode = .typing } label: {
                Text("ABC").font(.system(size: 14, weight: .heavy)).foregroundStyle(Kallr.bone)
                    .frame(width: 52, height: 36).background(Kallr.keyDark, in: Capsule())
            }
            .buttonStyle(Press())
            .accessibilityLabel("Back to typing")
            ForEach(KeyboardModel.Tab.allCases, id: \.self) { t in
                Button {
                    model.tap()
                    withAnimation(.easeOut(duration: 0.15)) { model.tab = t }
                    if t == .orders { model.startPolling() }
                    if t == .wallet || t == .following { Task { await model.load() } }
                } label: {
                    VStack(spacing: 5) {
                        Text(title(t)).font(.system(size: 14, weight: .heavy))
                            .foregroundStyle(model.tab == t ? Kallr.bone : Kallr.muted)
                            .lineLimit(1).minimumScaleFactor(0.8)
                        Capsule().fill(model.tab == t ? Kallr.lime : .clear).frame(width: 18, height: 3)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(Press())
            }
            if model.showsGlobe {
                Button { model.tap(); model.controller?.nextKeyboard() } label: {
                    Image(systemName: "globe").font(.system(size: 17, weight: .medium)).foregroundStyle(Kallr.muted)
                        .frame(width: 40, height: 44)
                }
                .buttonStyle(Press())
                .accessibilityLabel("Next keyboard")
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
    }
}

// MARK: - Following

private struct FollowingTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        if let item = model.opened {
            PostView(item: item, model: model)
        } else {
            VStack(spacing: 4) {
                HStack(spacing: 16) {
                    ForEach(KeyboardModel.Scope.allCases, id: \.self) { sc in
                        Button { model.tap(); model.scope = sc } label: {
                            Text(sc == .following ? "Following \(model.follows.count)" : "Explore")
                                .font(.system(size: 14, weight: .heavy))
                                .foregroundStyle(model.scope == sc ? Kallr.bone : Kallr.muted)
                                .frame(minHeight: 36)
                        }
                        .buttonStyle(Press())
                    }
                    Spacer(minLength: 0)
                    IconButton(symbol: "doc.on.clipboard", label: "Check what you copied") { model.controller?.checkCopied() }
                    IconButton(symbol: model.refreshing ? "hourglass" : "arrow.clockwise", label: "Refresh") { Task { await model.refresh() } }
                }
                .padding(.horizontal, 14)

                if model.checking || model.note != nil || model.cre != nil || model.copied?.headline(typed: nil) != nil { CopiedBanner(model: model) }

                if model.scope == .explore { ExploreList(model: model) } else { FollowingList(model: model) }
            }
        }
    }
}

/** One post in full: who called it, which way, the whole text, how it's going, and one button to trade it. */
private struct PostView: View {
    let item: KeyboardModel.Item
    @ObservedObject var model: KeyboardModel

    private var record: String? {
        guard let c = model.feed?.callers?.first(where: { $0.handle.lowercased() == item.caller.lowercased() }), c.settled > 0 else { return nil }
        return "\(c.hits) of \(c.settled) right"
    }
    private var direction: String { item.demo ? "SWAP ETH → USDC" : "\(item.short ? "SHORT" : "LONG") $\(item.asset)" }
    private var tradable: Bool { item.demo || (item.status == nil && !item.short && ["ETH", "BTC"].contains(item.asset)) }
    private var buttonTitle: String {
        if item.demo { return "Swap ETH → USDC" }
        if tradable { return "Trade $\(item.asset)" }
        if item.status != nil { return "Settled: \(item.status ?? "")" }
        return item.short ? "Can't copy shorts" : "Not tradable on Base"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Button { model.tap(); model.opened = nil } label: {
                    Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold)).foregroundStyle(Kallr.bone)
                        .frame(width: 40, height: 40).background(Kallr.keyDark, in: Circle())
                }
                .buttonStyle(Press())
                .accessibilityLabel("Back")
                VStack(alignment: .leading, spacing: 2) {
                    Text("@\(item.caller)").font(.system(size: 14, weight: .heavy)).foregroundStyle(Kallr.bone)
                    Text([direction, Kallr.ago(item.postedAt), record].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(item.short && !item.demo ? Kallr.danger : Kallr.lime).lineLimit(1)
                }
                Spacer(minLength: 0)
                if !item.demo {
                    Button { model.toggleFavorite(item.postId) } label: {
                        Image(systemName: model.favorites.contains(item.postId) ? "star.fill" : "star")
                            .font(.system(size: 16)).foregroundStyle(model.favorites.contains(item.postId) ? Kallr.lime : Kallr.muted)
                            .frame(width: 40, height: 40)
                    }
                    .buttonStyle(Press())
                    .accessibilityLabel("Favorite")
                }
            }
            .padding(.horizontal, 14)
            ScrollView(.vertical, showsIndicators: false) {
                Text(item.text ?? "Kall Markets didn't keep this post's text.")
                    .font(.system(size: 17)).foregroundStyle(Kallr.bone)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14).padding(.vertical, 10)
            }
            .modifier(NoEdgeBlur())
            if let move = model.move(item), !item.demo {
                Text(String(format: "%+.2f%% since the post · %@", move, Kallr.left(item.deadline)))
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(move >= 0 ? Kallr.up : Kallr.danger)
                    .padding(.horizontal, 14).padding(.bottom, 6)
            }
            Button { if tradable { model.trade(item) } } label: {
                Text(buttonTitle).font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(tradable ? Kallr.black : Kallr.muted)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(tradable ? Kallr.lime : Kallr.keyDark, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(Press())
            .disabled(!tradable)
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
        .padding(.top, 4)
    }
}

private struct IconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(Kallr.muted)
                .frame(width: 40, height: 40)
        }
        .buttonStyle(Press())
        .accessibilityLabel(label)
    }
}

/** What Check found in the clipboard: the call, or a red warning. */
private struct CopiedBanner: View {
    @ObservedObject var model: KeyboardModel
    var body: some View {
        let fake = model.creFake
        let warning = model.copied?.warning != nil || model.note != nil || fake != nil
        HStack(spacing: 8) {
            Text(model.checking ? "Checking what you copied…"
                 : fake.map { "✕ Fake $\($0.claimed ?? "token") · checked by Chainlink CRE" }
                 ?? model.creChecking.map { "Checking $\($0) with Chainlink CRE…" }
                 ?? model.note ?? model.copied?.headline(typed: nil) ?? "")
                .font(.system(size: 12, weight: .semibold)).lineLimit(1)
                .foregroundStyle(warning ? Kallr.danger : Kallr.bone)
            Spacer(minLength: 0)
            if !warning, model.creChecking == nil, model.copied?.trade != nil {
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
            VStack(spacing: 2) {
                HStack(spacing: 16) {
                    ForEach(KeyboardModel.Filter.allCases, id: \.self) { f in
                        Button { model.tap(); model.filter = f } label: {
                            Text(f.label(count: model.count(f))).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(model.filter == f ? Kallr.lime : Kallr.muted)
                                .frame(minHeight: 32)
                        }
                        .buttonStyle(Press())
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        let items = model.visibleItems
                        if model.feed == nil { Empty(text: model.feedError ?? "Reading Arkiv…") }
                        else if items.isEmpty { Empty(text: model.filter == .favorites ? "Star a call to keep it here." : model.filter == .active ? "No open calls from who you follow." : "Nothing settled yet.") }
                        ForEach(items) { item in CallCard(item: item, model: model) }
                    }
                    .padding(.horizontal, 14)
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

/** One call in three quiet lines: who and which way, the post, how it's going. Tap opens the whole post. */
private struct CallCard: View {
    let item: KeyboardModel.Item
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text("@\(item.caller)").font(.system(size: 14, weight: .heavy)).foregroundStyle(Kallr.bone).lineLimit(1)
                Text(item.demo ? "SWAP ETH → USDC" : "\(item.short ? "SHORT" : "LONG") $\(item.asset)").font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(item.short && !item.demo ? Kallr.danger : Kallr.lime).lineLimit(1)
                Spacer(minLength: 0)
                Text(item.demo ? "DEMO" : Kallr.ago(item.postedAt)).font(.system(size: 14, weight: .semibold)).foregroundStyle(Kallr.muted)
            }
            if let text = item.text {
                Text(text).font(.system(size: 14)).foregroundStyle(Kallr.bone.opacity(0.75)).lineLimit(1)
            }
            HStack(spacing: 6) {
                if let status = item.status {
                    Text(status.capitalized + (item.returnBps.map { String(format: " · %+.2f%%", Double($0) / 100) } ?? ""))
                        .foregroundStyle(status == "hit" ? Kallr.up : status == "miss" ? Kallr.danger : Kallr.muted)
                } else if let move = model.move(item) {
                    Text(String(format: "%+.2f%% · %@", move, Kallr.left(item.deadline))).foregroundStyle(move >= 0 ? Kallr.up : Kallr.danger)
                } else {
                    Text(item.demo ? "Tap to read, then swap" : Kallr.left(item.deadline)).foregroundStyle(Kallr.muted)
                }
                Spacer(minLength: 0)
                Text("Read ›").foregroundStyle(Kallr.muted)
            }
            .font(.system(size: 14, weight: .semibold))
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .onTapGesture { model.tap(); model.opened = item }
        .overlay(alignment: .bottom) { Rectangle().fill(Kallr.hairline.opacity(0.6)).frame(height: 1) }
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

/** Two sizes on every Trade screen: the big number, and everything else. */
private enum TradeFont {
    static let big = Font.system(size: 40, weight: .black).monospacedDigit()
    static let mid = Font.system(size: 26, weight: .black).monospacedDigit()
    static let body = Font.system(size: 14, weight: .semibold)
    static let bold = Font.system(size: 14, weight: .heavy)
}

private struct TradeTab: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        Group {
            if model.picking {
                TokenPicker(model: model)
            } else if let fake = model.creFake {
                FakeCoinCard(model: model, verdict: fake)
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
        // Trade open: follow the coin's price.
        .onAppear { model.startLive() }
        .onDisappear { model.stopLive() }
        .onChange(of: model.tickerKey) { _, _ in model.startLive() }
    }

    /** One decision: the call, how much, and one button. Order type and exits fold into Options. */
    private var form: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView(.vertical, showsIndicators: false) {
                if model.advancedOpen, !model.payingETH {
                    options
                } else {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        if let call = callLine {
                            Text(call).font(TradeFont.body).foregroundStyle(Kallr.bone).lineLimit(1)
                        }
                        if let claimed = model.creChecking {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small).tint(Kallr.muted)
                                Text("Checking $\(claimed) with Chainlink CRE…").font(TradeFont.body).foregroundStyle(Kallr.muted).lineLimit(1)
                            }
                        } else if let real = model.creReal {
                            Label("Real $\(real.claimed ?? real.symbol ?? "") · checked by Chainlink CRE", systemImage: "checkmark.seal.fill")
                                .font(TradeFont.body).foregroundStyle(Kallr.lime).lineLimit(1)
                        }
                        LiveTicker(model: model)
                    }
                    AmountLine(model: model, editing: false)
                    pair
                }
                .padding(.horizontal, 14)
                .padding(.top, 6)
                .padding(.bottom, 6)
                }
            }
            .modifier(NoEdgeBlur())
            if case .failed(let message) = model.placing {
                Text(message).font(TradeFont.body).foregroundStyle(Kallr.danger).lineLimit(2)
                    .padding(.horizontal, 14).padding(.bottom, 6)
            }
            Button { model.review() } label: {
                Text(model.busy ? "Getting a quote…" : model.blocked ?? reviewTitle)
                    .font(TradeFont.bold).lineLimit(1).minimumScaleFactor(0.8)
                    .foregroundStyle(model.blocked == nil ? Kallr.black : Kallr.muted)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(model.blocked == nil ? Kallr.lime : Kallr.keyDark, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(Press())
            .disabled(model.blocked != nil || model.busy)
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
    }

    /** Options on their own screen: order type, take-profit and stop-loss, then Done. */
    private var options: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Options").font(TradeFont.bold).foregroundStyle(Kallr.bone)
                Spacer()
                Button { Haptics.modifier(); withAnimation(.easeOut(duration: 0.18)) { model.advancedOpen = false } } label: {
                    Text("Done").font(TradeFont.bold).foregroundStyle(Kallr.lime).frame(minWidth: 44, minHeight: 36)
                }
                .buttonStyle(Press())
            }
            AdvancedPanel(model: model)
        }
        .padding(.horizontal, 14)
        .padding(.top, 2)
    }

    /** "@altcoinsherpa · LONG ETH · 3 of 9 right": the call this trade copies, in one line. */
    private var callLine: String? {
        if let source = model.source {
            let record = model.feed?.callers?.first { $0.handle.lowercased() == source.handle.lowercased() }
            let right = record.flatMap { $0.settled > 0 ? "\($0.hits) of \($0.settled) right" : nil }
            return [source.line, right].compactMap { $0 }.joined(separator: " · ")
        }
        if let copied = model.copied, copied.trade != nil, copied.warning == nil { return copied.headline(typed: nil) }
        return nil
    }

    /** You pay → you get, as two coins; then Options, folded. */
    private var pair: some View {
        HStack(spacing: 8) {
            Button { model.togglePay() } label: { TokenBadge(symbol: model.payAsset, chevron: true) }
                .buttonStyle(Press())
                .accessibilityLabel("Pay with \(model.payingETH ? "USDC" : "ETH")")
            Image(systemName: "arrow.right").font(TradeFont.bold).foregroundStyle(Kallr.muted)
            if model.payingETH {
                TokenBadge(symbol: "USDC")
            } else {
                Button { Haptics.modifier(); model.openPicker() } label: {
                    TokenBadge(symbol: model.symbol, logo: model.isAddress ? model.assetLogo : nil, chevron: true)
                }
                .buttonStyle(Press())
                .accessibilityLabel("Pick a token")
            }
            Spacer(minLength: 6)
            if model.payingETH {
                Text("Swap").font(TradeFont.body).foregroundStyle(Kallr.muted)
            } else {
                Button {
                    Haptics.modifier()
                    withAnimation(.easeOut(duration: 0.18)) { model.advancedOpen.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Text(model.optionsSummary).font(TradeFont.body).lineLimit(1).minimumScaleFactor(0.6)
                        Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                            .rotationEffect(.degrees(model.advancedOpen ? 180 : 0))
                    }
                    .foregroundStyle(model.advancedOpen ? Kallr.lime : Kallr.muted)
                    .frame(minHeight: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(Press())
                .accessibilityLabel("Options: order type, take profit and stop loss")
            }
        }
    }

    private var reviewTitle: String {
        if model.payingETH { return "Review swap" }
        switch model.kind {
        case .market: return "Review buy"
        case .limit: return "Review limit buy"
        case .twap: return "Review TWAP buy"
        }
    }
}

/** The amount, big; what it gets and the balance under it. Tap to type; MAX fills what you can spend. */
private struct AmountLine: View {
    @ObservedObject var model: KeyboardModel
    let editing: Bool
    @State private var blink = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("$" + (model.usd.isEmpty ? "0" : model.usd))
                    .font(TradeFont.big)
                    .foregroundStyle(model.usd.isEmpty ? Kallr.muted : Kallr.bone)
                    .lineLimit(1).minimumScaleFactor(0.5)
                    .background(editing && model.freshEntry ? Kallr.lime.opacity(0.22) : .clear, in: RoundedRectangle(cornerRadius: 6))
                if editing {
                    Rectangle().fill(Kallr.lime).frame(width: 3, height: 34).opacity(blink ? 1 : 0)
                        .onAppear { withAnimation(.easeInOut(duration: 0.5).repeatForever()) { blink = true } }
                }
                Spacer(minLength: 8)
                if !editing {
                    Button { Haptics.modifier(); model.useMax() } label: {
                        Text("Max").font(TradeFont.bold).foregroundStyle(Kallr.lime)
                            .frame(minWidth: 44, minHeight: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(Press())
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { if !editing { model.startTyping() } }
            Text(model.amountSubline).font(TradeFont.body).foregroundStyle(Kallr.muted).lineLimit(1)
        }
    }
}

/** Advanced, folded under Options: the order type, then take-profit and stop-loss. */
private struct AdvancedPanel: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            row("Order") {
                ForEach(KeyboardModel.Kind.allCases, id: \.self) { k in
                    MiniChip(label: k.rawValue, on: model.kind == k) {
                        withAnimation(.easeOut(duration: 0.18)) { model.kind = k }
                    }
                }
            }
            if model.kind == .limit {
                row("Buy at") {
                    ForEach([-1.0, -3, -5, -10], id: \.self) { p in
                        MiniChip(label: "−\(Kallr.fmt(-p))%", on: model.limitPct == p) { model.limitPct = p }
                    }
                }
            }
            if model.kind == .twap {
                row("Over") {
                    ForEach([(10, "10m"), (60, "1h"), (240, "4h"), (720, "12h")], id: \.0) { m in
                        MiniChip(label: m.1, on: model.twapMinutes == m.0) { model.twapMinutes = m.0 }
                    }
                }
            }
            row("Profit") {
                MiniChip(label: "Off", on: !model.exitsOn) { model.exitsOn = false }
                ForEach([5.0, 10, 20, 50], id: \.self) { p in
                    MiniChip(label: "+\(Kallr.fmt(p))%", on: model.exitsOn && model.tpPct == p) { model.exitsOn = true; model.tpPct = p }
                }
                if model.exitsOn, ![5.0, 10, 20, 50].contains(model.tpPct) {
                    MiniChip(label: "+\(Kallr.fmt(model.tpPct))%", on: true) {}
                }
            }
            if model.exitsOn {
                row("Stop") {
                    ForEach([3.0, 5, 10, 20], id: \.self) { p in
                        MiniChip(label: "−\(Kallr.fmt(p))%", on: model.slPct == p, danger: true) { model.slPct = p }
                    }
                    if ![3.0, 5, 10, 20].contains(model.slPct) {
                        MiniChip(label: "−\(Kallr.fmt(model.slPct))%", on: true, danger: true) {}
                    }
                }
                if let line = model.exitsPriceLine {
                    Text(line).font(TradeFont.body).foregroundStyle(Kallr.muted).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        }
    }

    private func row<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 6) {
            Text(label).font(TradeFont.body).foregroundStyle(Kallr.muted).frame(width: 54, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 6) { content() } }
                .modifier(NoEdgeBlur())
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
            Text(label).font(TradeFont.body.monospacedDigit())
                .foregroundStyle(on ? Kallr.black : Kallr.bone)
                .padding(.horizontal, 12)
                .frame(maxWidth: wide ? .infinity : nil, minHeight: 34)
                .background(on ? (danger ? Kallr.danger : Kallr.lime) : Kallr.keyDark, in: Capsule())
        }
        .buttonStyle(Press())
    }
}

/**
 * The review, as a swap: you pay → you get, one line from Definitive, then Confirm. The estimates and
 * the steps on Base fold under Details. While it places, the button says so.
 */
private struct ReviewCard: View {
    @ObservedObject var model: KeyboardModel
    let quote: Kallr.Placed?
    @State private var details = false
    @State private var sweep: CGFloat = 0

    private var paySymbol: String { model.payingETH ? "ETH" : "USDC" }
    private var getSymbol: String { model.payingETH ? "USDC" : model.symbol }
    private var getLogo: URL? { model.payingETH || !model.isAddress ? nil : model.assetLogo }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(quote == nil ? "Placing on Base" : "Review").font(TradeFont.bold).foregroundStyle(Kallr.muted)
                Spacer()
                if quote != nil {
                    Button { Haptics.modifier(); withAnimation(.easeOut(duration: 0.18)) { details.toggle() } } label: {
                        HStack(spacing: 4) {
                            Text("Details").font(TradeFont.body)
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).rotationEffect(.degrees(details ? 180 : 0))
                        }
                        .foregroundStyle(details ? Kallr.lime : Kallr.muted)
                        .frame(minHeight: 32)
                    }
                    .buttonStyle(Press())
                }
            }
            .padding(.horizontal, 14)
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 12) {
                    leg("You pay", symbol: paySymbol, logo: nil, amount: quote.map { ReviewCard.clean($0.preview.pay) } ?? "$\(model.usd)")
                    leg("You get", symbol: getSymbol, logo: getLogo, amount: quote.map { ReviewCard.clean($0.preview.get) } ?? "…")
                    if details, let quote { detailLines(quote) }
                    Label("Definitive Flash · best price", systemImage: "checkmark.seal.fill")
                        .font(TradeFont.body).foregroundStyle(Kallr.lime)
                }
                .padding(.horizontal, 14)
                .padding(.top, 10)
            }
            .modifier(NoEdgeBlur())
            if quote == nil { progress }
            buttons
        }
        .padding(.top, 6)
    }

    private func leg(_ label: String, symbol: String, logo: URL?, amount: String) -> some View {
        HStack(spacing: 12) {
            TokenIcon(symbol: symbol, logo: logo, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(TradeFont.body).foregroundStyle(Kallr.muted)
                Text(amount).font(TradeFont.mid).foregroundStyle(Kallr.bone).lineLimit(1).minimumScaleFactor(0.5)
            }
        }
    }

    @ViewBuilder private func detailLines(_ q: Kallr.Placed) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let impact = q.details?.impactPct { line("Price impact", String(format: "%.2f%%", abs(impact))) }
            if let fee = q.details?.feeUsd { line("Fee", fee < 0.005 ? "None" : String(format: "$%.2f", fee)) }
            line("On Base", ReviewCard.steps(q.preview.approval))
            if q.preview.exits != "None", !q.preview.exits.isEmpty { line("Exits", q.preview.exits) }
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(Kallr.muted)
            Spacer()
            Text(value).foregroundStyle(Kallr.bone).lineLimit(1).minimumScaleFactor(0.7)
        }
        .font(TradeFont.body.monospacedDigit())
    }

    /** A thin lime sweep while Flash places the order. */
    private var progress: some View {
        GeometryReader { g in
            Capsule().fill(Kallr.lime).frame(width: g.size.width * 0.3, height: 3)
                .offset(x: sweep * g.size.width * 0.7)
                .onAppear { withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { sweep = 1 } }
        }
        .frame(height: 3)
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private var buttons: some View {
        HStack(spacing: 8) {
            Button { model.tap(); model.placing = .idle } label: {
                Image(systemName: "chevron.left").font(.system(size: 18, weight: .bold)).foregroundStyle(Kallr.bone)
                    .frame(width: 56, height: 52)
                    .background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(Press())
            .disabled(quote == nil)
            .accessibilityLabel("Back")
            Button { model.confirm() } label: {
                HStack(spacing: 8) {
                    if quote == nil { ProgressView().tint(Kallr.black) }
                    Text(quote == nil ? "Placing on Flash…" : model.payingETH ? "Confirm swap" : "Confirm buy")
                        .font(TradeFont.bold)
                }
                .foregroundStyle(Kallr.black)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(Press())
            .disabled(quote == nil)
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
    }

    static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "up to about ", with: "≤ ").replacingOccurrences(of: "about ", with: "≈ ")
    }
    /** What runs on Base before the order: a wrap, an approval, or nothing. */
    static func steps(_ approval: String) -> String {
        if approval.hasPrefix("Wrap") { return "Wrap + approve" }
        if approval == "Not needed" { return "Ready" }
        return "Approve " + (approval.contains("WETH") ? "WETH" : "USDC")
    }
}

/**
 * Chainlink CRE says the contract isn't the coin the post names: why, the real one, CRE's signed verdict to
 * share, and no Trade button at all.
 */
private struct FakeCoinCard: View {
    @ObservedObject var model: KeyboardModel
    let verdict: Kallr.CreVerdict

    private var realOne: String? {
        guard let c = verdict.canonical, c.count == 42, c != "0x0000000000000000000000000000000000000000" else { return nil }
        return "The real $\(verdict.claimed ?? "") is \(c.prefix(6))…\(c.suffix(4))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Label("Fake token · checked by Chainlink CRE", systemImage: "xmark.octagon.fill")
                    .font(TradeFont.bold).foregroundStyle(Kallr.danger)
                Text("$\(verdict.claimed ?? verdict.symbol ?? "?")").font(TradeFont.mid).foregroundStyle(Kallr.bone)
                Text(verdict.reason ?? "This contract isn't the coin the post names.").font(TradeFont.body).foregroundStyle(Kallr.bone)
                    .fixedSize(horizontal: false, vertical: true)
                if let realOne { Text(realOne).font(TradeFont.body).foregroundStyle(Kallr.muted) }
                Text("Trading is off for this post.").font(TradeFont.body).foregroundStyle(Kallr.muted)
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Button { model.shareCreProof() } label: {
                    Text("Share the signed verdict").font(TradeFont.bold)
                        .foregroundStyle(verdict.proof == nil ? Kallr.muted : Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(verdict.proof == nil ? Kallr.keyDark : Kallr.danger, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(Press())
                .disabled(verdict.proof == nil)
                Button {
                    model.tap()
                    model.clearCre()
                    model.copied = nil
                    model.source = nil
                } label: {
                    Text("Close").font(TradeFont.bold).foregroundStyle(Kallr.bone)
                        .frame(width: 96, height: 52)
                        .background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(Press())
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
    }
}

/** Placed: what you got, on Definitive Flash, and its BaseScan link to drop into the chat. */
private struct DoneCard: View {
    @ObservedObject var model: KeyboardModel
    let placed: Kallr.Placed
    @State private var pop = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            ZStack {
                Circle().fill(Kallr.lime).frame(width: 52, height: 52).scaleEffect(pop ? 1 : 0.6)
                Image(systemName: "checkmark").font(.system(size: 22, weight: .black)).foregroundStyle(Kallr.black)
            }
            .onAppear { withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) { pop = true } }
            .padding(.bottom, 14)
            Text(ReviewCard.clean(placed.preview.get)).font(TradeFont.mid).foregroundStyle(Kallr.bone)
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(model.fillTx.map { "Filled on Base · \($0.prefix(6))…\($0.suffix(4))" } ?? "\(placed.preview.title) · Definitive Flash")
                .font(TradeFont.body).foregroundStyle(Kallr.muted).lineLimit(1).minimumScaleFactor(0.8)
                .padding(.top, 4)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Button { model.shareReceipt() } label: {
                    Text(model.fillTx == nil ? "Finding it on Base…" : "Share BaseScan link")
                        .font(TradeFont.bold).foregroundStyle(model.fillTx == nil ? Kallr.muted : Kallr.black)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(model.fillTx == nil ? Kallr.keyDark : Kallr.lime, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(Press())
                .disabled(model.fillTx == nil)
                Button { model.tap(); model.placing = .idle } label: {
                    Text("New trade").font(TradeFont.bold).foregroundStyle(Kallr.bone)
                        .frame(width: 112, height: 52)
                        .background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(Press())
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
        }
    }
}

/** The coin's live price every 4 seconds: it flashes as it ticks, with the 24h move and a sparkline. */
private struct LiveTicker: View {
    @ObservedObject var model: KeyboardModel
    @State private var flash = false

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(model.live == nil ? Kallr.muted : Kallr.up).frame(width: 6, height: 6).opacity(flash ? 0.3 : 1)
            if let live = model.live {
                Text("\(model.payingETH ? "ETH" : model.symbol) $\(Self.tick(live.price))")
                    .font(TradeFont.body.monospacedDigit())
                    .foregroundStyle(flash ? (model.tickMove >= 0 ? Kallr.up : Kallr.danger) : Kallr.bone)
                    .contentTransition(.numericText(value: live.price))
                    .lineLimit(1)
                if let c = live.change24h {
                    Text(String(format: "%@%.2f%%", c >= 0 ? "+" : "−", abs(c)))
                        .font(TradeFont.body.monospacedDigit())
                        .foregroundStyle(c >= 0 ? Kallr.up : Kallr.danger).lineLimit(1)
                }
            } else {
                Text("\(model.payingETH ? "ETH" : model.symbol) · live price…").font(TradeFont.body).foregroundStyle(Kallr.muted)
            }
            Spacer(minLength: 4)
            Sparkline(values: model.ticks).frame(width: 64, height: 16)
        }
        .onChange(of: model.live?.price) { _, _ in
            withAnimation(.easeOut(duration: 0.15)) { flash = true }
            withAnimation(.easeIn(duration: 0.6).delay(0.25)) { flash = false }
        }
    }

    /** Cents on a ticker so a move shows: 2,225.43 · 90.52 · 0.000123. */
    static func tick(_ v: Double) -> String {
        guard v >= 1 else { return KeyboardModel.money(v) }
        return v.formatted(.number.precision(.fractionLength(2)).locale(Locale(identifier: "en_US")))
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
        HStack(spacing: 6) {
            TokenIcon(symbol: symbol, logo: logo, size: 24)
            Text(symbol).font(.system(size: 14, weight: .heavy)).foregroundStyle(selected ? Kallr.bone : Kallr.muted).lineLimit(1)
            if chevron { Image(systemName: "chevron.down").font(.system(size: 11, weight: .heavy)).foregroundStyle(Kallr.muted) }
        }
        .padding(.leading, 6).padding(.trailing, 12).frame(height: 40)
        .fixedSize()
        .background(selected ? Kallr.keyDark : .clear, in: Capsule())
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
        VStack(spacing: 8) {
            HStack(alignment: .top) {
                AmountLine(model: model, editing: true)
                Button { model.tap(.medium); model.freshEntry = false; model.editingAmount = false } label: {
                    Text("Done").font(.system(size: 14, weight: .heavy)).foregroundStyle(Kallr.black)
                        .frame(width: 72, height: 44).background(Kallr.lime, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(Press())
            }
            HStack(spacing: 6) {
                ForEach(["5", "10", "25"], id: \.self) { a in
                    MiniChip(label: "$\(a)", on: model.usd == a, wide: true) { model.usd = a; model.freshEntry = false }
                }
                MiniChip(label: "Max", on: false, wide: true) { model.useMax() }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(keys, id: \.self) { k in
                    Button { model.keypad(k) } label: {
                        Group { if k == "⌫" { Image(systemName: "delete.left") } else { Text(k) } }
                            .font(.system(size: 22, weight: .medium)).foregroundStyle(Kallr.bone)
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(Kallr.keyDark.opacity(k == "⌫" || k == "." ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(Press())
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 8)
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
