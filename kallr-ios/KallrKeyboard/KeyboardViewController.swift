// The Kallr keyboard on iPhone: typing, the Kallr row (a copied call, the caller's record, fake
// contracts) and the Trade panel. Buying opens the Kallr order page with the order filled in,
// where the same Privy wallet signs it.

import SwiftUI
import UIKit

final class KeyboardViewController: UIInputViewController {
    private lazy var model = KeyboardModel(controller: self)
    private var lookupTask: Task<Void, Never>?

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
        let height = view.heightAnchor.constraint(equalToConstant: 292)
        height.priority = .defaultHigh
        height.isActive = true
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        model.showsGlobe = needsInputModeSwitchKey
        model.fullAccess = hasFullAccess
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        typedChanged()
    }

    // MARK: Typing

    func insert(_ text: String) {
        textDocumentProxy.insertText(text)
        typedChanged()
    }

    func deleteBackward() {
        textDocumentProxy.deleteBackward()
        typedChanged()
    }

    func nextKeyboard() { advanceToNextInputMode() }

    /** An order being typed ("buy $20 of eth tp 10% sl 5%") is read once typing settles. */
    private func typedChanged() {
        let typed = Kallr.typedOrder(textDocumentProxy.documentContextBeforeInput)
        guard typed != model.typed else { return }
        model.typed = typed
        guard let typed else { return }
        check(text: nil, typed: typed)
    }

    // MARK: Kallr

    /** "Check copied": reads the clipboard only when the user asks. */
    func checkCopied() {
        guard hasFullAccess else {
            model.note = "Turn on Allow Full Access for Kallr in Settings to check calls."
            return
        }
        guard let reference = Kallr.reference(fromCopied: UIPasteboard.general.string) else {
            model.note = "Copy an X post link, or a message with a $TICKER or a contract, then tap Check."
            return
        }
        check(text: reference, typed: nil)
    }

    private func check(text: String?, typed: String?) {
        lookupTask?.cancel()
        lookupTask = Task { @MainActor in
            if typed != nil { try? await Task.sleep(nanoseconds: 450_000_000) }
            guard !Task.isCancelled else { return }
            model.loading = true
            model.note = nil
            let result = await Kallr.lookup(text: text, typed: typed)
            guard !Task.isCancelled else { return }
            model.loading = false
            if let result {
                model.apply(result)
            } else {
                model.note = hasFullAccess ? "Couldn't reach Kallr. Check your connection." : "Turn on Allow Full Access for Kallr in Settings."
            }
        }
    }

    /**
     * Keyboards can't open links through the normal API, so this asks the app the keyboard runs in
     * to open it, the way other iOS keyboards do. If that fails, the link is copied instead.
     */
    func open(_ url: URL) {
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let current = responder {
            if current.responds(to: selector), let method = current.method(for: selector) {
                typealias Open = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
                unsafeBitCast(method, to: Open.self)(current, selector, url as NSURL, NSDictionary(), nil)
                return
            }
            responder = current.next
        }
        UIPasteboard.general.string = url.absoluteString
        model.note = "Link copied. Paste it in Safari to confirm the order."
    }
}
