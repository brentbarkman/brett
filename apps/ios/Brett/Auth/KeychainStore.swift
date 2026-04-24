import Foundation
import Security

/// Thin wrapper over Keychain Services for storing the session bearer token.
///
/// Design notes:
/// - Accessibility is `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`:
///   the token is readable after the first unlock following a reboot, but
///   never leaves this device (no iCloud keychain sync).
/// - We only store the token string here. User profile data lives in
///   SwiftData (`UserProfile`) — the token is the sensitive bit.
///
/// ## Access group sharing (added for share extension)
///
/// The main app and `BrettShareExtension` share a keychain access group
/// (`$(AppIdentifierPrefix)com.brett.app.auth`) declared in both targets'
/// entitlements. The extension reads the token at share time so it can
/// authenticate against `/sync/push`. See `sharedKeychain` in the extension
/// target for the read side.
///
/// Writes always land in the shared group. Reads try the shared group first
/// and fall back to the default (legacy, no access group) location so users
/// who were already signed in *before* this feature shipped don't need to
/// sign in again — the next successful read silently migrates the token to
/// the shared group and deletes the legacy copy.
enum KeychainStore {
    /// Service identifier for Keychain queries. Namespaced under the bundle id.
    static let service = "com.brett.app.auth"

    /// Account key for the single bearer token entry.
    private static let tokenAccount = "sessionToken"

    /// Account key for the "this install has run on this device" sentinel.
    /// Stored with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and
    /// `kSecAttrSynchronizable = false`, so it is NOT restored via iCloud
    /// Keychain sync, encrypted iTunes/Finder backups, or Quick Start
    /// device-to-device migration. Its absence is therefore a reliable
    /// "never run on this particular device" signal — which a UserDefaults
    /// sentinel cannot give us (UserDefaults *is* restored from backup).
    private static let installSentinelAccount = "installSentinel.v1"

    /// Shared keychain access group, matching the `$(AppIdentifierPrefix)`
    /// entitlement in both the main app and the share extension. Per Apple:
    /// when a single access group is declared in the entitlement, iOS
    /// accepts the bare (unprefixed) form here and prepends the team prefix
    /// automatically. We only declare one group, so the bare form is correct.
    private static let sharedAccessGroupName = "com.brett.app.auth"

    /// One-shot probe: does the current bundle have an entitlement for the
    /// shared access group? Cached after the first access. When `false`
    /// (ad-hoc simulator builds, test bundles without the entitlement),
    /// reads/writes fall back to the default per-app keychain location.
    private nonisolated(unsafe) static var sharedGroupAvailable: Bool? = nil
    private static let sharedGroupLock = NSLock()

    /// The access group string to pass to SecItem APIs, or `nil` when the
    /// group isn't entitled. Probes once per process via a throwaway
    /// add/delete round-trip.
    private static var sharedAccessGroup: String? {
        sharedGroupLock.lock()
        defer { sharedGroupLock.unlock() }
        if let cached = sharedGroupAvailable {
            return cached ? sharedAccessGroupName : nil
        }

        let probeAccount = "entitlement-probe-\(UUID().uuidString)"
        let probeQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: probeAccount,
            kSecAttrAccessGroup as String: sharedAccessGroupName,
            kSecValueData as String: Data([0]),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let addStatus = SecItemAdd(probeQuery as CFDictionary, nil)
        let available: Bool
        switch addStatus {
        case errSecSuccess, errSecDuplicateItem:
            available = true
            let deleteQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: probeAccount,
                kSecAttrAccessGroup as String: sharedAccessGroupName,
            ]
            _ = SecItemDelete(deleteQuery as CFDictionary)
        default:
            available = false
        }

