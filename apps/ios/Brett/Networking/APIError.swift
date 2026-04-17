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

    var description: String {
        switch self {
        case .offline:
            return "APIError.offline"
        case .unauthorized:
            return "APIError.unauthorized"
        case .invalidCredentials(let detail):
            return "APIError.invalidCredentials(\(detail ?? "nil"))"
        case .rateLimited(let retry):
            return "APIError.rateLimited(retryAfter: \(retry.map(String.init) ?? "nil"))"
        case .serverError(let status):
            return "APIError.serverError(\(status))"
        case .validation(let message):
            return "APIError.validation(\(message))"
        case .decodingFailed(let underlying):
            return "APIError.decodingFailed(\(underlying))"
        case .unknown(let underlying):
            return "APIError.unknown(\(underlying))"
        }
    }
}
