import Foundation

/// Handles email/password sign-in and sign-up via the better-auth REST
/// endpoints. Unlike the Apple/Google providers this one isn't a one-shot
/// `signIn()` flow — it carries credentials captured from the UI.
@MainActor
struct EmailAuthProvider: AuthProvider {
    enum Mode: Sendable {
        case signIn
        case signUp(name: String)
    }

    let email: String
    let password: String
    let mode: Mode
    private let endpoints: AuthEndpoints

    init(
        email: String,
        password: String,
        mode: Mode,
        endpoints: AuthEndpoints = AuthEndpoints()
    ) {
        self.email = email
        self.password = password
        self.mode = mode
        self.endpoints = endpoints
    }

    func signIn() async throws -> AuthSession {
        do {
            switch mode {
            case .signIn:
                return try await endpoints.signInEmail(email: email, password: password)
            case .signUp(let name):
                return try await endpoints.signUpEmail(email: email, password: password, name: name)
            }
        } catch let apiError as APIError {
            // Remap the "you have no session" error into the more accurate
            // "these credentials aren't valid" error for sign-in flows.
            // The server returns 401 both for expired sessions (rare here —
            // we have no token yet) and for wrong credentials; the context
            // makes it unambiguous.
            if case .unauthorized = apiError, case .signIn = mode {
                throw APIError.invalidCredentials()
            }
            // better-auth sometimes reports bad credentials via 400/422 with
            // a body like "Invalid email or password." — surface those as
            // `.invalidCredentials` too so the UI can offer sign-up.
            if case .validation(let message) = apiError,
               case .signIn = mode,
               Self.looksLikeCredentialError(message) {
                throw APIError.invalidCredentials(detail: message)
            }
            throw apiError
        }
    }

    /// Matches better-auth's "invalid email or password" style messages so
    /// they route to `.invalidCredentials` rather than a generic validation
    /// banner. Mirrors the regex the desktop client uses in LoginPage.tsx.
    private static func looksLikeCredentialError(_ message: String) -> Bool {
        let lower = message.lowercased()
        return lower.contains("invalid") &&
               (lower.contains("email") || lower.contains("password") || lower.contains("credential"))
    }
}
