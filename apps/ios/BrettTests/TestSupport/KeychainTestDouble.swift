import Foundation
@testable import Brett

/// In-memory test double for Keychain-backed token storage.
///
/// AGENT COORDINATION TODO (W1-A):
/// `KeychainStore` is currently an `enum` with static methods, not a class or
/// protocol. That makes it impossible to substitute at runtime for tests.
///
/// When W1-A is ready, we need one of:
///   1. A `KeychainStoring` protocol conformed to by a `KeychainStore` struct,
///      with production code taking the protocol as a dependency, OR
///   2. A `KeychainStore` class that can be subclassed, OR
///   3. A closure-based injection point inside AuthManager.
///
/// Until then, this type stands alone as a reference implementation for what
/// the test double will expose once the protocol exists. Tests that need to
/// exercise auth flows should be marked `.disabled("Wave 2 — needs KeychainStoring protocol")`.
///
/// The protocol this double will conform to (expected shape):
/// ```swift
/// protocol KeychainStoring: Sendable {
///     func readToken() throws -> String?
///     func writeToken(_ token: String) throws
///     func deleteToken() throws
/// }
/// ```
final class KeychainTestDouble: @unchecked Sendable {
    /// Flip to make every operation throw the given error, to simulate
    /// keychain failures (locked device, corrupted entry, etc.).
    var throwOnNextOperation: Error?

    private let queue = DispatchQueue(label: "com.brett.tests.KeychainTestDouble")
    private var storage: [String: String] = [:]

    /// The single key AuthManager uses in production. Centralized here so if
    /// the production account name ever changes, tests update in lockstep.
    private static let tokenKey = "sessionToken"

    init() {}

    /// Seed the double with pre-existing state, e.g. simulating a returning
    /// signed-in user.
    func seed(token: String) {
        queue.sync { storage[Self.tokenKey] = token }
    }

    /// Peek at the current stored value without triggering the fail-next hook.
    /// Tests use this to assert the token was written (or cleared) correctly.
    func currentTokenForAssertions() -> String? {
        queue.sync { storage[Self.tokenKey] }
    }

    // MARK: - KeychainStoring (forward shape)

    func readToken() throws -> String? {
        if let err = throwOnNextOperation {
            throwOnNextOperation = nil
            throw err
        }
        return queue.sync { storage[Self.tokenKey] }
    }

    func writeToken(_ token: String) throws {
        if let err = throwOnNextOperation {
            throwOnNextOperation = nil
            throw err
        }
        queue.sync { storage[Self.tokenKey] = token }
    }

    func deleteToken() throws {
        if let err = throwOnNextOperation {
            throwOnNextOperation = nil
            throw err
        }
        _ = queue.sync { storage.removeValue(forKey: Self.tokenKey) }
    }
}
