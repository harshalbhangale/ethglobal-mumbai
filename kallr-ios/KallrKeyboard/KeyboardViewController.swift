// The Kall Keyboard on iPhone: a typing keyboard with a TRADE key that opens Kall: calls from the
// callers you follow, one-tap trades on Definitive Flash from your Kall wallet, your orders, and the
// wallet itself.

import SwiftUI
import UIKit

final class KeyboardViewController: UIInputViewController {
    private lazy var model = KeyboardModel(controller: self)
    private var lookupTask: Task<Void, Never>?
    private var lastTyped: String?
    private var height: NSLayoutConstraint?
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
        model.autoShift()
        readTypedOrder()
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        model.autoShift()
        readTypedOrder()
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

    /** "Check what you copied": reads the clipboard only when the user taps it. */
    func checkCopied() {
        guard hasFullAccess else {
            model.note = "Turn on Allow Full Access for Kall Keyboard in Settings."
            return
        }
        guard let reference = Kallr.reference(fromCopied: UIPasteboard.general.string) else {
            model.note = "Copy an X post link, or a message with a $TICKER or a contract."
            return
        }
        check(text: reference, typed: nil, openTrade: false)
    }

    private func check(text: String?, typed: String?, openTrade: Bool) {
        lookupTask?.cancel()
        lookupTask = Task { @MainActor in
            model.checking = true
            model.note = nil
            let result = await Kallr.lookup(text: text, typed: typed)
            guard !Task.isCancelled else { return }
            model.checking = false
            if let result {
                model.applyCopied(result)
                if openTrade || result.warning == nil && result.trade != nil { model.tab = .trade }
            } else if text != nil {
                model.note = hasFullAccess ? "Couldn't reach Kall Markets." : "Turn on Allow Full Access for Kall Keyboard in Settings."
            }
        }
    }
}
