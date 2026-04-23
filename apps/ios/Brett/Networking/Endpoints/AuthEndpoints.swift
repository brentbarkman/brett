import Foundation

/// Typed wrappers for the better-auth endpoints under `/api/auth/*`.
///
/// better-auth returns the session token in two places depending on the call:
/// - `Set-Cookie: better-auth.session_token=<token>` (or `__Secure-…` in prod)
/// - Response body field `token` (on sign-in/sign-up with the bearer plugin)
///
/// We check the body first, then fall back to parsing the cookie header. This
/// matches how the desktop client extracts tokens.
@MainActor
struct AuthEndpoints {
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    // MARK: - Request bodies

    private struct EmailSignIn: Encodable {
        let email: String
        let password: String
    }

    private struct EmailSignUp: Encodable {
        let email: String
        let password: String
        let name: String
    }

    private struct SocialSignIn: Encodable {
        let provider: String
        let idToken: IDTokenPayload?
        /// Raw nonce the client generated for Apple Sign In. Server hashes
        /// this with SHA-256 and asserts it matches the `nonce` claim
        /// embedded in `idToken`. Nil for flows that don't use a nonce
        /// (Google via ASWebAuthenticationSession relies on the HTTP
        /// redirect state parameter instead).
        let nonce: String?

        struct IDTokenPayload: Encodable {
            let token: String
        }
    }

    // MARK: - Response shapes

    /// better-auth returns a grab-bag of fields. We decode defensively.
    private struct SignInResponse: Decodable {
        let token: String?
        let user: ResponseUser?

        struct ResponseUser: Decodable {
            let id: String
            let email: String
            let name: String?
            let image: String?
        }
    }

    // MARK: - Endpoints

    /// Sign in with email + password. Returns the session token and a minimal
    /// AuthUser (hydrated further by `getMe()`).
    func signInEmail(email: String, password: String) async throws -> AuthSession {
        let body = EmailSignIn(email: email, password: password)
        return try await performSignIn(path: "/api/auth/sign-in/email", body: body)
    }

    /// Sign up with email + password + name.
    func signUpEmail(email: String, password: String, name: String) async throws -> AuthSession {
        let body = EmailSignUp(email: email, password: password, name: name)
        return try await performSignIn(path: "/api/auth/sign-up/email", body: body)
    }

    /// Social sign-in. For Apple, pass the ASAuthorization identity token as
    /// `idToken` plus the raw nonce the client generated (see
    /// `AppleSignInProvider`). For flows without a pre-minted token (Google
    /// via ASWebAuthenticationSession), both are nil — the caller handles
    /// redirects.
    func signInSocial(
        provider: String,
        idToken: String? = nil,
        rawNonce: String? = nil
    ) async throws -> AuthSession {
        let payload = idToken.map { SocialSignIn.IDTokenPayload(token: $0) }
        let body = SocialSignIn(provider: provider, idToken: payload, nonce: rawNonce)
        return try await performSignIn(path: "/api/auth/sign-in/social", body: body)
    }

    /// Native iOS Google Sign-In — exchange an idToken minted by
    /// GoogleSignIn-iOS for a Brett bearer token.
    ///
    /// The server's `/api/auth/ios/google/token` verifies the token against
    /// the iOS client-ID audience and Google's JWKS, then upserts the user
    /// and issues a session. Response shape:
    /// `{ token: string, user: { id, email, name, image?, createdAt }, outcome }`
    func signInIOSGoogle(idToken: String) async throws -> AuthSession {
        struct Body: Encodable { let idToken: String }
        struct Response: Decodable {
            let token: String
            let user: ResponseUser
            struct ResponseUser: Decodable {
                let id: String
                let email: String
                let name: String?
                let image: String?
            }
        }

        let encoded = try JSONEncoder().encode(Body(idToken: idToken))
        let (data, _) = try await client.rawRequest(
            path: "/api/auth/ios/google/token",
            method: "POST",
            body: encoded
        )

        let decoded = try JSONDecoder().decode(Response.self, from: data)
        let user = AuthUser(
            id: decoded.user.id,
            email: decoded.user.email,
            name: decoded.user.name,
            avatarUrl: decoded.user.image,
            timezone: nil,
            assistantName: nil
        )
        return AuthSession(token: decoded.token, user: user)
    }

    /// Sign out. Best-effort — we always clear local state even if this fails.
    func signOut() async throws {
        _ = try await client.rawRequest(path: "/api/auth/sign-out", method: "POST")
    }

    /// Fetch the current user from `/users/me`. Requires a bearer token to be
    /// set on `APIClient`.
    func getMe() async throws -> AuthUser {
        try await client.request(AuthUser.self, path: "/users/me", method: "GET")
    }

    // MARK: - Private helpers

    /// Shared implementation for both sign-in and sign-up. POSTs the given
    /// body to `path`, extracts the token from the response, and returns a
    /// partially-hydrated AuthSession. Callers typically follow up with a
    /// `getMe()` call to fill in timezone, assistantName, etc.
    private func performSignIn(path: String, body: Encodable) async throws -> AuthSession {
        let encoded = try JSONEncoder().encode(AnyEncodableBody(body))
        let (data, response) = try await client.rawRequest(
            path: path,
            method: "POST",
            body: encoded
        )

        // Prefer the body token (better-auth bearer plugin)
        let bodyToken: String? = (try? JSONDecoder().decode(SignInResponse.self, from: data))?.token
        let token = bodyToken ?? Self.extractCookieToken(from: response)

        guard let token, !token.isEmpty else {
            throw APIError.validation("Sign-in succeeded but no session token was returned.")
        }

        // Decode the user if present, else fall back to an id-only stub that
        // will be replaced by `getMe()` in AuthManager.
        let user: AuthUser
        if let decoded = try? JSONDecoder().decode(SignInResponse.self, from: data), let u = decoded.user {
            user = AuthUser(
                id: u.id,
                email: u.email,
                name: u.name,
                avatarUrl: u.image,
                timezone: nil,
                assistantName: nil
            )
        } else {
            user = AuthUser(id: "", email: "")
        }

        return AuthSession(token: token, user: user)
    }

    /// Parse `better-auth.session_token` (or `__Secure-better-auth.session_token`)
    /// out of the `Set-Cookie` response header. Falls back to HTTPCookieStorage
    /// for flows where the cookie has already been stored.
    static func extractCookieToken(from response: HTTPURLResponse) -> String? {
        // HTTPURLResponse.allHeaderFields collapses multiple Set-Cookie headers
        // into a comma-joined string. Use HTTPCookie.cookies(withResponseHeaderFields:)
        // which knows how to split them.
        let headerFields = response.allHeaderFields.reduce(into: [String: String]()) { acc, pair in
            if let key = pair.key as? String, let value = pair.value as? String {
                acc[key] = value
            }
        }
        let url = response.url ?? URL(string: "http://localhost")!
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: url)

        let candidates = [
            "better-auth.session_token",
            "__Secure-better-auth.session_token",
        ]

        for cookie in cookies {
            if candidates.contains(cookie.name) {
                // better-auth format: `<token>.<signature>` — we pass the whole
                // value through since the bearer plugin accepts it verbatim.
                return cookie.value
            }
        }
        return nil
    }
}

/// Private AnyEncodable wrapper — duplicate of the one in APIClient.swift
/// (kept private so each file compiles independently without re-exporting).
private struct AnyEncodableBody: Encodable {
    private let encodeFunc: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        self.encodeFunc = { try wrapped.encode(to: $0) }
    }

    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}
