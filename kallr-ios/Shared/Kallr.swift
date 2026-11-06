// Kallr's server client and look, shared by the app and the keyboard. It speaks the same
// /api/keyboard API as the Android keyboard (kallr-keyboard/.../KallrClient.kt).

import Foundation
import SwiftUI
import Security
import UIKit

enum Kallr {
    static let origin: URL = {
        #if DEBUG
        // Debug builds can point at a local server: defaults write <bundle id> kall.origin http://localhost:3004
        if let local = UserDefaults.standard.string(forKey: "kall.origin"), let url = URL(string: local) { return url }
        #endif
        return URL(string: "https://kallmarkets.vercel.app")!
    }()

    // MARK: Look: Kallr black, bone and lime.
    static let black = Color(red: 0.039, green: 0.039, blue: 0.039)
    static let graphite = Color(red: 0.102, green: 0.102, blue: 0.102)
    static let keyDark = Color(red: 0.169, green: 0.169, blue: 0.169)
    static let hairline = Color(red: 0.165, green: 0.165, blue: 0.165)
    static let bone = Color(red: 0.925, green: 0.925, blue: 0.894)
    static let muted = Color(red: 0.557, green: 0.557, blue: 0.525)
    static let lime = Color(red: 0.800, green: 0.949, blue: 0.353)
    static let danger = Color(red: 1.0, green: 0.541, blue: 0.478)

