import UIKit

/**
 * The Kall Keyboard's feel. Each kind of key has its own tap, fired the moment a finger lands, from
 * generators kept warm so there's no lag. iOS lets a keyboard play haptics only with Allow Full Access.
 *
 *   letters    a light, crisp tick
 *   space      a softer, rounder thump
 *   delete     a firm click; held, a quick ratchet that gets lighter
 *   shift      a medium click; caps lock adds a second click
 *   123 / ABC  the selection tick
 *   TRADE      a heavy press, then two soft echoes rising out of it
 */
@MainActor
enum Haptics {
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let heavy = UIImpactFeedbackGenerator(style: .heavy)
    private static let selection = UISelectionFeedbackGenerator()
    private static let notice = UINotificationFeedbackGenerator()

    static func warmUp() {
        light.prepare()
        soft.prepare()
        rigid.prepare()
        selection.prepare()
    }

    static func letter() { light.impactOccurred(intensity: 0.6); light.prepare() }
    static func space() { soft.impactOccurred(intensity: 0.85); soft.prepare() }
    static func delete(repeatCount: Int = 0) {
        rigid.impactOccurred(intensity: max(0.3, 0.6 - CGFloat(repeatCount) * 0.03))
        rigid.prepare()
    }
    static func modifier() { medium.impactOccurred(intensity: 0.75); medium.prepare() }
    static func capsLock() { later(0.06) { rigid.impactOccurred(intensity: 0.9) } }
    static func layer() { selection.selectionChanged(); selection.prepare() }

    /** TRADE: a heavy press, then two soft echoes. */
    static func trade() {
        heavy.impactOccurred(intensity: 1)
        later(0.08) { soft.impactOccurred(intensity: 0.7) }
        later(0.16) { soft.impactOccurred(intensity: 0.4) }
    }

    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        switch style {
        case .light: light.impactOccurred()
        case .soft: soft.impactOccurred()
        case .rigid: rigid.impactOccurred()
        case .heavy: heavy.impactOccurred()
        default: medium.impactOccurred()
        }
    }

    static func success() { notice.notificationOccurred(.success) }
    static func error() { notice.notificationOccurred(.error) }

    private static func later(_ seconds: Double, _ body: @escaping @MainActor () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { MainActor.assumeIsolated { body() } }
    }
}
