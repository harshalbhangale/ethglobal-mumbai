// Kallr's server client and look, shared by the app and the keyboard. It speaks the same
// /api/keyboard API as the Android keyboard (kallr-keyboard/.../KallrClient.kt).

import Foundation
import SwiftUI

enum Kallr {
    static let origin = URL(string: "https://kallr.vercel.app")!

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
    private static let orderStart = try! NSRegularExpression(pattern: #"\b(copy|buy|long|sell|short)\b"#, options: .caseInsensitive)
    private static let orderSize = try! NSRegularExpression(pattern: #"\$\s*\d|\bmy\s+\$?[a-z]|\d+\s*(?:bucks|usd|dollars?)\b"#, options: .caseInsensitive)

    private static func first(_ regex: NSRegularExpression, in text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        guard let m = regex.firstMatch(in: text, range: range), let r = Range(m.range, in: text) else { return nil }
        return String(text[r])
    }

    /** A copied post link, or a copied message that names a coin. Anything else stays on the phone. */
    static func reference(fromCopied text: String?) -> String? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        if let link = first(postLink, in: text) { return link }
        if first(cashtag, in: text) != nil || first(evmAddress, in: text) != nil { return String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(600)) }
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
    struct Trade: Codable { let token: String; let symbol: String; let price: Double }
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
            return nil
        }
    }

    private struct Request: Codable { let text: String?; let typed: String?; let history: [Post] }

    /** Ask Kallr about a copied call or an order being typed. Nil when there's nothing to say or no network. */
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
}
