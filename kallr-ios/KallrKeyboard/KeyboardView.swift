import SwiftUI

/** Everything the keyboard shows: the row, the keys or the Trade panel, and the order being built. */
@MainActor
final class KeyboardModel: ObservableObject {
    enum Mode { case letters, numbers, trade }

    weak var controller: KeyboardViewController?
    @Published var mode = Mode.letters
    @Published var shift = false
    @Published var showsGlobe = true
    @Published var fullAccess = false

    @Published var typed: String?
    @Published var loading = false
    @Published var result: Kallr.Result?
    @Published var note: String?

    @Published var asset = "ETH"
    @Published var usd = "5"
    @Published var exits: (tp: Double, sl: Double)? = (10, 5)

    init(controller: KeyboardViewController) { self.controller = controller }

    var headline: String? {
        if loading { return typed != nil && result == nil ? "Reading your order…" : "Reading what you copied…" }
        return result?.headline(typed: typed) ?? typed.map { "Trade it: \($0)" }
    }

    func apply(_ r: Kallr.Result) {
        result = r
        if let symbol = (r.trade?.symbol ?? r.call?.asset)?.uppercased(), ["ETH", "BTC", "WETH", "CBBTC"].contains(symbol) {
            asset = symbol.hasSuffix("BTC") ? "BTC" : "ETH"
        }
        if let p = r.prefill {
            if let v = p.usd { usd = Kallr.fmt(v) }
            if let tp = p.tpPct, let sl = p.slPct { exits = (tp, sl) }
        }
    }

    /** iPhone buys ETH and BTC through the order page for now; Base tokens trade on Android and the extension. */
    var blocked: String? {
        if result?.warning != nil { return "No buy: \(result?.fake != nil ? "fake contract" : "risky token")" }
        if let t = result?.trade, !["ETH", "BTC", "WETH", "CBBTC"].contains(t.symbol.uppercased()) {
            return "$\(t.symbol) trades on Android and the X extension"
        }
        return nil
    }

    func buy() {
        guard blocked == nil else { return }
        controller?.open(Kallr.deskURL(usd: usd, asset: asset, tp: exits?.tp, sl: exits?.sl, post: result?.post))
    }
}

struct KeyboardView: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: 0) {
            KallrRow(model: model)
            if model.mode == .trade {
                TradePanel(model: model)
            } else {
                Keys(model: model)
            }
        }
        .background(Kallr.black)
    }
}

// MARK: - The row above the keys

private struct KallrRow: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        HStack(spacing: 8) {
            Button { model.mode = model.mode == .trade ? .letters : .trade } label: {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(model.mode == .trade ? Kallr.black : Kallr.lime)
                    .frame(width: 38, height: 34)
                    .background(model.mode == .trade ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
            }
            .accessibilityLabel("Trade")

            Button { if model.headline != nil { model.mode = .trade } } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.note ?? model.headline ?? "Copy a call, or type “buy $20 of eth”")
                        .font(.system(size: 13, weight: model.headline != nil && model.note == nil ? .semibold : .regular))
                        .foregroundStyle(model.result?.warning != nil || model.note != nil ? Kallr.danger : model.headline != nil ? Kallr.bone : Kallr.muted)
                        .lineLimit(1)
                    if model.note == nil, let record = model.result?.record?.line {
                        Text(record).font(.system(size: 11)).foregroundStyle(Kallr.muted).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Button { model.controller?.checkCopied() } label: {
                Text(model.loading ? "…" : "CHECK")
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.6)
                    .foregroundStyle(Kallr.black)
                    .frame(width: 58, height: 30)
                    .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 7))
            }
            .accessibilityLabel("Check what you copied")
        }
        .padding(.horizontal, 6)
        .frame(height: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(Kallr.hairline).frame(height: 1) }
    }
}

// MARK: - Keys

private struct Keys: View {
    @ObservedObject var model: KeyboardModel

    private var rows: [[String]] {
        if model.mode == .numbers {
            return [Array("1234567890").map(String.init), Array("-/:;()$&@\"").map(String.init), Array(".,?!'%").map(String.init)]
        }
        let letters = [Array("qwertyuiop"), Array("asdfghjkl"), Array("zxcvbnm")].map { $0.map(String.init) }
        return model.shift ? letters.map { $0.map { $0.uppercased() } } : letters
    }

