// The Kall Keyboard on iPhone: a typing keyboard with a TRADE key that opens Kall: calls from the
// callers you follow, one-tap trades on Definitive Flash from your Kall wallet, your orders, and the
// wallet itself.

import SwiftUI
import UIKit

final class KeyboardViewController: UIInputViewController {
    private lazy var model = KeyboardModel(controller: self)
    private var lookupTask: Task<Void, Never>?
    private var lastTyped: String?
    /** Text before the cursor at the last change, to spot a paste (a jump of a whole message). */
    private var lastContextLength = 0
    private var height: NSLayoutConstraint?
    /** Watches the clipboard's change count (no paste prompt) so the strip's Paste shows as soon as you copy. */
    private var clipboardWatch: Timer?
    private var clipboardCount = UIPasteboard.general.changeCount
    /** Typing is the iPhone keyboard's height plus the strip; the panel needs more room. */
    static let typingHeight: CGFloat = 260
    static let panelHeight: CGFloat = 336
    static let pickerHeight: CGFloat = 440

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: KeyboardView(model: model))
        host.view.translatesAutoresizingMaskIntoConstraints = false
        host.view.backgroundColor = .clear
        addChild(host)
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
        let height = view.heightAnchor.constraint(equalToConstant: model.mode == .typing ? Self.typingHeight : Self.panelHeight)
        height.priority = .defaultHigh
        height.isActive = true
        self.height = height
    }

    func modeChanged(_ mode: KeyboardModel.Mode) { updateHeight() }

    /**
     * Opens a link in Safari. A keyboard has no UIApplication of its own, but with Allow Full Access the
     * host app's is on the responder chain. `done` gets whether iOS opened it.
     */
    func openURL(_ url: URL, done: @escaping (Bool) -> Void) {
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: done)
                return
            }
            responder = r.next
        }
        done(false)
    }

    func updateHeight() {
        height?.constant = model.mode == .typing ? Self.typingHeight : model.picking ? Self.pickerHeight : Self.panelHeight
        view.setNeedsLayout()
    }

    /** After a key: capitalize as needed, and watch for an order being typed. */
    func afterTyping() {
        model.autoShift()
        readTypedOrder()
    }

    private func returnLabel() -> String {
        switch textDocumentProxy.returnKeyType ?? .default {
        case .go: return "go"
        case .google, .yahoo, .search: return "search"
        case .join: return "join"
        case .next: return "next"
        case .route: return "route"
        case .send: return "send"
        case .done: return "done"
        case .continue: return "continue"
        default: return "return"
        }
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        model.showsGlobe = needsInputModeSwitchKey
        model.fullAccess = hasFullAccess
        let label = returnLabel()
        if model.returnLabel != label { model.returnLabel = label }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        Haptics.warmUp()
        model.clipboardHasText = UIPasteboard.general.hasStrings
        lastContextLength = (textDocumentProxy.documentContextBeforeInput ?? "").count
        model.autoShift()
        readTypedOrder()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        clipboardWatch?.invalidate()
        clipboardWatch = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.clipboardChanged() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        clipboardWatch?.invalidate()
        clipboardWatch = nil
    }

    private func clipboardChanged() {
        let count = UIPasteboard.general.changeCount
        guard count != clipboardCount else { return }
        clipboardCount = count
        model.clipboardHasText = UIPasteboard.general.hasStrings
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        model.autoShift()
        readTypedOrder()
        readPastedCall()
    }

    /**
     * A call pasted into the chat (iOS's own Paste): the text jumps by more than a key or a word would add.
     * iOS often hands a keyboard only the last line before the cursor, so when what was copied ends the
     * same way, read the whole copied message; otherwise read what's in the field.
     */
    private func readPastedCall() {
        let context = textDocumentProxy.documentContextBeforeInput ?? ""
        defer { lastContextLength = context.count }
        guard context.count - lastContextLength >= 8 else { return }
        var reference: String?
        if hasFullAccess, UIPasteboard.general.hasStrings, let copied = Kallr.copiedText(), endsTheSame(context, copied) {
            reference = Kallr.reference(fromCopied: copied)
        }
        if reference == nil { reference = Kallr.reference(fromCopied: context) }
        guard let reference else { return }
        check(text: reference, typed: nil, openTrade: true, openPanel: true)
    }

    /** The field ends with the copied text's last line: that's what was just pasted. */
    private func endsTheSame(_ context: String, _ copied: String) -> Bool {
        let tail = copied.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: .newlines).last ?? ""
        let probe = String(tail.suffix(24))
        return !probe.isEmpty && context.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix(probe)
    }

    /**
     * The strip's Trade copied: takes the call you copied straight into Trade (nothing is typed into the
     * chat). Opens the panel at once and fills in the coin, amount and exits the call names.
     */
    func tradeCopied() {
        guard hasFullAccess else {
            model.note = "Turn on Allow Full Access for Kall Keyboard in Settings."
            return
        }
        guard let reference = Kallr.reference(fromCopied: Kallr.copiedText()) else {
            model.note = "Copy a call first: an X post link, or a message with a coin."
            return
        }
        Haptics.trade()
        model.placing = .idle
        model.closePicker()
        model.openPanel(.trade)
        check(text: reference, typed: nil, openTrade: true, openPanel: true)
    }

    func nextKeyboard() { advanceToNextInputMode() }

    /**
     * An order being typed ("buy $20 of eth tp 10% sl 5%") fills the Trade tab and shows in the strip
     * above the keys: the text before the cursor is read only when it looks like an order.
     */
    private func readTypedOrder() {
        guard let typed = Kallr.typedOrder(textDocumentProxy.documentContextBeforeInput), typed != lastTyped else { return }
        lastTyped = typed
        check(text: nil, typed: typed, openTrade: true)
    }

    private var lastContextChecked: String?

    /** TRADE with a call already in the field (typed or pasted): check it, as a paste would be. */
    func checkContext() {
        guard let reference = Kallr.reference(fromCopied: textDocumentProxy.documentContextBeforeInput ?? ""),
              reference != lastContextChecked else { return }
        lastContextChecked = reference
        check(text: reference, typed: nil, openTrade: true, openPanel: true)
    }

    /** "Check what you copied": reads the clipboard only when the user taps it. */
    func checkCopied() {
        guard hasFullAccess else {
            model.note = "Turn on Allow Full Access for Kall Keyboard in Settings."
            return
        }
        guard let reference = Kallr.reference(fromCopied: Kallr.copiedText()) else {
            model.note = "Copy an X post link, or a message with a $TICKER or a contract."
            return
        }
        check(text: reference, typed: nil, openTrade: false, openPanel: true)
    }

    private func check(text: String?, typed: String?, openTrade: Bool, openPanel: Bool = false) {
        lookupTask?.cancel()
        lookupTask = Task { @MainActor in
            model.checking = true
            model.note = nil
            model.clearCre()
            let result = await Kallr.lookup(text: text, typed: typed)
            guard !Task.isCancelled else { return }
            model.checking = false
            if let result {
                model.applyCopied(result)
                if openTrade || result.warning == nil && result.trade != nil { model.tab = .trade }
                // A call with a tradable coin opens straight onto Trade, filled in.
                if openPanel, result.warning == nil, result.trade != nil {
                    model.placing = .idle
                    model.tab = .trade
                    model.closePicker()
                    if model.mode != .panel { Haptics.trade(); model.mode = .panel }
                }
                // A post that names a coin and gives a contract: Chainlink CRE checks they match.
                if let target = text.flatMap(Kallr.creTarget(in:)) ?? Kallr.creTarget(result) {
                    model.checkCre(token: target.token, claimed: target.claimed, reveal: openPanel)
                }
                // Nothing to trade in it: say so instead of doing nothing.
                if openPanel, result.headline(typed: nil) == nil { model.note = "No call in that to trade." }
            } else if text != nil {
                model.note = hasFullAccess ? "Couldn't reach Kall Markets." : "Turn on Allow Full Access for Kall Keyboard in Settings."
            }
        }
    }
}
