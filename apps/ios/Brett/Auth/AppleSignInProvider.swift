import AuthenticationServices
import Foundation

/// Sign in with Apple provider.
///
/// Flow:
/// 1. Present `ASAuthorizationController` with an Apple ID request.
/// 2. Extract the `identityToken` from the returned credential.
/// 3. POST it to `/api/auth/sign-in/social` with `provider: "apple"`.
/// 4. Return the resulting `AuthSession` (token + user).
///
/// A dedicated `ASAuthorizationControllerDelegate` bridge object (`Bridge`)
/// adapts the delegate callbacks into an `async` continuation.
@MainActor
final class AppleSignInProvider: AuthProvider {
    private let endpoints: AuthEndpoints

    init(endpoints: AuthEndpoints = AuthEndpoints()) {
        self.endpoints = endpoints
    }

    func signIn() async throws -> AuthSession {
        let credential = try await requestAppleCredential()

        guard let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else {
            throw APIError.validation("Apple didn't return an identity token.")
        }

        return try await endpoints.signInSocial(provider: "apple", idToken: idToken)
    }

    // MARK: - ASAuthorization continuation bridge

    /// Present the Apple ID sheet and await the user's response. Runs the
    /// controller on the main actor and awaits the delegate callback.
    private func requestAppleCredential() async throws -> ASAuthorizationAppleIDCredential {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]

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
