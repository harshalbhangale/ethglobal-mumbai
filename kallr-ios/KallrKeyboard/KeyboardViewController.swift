// The Kall Keyboard on iPhone: calls from the callers you follow, one-tap trades on Definitive
// Flash from your Kall wallet, your orders, and the wallet itself. Typing stays on the iPhone
// keyboard; the globe key switches between them.

import SwiftUI
import UIKit

final class KeyboardViewController: UIInputViewController {
    private lazy var model = KeyboardModel(controller: self)
    private var lookupTask: Task<Void, Never>?
    private var lastTyped: String?

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
        let height = view.heightAnchor.constraint(equalToConstant: 300)
        height.priority = .defaultHigh
        height.isActive = true
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        model.showsGlobe = needsInputModeSwitchKey
        model.fullAccess = hasFullAccess
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        readTypedOrder()
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        readTypedOrder()
    }

    func nextKeyboard() { advanceToNextInputMode() }

    /**
     * An order typed on the iPhone keyboard before switching ("buy $20 of eth tp 10% sl 5%") fills the
     * Trade tab: the text before the cursor is read only when it looks like an order.
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
