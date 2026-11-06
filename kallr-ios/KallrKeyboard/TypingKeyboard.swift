import SwiftUI
import UIKit

/**
 * The Kall Keyboard's typing view: letters, numbers and symbols laid out like the iPhone keyboard,
 * with TRADE in the bottom row (where the emoji key sits) that opens the Kall panel. Above the keys, a
 * strip shows what you can trade right now: an order you're typing, what Check found, or the latest
 * calls from the callers you follow.
 */
struct TypingKeyboard: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: 0) {
            SuggestionStrip(model: model)
            GeometryReader { geo in
                KeyRows(model: model, width: geo.size.width)
            }
        }
        .background(Kallr.black)
    }
}

// MARK: - Strip

private struct SuggestionStrip: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        HStack(spacing: 6) {
            Text("KALL").font(.system(size: 11, weight: .black)).tracking(0.5).foregroundStyle(Kallr.lime)
                .padding(.leading, 6)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    if model.checking {
                        StripChip(text: "Checking…", style: .plain) {}
                    } else if let note = model.note {
                        StripChip(text: note, style: .warning) { model.note = nil }
                    } else if let copied = model.copied, let line = copied.headline(typed: nil) {
                        if copied.warning != nil {
                            StripChip(text: line, style: .warning) { model.openPanel(.trade) }
                        } else if copied.trade != nil {
                            StripChip(text: "↗ " + line, style: .lime) { model.openPanel(.trade) }
                        }
                    }
                    if model.follows.isEmpty {
                        StripChip(text: "Follow callers to see their calls here ↗", style: .plain) { model.openPanel(.following) }
                    } else {
                        ForEach(model.latestFollowed) { item in
                            StripChip(text: "@\(item.caller) \(item.short ? "SHORT" : "LONG") $\(item.asset)" + (model.move(item).map { String(format: " %+.1f%%", $0) } ?? ""), style: .plain) {
                                model.trade(item)
                                model.mode = .panel
                            }
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            .modifier(NoEdgeBlur())
            Button { Haptics.modifier(); model.controller?.checkCopied() } label: {
                Image(systemName: "doc.on.clipboard").font(.system(size: 14, weight: .semibold)).foregroundStyle(Kallr.bone)
                    .frame(width: 36, height: 30)
                    .background(Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
            }
            .accessibilityLabel("Check what you copied")
            .padding(.trailing, 4)
        }
        .frame(height: 40)
    }
}

/** A strip this short would be blurred whole by the newer iOS scroll-edge effect; keep it sharp. */
struct NoEdgeBlur: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.scrollEdgeEffectHidden(true, for: .all)
        } else {
            content
        }
    }
}

private struct StripChip: View {
    enum Style { case plain, lime, warning }
    let text: String
    let style: Style
    let action: () -> Void

