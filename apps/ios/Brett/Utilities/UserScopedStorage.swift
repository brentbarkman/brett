import Foundation

/// Reads/writes `UserDefaults` under keys scoped by the current user ID so
/// two accounts that sign in on the same device don't leak preferences
/// across each other. Falls back to a stable "anon" suffix when no user is
/// signed in (pre-auth settings like the login-screen theme toggle).
///
/// Wired at app launch via `configure(userIdProvider:)`. The provider
/// closure reads `AuthManager.currentUser?.id`; we avoid a direct reference
/// to AuthManager here because this module is loaded before the app's
/// @State-owned AuthManager exists.
enum UserScopedStorage {
    /// Injected at app launch. When nil we fall back to "anon" — matches the
    /// pre-auth state (e.g. the sign-in screen) and avoids crashes if a
    /// scoped key is read before `configure` runs.
    @MainActor
    private static var userIdProvider: (() -> String?)?

    @MainActor
    static func configure(userIdProvider: @escaping () -> String?) {
        self.userIdProvider = userIdProvider
    }

    /// Prefer the AuthManager-provided user ID. Callers that want purely-anon
    /// storage should use plain `@AppStorage` instead of this wrapper.
    @MainActor
    static var currentUserId: String {
        userIdProvider?() ?? "anon"
    }

    @MainActor
    static func key(_ base: String) -> String {
        "\(base).user=\(currentUserId)"
    }
}
