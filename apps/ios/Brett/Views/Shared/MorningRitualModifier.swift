import SwiftUI

/// Persistent state for the once-per-day "morning ritual" reveal.
///
/// The ritual plays exactly once per local day — the first time the user
/// opens the Today page after midnight. Subsequent opens within the same day
/// render the Today page immediately with no staged animation.
///
/// Broken out from the view modifier so tests can exercise the date logic
/// without needing to host a SwiftUI view.
enum MorningRitual {
    /// `UserDefaults` key holding the last date (start of day) on which the
    /// ritual played. Stored as `TimeInterval` (seconds since 1970) so the
    /// value survives process restarts and is easy to inspect.
    static let storageKey = "lastMorningRitualDate"

    /// Returns `true` if the ritual should play for `date` given the last
    /// stored ritual timestamp.
    ///
    /// - Parameters:
    ///   - lastPlayed: Timestamp the ritual last played, or `nil` if it has
    ///     never played.
    ///   - now: The current date (injected so tests can control time).
    ///   - calendar: Calendar used to compare start-of-day. Defaults to
    ///     `.current` so the check honors the user's locale/timezone.
    static func shouldPlay(
        lastPlayed: Date?,
        now: Date,
        calendar: Calendar = .current
    ) -> Bool {
        guard let lastPlayed else { return true }
        return !calendar.isDate(lastPlayed, inSameDayAs: now)
    }

    /// Convenience that reads the stored timestamp from `defaults`.
    static func shouldPlay(
        now: Date = Date(),
        defaults: UserDefaults = .standard,
        calendar: Calendar = .current
    ) -> Bool {
        let lastPlayed: Date? = {
            let stored = defaults.double(forKey: storageKey)
            // UserDefaults returns 0.0 for a missing key — treat as never-played.
            return stored > 0 ? Date(timeIntervalSince1970: stored) : nil
        }()
        return shouldPlay(lastPlayed: lastPlayed, now: now, calendar: calendar)
    }

    /// Persist that the ritual played at `now`.
    static func markPlayed(
        now: Date = Date(),
        defaults: UserDefaults = .standard
    ) {
        defaults.set(now.timeIntervalSince1970, forKey: storageKey)
    }
}

/// Applies the once-per-day morning ritual reveal to a Today-page container.
///
/// The modifier owns a `triggered` flag that flips from `false` to `true` on
/// appear. Callers compose `.staggeredReveal(index:triggered:)` on their
/// section cards using the published `triggered` binding so cards cascade up
/// after the header fades in.
///
/// For days where the ritual has already played, `triggered` starts at `true`
/// so the page renders in its final state with no animation. Likewise when
/// the user has Reduce Motion enabled.
struct MorningRitualModifier: ViewModifier {
    /// Optional override so previews and tests can force the ritual to play
    /// without touching real `UserDefaults`.
    var forcePlay: Bool?

    @State private var triggered: Bool = false
    @State private var hasApplied: Bool = false

    /// Binding exposed so siblings can sync their stagger off the same flag.
    private var bindingForChildren: Binding<Bool> {
        Binding(get: { triggered }, set: { triggered = $0 })
    }

    func body(content: Content) -> some View {
        content
            .environment(\.morningRitualTriggered, triggered)
            .onAppear { applyIfNeeded() }
    }

    private func applyIfNeeded() {
        guard !hasApplied else { return }
        hasApplied = true

        let reduceMotion = BrettAnimation.isReduceMotionEnabled
        let shouldPlay = forcePlay ?? MorningRitual.shouldPlay()

        guard shouldPlay, !reduceMotion else {
            // Render immediately in the final state.
            triggered = true
            if shouldPlay { MorningRitual.markPlayed() }
            return
        }

        // Header fade-in, then section cards stagger up behind it. The
        // children use `.staggeredReveal` with a 100ms stagger to match the
        // spec's ~800ms total reveal window.
        withAnimation(.easeOut(duration: 0.2).delay(0.15)) {
            triggered = true
        }
        MorningRitual.markPlayed()
    }
}

// MARK: - Environment plumbing

private struct MorningRitualTriggeredKey: EnvironmentKey {
    static let defaultValue: Bool = true
}

extension EnvironmentValues {
    /// `true` when the morning ritual reveal has played (or been skipped
    /// because Reduce Motion is on / the ritual already played today).
    ///
    /// Section cards inside a Today-page hierarchy read this to gate their
    /// stagger:
    /// ```swift
    /// @Environment(\.morningRitualTriggered) private var triggered
    /// ...
    /// .staggeredReveal(index: sectionIndex, triggered: triggered, staggerDelay: 0.1)
    /// ```
    var morningRitualTriggered: Bool {
        get { self[MorningRitualTriggeredKey.self] }
        set { self[MorningRitualTriggeredKey.self] = newValue }
    }
}

extension View {
    /// Attach the once-per-day morning ritual reveal.
    ///
    /// - Parameter forcePlay: Optional override for previews/tests.
    func morningRitual(forcePlay: Bool? = nil) -> some View {
        modifier(MorningRitualModifier(forcePlay: forcePlay))
    }
}