    // MARK: What we send: an X post link, a message naming a coin, or an order being typed.
    private static let postLink = try! NSRegularExpression(pattern: #"https://(?:www\.)?(?:x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,20}"#)
    private static let evmAddress = try! NSRegularExpression(pattern: #"(?<![A-Za-z0-9])0x[0-9a-fA-F]{40}(?![A-Za-z0-9])"#)
    private static let cashtag = try! NSRegularExpression(pattern: #"(?<![A-Za-z0-9$])\$[A-Za-z][A-Za-z0-9]{1,9}\b"#)
    /** A Telegram-style tag for a coin or pair: #SOL, #SOLUSDT, #Bitcoin. */
    private static let hashtag = try! NSRegularExpression(pattern: #"(?<![A-Za-z0-9#&])#[A-Za-z][A-Za-z0-9]{1,14}\b"#)
    private static let orderStart = try! NSRegularExpression(pattern: #"\b(copy|buy|long|sell|short)\b"#, options: .caseInsensitive)
    private static let orderSize = try! NSRegularExpression(pattern: #"\$\s*\d|\bmy\s+\$?[a-z]|\d+\s*(?:bucks|usd|dollars?)\b"#, options: .caseInsensitive)

    private static func first(_ regex: NSRegularExpression, in text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        guard let m = regex.firstMatch(in: text, range: range), let r = Range(m.range, in: text) else { return nil }
        return String(text[r])
    }

    /**
     * What's copied, as text, whatever form the copying app stored it in (UTF-8, plain text or older
     * encodings), so a call copied anywhere reads the same.
     */
    static func copiedText() -> String? {
        #if DEBUG
        // The simulator's clipboard doesn't reach keyboard extensions: debug builds can stand one in.
        // xcrun simctl spawn booted defaults write com.buddyharshal.kallr.keyboard kall.debugClipboard "…"
        if let stand = UserDefaults.standard.string(forKey: "kall.debugClipboard"), !stand.isEmpty { return stand }
        #endif
        let pasteboard = UIPasteboard.general
        if let s = pasteboard.string, !s.isEmpty { return s }
        if let s = pasteboard.strings?.first(where: { !$0.isEmpty }) { return s }
        for item in pasteboard.items {
            for (type, value) in item {
                if let s = value as? String, !s.isEmpty { return s }
                if let d = value as? Data, type.contains("text"),
                   let s = String(data: d, encoding: .utf8) ?? String(data: d, encoding: .macOSRoman), !s.isEmpty { return s }
            }
        }
        return nil
    }

    /** A copied post link, or a copied message that names a coin. Anything else stays on the phone. */
    static func reference(fromCopied text: String?) -> String? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        if let link = first(postLink, in: text) { return link }
        if first(cashtag, in: text) != nil || first(hashtag, in: text) != nil || first(evmAddress, in: text) != nil {
            return String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1500))
        }
        return nil
    }

    /** The order phrase at the end of the line being typed, e.g. "buy $20 of eth tp 10% sl 5%". */
    static func typedOrder(_ before: String?) -> String? {
        guard let before else { return nil }
        let line = before.components(separatedBy: "\n").last ?? ""
        let matches = orderStart.matches(in: line, range: NSRange(line.startIndex..., in: line))
        guard let last = matches.last, let r = Range(last.range, in: line) else { return nil }
        let candidate = String(line[r.lowerBound...]).trimmingCharacters(in: .whitespaces)
        return first(orderSize, in: candidate) != nil ? String(candidate.prefix(200)) : nil
    }

    // MARK: Server

    struct Post: Codable { let postId: String; let handle: String }
    struct Call: Codable { let line: String; let asset: String; let direction: String }
    struct Record: Codable { let line: String }
    struct Token: Codable { let address: String; let symbol: String?; let warnings: [String]?; let line: String }
    struct Trade: Codable { let token: String; let symbol: String; let price: Double; let logo: String? }
    struct AI: Codable { let summary: String; let symbol: String?; let direction: String? }
    struct Fake: Codable { let claimed: String; let contract: String; let real: String }
    struct Prefill: Codable { let kind: String?; let usd: Double?; let tpPct: Double?; let slPct: Double? }

    struct Result: Codable {
        let post: Post?
        let call: Call?
        let record: Record?
        let token: Token?
        let trade: Trade?
        let ai: AI?
        let fake: Fake?
        let prefill: Prefill?

        /** The red line, if any: a fake contract or a risky token. */
        var warning: String? {
            if let fake { return "Fake $\(fake.claimed) contract, not the real one. Don't buy it." }
            if let w = token?.warnings?.first { return "\(token?.symbol ?? "Token"): \(w)" }
            return nil
        }

        /** One line for the row above the keys. */
        func headline(typed: String?) -> String? {
            if let warning { return warning }
            if call == nil, let ai { return ai.direction == nil ? ai.summary : "Trade it · \(ai.summary)" }
            if let call { return "Trade @\(post?.handle ?? "this")'s call · \(call.line)" }
            if let post, let trade { return "Trade @\(post.handle)'s $\(trade.symbol) call" }
            if let post { return "@\(post.handle): not a call we can price" }
            if let typed { return "Trade it: \(typed)" }
            if let trade { return "Trade $\(trade.symbol) from what you copied" }
            return nil
        }
    }

    private struct Request: Codable { let text: String?; let typed: String?; let history: [Post] }

    /** Ask Kallr about a copied call or an order being typed. Nil when there's nothing to say or no network. */
    // MARK: Chainlink CRE

    /** Chainlink CRE's signed verdict on a coin a post names: is that contract really the coin? */
    struct CreVerdict: Codable {
        let checked: Bool
        let verdict: String?
        let reason: String?
        let symbol: String?
        let claimed: String?
        let canonical: String?
        let txHash: String?
        let canRun: Bool?
        var isFake: Bool { checked && verdict == "fake" }
        var isReal: Bool { checked && verdict == "real" }
        /** The signed verdict on Base Sepolia. */
        var proof: String? { txHash.map { "https://sepolia.basescan.org/tx/\($0)" } }
    }

    /** The coin a message names and the contract it gives: "$TOSHI … 0x8544…" → (0x8544…, TOSHI). */
    static func creTarget(in text: String) -> (token: String, claimed: String)? {
        guard let tag = first(cashtag, in: text), let address = first(evmAddress, in: text) else { return nil }
        return (address, String(tag.dropFirst()).uppercased())
    }

    /** From a looked-up post: the contract it gives and the ticker it names. */
    static func creTarget(_ r: Result) -> (token: String, claimed: String)? {
        guard let token = r.token?.address, let claimed = r.fake?.claimed ?? r.call?.asset ?? r.ai?.symbol else { return nil }
        return (token, claimed.replacingOccurrences(of: "$", with: "").uppercased())
    }

    /** What CRE already decided for this contract and ticker, if it has looked. */
    static func creVerdict(token: String, claimed: String) async -> CreVerdict? {
        await get("api/cre/coin?token=\(token)&claimed=\(claimed)")
    }

    /** Asks CRE to check it now (about 10 seconds), where the server can run it. */
    static func runCre(token: String, claimed: String) async -> CreVerdict? {
        var request = URLRequest(url: origin.appendingPathComponent("api/cre/coin"), timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "claimed": claimed])
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(CreVerdict.self, from: data)
    }

    static func lookup(text: String?, typed: String?) async -> Result? {
        guard text != nil || typed != nil else { return nil }
        var request = URLRequest(url: origin.appendingPathComponent("api/keyboard"), timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(Request(text: text, typed: typed, history: []))
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(Result.self, from: data)
    }

    /**
     * The Kallr order page with the order filled in. It signs with the same Privy wallet as the desk
     * and the Android keyboard, and records the trade on Arkiv as a keyboard trade.
     */
    static func deskURL(usd: String, asset: String, tp: Double?, sl: Double?, post: Post?) -> URL {
        var order = "copy $\(usd) of \(asset)"
        if let tp, let sl { order += " tp \(fmt(tp))% sl \(fmt(sl))%" }
        var c = URLComponents(url: origin.appendingPathComponent("app"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "order", value: order), URLQueryItem(name: "src", value: "keyboard")]
        if let post { items += [URLQueryItem(name: "post", value: post.postId), URLQueryItem(name: "caller", value: post.handle)] }
        c.queryItems = items
        return c.url!
    }

    static func fmt(_ v: Double) -> String { v.rounded() == v ? String(Int(v)) : String(v) }

    static let up = Color(red: 0.541, green: 0.851, blue: 0.486)

    /** "2h ago", "5m ago" since a post. */
    static func ago(_ t: Double?) -> String {
        guard let t else { return "" }
        let s = Date().timeIntervalSince1970 - t
        if s < 3600 { return "\(max(1, Int(s / 60)))m ago" }
        if s < 86400 { return "\(Int(s / 3600))h ago" }
        return "\(Int(s / 86400))d ago"
    }

    /** "3h left", "40m left" until a call's deadline. */
    static func left(_ deadline: Double?) -> String {
        guard let deadline else { return "" }
        let s = deadline - Date().timeIntervalSince1970
        if s <= 0 { return "settling" }
        return s >= 3600 ? "\(Int(s / 3600))h left" : "\(max(1, Int(s / 60)))m left"
    }

    // MARK: Calls feed (Arkiv, read by the server)

    struct FeedCall: Codable { let postId: String; let caller: String; let asset: String; let direction: String; let postedAt: Double?; let deadline: Double?; let entry: Double?; let text: String?; let key: String? }
    struct FeedResult: Codable { let postId: String; let caller: String; let asset: String; let direction: String?; let status: String; let returnBps: Int?; let postedAt: Double?; let text: String?; let key: String? }
    /** A caller Kall Markets tracks or has priced, with their record. */
    struct FeedCaller: Codable { let handle: String; let focus: String?; let tracked: Bool; let open: Int; let settled: Int; let hits: Int; let hitRate: Double? }
    struct FeedTrade: Codable { let flashOrderId: String; let caller: String?; let key: String? }
    struct Feed: Codable {
        let following: [String]
        let prices: [String: Double?]
        let calls: [FeedCall]
        let results: [FeedResult]
        let trades: [FeedTrade]?
        let callers: [FeedCaller]?
    }

    static func feed() async -> Feed? { await get("api/keyboard/feed") }

    /** One caller's record from Arkiv (/api/callers/<handle>): every call, open and settled, newest first. */
    struct CallerRecord: Codable {
        struct Call: Codable, Identifiable {
            let key: String?
            let postId: String
            let asset: String
            let direction: String
            let status: String
            let returnBps: Int?
            let postedAt: Double?
            let expiresAt: Double?
            /** The post is no longer public on X. */
            var gone: Bool? = nil
            var id: String { postId }
            var open: Bool { status == "open" }
            var short: Bool { direction == "down" }
        }
        let calls: [Call]
        /** How many of the checked posts are gone from X, and how many X answered for. */
        let deleted: Int?
        let deletedChecked: Int?
    }

    static func callerRecord(_ handle: String) async -> CallerRecord? { await get("api/callers/\(handle.lowercased())") }

    /** The call's post on X. */
    static func postURL(handle: String, postId: String) -> URL? { URL(string: "https://x.com/\(handle)/status/\(postId)") }

    /** A record's page on Arkiv's Rabdi explorer: a call, its result or a trade. */
    static func arkivURL(_ key: String) -> URL? { URL(string: "https://rabdi.explorer.arkiv.network/entity/\(key)") }
    /** 0x4b9d…0ed1: a hash short enough for one line. */
    static func shortHash(_ h: String) -> String { h.count > 14 ? "\(h.prefix(6))…\(h.suffix(4))" : h }

    // MARK: The Kall keyboard wallet

    struct Wallet: Codable {
        struct Balances: Codable { let eth: String; let usdc: String }
        let configured: Bool
        let address: String?
        /** "kall" for your own linked Kall wallet, "shared" for the old shared keyboard wallet. */
        var wallet: String? = nil
        let maxUsd: Double?
        let balances: Balances?
        var usdcValue: Double? { balances.flatMap { Double($0.usdc) } }
        /** More than dust: worth moving (ETH beyond what a transfer's gas costs). */
        var holdsFunds: Bool { (usdcValue ?? 0) >= 0.01 || (ethValue ?? 0) > 0.0001 }
        var ethValue: Double? { balances.flatMap { Double($0.eth) } }
    }

    static func wallet() async -> Wallet? { await get("api/keyboard/execute") }
    /** The old shared keyboard wallet, whatever is linked: what's left to move to your Kall wallet. */
    static func sharedWallet() async -> Wallet? { await get("api/keyboard/execute", linked: false) }

    // MARK: Your Kall wallet, linked

    /**
     * The key from linking your Kall wallet (the Privy wallet you got signing in with X, the same one the
     * web app and X use): the web app's /app/keyboard-link sends it back as kallmarkets://link?key=…&address=…
     * &expires=…. Kept in a keychain group the app and the keyboard share.
     */
    struct Link: Codable {
        let key: String
        let address: String
        /** Unix milliseconds. */
        let expires: Double
        var live: Bool { expires > Date().timeIntervalSince1970 * 1000 }
    }

    static var link: Link? {
        guard let data = SharedKeychain.read("kall.link"), let l = try? JSONDecoder().decode(Link.self, from: data), l.live else { return nil }
        return l
    }

    /** Where linking starts: sign in with X, allow Kall's signer once, come back to the app. */
    static var linkPage: URL { origin.appendingPathComponent("app/keyboard-link") }

    /** Saves the link from kallmarkets://link…; false when the URL isn't one. */
    @discardableResult
    static func handleLink(_ url: URL) -> Bool {
        guard url.scheme == "kallmarkets", url.host == "link",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let key = value("key"), !key.isEmpty, let address = value("address"),
              address.range(of: "^0x[0-9a-fA-F]{40}$", options: .regularExpression) != nil,
              let expires = value("expires").flatMap(Double.init) else { return false }
        guard let data = try? JSONEncoder().encode(Link(key: key, address: address, expires: expires)) else { return false }
        return SharedKeychain.write("kall.link", data)
    }

    static func unlink() { SharedKeychain.delete("kall.link") }

    /** What keyboard trades sign with: your Kall wallet's key once linked, else this build's token (the old shared wallet). */
    static var bearer: String { link?.key ?? Secrets.execToken }

    /** Reading the Kall wallet, with why it failed, so the keyboard never sits on "Reading…". */
    enum WalletRead { case ok(Wallet), notSetUp, failed(String), cancelled }

    static func readWallet() async -> WalletRead {
        guard let url = URL(string: "api/keyboard/execute", relativeTo: origin) else { return .failed("bad address") }
        do {
            let (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15))
            guard let http = response as? HTTPURLResponse else { return .failed("no answer from Kall Markets") }
            guard (200..<300).contains(http.statusCode) else { return .failed("Kall Markets answered \(http.statusCode)") }
            guard let w = try? JSONDecoder().decode(Wallet.self, from: data) else { return .failed("unexpected answer from Kall Markets") }
            return w.configured && w.address != nil ? .ok(w) : .notSetUp
        } catch let e as URLError where e.code == .cancelled {
            return .cancelled
        } catch is CancellationError {
            return .cancelled
        } catch let e as URLError where e.code == .notConnectedToInternet || e.code == .networkConnectionLost {
            return .failed("no internet connection")
        } catch let e as URLError where e.code == .timedOut {
            return .failed("Kall Markets took too long")
        } catch let e as URLError where [.cannotConnectToHost, .cannotFindHost, .dnsLookupFailed].contains(e.code) {
            return .failed("can't reach Kall Markets")
        } catch {
            let why = error.localizedDescription
            return .failed(why.hasSuffix(".") ? String(why.dropLast()) : why)
        }
    }

    struct KeyboardOrder: Codable {
        let token: String
        let kind: String
        let usd: String
        var limitPct: Double? = nil
        var twapMinutes: Int? = nil
        let tpPct: Double?
        let slPct: Double?
        let postId: String?
        let caller: String?
    }
    struct Preview: Codable { let title: String; let kind: String; let pay: String; let get: String; let exits: String; let approval: String }
    struct Details: Codable { let impactPct: Double?; let slippagePct: Double?; let feeUsd: Double? }

    /** One token's live price on Base and its 24h move, for the keyboard's ticker. */
    struct LivePrice: Codable {
        let symbol: String
        let price: Double
        let change24h: Double?
        let source: String
    }

    /** `key` is ETH, BTC or a token's contract address. */
    static func livePrice(_ key: String) async -> LivePrice? { await get("api/tokens/price?key=\(key)") }
    /** A dry run (the review card) or a placed order. */
    struct Placed: Codable { let orderId: String?; let preview: Preview; let details: Details?; let approvals: [String]? }

    /** A Base token from Definitive's search (symbol, name or contract address). */
    struct TokenHit: Codable, Identifiable {
        let address: String
        let symbol: String
        let name: String?
        let price: String?
        let liquidity: String?
        let change24h: String?
        let imageUrl: String?
        let riskFlagged: Bool?
        var id: String { address }
        var priceValue: Double? { price.flatMap(Double.init) }
        var logo: URL? { imageUrl.flatMap(URL.init(string:)) }
        /** "Liq $1.2M", from Definitive's liquidity figure. */
        var detail: String? {
            liquidity.flatMap(Double.init).map { "Liq $" + Kallr.compact($0) }
        }
    }

    /** 1.2M, 340K, 2.1B: the same in every locale (not lakh or crore). */
    static func compact(_ v: Double) -> String {
        if v >= 1e9 { return String(format: "%.1fB", v / 1e9) }
        if v >= 1e6 { return String(format: "%.1fM", v / 1e6) }
        if v >= 1e3 { return String(format: "%.0fK", v / 1e3) }
        return String(format: "%.0f", v)
    }

    static func searchTokens(_ q: String) async -> [TokenHit]? {
        struct Body: Codable { let tokens: [TokenHit] }
        guard let encoded = q.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return nil }
        let body: Body? = await get("api/tokens/search?q=\(encoded)")
        return body?.tokens
    }
    private struct ExecuteBody: Codable { let order: KeyboardOrder; let dryRun: Bool }

    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }

