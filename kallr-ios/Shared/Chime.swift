import AudioToolbox
import Foundation

/**
 * The trade-placed chime: a short two-note "cha-ching" (kall-chime.wav, made for Kall Markets by
 * scripts/make-chime.py), played once when an order is placed. It's a system sound, so it follows the
 * ringer switch like key clicks; the keyboard plays it only with Allow Full Access.
 */
enum Chime {
    private static let sound: SystemSoundID? = {
        guard let url = Bundle.main.url(forResource: "kall-chime", withExtension: "wav") else { return nil }
        var id: SystemSoundID = 0
        return AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError ? id : nil
    }()

    /** Loads the sound ahead of time, so the first chime isn't late. */
    static func prepare() { _ = sound }

    static func play() {
        if let sound { AudioServicesPlaySystemSound(sound) }
    }
}
