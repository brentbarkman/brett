import SwiftUI

/// Tiny hint shown once per install to nudge the user to pull down to refresh.
///
/// After the user has pulled at least once, the hint never appears again
/// (`UserDefaults` stores a bool flag). Screens that wire up
/// `.refreshable` should call `PullToRefreshHint.markUsed()` from their
/// refresh closure so the hint auto-retires the first time it fires.
struct PullToRefreshHint: View {
    private static let defaultsKey = "hasUsedPullToRefresh"

    /// Whether the hint is visible. `@State` wraps `UserDefaults` so the view
    /// hides itself the moment the flag flips (e.g. after the first pull).
    @State private var hasUsed: Bool

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        _hasUsed = State(initialValue: defaults.bool(forKey: Self.defaultsKey))
    }

    private let defaults: UserDefaults

    var body: some View {
        if !hasUsed {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.40))
                Text("Pull to refresh")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.40))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background {
                Capsule(style: .continuous)
                    .fill(Color.white.opacity(0.05))
                    .overlay {
                        Capsule(style: .continuous)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                    }
            }
            .transition(.opacity.combined(with: .scale(scale: 0.94)))
            .accessibilityLabel("Pull down to refresh the current screen")
            .onReceive(NotificationCenter.default.publisher(for: .brettPullToRefreshUsed)) { _ in
                withAnimation(.easeInOut(duration: 0.25)) {
                    hasUsed = true
                }
            }
        }
    }

    // MARK: - Public helpers

    /// Mark the hint as dismissed. Call this from any screen's `.refreshable`
    /// action so the hint retires the first time the user pulls.
    @MainActor
    static func markUsed(defaults: UserDefaults = .standard) {
        guard !defaults.bool(forKey: defaultsKey) else { return }
        defaults.set(true, forKey: defaultsKey)
        NotificationCenter.default.post(name: .brettPullToRefreshUsed, object: nil)
    }

    /// Reset — testing convenience; not used from the app.
    @MainActor
    static func reset(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: defaultsKey)
    }
}

extension Notification.Name {
    static let brettPullToRefreshUsed = Notification.Name("brett.pullToRefreshUsed")
}
