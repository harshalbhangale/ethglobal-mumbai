import UIKit
import WebKit

/**
 * Anon-RPC for the keyboard's Base reads. A keyboard can't run the anon-rpc harness itself, so a hidden
 * web view loads Kall's /anon-bridge page, which boots the same hash-pinned worker as the web app (Nym by
 * default). Reads go to it as one JSON-RPC batch through `window.kallReadBatch`, one round trip through
 * the mixnet. If the page never loads, reads go straight to Base from the keyboard and say so.
 */
@MainActor
final class AnonBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    enum State: Equatable { case idle, loading, connecting, ready(bootMs: Int?), failed(String) }

    /** One read's answer: the JSON-RPC result, and whether it went through Nym or direct (and why). */
    struct Read {
        let result: Any?
        let error: String?
        let isPrivate: Bool
        let why: String?
        let ms: Int
        let waitedMs: Int
    }

    static let baseRPC = URL(string: "https://mainnet.base.org")!

    private(set) var state = State.idle {
        didSet { if state != oldValue { onState?(state) } }
    }
    var onState: ((State) -> Void)?
    private var webView: WKWebView?
    private var pageLoaded = false

    /** Load the page in a tiny, invisible web view inside `host`, so the worker boots while you type. */
    func start(in host: UIView) {
        guard webView == nil else { return }
        let config = WKWebViewConfiguration()
        config.userContentController.add(WeakHandler(self), name: "kall")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 2, height: 2), configuration: config)
        view.alpha = 0.01
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.navigationDelegate = self
        host.insertSubview(view, at: 0)
        webView = view
        state = .loading
        view.load(URLRequest(url: URL(string: "anon-bridge", relativeTo: Kallr.origin)!, timeoutInterval: 30))
    }

    // MARK: Reads

    /**
     * Several Base reads in one round trip through the mixnet. The page waits up to `waitMs` for the
     * worker; past that the reads go direct and say so, so a trade is never held up.
     */
    func batch(_ calls: [(method: String, params: [Any])], waitMs: Int = 20_000) async -> [Read] {
        if let webView, pageLoaded {
            let arg: [[String: Any]] = calls.map { ["method": $0.method, "params": $0.params] }
            do {
                let value = try await webView.callAsyncJavaScript(
                    "return await window.kallReadBatch(calls, waitMs)",
                    arguments: ["calls": arg, "waitMs": waitMs],
                    in: nil,
                    contentWorld: .page
                )
                if let rows = value as? [[String: Any]], rows.count == calls.count { return rows.map(Self.read) }
            } catch {}
        }
        return await Self.direct(calls, why: pageLoaded ? "the Anon-RPC page didn't answer" : "the Anon-RPC page didn't load")
    }

    private static func read(_ row: [String: Any]) -> Read {
        Read(
            result: row["result"].flatMap { $0 is NSNull ? nil : $0 },
            error: row["error"] as? String,
            isPrivate: (row["via"] as? String) == "anon",
            why: row["why"] as? String,
            ms: (row["ms"] as? NSNumber)?.intValue ?? 0,
            waitedMs: (row["waitedMs"] as? NSNumber)?.intValue ?? 0
        )
    }

    /** Straight to Base's public RPC from the keyboard: not private, and marked so. */
    static func direct(_ calls: [(method: String, params: [Any])], why: String) async -> [Read] {
        let body = calls.enumerated().map { ["jsonrpc": "2.0", "id": $0.offset + 1, "method": $0.element.method, "params": $0.element.params] as [String: Any] }
        var request = URLRequest(url: baseRPC, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let t0 = Date()
        let answers: [[String: Any]]
        if let (data, _) = try? await URLSession.shared.data(for: request),
           let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            answers = json
        } else {
            answers = []
        }
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        return calls.indices.map { i in
            let a = answers.first { ($0["id"] as? NSNumber)?.intValue == i + 1 }
            let message = (a?["error"] as? [String: Any])?["message"] as? String
            return Read(result: a?["result"], error: message ?? (a == nil ? "no answer from Base" : nil), isPrivate: false, why: why, ms: ms, waitedMs: 0)
        }
    }

    // MARK: Page messages

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch body["type"] as? String {
        case "loaded":
            pageLoaded = true
            if state == .loading { state = .connecting }
        case "status":
            switch body["state"] as? String {
            case "ready": state = .ready(bootMs: (body["bootMs"] as? NSNumber)?.intValue)
            case "failed": state = .failed((body["error"] as? String) ?? "Nym didn't connect")
            case "starting": if case .ready = state {} else { state = .connecting }
            default: break
            }
        default: break
        }
    }

    /** A server without the page (404) or one that errors: say so instead of "connecting" forever. */
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        if let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
            state = .failed("the Anon-RPC page isn't on this server (\(http.statusCode))")
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        state = .failed("the page didn't load")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        state = .failed("the page didn't load")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageLoaded = false
        state = .failed("the web view stopped")
    }
}

/** WKUserContentController keeps its handlers strongly; this breaks the cycle with the bridge. */
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/** Decoding the few Base answers the keyboard reads. */
enum BaseRead {
    static let usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    /** Chainlink ETH / USD on Base. */
    static let ethUsdFeed = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"

    static func word(_ address: String) -> String {
        String(repeating: "0", count: 24) + address.lowercased().replacingOccurrences(of: "0x", with: "")
    }
    static func balanceOf(_ owner: String) -> String { "0x70a08231" + word(owner) }
    static func allowance(_ owner: String, _ spender: String) -> String { "0xdd62ed3e" + word(owner) + word(spender) }
    static let latestRoundData = "0xfeaf968c"

    /** A hex quantity or word as a number scaled down by `decimals` (fine for display). */
    static func number(_ hex: Any?, decimals: Int, word index: Int = 0) -> Double? {
        guard var s = hex as? String, s.hasPrefix("0x") else { return nil }
        s.removeFirst(2)
        if index > 0 || s.count > 64 {
            let start = s.index(s.startIndex, offsetBy: min(index * 64, s.count))
            let end = s.index(start, offsetBy: min(64, s.distance(from: start, to: s.endIndex)))
            s = String(s[start..<end])
        }
        // Only the low 30 hex digits: display amounts never need more, and Double can't hold more anyway.
        let tail = s.count > 30 ? String(s.suffix(30)) : s
        guard !tail.isEmpty else { return 0 }
        var value = 0.0
        for c in tail {
            guard let d = c.hexDigitValue else { return nil }
            value = value * 16 + Double(d)
        }
        return value / pow(10, Double(decimals))
    }
}