    /**
     * Place an order from the Kall keyboard wallet: the server quotes, approves, signs and submits on
     * Flash. With dryRun it gets a fresh quote and signs, but sends nothing: the review card.
     */
    static func execute(_ order: KeyboardOrder, dryRun: Bool = false) async -> Swift.Result<Placed, Failure> {
        await place("api/keyboard/execute", ExecuteBody(order: order, dryRun: dryRun))
    }

    private struct SwapBody: Codable { let usd: String; let dryRun: Bool }

    /**
     * Swap the Kall wallet's ETH to USDC on Flash, keeping about $1 of ETH for gas. With dryRun it gets
     * a fresh quote and signs, but sends nothing.
     */
    static func swap(usd: String, dryRun: Bool = false) async -> Swift.Result<Placed, Failure> {
        await place("api/keyboard/swap", SwapBody(usd: usd, dryRun: dryRun))
    }

    /** A withdrawal from the Kall wallet: what goes where, and its transaction once sent. */
    struct Withdrawal: Codable { let asset: String; let amount: String; let to: String; let usd: Double?; let tx: String? }
    private struct WithdrawBody: Codable { let asset: String; let amount: String; let to: String; let dryRun: Bool }

    /**
     * Send ETH or USDC from the old shared keyboard wallet to an address on Base, such as your own Kall
     * wallet once it's linked. With dryRun it only checks. Always the build token: it's that wallet's way out.
     */
    static func withdraw(asset: String, amount: String, to: String, dryRun: Bool) async -> Swift.Result<Withdrawal, Failure> {
        var request = URLRequest(url: origin.appendingPathComponent("api/keyboard/withdraw"), timeoutInterval: 60)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(Secrets.execToken)", forHTTPHeaderField: "authorization")
        request.httpBody = try? JSONEncoder().encode(WithdrawBody(asset: asset, amount: amount, to: to, dryRun: dryRun))
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status), let w = try? JSONDecoder().decode(Withdrawal.self, from: data) { return .success(w) }
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "The withdrawal didn't go through (\(status))."
            return .failure(Failure(message: message))
        } catch {
            return .failure(Failure(message: "Couldn't reach Kall Markets."))
        }
    }

    private static func place<Body: Encodable>(_ path: String, _ body: Body) async -> Swift.Result<Placed, Failure> {
        var request = URLRequest(url: origin.appendingPathComponent(path), timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "authorization")
        request.httpBody = try? JSONEncoder().encode(body)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status), let placed = try? JSONDecoder().decode(Placed.self, from: data) { return .success(placed) }
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "The order didn't go through (\(status))."
            return .failure(Failure(message: message))
        } catch {
            return .failure(Failure(message: "Couldn't reach Kall Markets. Check your connection."))
        }
    }

    /** Cancel an open order the Kall wallet placed: the server signs Flash's cancel message. */
    static func cancel(orderId: String) async -> Swift.Result<Void, Failure> {
        var request = URLRequest(url: origin.appendingPathComponent("api/keyboard/cancel"), timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "authorization")
        request.httpBody = try? JSONEncoder().encode(["orderId": orderId])
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status) { return .success(()) }
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Couldn't cancel (\(status))."
            return .failure(Failure(message: message))
        } catch {
            return .failure(Failure(message: "Couldn't reach Kall Markets."))
        }
    }

    // MARK: Orders on Flash

    struct Order: Codable {
        struct Price: Codable { let notionalPrice: String? }
        struct Bracket: Codable { let status: String; let takeProfit: Price?; let stopLoss: Price? }
        /** What has filled: each asset's amount and the average price in USDC. Empty if Flash sends another shape. */
        struct Filled: Codable {
            var targetAmount: String?
            var contraAmount: String?
            var averagePrice: String?
            init(from decoder: Decoder) throws {
                let c = try? decoder.container(keyedBy: CodingKeys.self)
                targetAmount = try? c?.decodeIfPresent(String.self, forKey: .targetAmount)
                contraAmount = try? c?.decodeIfPresent(String.self, forKey: .contraAmount)
                averagePrice = try? c?.decodeIfPresent(String.self, forKey: .averagePrice)
            }
        }
        let orderId: String
        let orderType: String
        let side: String
        let status: String
        let targetAsset: String
        let qty: String
        let placedAt: String?
        let attachedBracket: Bracket?
        let filled: Filled?
        /** The wallet that placed it: the Kall wallet, or the person's own wallet (X and the web app). */
        let funderAddress: String?
        /** From its Arkiv record, via /api/history: keyboard, extension (X) or desk (web app); nil without one. */
        let source: String?
        let caller: String?
        let postId: String?
        let arkivKey: String?
        /** The coin's symbol when the record names it; Flash only gives the token's address. */
        let assetHint: String?

        /** When Flash took the order, from its ISO timestamp. */
        var placedDate: Date? {
            guard let placedAt else { return nil }
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return f.date(from: placedAt) ?? ISO8601DateFormatter().date(from: placedAt)
        }
        /** "2h ago". */
        var placedAgo: String? { placedDate.map { Kallr.ago($0.timeIntervalSince1970) } }

        var symbol: String {
            if let assetHint, !assetHint.isEmpty { return assetHint }
            switch targetAsset.lowercased() {
            case "0x4200000000000000000000000000000000000006": return "ETH"
            case "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": return "BTC"
            default: return "token"
            }
        }
        var title: String {
            if orderType == "bracket" { return "Exit · sell \(qty) \(symbol)" }
            let kind = orderType == "market" ? "Market" : orderType == "twap" ? "TWAP" : orderType.capitalized
            // Flash sizes buys in USDC and sells in the asset.
            return side == "buy" ? "\(kind) buy · $\(qty) of \(symbol)" : "\(kind) sell · \(qty) \(symbol)"
        }
        /** "Got 0.00489 ETH for $10.00 at $2,045.26", once something has filled. */
        var filledLine: String? {
            guard let f = filled, let got = f.targetAmount.flatMap(Double.init), got > 0 else { return nil }
            let paid = f.contraAmount.flatMap(Double.init).map { String(format: " for $%.2f", $0) } ?? ""
            let at = f.averagePrice.flatMap(Double.init).map { " at $" + $0.formatted(.number.precision(.fractionLength(2))) } ?? ""
            let amount = got.formatted(.number.precision(.significantDigits(1...6)))
            return side == "buy" ? "Got \(amount) \(symbol)\(paid)\(at)" : "Sold \(amount) \(symbol)\(paid)\(at)"
        }
        var open: Bool { ["ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED"].contains(status) }
        var statusLabel: String {
            switch status {
            case "ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED": return "WORKING"
            case "ORDER_STATUS_PARTIALLY_FILLED": return "PART FILLED"
            case "RECORDED": return "ON ARKIV"
            default: return status.replacingOccurrences(of: "ORDER_STATUS_", with: "")
            }
        }
        var exits: String? {
            guard let b = attachedBracket else { return nil }
            let tp = b.takeProfit?.notionalPrice.flatMap(Double.init).map { String(format: "TP $%.2f", $0) }
            let sl = b.stopLoss?.notionalPrice.flatMap(Double.init).map { String(format: "SL $%.2f", $0) }
            return [tp, sl].compactMap { $0 }.joined(separator: " · ")
        }
    }

    static func orders(funder: String) async -> [Order]? {
        struct Body: Codable { let orders: [Order] }
        let body: Body? = await get("api/flash/orders?funder=\(funder)")
        return body?.orders
    }

    /** Every order across these wallets, newest first, each with where it was placed (keyboard, X, web). */
    static func history(wallets: [String]) async -> [Order]? {
        struct Body: Codable { let orders: [Order] }
        guard !wallets.isEmpty else { return nil }
        let body: Body? = await get("api/history?wallets=\(wallets.joined(separator: ","))")
        return body?.orders
    }

    /** How an order filled on Base: each fill's transaction and the venues Flash routed it through. */
    struct Fills: Codable {
        struct Fill: Codable {
            let transactionId: String?
            let venues: [String]?
            let status: String?
            let filledAt: String?
        }
        let status: String?
        let fills: [Fill]
        /** "Uniswap v2", from Flash's "uniswap_v2". */
        var venues: String? {
            let names = Set(fills.flatMap { $0.venues ?? [] }).sorted().map { v in
                v.split(separator: "_").map { w in w.count <= 2 ? String(w) : w.prefix(1).uppercased() + w.dropFirst() }.joined(separator: " ")
            }
            return names.isEmpty ? nil : names.joined(separator: ", ")
        }
        var transaction: String? { fills.compactMap(\.transactionId).first }
    }

    static func fills(orderId: String, funder: String?) async -> Fills? {
        let q = funder.map { "?funder=\($0)" } ?? ""
        return await get("api/flash/orders/\(orderId)\(q)")
    }

    private static func get<T: Decodable>(_ path: String, linked: Bool = true) async -> T? {
        guard let url = URL(string: path, relativeTo: origin) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 20)
        // Keyboard routes act on your own Kall wallet when the request carries its key.
        if linked, path.hasPrefix("api/keyboard/"), let key = link?.key {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")
        }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

