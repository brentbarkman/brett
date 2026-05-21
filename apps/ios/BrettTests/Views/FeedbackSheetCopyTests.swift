import Testing
import Foundation
@testable import Brett

/// Covers the pure helpers added to `FeedbackSheet` for the fail-fast
/// recovery flow (Brett-unreachable → user can retry or copy):
///
///  - `errorCopy(for:)` — maps thrown errors from `POST /feedback`
///    into user-facing copy. Transport errors collapse into one
///    "Brett is unreachable" message; auth and validation errors
///    keep their own specific copy.
///  - `formatReportForClipboard(...)` — composes the plain-text
///    report a user pastes into email or Slack when the API is down.
///
/// SwiftUI rendering is exercised manually via Preview; only these
/// pure functions are tested here.
@Suite("FeedbackSheet copy + clipboard format", .tags(.views))
struct FeedbackSheetCopyTests {
    // MARK: - errorCopy(for:)

    @Test func offlineErrorMessagesAsUnreachable() {
        let copy = FeedbackSheet.errorCopy(for: APIError.offline)
        #expect(copy.contains("Brett is unreachable"))
        #expect(copy.lowercased().contains("copy your report"))
    }

    @Test func serverErrorMessagesAsUnreachable() {
        // Railway 502s come through as `.serverError(502)` and should
        // not surface the raw status to the user — outage messaging is
        // identical to offline.
        let copy = FeedbackSheet.errorCopy(for: APIError.serverError(502))
        #expect(copy.contains("Brett is unreachable"))
        #expect(!copy.contains("502"))
    }

    @Test func rateLimitedMessagesAsUnreachable() {
        let copy = FeedbackSheet.errorCopy(for: APIError.rateLimited(retryAfter: 30))
        #expect(copy.contains("Brett is unreachable"))
    }

    @Test func unknownTransportErrorMessagesAsUnreachable() {
        let urlError = URLError(.timedOut)
        let copy = FeedbackSheet.errorCopy(for: APIError.unknown(urlError))
        #expect(copy.contains("Brett is unreachable"))
    }

    @Test func decodingFailedMessagesAsUnreachable() {
        // A decoding failure on `/feedback` (server returned non-JSON)
        // is functionally an outage from the user's perspective —
        // their report didn't land. Same copy.
        let decodingErr = NSError(domain: "Test", code: -1)
        let copy = FeedbackSheet.errorCopy(for: APIError.decodingFailed(decodingErr))
        #expect(copy.contains("Brett is unreachable"))
    }

    @Test func plainErrorMessagesAsUnreachable() {
        // Anything that wasn't wrapped in APIError still falls through
        // to the unreachable copy. APIClient.rawRequest categorizes the
        // common cases but a future code path could throw something
        // raw — we want to fail safe, not crash.
        struct UnknownThing: Error {}
        let copy = FeedbackSheet.errorCopy(for: UnknownThing())
        #expect(copy.contains("Brett is unreachable"))
    }

    @Test func unauthorizedHasDistinctCopy() {
        // Auth-expired needs a different action than retry — the user
        // has to reopen / re-auth, not resubmit. Copy must NOT suggest
        // a retry from this sheet.
        let copy = FeedbackSheet.errorCopy(for: APIError.unauthorized)
        #expect(copy.lowercased().contains("sign-in"))
        #expect(!copy.contains("Brett is unreachable"))
    }

    @Test func validationKeepsServerMessage() {
        // 400/422 means the server rejected the report content (rare —
        // we already trim length client-side). Show what the server
        // said so the user can fix it.
        let copy = FeedbackSheet.errorCopy(for: APIError.validation("Title is too long."))
        #expect(copy.contains("Title is too long."))
    }

    // MARK: - formatReportForClipboard

    @Test func clipboardFormatIncludesTypeAndTitle() {
        let result = FeedbackSheet.formatReportForClipboard(
            type: .bug,
            title: "App crashes on launch",
            description: "Tap icon, see splash, then white screen.",
            appVersion: "1.0.0 (42)",
            os: "iOS 18.0",
            userId: "user_abc"
        )
        #expect(result.contains("[Bug] App crashes on launch"))
        #expect(result.contains("Tap icon, see splash, then white screen."))
    }

    @Test func clipboardFormatHandlesEmptyTitle() {
        // Defensive: the submit button is gated on non-empty title,
        // but the Copy button shouldn't be — a user opens the sheet,
        // notices the outage, and may want to copy a partial draft.
        let result = FeedbackSheet.formatReportForClipboard(
            type: .bug,
            title: "   ",
            description: "Something broke.",
            appVersion: "1.0.0 (42)",
            os: "iOS 18.0",
            userId: "user_abc"
        )
        #expect(result.contains("(no title)"))
        #expect(result.contains("Something broke."))
    }

    @Test func clipboardFormatHandlesEmptyDescription() {
        let result = FeedbackSheet.formatReportForClipboard(
            type: .feature,
            title: "Idea",
            description: "",
            appVersion: "1.0.0 (42)",
            os: "iOS 18.0",
            userId: nil
        )
        #expect(result.contains("[Feature] Idea"))
        #expect(result.contains("(no description)"))
    }

    @Test func clipboardFormatIncludesDiagnostics() {
        let result = FeedbackSheet.formatReportForClipboard(
            type: .bug,
            title: "Title",
            description: "Desc",
            appVersion: "1.0.0 (42)",
            os: "iOS 18.0",
            userId: "user_abc"
        )
        #expect(result.contains("App: 1.0.0 (42)"))
        #expect(result.contains("OS: iOS 18.0"))
        #expect(result.contains("User: user_abc"))
    }

    @Test func clipboardFormatOmitsUserWhenAbsent() {
        // Signed-out users (or pre-auth) shouldn't get a bogus "User: "
        // line. Same for an empty string — coalesce to "not present."
        let result = FeedbackSheet.formatReportForClipboard(
            type: .bug,
            title: "Title",
            description: "Desc",
            appVersion: "1.0.0 (42)",
            os: "iOS 18.0",
            userId: nil
        )
        #expect(!result.contains("User:"))

        let resultEmpty = FeedbackSheet.formatReportForClipboard(
            type: .bug,
            title: "Title",
            description: "Desc",
            appVersion: "1.0.0 (42)",
            os: "iOS 18.0",
            userId: ""
        )
        #expect(!resultEmpty.contains("User:"))
    }

    @Test func clipboardFormatHasNoTechnicalArtifacts() {
        // The pasted report ends up in the user's email or Slack — no
        // JSON braces, no key-quoting, nothing that looks like raw API
        // payload. Pure plain text.
        let result = FeedbackSheet.formatReportForClipboard(
            type: .bug,
            title: "Title",
            description: "Desc",
            appVersion: "1.0.0 (42)",
            os: "iOS 18.0",
            userId: "user_abc"
        )
        #expect(!result.contains("{"))
        #expect(!result.contains("}"))
        #expect(!result.contains("\":\""))
        #expect(!result.contains("diagnostics"))
    }
}
