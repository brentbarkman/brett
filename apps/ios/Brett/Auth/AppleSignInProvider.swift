import AuthenticationServices
import CryptoKit
import Foundation

/// Sign in with Apple provider.
///
/// Flow:
/// 1. Generate a cryptographically-random raw nonce.
/// 2. SHA-256 hash it and pass the HASH to Apple via `request.nonce`.
///    Apple embeds the hash in the returned JWT's `nonce` claim.
/// 3. Present `ASAuthorizationController` with an Apple ID request.
/// 4. Extract `identityToken` from the credential and read the `nonce`
///    claim from its JWT payload. Verify it matches our hashed nonce —
///    a defense-in-depth check against replay of a captured token.
/// 5. POST the idToken AND the raw nonce to the server. The server
///    independently verifies `sha256(rawNonce) == idToken.claims.nonce`,
///    which is Apple's required server-side nonce check.
///
/// Without this flow, a stolen or replayed identityToken from a prior
/// Apple Sign In session could in principle be used to impersonate the
/// user. The nonce binds each token to a single client-generated value
/// that can't be reused.
@MainActor
final class AppleSignInProvider: AuthProvider {
    private let endpoints: AuthEndpoints

    init(endpoints: AuthEndpoints = AuthEndpoints()) {
        self.endpoints = endpoints
    }

    func signIn() async throws -> AuthSession {
        let rawNonce = Self.makeRawNonce()
        let hashedNonce = Self.sha256(rawNonce)

        let credential = try await requestAppleCredential(hashedNonce: hashedNonce)

        guard let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else {
            throw APIError.validation("Apple didn't return an identity token.")
        }

        // Client-side nonce check. Not a substitute for the server's
        // verification, but catches obvious tampering (and rules out the
        // most common misconfiguration — server quietly accepting tokens
        // without running the nonce comparison) before we POST.
        try Self.verifyNonceClaim(idToken: idToken, expectedHash: hashedNonce)

        return try await endpoints.signInSocial(
            provider: "apple",
            idToken: idToken,
            rawNonce: rawNonce
        )
    }

    // MARK: - Nonce

    private static let nonceAlphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")

    /// 32-char URL-safe random nonce. Not hex-encoded: Apple accepts any
    /// reasonable opaque string, and the alphabet here matches what the
    /// community implementations use so a future server-side diff is smaller.
    private static func makeRawNonce(length: Int = 32) -> String {
        var result = ""
        result.reserveCapacity(length)

        while result.count < length {
            var byte: UInt8 = 0
            let status = withUnsafeMutablePointer(to: &byte) { ptr -> Int32 in
                SecRandomCopyBytes(kSecRandomDefault, 1, ptr)
            }
            guard status == errSecSuccess else {
                // Fall back to AES-backed RNG via UInt64.random if SecRandom
                // fails (should never happen on device).
                byte = UInt8(UInt64.random(in: 0...255))
            }
            let idx = Int(byte) % nonceAlphabet.count
            result.append(nonceAlphabet[idx])
        }

        return result
    }

    private static func sha256(_ string: String) -> String {
        let data = Data(string.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Decode the JWT payload, extract `nonce`, compare against the hash we
    /// sent. Throws `APIError.validation` on any mismatch — the UI surfaces
    /// this as a sign-in failure rather than proceeding with a suspect token.
    private static func verifyNonceClaim(idToken: String, expectedHash: String) throws {
        let segments = idToken.split(separator: ".")
        guard segments.count >= 2 else {
            throw APIError.validation("Malformed Apple identity token.")
        }
        let payload = String(segments[1])
        guard let payloadData = Data(base64URLEncoded: payload),
              let claims = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let claimedNonce = claims["nonce"] as? String else {
            throw APIError.validation("Apple identity token missing nonce claim.")
        }
        guard claimedNonce == expectedHash else {
            throw APIError.validation("Apple identity token nonce mismatch.")
        }
    }

    // MARK: - ASAuthorization continuation bridge

    /// Present the Apple ID sheet and await the user's response. Runs the
    /// controller on the main actor and awaits the delegate callback.
    private func requestAppleCredential(hashedNonce: String) async throws -> ASAuthorizationAppleIDCredential {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = hashedNonce

        let controller = ASAuthorizationController(authorizationRequests: [request])

        return try await withCheckedThrowingContinuation { continuation in
            let bridge = Bridge(continuation: continuation)
            // Retain the bridge for the lifetime of the request — ASAC holds
            // its delegate as weak.
            controller.delegate = bridge
            controller.presentationContextProvider = bridge
            bridge.controller = controller
            controller.performRequests()
        }
    }

    // MARK: - Delegate bridge

    /// Private bridge class that adapts ASAuthorizationController's delegate
    /// callbacks to an async continuation. It also retains itself until the
    /// continuation resumes (via the captured closure).
    private final class Bridge: NSObject,
                                ASAuthorizationControllerDelegate,
                                ASAuthorizationControllerPresentationContextProviding {
        typealias Continuation = CheckedContinuation<ASAuthorizationAppleIDCredential, Error>

        /// The controller we're bridging. Retained until the callback fires.
        var controller: ASAuthorizationController?
        private var continuation: Continuation?
        // Self-retain cycle deliberately — released in finish().
        private var selfRetain: Bridge?

        init(continuation: Continuation) {
            self.continuation = continuation
            super.init()
            self.selfRetain = self
        }

        private func finish(_ result: Result<ASAuthorizationAppleIDCredential, Error>) {
            guard let cont = continuation else { return }
            continuation = nil
            switch result {
            case .success(let credential): cont.resume(returning: credential)
            case .failure(let error): cont.resume(throwing: error)
            }
            // Break the retain cycle.
            selfRetain = nil
            controller = nil
        }

        // MARK: Delegate

        func authorizationController(
            controller: ASAuthorizationController,
            didCompleteWithAuthorization authorization: ASAuthorization
        ) {
            if let credential = authorization.credential as? ASAuthorizationAppleIDCredential {
                finish(.success(credential))
            } else {
                finish(.failure(APIError.validation("Unexpected Apple credential type.")))
            }
        }

        func authorizationController(
            controller: ASAuthorizationController,
            didCompleteWithError error: Error
        ) {
            finish(.failure(error))
        }

        // MARK: Presentation context

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            // Find the current key window to anchor the sheet. Works for
            // single-scene apps like Brett.
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

// MARK: - Base64URL decoder

private extension Data {
    /// Decode base64url (no padding, `-_` instead of `+/`) as used in JWT
    /// payload segments. Swift's `Data(base64Encoded:)` only handles plain
    /// base64, so we normalize before decoding.
    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        guard let data = Data(base64Encoded: base64) else { return nil }
        self = data
    }
}