    var body: some View {
        GeometryReader { geo in
            let gap: CGFloat = 6
            let keyW = (geo.size.width - 6 - gap * 9) / 10
            VStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    HStack(spacing: gap) {
                        if i == 2 {
                            Special(symbol: model.mode == .numbers ? nil : (model.shift ? "shift.fill" : "shift"), text: model.mode == .numbers ? "#" : nil, width: keyW * 1.35) {
                                if model.mode == .letters { model.shift.toggle() }
                            }
                            Spacer(minLength: 0)
                        }
                        ForEach(rows[i], id: \.self) { k in
                            Key(label: k, width: keyW) {
                                model.controller?.insert(k)
                                if model.shift { model.shift = false }
                            }
                        }
                        if i == 2 {
                            Spacer(minLength: 0)
                            Special(symbol: "delete.left", width: keyW * 1.35) { model.controller?.deleteBackward() }
                        }
                    }
                }
                HStack(spacing: gap) {
                    Special(text: model.mode == .numbers ? "ABC" : "123", width: keyW * 1.35) {
                        model.mode = model.mode == .numbers ? .letters : .numbers
                    }
                    if model.showsGlobe {
                        Special(symbol: "globe", width: keyW * 1.1) { model.controller?.nextKeyboard() }
                    }
                    Key(label: "space", width: .infinity, small: true) { model.controller?.insert(" ") }
                    Button { model.controller?.insert("\n") } label: {
                        Image(systemName: "return")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Kallr.black)
                            .frame(width: keyW * 2, height: 44)
                            .background(Kallr.lime, in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
            .padding(.horizontal, 3)
            .padding(.top, 8)
        }
    }
}

private struct Key: View {
    let label: String
    let width: CGFloat
    var small = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: small ? 14 : 21))
                .foregroundStyle(Kallr.bone)
                .frame(maxWidth: width == .infinity ? .infinity : width)
                .frame(width: width == .infinity ? nil : width, height: 44)
                .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(KeyPress())
    }
}

private struct Special: View {
    var symbol: String? = nil
    var text: String? = nil
    let width: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if let symbol { Image(systemName: symbol).font(.system(size: 16, weight: .semibold)) } else { Text(text ?? "").font(.system(size: 14, weight: .semibold)) }
            }
            .foregroundStyle(Kallr.bone)
            .frame(width: width, height: 44)
            .background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(KeyPress())
    }
}

/** Keys dip and brighten a little under the finger. */
private struct KeyPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(configuration.isPressed ? 0.12 : 0)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

// MARK: - Trade panel

private struct TradePanel: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ChipRow(options: ["ETH", "BTC"], selected: model.asset) { model.asset = $0 }
            ChipRow(options: ["1", "5", "20", "50"], label: { "$\($0)" }, selected: model.usd) { model.usd = $0 }
            ChipRow(
                options: ["none", "10/5", "20/10"],
                label: { $0 == "none" ? "No exits" : "TP \($0.split(separator: "/")[0])% · SL \($0.split(separator: "/")[1])%" },
                selected: model.exits.map { "\(Kallr.fmt($0.tp))/\(Kallr.fmt($0.sl))" } ?? "none"
            ) { v in
                let p = v.split(separator: "/").compactMap { Double($0) }
                model.exits = p.count == 2 ? (p[0], p[1]) : nil
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Button { model.mode = .letters } label: {
                    Text("ABC").font(.system(size: 13, weight: .bold)).foregroundStyle(Kallr.bone)
                        .frame(width: 64, height: 48)
                        .background(Kallr.keyDark, in: RoundedRectangle(cornerRadius: 10))
                }
                Button { model.buy() } label: {
                    Text(model.blocked ?? "BUY $\(model.usd) OF \(model.asset)  ↗")
                        .font(.system(size: 14, weight: .heavy))
                        .tracking(0.5)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundStyle(model.blocked == nil ? Kallr.black : Kallr.muted)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(model.blocked == nil ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 10))
                }
                .disabled(model.blocked != nil)
            }
            Text("Opens the Kallr order page to sign with your wallet · Flash on Base")
                .font(.system(size: 10))
                .foregroundStyle(Kallr.muted)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }
}

private struct ChipRow: View {
    let options: [String]
    var label: (String) -> String = { $0 }
    let selected: String
    let pick: (String) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.self) { o in
                Button { pick(o) } label: {
                    Text(label(o))
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(o == selected ? Kallr.black : Kallr.bone)
                        .padding(.horizontal, 13)
                        .frame(height: 34)
                        .background(o == selected ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(KeyPress())
            }
        }
    }
}
