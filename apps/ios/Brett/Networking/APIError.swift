import Foundation

/// Categorised network / decoding errors surfaced from `APIClient`.
///
/// Each case carries a `userFacingMessage` suitable for rendering in the UI
/// (SignInView's error banner, etc.). Keep messages short and non-technical.
enum APIError: Error, CustomStringConvertible {
    case offline
    case unauthorized
    /// Sign-in attempt rejected because the email doesn't exist or the
    /// password is wrong. Distinct from `.unauthorized` (which means "you
    /// had a session and it expired") so the UI can offer "create account"
    /// instead of "sign in again."
    case invalidCredentials(detail: String? = nil)
    case rateLimited(retryAfter: Int?)
    case serverError(Int)
    case validation(String)
    case decodingFailed(Error)
    case unknown(Error)

    var userFacingMessage: String {
        switch self {
        case .offline:
            return "You're offline. Check your connection and try again."
        case .unauthorized:
            return "Your session expired. Please sign in again."
        case .invalidCredentials(let detail):
            return detail ?? "Invalid email or password."
        case .rateLimited(let retry):
            if let retry {
                return "Too many attempts. Try again in \(retry)s."
            }
            return "Too many attempts. Please wait a moment and try again."
        case .serverError(let status):
            return "Server error (\(status)). Please try again."
        case .validation(let message):
            return message
        case .decodingFailed:
            return "We couldn't read the server's response."
        case .unknown:
            return "Something went wrong. Please try again."
        }
    }

    /// Redacted debug description — safe for OSLog / crash-reports.
    /// User-typed fields (email in `invalidCredentials.detail`, server
    /// messages in `validation(...)`, underlying error text from
    /// `unknown(Error)`) are deliberately omitted because they may echo
    /// back the user's email or other PII. The UI reaches for
    /// `userFacingMessage` when it needs something to render; logs use
    /// the category alone so support can correlate without leaking.
    var description: String {
        switch self {
        case .offline:
            return "APIError.offline"
        case .unauthorized:
            return "APIError.unauthorized"
        case .invalidCredentials:
            return "APIError.invalidCredentials"
        case .rateLimited(let retry):
            return "APIError.rateLimited(retryAfter: \(retry.map(String.init) ?? "nil"))"
        case .serverError(let status):
            return "APIError.serverError(\(status))"
        case .validation:
            return "APIError.validation"
        case .decodingFailed:
            return "APIError.decodingFailed"
        case .unknown:
            return "APIError.unknown"
        }
    }
}