/** "Powered by [Definitive] Flash": the Definitive wordmark wherever a quote or an order appears. */
struct PoweredByDefinitive: View {
    var height: CGFloat = 10
    var suffix: String = "Flash · Base"
    var body: some View {
        HStack(spacing: 5) {
            Text("Powered by").font(.system(size: height + 1)).foregroundStyle(Kallr.muted)
            Image("Definitive").resizable().scaledToFit().frame(height: height).accessibilityLabel("Definitive")
            if !suffix.isEmpty { Text(suffix).font(.system(size: height + 1)).foregroundStyle(Kallr.muted) }
        }
    }
}

// MARK: Deposits

/**
 * EIP-681 links that open a wallet app with a transfer to the Kall wallet filled in, on Base (8453).
 * Wallet apps take the ethereum: form.
 */
enum Deposit {
    static let usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

    /** The part after "ethereum:", for USDC (6 decimals) or ETH (wei). */
    static func path(asset: String, to: String, usd: Double, ethPrice: Double?) -> String? {
        if asset == "USDC" {
            return "\(usdc)@8453/transfer?address=\(to)&uint256=\(Int((usd * 1_000_000).rounded()))"
        }
        guard let price = ethPrice, price > 0 else { return nil }
        let microEth = Int((usd / price * 1_000_000).rounded())
        guard microEth > 0 else { return nil }
        return "\(to)@8453?value=\(microEth)000000000000"
    }

    static func anyWallet(_ path: String) -> URL? { URL(string: "ethereum:\(path)") }
}

/** A keychain group the app and the keyboard share (KallKeychainGroup in both Info.plists). */
enum SharedKeychain {
    private static var group: String? { Bundle.main.object(forInfoDictionaryKey: "KallKeychainGroup") as? String }

    private static func query(_ account: String) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: "com.buddyharshal.kallr",
                                kSecAttrAccount as String: account]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    static func read(_ account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    @discardableResult
    static func write(_ account: String, _ data: Data) -> Bool {
        delete(account)
        var q = query(account)
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func delete(_ account: String) { SecItemDelete(query(account) as CFDictionary) }
}