    var body: some View {
        Button { Haptics.modifier(); action() } label: {
            Text(text).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                .foregroundStyle(style == .lime ? Kallr.black : style == .warning ? Kallr.danger : Kallr.bone)
                .padding(.horizontal, 10).frame(height: 30)
                .background(style == .lime ? Kallr.lime : Kallr.graphite, in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Keys

private let letterFill = Color(white: 0.24)
private let specialFill = Color(white: 0.14)

struct KeyRows: View {
    @ObservedObject var model: KeyboardModel
    let width: CGFloat

    private let side: CGFloat = 3
    private let gap: CGFloat = 6
    private let keyHeight: CGFloat = 43
    private let rowHeight: CGFloat = 54
    /** One key's touch width: a tenth of the row. */
    private var unit: CGFloat { (width - side * 2) / 10 }

    var body: some View {
        VStack(spacing: 0) {
            switch model.layer {
            case .letters: letters
            case .numbers: numbers
            case .symbols: symbols
            }
            bottomRow
        }
        .padding(.horizontal, side)
    }

    // Letters

    private var letters: some View {
        let rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map { $0.map(String.init) }
        return Group {
            row(rows[0].map { charKey($0) })
            HStack(spacing: 0) {
                ForEach(Array(rows[1].enumerated()), id: \.offset) { i, c in
                    let edge = i == 0 ? HorizontalAlignment.trailing : i == rows[1].count - 1 ? .leading : .center
                    charKey(c, touch: edge == .center ? unit : unit * 1.5, align: edge)
                }
            }
            HStack(spacing: 0) {
                shiftKey
                ForEach(rows[2], id: \.self) { c in charKey(c) }
                deleteKey
            }
        }
    }

    private var shiftKey: some View {
        Key(touch: unit * 1.5, visual: unit * 1.25, height: keyHeight, rowHeight: rowHeight, align: .leading,
            fill: model.shift == .off ? specialFill : Color(white: 0.85), feel: { _ in Haptics.modifier() }) {
            model.shiftTap()
        } label: {
            Image(systemName: model.shift == .locked ? "capslock.fill" : model.shift == .once ? "shift.fill" : "shift")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(model.shift == .off ? Kallr.bone : Kallr.black)
        }
        .accessibilityLabel(model.shift == .locked ? "Caps lock" : "Shift")
    }

    private var deleteKey: some View {
        Key(touch: unit * 1.5, visual: unit * 1.25, height: keyHeight, rowHeight: rowHeight, align: .trailing,
            fill: specialFill, repeats: true, feel: { Haptics.delete(repeatCount: $0) }) {
            model.backspace()
        } label: {
            Image(systemName: "delete.left").font(.system(size: 18, weight: .medium)).foregroundStyle(Kallr.bone)
        }
        .accessibilityLabel("Delete")
    }

    // Numbers and symbols

    private var numbers: some View {
        Group {
            row("1234567890".map { charKey(String($0)) })
            row(["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""].map { charKey($0) })
            punctuationRow(switchLabel: "#+=") { model.layer = .symbols }
        }
    }

    private var symbols: some View {
        Group {
            row(["[", "]", "{", "}", "#", "%", "^", "*", "+", "="].map { charKey($0) })
            row(["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"].map { charKey($0) })
            punctuationRow(switchLabel: "123") { model.layer = .numbers }
        }
    }

    private func punctuationRow(switchLabel: String, _ toggle: @escaping () -> Void) -> some View {
        HStack(spacing: 0) {
            Key(touch: unit * 1.5, visual: unit * 1.25, height: keyHeight, rowHeight: rowHeight, align: .leading, fill: specialFill,
                feel: { _ in Haptics.layer() }) {
                toggle()
            } label: {
                Text(switchLabel).font(.system(size: 16)).foregroundStyle(Kallr.bone)
            }
            ForEach([".", ",", "?", "!", "'"], id: \.self) { c in charKey(c, touch: unit * 1.4) }
            deleteKey
        }
    }

    // Bottom row: 123 / ABC, (globe), TRADE, space, return.

    private var bottomRow: some View {
        let kallKey = !model.searchActive
        let fixed: CGFloat = 1.25 + (kallKey ? 2.0 : 0) + 2.25 + (model.showsGlobe ? 1 : 0)
        return HStack(spacing: 0) {
            Key(touch: unit * 1.25, visual: unit * 1.25 - gap, height: keyHeight, rowHeight: rowHeight, fill: specialFill,
                feel: { _ in Haptics.layer() }) {
                model.layer = model.layer == .letters ? .numbers : .letters
            } label: {
                Text(model.layer == .letters ? "123" : "ABC").font(.system(size: 16)).foregroundStyle(Kallr.bone)
            }
            if model.showsGlobe {
                Key(touch: unit, visual: unit - gap, height: keyHeight, rowHeight: rowHeight, fill: specialFill,
                    feel: { _ in Haptics.layer() }) {
                    model.controller?.nextKeyboard()
                } label: {
                    Image(systemName: "globe").font(.system(size: 18)).foregroundStyle(Kallr.bone)
                }
                .accessibilityLabel("Next keyboard")
            }
            if kallKey {
            Key(touch: unit * 2, visual: unit * 2 - gap, height: keyHeight, rowHeight: rowHeight, fill: Kallr.lime,
                feel: { _ in Haptics.trade() }) {
                model.openPanel(nil)
            } label: {
                // The Kall mark, with TRADE under it.
                VStack(spacing: 1) {
                    Image("KallGlyph").renderingMode(.template).resizable().scaledToFit()
                        .frame(width: 22, height: 20)
                    Text("TRADE").font(.system(size: 8, weight: .black)).tracking(0.8)
                }
                .foregroundStyle(Kallr.black)
            }
            .accessibilityLabel("Kall: trade")
            }
            Key(touch: unit * (10 - fixed), visual: unit * (10 - fixed) - gap, height: keyHeight, rowHeight: rowHeight, fill: letterFill,
                feel: { _ in Haptics.space() }) {
                model.space()
            } label: {
                Text("space").font(.system(size: 16)).foregroundStyle(Kallr.bone)
            }
            Key(touch: unit * 2.25, visual: unit * 2.25 - gap, height: keyHeight, rowHeight: rowHeight, fill: specialFill,
                feel: { _ in Haptics.modifier() }) {
                model.returnKey()
            } label: {
                Text(model.searchActive ? "select" : model.returnLabel).font(.system(size: 16)).foregroundStyle(Kallr.bone)
            }
        }
    }

    // Pieces

    private func row(_ keys: [some View]) -> some View {
        HStack(spacing: 0) { ForEach(Array(keys.enumerated()), id: \.offset) { $0.element } }
    }

    private func charKey(_ c: String, touch: CGFloat? = nil, align: HorizontalAlignment = .center) -> some View {
        let w = touch ?? unit
        let visual = align == .center ? w - gap : unit - gap
        let shown = model.layer == .letters && model.shift != .off ? c.uppercased() : c
        return Key(touch: w, visual: visual, height: keyHeight, rowHeight: rowHeight, align: align, fill: letterFill, popup: shown) {
            model.type(c)
        } label: {
            Text(shown).font(.system(size: 23)).foregroundStyle(Kallr.bone)
        }
    }
}

/**
 * One key. Its touch area covers half the gap around it (and the row's edge for the outer keys), so a
 * tap between keys still lands. Characters type on release with a callout above the key, like iOS;
 * delete repeats while held.
 */
private struct Key<Label: View>: View {
    let touch: CGFloat
    let visual: CGFloat
    let height: CGFloat
    let rowHeight: CGFloat
    var align: HorizontalAlignment = .center
    let fill: Color
    var popup: String? = nil
    var repeats = false
    /** The haptic for this key, on touch-down; for a repeating key, again on each repeat (count from 0). */
    var feel: (Int) -> Void = { _ in Haptics.letter() }
    let action: () -> Void
    @ViewBuilder let label: () -> Label

    @State private var pressed = false
    @State private var repeater: Task<Void, Never>?

    var body: some View {
        ZStack {
            label()
                .frame(width: max(visual, 1), height: height)
                .background(pressed && popup == nil ? fill.opacity(0.65) : fill, in: RoundedRectangle(cornerRadius: 6))
                .shadow(color: .black.opacity(0.55), radius: 0, x: 0, y: 1)
                .overlay(alignment: .bottom) {
                    if pressed, let popup {
                        Text(popup).font(.system(size: 30)).foregroundStyle(Kallr.bone)
                            .frame(width: visual + 12, height: 48)
                            .background(letterFill, in: RoundedRectangle(cornerRadius: 9))
                            .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                            .offset(y: -(height - 6))
                            .allowsHitTesting(false)
                    }
                }
                // An edge-aligned key keeps half a gap on the side it's aligned to.
                .padding(align == .leading ? .leading : .trailing, align == .center ? 0 : 3)
        }
        .frame(width: max(touch, 1), height: rowHeight, alignment: Alignment(horizontal: align, vertical: .center))
        .contentShape(Rectangle())
        .zIndex(pressed ? 1 : 0)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !pressed else { return }
                    pressed = true
                    feel(0)
                    guard repeats else { return }
                    action()
                    repeater = Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 450_000_000)
                        var count = 1
                        while !Task.isCancelled {
                            feel(count)
                            action()
                            count += 1
                            try? await Task.sleep(nanoseconds: 80_000_000)
                        }
                    }
                }
                .onEnded { _ in
                    pressed = false
                    repeater?.cancel()
                    repeater = nil
                    if !repeats { action() }
                }
        )
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { action() }
    }
}
