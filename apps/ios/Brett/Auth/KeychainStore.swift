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
enum KeychainStore {
    /// Service identifier for Keychain queries. Namespaced under the bundle id.
    static let service = "com.brett.app.auth"

    /// Account key for the single bearer token entry.
    private static let tokenAccount = "sessionToken"

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
    static func readToken() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: tokenAccount,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true,
        ]

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

    /// Writes (insert or update) the session token.
    static func writeToken(_ token: String) throws {
        let data = Data(token.utf8)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: tokenAccount,
        ]

        // Try updating an existing entry first.
        let updateAttrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, updateAttrs as CFDictionary)

        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            // Fall through to insert.
            break
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

    /// Deletes the stored token. Treats "item not found" as success — we're
    /// already in the desired state.
    static func deleteToken() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: tokenAccount,
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }
}
