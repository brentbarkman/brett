import Testing
import Foundation
@testable import Brett

/// Tests for the BrettLog redaction helpers.
///
/// These are deliberately small — the main value of BrettLog is that it
/// exists as the one place errors get routed instead of being swallowed
/// by `try?`. The only thing worth unit-testing is the PII redaction
/// helpers, which must never leak a full email or id into production logs.
@Suite("BrettLog")
struct BrettLogTests {

    @Test func shortIdTruncatesToEightChars() {
        let uuid = "01HQ3M7NNK6BVZ6Z5V6XYZZZZZ"
        #expect(BrettLog.shortId(uuid) == "01HQ3M7N")
    }

    @Test func shortIdHandlesEmptyAndNil() {
        #expect(BrettLog.shortId(nil) == "<nil>")
        #expect(BrettLog.shortId("") == "<nil>")
    }

    @Test func shortIdPreservesShortIdsBelowEight() {
        // Don't pad — a genuinely-short id just comes through.
        #expect(BrettLog.shortId("abc") == "abc")
    }

    @Test func maskEmailKeepsFirstCharAndDomain() {
        #expect(BrettLog.maskEmail("brent@example.com") == "b***@example.com")
    }

    @Test func maskEmailHandlesEmptyLocalPart() {
        // Never realistic, but must not crash.
        #expect(BrettLog.maskEmail("@example.com") == "<@example.com>")
    }

    @Test func maskEmailHandlesMalformedInput() {
        // No @ sign at all → treat as nil so logs never leak the raw string.
        #expect(BrettLog.maskEmail("notanemail") == "<nil>")
        #expect(BrettLog.maskEmail(nil) == "<nil>")
    }
}
