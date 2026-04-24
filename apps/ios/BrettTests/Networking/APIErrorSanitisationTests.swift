import Testing
import Foundation
@testable import Brett

/// Regression guards for `APIError.sanitiseUserFacing(_:)`. Server error
/// bodies occasionally echo the user's own email or other PII; the client
/// surfaces those messages via `userFacingMessage`, which can reach lock
/// screens and notification banners. Sanitisation runs before display.
@Suite("APIError sanitisation", .tags(.auth), .serialized)
@MainActor
struct APIErrorSanitisationTests {
    @Test func nilInputReturnsNil() {
        #expect(APIError.sanitiseUserFacing(nil) == nil)
    }

    @Test func whitespaceInputReturnsNil() {
        #expect(APIError.sanitiseUserFacing("   \n") == nil)
    }

    @Test func plainMessagePassesThroughUnchanged() {
        #expect(APIError.sanitiseUserFacing("Password too short.") == "Password too short.")
    }

    @Test func emailIsMaskedWithBracket() {
        let out = APIError.sanitiseUserFacing("No account for brent@example.com")
        #expect(out == "No account for [email]")
    }

    @Test func multipleEmailsAreAllMasked() {
        let out = APIError.sanitiseUserFacing("Sent to a@x.com and b@y.org, cc c@z.net")
        #expect(out == "Sent to [email] and [email], cc [email]")
    }

    @Test func longMessageIsTruncatedWithEllipsis() {
        let longMessage = String(repeating: "a", count: 200)
        let out = APIError.sanitiseUserFacing(longMessage)
        #expect(out != nil)
        #expect((out ?? "").hasSuffix("…"))
        // 160 chars + 1 ellipsis character.
        #expect((out ?? "").count == 161)
    }

    @Test func validationErrorUsesSanitisedMessage() {
        let err = APIError.validation("Email brent@x.com already in use")
        #expect(err.userFacingMessage == "Email [email] already in use")
    }

    @Test func validationErrorFallsBackOnEmptyMessage() {
        let err = APIError.validation("   ")
        #expect(err.userFacingMessage == "That didn't look right. Please check and try again.")
    }

    @Test func invalidCredentialsErrorIsSanitised() {
        let err = APIError.invalidCredentials(detail: "No account for brent@example.com")
        #expect(err.userFacingMessage == "No account for [email]")
    }

    @Test func invalidCredentialsFallbackWhenDetailEmpty() {
        let err = APIError.invalidCredentials(detail: nil)
        #expect(err.userFacingMessage == "Invalid email or password.")
    }

    @Test func descriptionRedactsValidationPayload() {
        // Logs should never see the raw message — only the category.
        let err = APIError.validation("leaks@secret.com")
        #expect(err.description == "APIError.validation")
    }
}
