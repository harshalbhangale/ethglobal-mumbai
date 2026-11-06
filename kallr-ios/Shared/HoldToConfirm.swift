import SwiftUI
import UIKit

/**
 * Hold to confirm: a trade only goes out after a deliberate press. Press and hold; a darker bar sweeps
 * across the lime button with ticks that build up, and at the end the action fires with a success tap. Let
 * go early and the bar runs back, nothing sent. VoiceOver gets a plain "Activate" action instead of the hold.
 */
struct HoldToConfirm: View {
    let label: String
    var holding = "Keep holding…"
    var duration: Double = 0.9
    var height: CGFloat = 52
    var cornerRadius: CGFloat = 14
    var font: Font = .system(size: 14, weight: .heavy)
    var disabled = false
    let action: () -> Void

    @State private var progress: CGFloat = 0
    @State private var pressing = false
    @State private var fired = false
    @State private var hold: Task<Void, Never>?

    private static let lime = Color(red: 0.776, green: 0.949, blue: 0.353)
    private static let ink = Color(red: 0.055, green: 0.078, blue: 0.027)

    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: cornerRadius).fill(Self.lime)
            GeometryReader { g in
                Rectangle().fill(Self.ink.opacity(0.22))
                    .frame(width: max(0, g.size.width * progress))
            }
            HStack(spacing: 8) {
                Image(systemName: fired ? "checkmark" : "hand.tap.fill").font(.system(size: 15, weight: .bold))
                Text(pressing && !fired ? holding : label).font(font).tracking(0.4)
            }
            .foregroundStyle(Self.ink)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .scaleEffect(pressing ? 0.97 : 1)
        .animation(.easeOut(duration: 0.12), value: pressing)
        .opacity(disabled ? 0.45 : 1)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in if !pressing && !disabled && !fired { start() } }
                .onEnded { _ in if !fired { cancel() } }
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint("Press and hold to confirm")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if !disabled && !fired { complete() } }
        .onChange(of: disabled) { _, now in if now { reset() } }
    }

    private func start() {
        pressing = true
        let tick = UIImpactFeedbackGenerator(style: .soft)
        tick.prepare()
        tick.impactOccurred(intensity: 0.5)
        withAnimation(.linear(duration: duration)) { progress = 1 }
        hold = Task { @MainActor in
            let steps = 6
            for i in 1...steps {
                try? await Task.sleep(nanoseconds: UInt64(duration / Double(steps) * 1_000_000_000))
                if Task.isCancelled { return }
                tick.impactOccurred(intensity: 0.4 + 0.6 * CGFloat(i) / CGFloat(steps))
            }
            complete()
        }
    }

    private func complete() {
        hold?.cancel()
        fired = true
        progress = 1
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        action()
        // Ready again if the screen stays up (a failed order, say).
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            reset()
        }
    }

    private func cancel() {
        hold?.cancel()
        pressing = false
        withAnimation(.easeOut(duration: 0.25)) { progress = 0 }
    }

    private func reset() {
        hold?.cancel()
        pressing = false
        fired = false
        progress = 0
    }
}