        sharedGroupAvailable = available
        return available ? sharedAccessGroupName : nil
    }

    // MARK: - Errors

    enum KeychainError: Error, CustomStringConvertible {
        case unexpectedData
        case status(OSStatus)

        var description: String {
            switch self {
            case .unexpectedData:
                return "Keychain returned unexpected data"
            case .status(let code):
                return "Keychain operation failed with status \(code)"
            }
        }
    }

    // MARK: - Token operations

    /// Reads the stored session token, or nil if absent. Does not throw on
    /// `errSecItemNotFound` — that's a normal "not signed in" state.
    ///
    /// Tries the shared access group first (if available). If not found,
    /// probes the legacy location (no access group) and — if a token exists
    /// — migrates it to the shared group before returning. This one-shot
    /// migration keeps already-signed-in users from being forced to re-auth
    /// when this feature ships.
    static func readToken() throws -> String? {
        if let group = sharedAccessGroup {
            if let token = try read(accessGroup: group) {
                return token
            }
        }

        if let legacyToken = try read(accessGroup: nil) {
            // Migrate to the shared group if we have one. If the environment
            // doesn't support the shared group (ad-hoc / no-entitlement
            // builds), we leave the token where it is — the extension can't
            // reach it either way.
            if let group = sharedAccessGroup {
                try writeInternal(legacyToken, accessGroup: group)
                _ = try? deleteInternal(accessGroup: nil)
            }
            return legacyToken
        }

        return nil
    }

    /// Writes (insert or update) the session token into the shared access
    /// group when that group is entitled, otherwise writes to the default
    /// group. Callers don't need to care about the access group — everything
    /// in the app funnels through this single write path.
    static func writeToken(_ token: String) throws {
        try writeInternal(token, accessGroup: sharedAccessGroup)
    }

    /// Deletes the stored token from every location we might have written
    /// to (shared group + legacy default). Treats "item not found" as
    /// success at each step — we're aiming for the "no token anywhere"
    /// post-condition, not mandating that one existed.
    static func deleteToken() throws {
        var statuses: [OSStatus] = []
        if let group = sharedAccessGroup {
            statuses.append(deleteInternalStatus(accessGroup: group, account: tokenAccount))
        }
        statuses.append(deleteInternalStatus(accessGroup: nil, account: tokenAccount))

        for status in statuses {
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw KeychainError.status(status)
            }
        }
    }

    // MARK: - Install sentinel

    /// True iff the install-sentinel keychain item is present on THIS device.
    /// Absence means the app has never completed a first-launch purge on this
    /// device, even if UserDefaults was restored from a backup.
    static func hasInstallSentinel() -> Bool {
        // Check the shared access group first, then fall back to the default.
        // The accessor probes shared-group availability lazily so we can't
        // rely on it in every environment.
        if let group = sharedAccessGroup,
           (try? read(accessGroup: group, account: installSentinelAccount)) != nil {
            return true
        }
        return (try? read(accessGroup: nil, account: installSentinelAccount)) != nil
    }

    /// Writes the install sentinel so subsequent launches can detect that
    /// the purge has already run on this device. Best-effort — logged but
    /// not fatal on failure.
    static func writeInstallSentinel() {
        // A single byte is enough. The presence of the item, not its value,
        // is what we check.
        let data = Data([1])
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: installSentinelAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
        if let group = sharedAccessGroup {
            query[kSecAttrAccessGroup as String] = group
        }
        let addStatus = SecItemAdd(query as CFDictionary, nil)
        if addStatus != errSecSuccess && addStatus != errSecDuplicateItem {
            BrettLog.auth.error("Install sentinel write failed: \(addStatus, privacy: .public)")
        }
    }

    // MARK: - Internals

    private static func baseQuery(accessGroup: String?, account: String = tokenAccount) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }

    private static func read(accessGroup: String?, account: String = tokenAccount) throws -> String? {
        var query = baseQuery(accessGroup: accessGroup, account: account)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            guard let data = result as? Data,
                  let token = String(data: data, encoding: .utf8) else {
                throw KeychainError.unexpectedData
            }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.status(status)
        }
    }

    private static func writeInternal(_ token: String, accessGroup: String?) throws {
        let data = Data(token.utf8)
        let query = baseQuery(accessGroup: accessGroup)

        let updateAttrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, updateAttrs as CFDictionary)

        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            break // Fall through to insert
        default:
            throw KeychainError.status(updateStatus)
        }

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError.status(addStatus)
        }
    }

    /// Delete helper that throws on unexpected status codes.
    private static func deleteInternal(accessGroup: String?, account: String = tokenAccount) throws {
        let status = deleteInternalStatus(accessGroup: accessGroup, account: account)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }

    /// Delete helper that returns the raw status so the caller can aggregate
    /// across multiple locations (see `deleteToken`).
    private static func deleteInternalStatus(accessGroup: String?, account: String = tokenAccount) -> OSStatus {
        let query = baseQuery(accessGroup: accessGroup, account: account)
        return SecItemDelete(query as CFDictionary)
    }
}
