import Foundation
import Security

/// Minimal Keychain reader used by the share extension to look up the
/// bearer token the main app stored. Intentionally read-only and much
/// smaller than `KeychainStore` in the main app — extensions have a tight
/// binary size budget and no reason to ever write to the keychain.
///
/// Must match the access group and service name used by `KeychainStore` in
/// the main app, or reads return `nil` silently. If you're changing either
/// value, update both places.
enum SharedKeychain {
    /// Matches `KeychainStore.service` in the main app.
    private static let service = "com.brett.app.auth"

    /// Account key for the single bearer token entry — matches `KeychainStore`.
    private static let tokenAccount = "sessionToken"

    /// Shared keychain access group, matching the `$(AppIdentifierPrefix)`
    /// entitlement in both targets. Per Apple: when a single access group
    /// is declared in the entitlement, iOS accepts the bare (unprefixed)
    /// form here and prepends the team prefix automatically. For multi-group
    /// entitlements we'd need to read the prefix explicitly; we only declare
    /// one, so the bare form is correct.
    private static let accessGroup = "com.brett.app.auth"

    /// Reads the bearer token, or `nil` if the user isn't signed in / the
    /// token has been rotated out. Never throws — failures are swallowed
    /// because the extension's contract is "best-effort push; queue file
    /// is the source of truth either way". A log-less nil return lets the
    /// extension proceed to write the pending file and dismiss cleanly.
    ///
    /// Tries the shared access group first. If that returns `errSecMissingEntitlement`
    /// (-34018) — which happens on ad-hoc-signed simulator builds where no
    /// entitlement is applied — falls back to the default no-group query
    /// so dev builds still work. Production builds (team-signed, entitlement
    /// present) hit the fast path.
    static func readToken() -> String? {
        if let token = tryRead(withAccessGroup: accessGroup) {
            return token
        }
        // Fallback: ad-hoc signed dev build. Matches `KeychainStore`'s
        // lenient simulator behavior so dev works end-to-end.
        return tryRead(withAccessGroup: nil)
    }

    private static func tryRead(withAccessGroup group: String?) -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: tokenAccount,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true,
        ]
        if let group {
            query[kSecAttrAccessGroup as String] = group
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }
}
