import Foundation

/// A mechanism for producing an `AuthSession`. Conformers include:
/// - `EmailAuthProvider` — email/password sign-in or sign-up
/// - `AppleSignInProvider` — Sign in with Apple
/// - `GoogleSignInProvider` — Google OAuth via `ASWebAuthenticationSession`
///
/// All providers are `Sendable` so they can be stored on `AuthManager`, and
/// `signIn()` is `async throws` so they can surface transport / validation
/// errors uniformly via `APIError`.
protocol AuthProvider: Sendable {
    func signIn() async throws -> AuthSession
}
