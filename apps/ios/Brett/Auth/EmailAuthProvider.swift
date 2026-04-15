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
        switch mode {
        case .signIn:
            return try await endpoints.signInEmail(email: email, password: password)
        case .signUp(let name):
            return try await endpoints.signUpEmail(email: email, password: password, name: name)
        }
    }
}
