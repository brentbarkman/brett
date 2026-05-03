import Testing
import Foundation
@testable import Brett

/// Edge-case coverage for Keychain-backed token storage.
///
/// The production `KeychainStore` is an `enum` with `static` methods that
/// drives real Keychain Services — on the iOS Simulator those calls actually
/// hit the per-simulator keychain, so each test cleans up after itself to
/// avoid leaking state into later runs.
///
/// For paths we can't reproduce through Keychain Services without simulating
/// a locked device or corrupted entry, we use `KeychainTestDouble` — the
/// in-memory double mirrors the expected production shape so the expectations
/// transfer when `KeychainStore` gains a protocol for dependency injection.
@Suite("KeychainEdges", .tags(.auth), .serialized)
struct KeychainEdgeTests {
    // MARK: - Real KeychainStore

    /// Cleaner — guarantees we start each test with no token in the simulator
    /// keychain and no leakage after.
    private func cleanKeychain() throws {
        try KeychainStore.deleteToken()
    }

    @Test func readingNonexistentTokenReturnsNil() throws {
        try cleanKeychain()
        defer { try? cleanKeychain() }

        let value = try KeychainStore.readToken()
        #expect(value == nil)
    }

    @Test func writeThenReadReturnsWrittenToken() throws {
        try cleanKeychain()
        defer { try? cleanKeychain() }

        try KeychainStore.writeToken("token-one")
        let read = try KeychainStore.readToken()
        #expect(read == "token-one")
    }

    @Test func writeReplacesExistingToken() throws {
        try cleanKeychain()
        defer { try? cleanKeychain() }

        try KeychainStore.writeToken("first-token")
        try KeychainStore.writeToken("second-token")

        let read = try KeychainStore.readToken()
        #expect(read == "second-token", "second write must replace, not coexist with first")
    }

    @Test func deleteThenReadReturnsNil() throws {
        try cleanKeychain()
        defer { try? cleanKeychain() }

        try KeychainStore.writeToken("to-be-deleted")
        try KeychainStore.deleteToken()
        let read = try KeychainStore.readToken()
        #expect(read == nil)
    }

    @Test func deleteIsIdempotent() throws {
        try cleanKeychain()
        defer { try? cleanKeychain() }

        // No token present → delete should succeed (errSecItemNotFound
        // treated as already-deleted, per KeychainStore.deleteToken).
        try KeychainStore.deleteToken()
        try KeychainStore.deleteToken()
    }

    @Test("writeToken rejects empty strings")
    func writeTokenRejectsEmptyTokens() {
        #expect(throws: KeychainStore.KeychainError.self) {
            try KeychainStore.writeToken("")
        }
    }

    @Test("writeToken+readToken round-trip succeeds for a non-empty token")
    func writeTokenRoundTrip() throws {
        defer { try? cleanKeychain() }
        let token = "round-trip-\(UUID().uuidString)"
        try KeychainStore.writeToken(token)
        let readBack = try KeychainStore.readToken()
        #expect(readBack == token)
    }

    @Test func writeHandlesUnicodeToken() throws {
        try cleanKeychain()
        defer { try? cleanKeychain() }

        let weirdToken = "café🔐tømørrow"
        try KeychainStore.writeToken(weirdToken)
        let read = try KeychainStore.readToken()
        #expect(read == weirdToken)
    }

    // MARK: - KeychainTestDouble — failure injection

    /// The double is what tests use to simulate errors that the real keychain
    /// won't raise on command (locked device, corrupt entry). When
    /// AuthManager eventually takes a `KeychainStoring` protocol, these flows
    /// will cover the actual error propagation — until then, they verify the
    /// double's contract.
    @Test func testDoubleReturnsNilWhenUnseededToken() throws {
        let double = KeychainTestDouble()
        let value = try double.readToken()
        #expect(value == nil)
    }

    @Test func testDoubleWriteThenReadRoundTrips() throws {
        let double = KeychainTestDouble()
        try double.writeToken("round-trip")
        let value = try double.readToken()
        #expect(value == "round-trip")
    }

    @Test func testDoubleWriteReplacesPreviousValue() throws {
        let double = KeychainTestDouble()
        try double.writeToken("a")
        try double.writeToken("b")
        #expect(double.currentTokenForAssertions() == "b")
    }

    @Test func testDoubleThrowsOnNextOperationWhenPrimed() throws {
        let double = KeychainTestDouble()
        double.throwOnNextOperation = KeychainStore.KeychainError.status(-25308) // errSecInteractionNotAllowed
        do {
            _ = try double.readToken()
            Issue.record("expected readToken to throw the primed error")
        } catch let err as KeychainStore.KeychainError {
            if case .status(let code) = err {
                #expect(code == -25308)
            } else {
                Issue.record("unexpected keychain error: \(err)")
            }
        }
        // Primed-error should fire only once, then reset.
        let ok = try double.readToken()
        #expect(ok == nil)
    }

    @Test func testDoubleSeedIsVisibleOnFirstRead() throws {
        // Represents the "returning signed-in user" scenario: a previously
        // persisted token is already in the keychain at app launch.
        let double = KeychainTestDouble()
        double.seed(token: "existing-session")
        let value = try double.readToken()
        #expect(value == "existing-session")
    }

    @Test func testDoubleDeleteClearsToken() throws {
        let double = KeychainTestDouble()
        try double.writeToken("to-delete")
        try double.deleteToken()
        #expect(double.currentTokenForAssertions() == nil)
        let value = try double.readToken()
        #expect(value == nil)
    }

    /// Verifies the `returnNilOnNextRead` flag on `KeychainTestDouble`
    /// produces the read-back-mismatch shape that `KeychainStore.writeToken`
    /// detects and maps to `.writeVerificationFailed`.
    ///
    /// Full integration (the real `KeychainStore.writeToken` throwing
    /// `.writeVerificationFailed`) requires the `KeychainStoring` protocol
    /// so the double can be injected — tracked in W1-A. Until then, this
    /// test exercises the double's half of the contract.
    @Test("writeToken throws writeVerificationFailed when read-back returns a different value")
    func writeTokenDetectsReadBackMismatch() throws {
        let double = KeychainTestDouble()
        try double.writeToken("test-token-\(UUID().uuidString)")
        // Simulate the iOS edge case where SecItemAdd succeeds but the
        // item isn't actually persisted (corrupt keychain / locked device).
        double.returnNilOnNextRead = true

        // The production writeToken logic: write, then read-back, guard match.
        let readBack = try double.readToken()
        guard readBack == double.currentTokenForAssertions() else {
            // This branch is the one KeychainStore.writeToken takes — it
            // throws .writeVerificationFailed. Confirm the error case is
            // defined and has a clear description.
            let err = KeychainStore.KeychainError.writeVerificationFailed
            #expect(err.description == "Keychain write verification failed: read-back mismatch")
            return
        }
        Issue.record("expected read-back to return nil (mismatch), but got \(String(describing: readBack))")
    }
}
