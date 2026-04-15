import Foundation
import UIKit
import GoogleSignIn

/// Google sign-in via GoogleSignIn-iOS SDK.
///
/// Why native SDK instead of ASWebAuthenticationSession:
/// - Native account chooser that reads from the iOS Google account store
///   (Gmail, YouTube, Drive, Meet). Users with those apps already signed in
///   get a one-tap sign-in without typing their address.
/// - PKCE + nonce handled on-device, so the idToken is safe to hand to the
///   server.
/// - Token refresh is automatic if we ever need it later.
///
/// Flow:
/// 1. `GIDSignIn.sharedInstance.signIn(withPresenting:)` shows the system
///    account chooser / sign-in UI.
/// 2. On success we extract `user.idToken.tokenString`.
/// 3. POST the idToken to our server's `/api/auth/ios/google/token` endpoint.
/// 4. Server verifies the token against Google's JWKS, upserts the user,
///    and returns a Brett session bearer token.
///
/// Configuration lives in Info.plist:
/// - `GIDClientID` — the iOS OAuth Client ID you create in Google Cloud
///   Console (separate from the web client used by desktop).
/// - `CFBundleURLTypes` — must include the reversed client ID as a URL
///   scheme so GIDSignIn's OAuth callback can return to the app.
///
/// See apps/ios/CREDENTIALS.md for the setup walkthrough.
@MainActor
final class GoogleSignInProvider: AuthProvider {
    private let endpoints: AuthEndpoints

    init(endpoints: AuthEndpoints = AuthEndpoints()) {
        self.endpoints = endpoints
        configureIfNeeded()
    }

    func signIn() async throws -> AuthSession {
        guard let rootViewController = Self.topViewController() else {
            throw APIError.validation("No view controller available to present Google Sign-In.")
        }

        // Present the SDK's native sign-in UI. The SDK handles PKCE, nonce,
        // and the OAuth redirect back via the reversed-client-ID URL scheme
        // (which BrettApp.onOpenURL hands off to `GIDSignIn.sharedInstance
        // .handle(url)`).
        let result: GIDSignInResult
        do {
            result = try await GIDSignIn.sharedInstance.signIn(withPresenting: rootViewController)
        } catch {
            // User-cancellation returns an error — surface as a soft failure
            // rather than a crash. AuthManager shows this message in-line.
            throw Self.mapGIDError(error)
        }

        guard let idToken = result.user.idToken?.tokenString, !idToken.isEmpty else {
            throw APIError.validation("Google Sign-In did not return an identity token.")
        }

        // Exchange the Google idToken for a Brett session via our own
        // verified endpoint. Server validates the token against the iOS
        // client-ID audience + Google's JWKS and hands back a bearer token.
        let session = try await endpoints.signInIOSGoogle(idToken: idToken)

        // AuthManager persists the token via Keychain; we just return the
        // populated session so the provider contract matches Email / Apple.
        APIClient.shared.tokenProvider = { session.token }
        return session
    }

    // MARK: - Configuration

    /// Read `GIDClientID` from Info.plist and wire it into GIDSignIn once.
    /// No-op on subsequent calls. The SDK happily throws at sign-in time if
    /// we skip this, so we do it eagerly at provider init.
    private func configureIfNeeded() {
        guard GIDSignIn.sharedInstance.configuration == nil else { return }
        guard
            let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
            !clientID.isEmpty
        else {
            // Misconfiguration — log but don't crash. signIn() will fail with
            // a clean error below when the SDK tries to use the config.
            #if DEBUG
            print("[GoogleSignIn] GIDClientID missing from Info.plist; see CREDENTIALS.md")
            #endif
            return
        }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
    }

    // MARK: - Presentation anchor

    /// Walk the active window scene to find the top-most view controller.
    /// Presenting from the root key window works for our single-scene app.
    private static func topViewController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        var vc = window?.rootViewController
        while let presented = vc?.presentedViewController {
            vc = presented
        }
        return vc
    }

    // MARK: - Error mapping

    /// Translate GIDSignIn errors into the app's APIError vocabulary so the
    /// UI layer doesn't need to know the SDK exists. Cancellation is the
    /// common case — keep it quiet; everything else we surface.
    private static func mapGIDError(_ error: Error) -> APIError {
        let nsError = error as NSError
        if nsError.domain == kGIDSignInErrorDomain {
            switch nsError.code {
            case GIDSignInError.canceled.rawValue:
                return APIError.validation("Sign-in cancelled.")
            case GIDSignInError.hasNoAuthInKeychain.rawValue:
                return APIError.validation("No Google account found. Tap Sign in with Google to continue.")
            case GIDSignInError.unknown.rawValue:
                return APIError.unknown(error)
            default:
                return APIError.unknown(error)
            }
        }
        return APIError.unknown(error)
    }
}
