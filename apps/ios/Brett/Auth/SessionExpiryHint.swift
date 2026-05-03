import Foundation

/// UserDefaults-backed hint shown to the user after a token-rejection
/// sign-out. Lets `SignInView` prefill the email and surface a soft
/// "please sign in again" banner instead of a cold sign-in experience
/// that feels like the app forgot the user.
///
/// Cleared on user-initiated sign-out (where the device may be handed
/// to someone else and the prefill would leak the prior user's email).
/// Persisted across app kills via UserDefaults; wiped on app uninstall
/// because UserDefaults is part of the app sandbox.
///
/// Why UserDefaults and not the keychain: this is a UI hint, not a
/// secret. The email it stores is already in the bearer's session row
/// on the server and would be returned by `/users/me` anyway.
enum SessionExpiryHint {
    private static let emailKey = "auth.sessionExpiry.lastEmail"
    private static let didExpireKey = "auth.sessionExpiry.didExpire"

    static var lastEmail: String? {
        get { UserDefaults.standard.string(forKey: emailKey) }
        set { UserDefaults.standard.set(newValue, forKey: emailKey) }
    }

    static var didExpire: Bool {
        get { UserDefaults.standard.bool(forKey: didExpireKey) }
        set { UserDefaults.standard.set(newValue, forKey: didExpireKey) }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: emailKey)
        UserDefaults.standard.removeObject(forKey: didExpireKey)
    }
}
