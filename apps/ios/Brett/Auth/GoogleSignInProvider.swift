import AuthenticationServices
import Foundation

/// Google OAuth provider — opens the system browser via
/// `ASWebAuthenticationSession` so Google's cookies / passkeys on the device
/// are reused (much better UX than an in-app webview, and required by Google
/// policy for some OAuth configurations).
///
/// Flow:
/// 1. Request a start URL from the API (better-auth's `/sign-in/social` with
///    `provider: "google"` and a `callbackURL` pointing at `brett://oauth-callback`).
/// 2. `ASWebAuthenticationSession` opens that URL in the system browser.
/// 3. Google redirects back to better-auth's callback, which redirects to our
///    custom URL scheme with the session token in a query parameter.
/// 4. Parse the token from the callback URL, then call `getMe()` to hydrate
///    the user profile.
///
/// The iOS OAuth Client ID (if Google requires it) lives in Info.plist under
/// `GoogleiOSClientID`. See CREDENTIALS.md for setup.
@MainActor
final class GoogleSignInProvider: NSObject, AuthProvider, ASWebAuthenticationPresentationContextProviding {
    private let endpoints: AuthEndpoints
    private let callbackScheme = "brett"
    private let callbackURL = "brett://oauth-callback"

    init(endpoints: AuthEndpoints = AuthEndpoints()) {
        self.endpoints = endpoints
        super.init()
    }

    func signIn() async throws -> AuthSession {
        let startURL = buildStartURL()

        let callback = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(
                url: startURL,
                callbackURLScheme: callbackScheme
            ) { url, error in
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                guard let url else {
                    cont.resume(throwing: APIError.validation("Google sign-in returned no URL."))
                    return
                }
                cont.resume(returning: url)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }

        // Parse `token` out of the callback URL.
        guard let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
              !token.isEmpty else {
            throw APIError.validation("Google sign-in didn't return a session token.")
        }

        // We have a token but no user payload from this flow — set the token
        // on the client and hydrate via /users/me. AuthManager does the final
        // token persistence; we just return a populated AuthSession.
        APIClient.shared.tokenProvider = { token }
        let user = try await endpoints.getMe()
        return AuthSession(token: token, user: user)
    }

    /// Build the URL that kicks off the better-auth social flow. The API
    /// expects a POST for `/sign-in/social`, so we route through a GET
    /// endpoint that the API already serves for browser-based sign-ins — or
    /// fall back to constructing the URL directly with query parameters, if
    /// your API exposes a GET shim. The desktop client uses a `/desktop/google`
    /// endpoint — iOS gets its own `/ios/google` shim (not yet built).
    ///
    /// For now we hit `/api/auth/sign-in/social` with URL-encoded query
    /// parameters via a custom URL. The API may need a corresponding shim on
    /// the server side — see CREDENTIALS.md.
    private func buildStartURL() -> URL {
        let base = APIClient.shared.baseURL
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.path = "/api/auth/sign-in/social"
        components.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            URLQueryItem(name: "callbackURL", value: callbackURL),
        ]
        return components.url ?? base
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    nonisolated func presentationAnchor(
        for session: ASWebAuthenticationSession
    ) -> ASPresentationAnchor {
        // The key window is the right anchor for single-scene apps. Fall back
        // to a fresh ASPresentationAnchor if none is available (e.g. during
        // early app launch).
        MainActor.assumeIsolated {
            if let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) {
                return window
            }
            return ASPresentationAnchor()
        }
    }
}
