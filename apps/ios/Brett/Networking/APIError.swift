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
            return APIError.sanitiseUserFacing(detail) ?? "Invalid email or password."
        case .rateLimited(let retry):
            if let retry {
                return "Too many attempts. Try again in \(retry)s."
            }
            return "Too many attempts. Please wait a moment and try again."
        case .serverError(let status):
            return "Server error (\(status)). Please try again."
        case .validation(let message):
            return APIError.sanitiseUserFacing(message) ?? "That didn't look right. Please check and try again."
        case .decodingFailed:
            return "We couldn't read the server's response."
        case .unknown:
            return "Something went wrong. Please try again."
        }
    }

    /// Scrubs PII before a server-originated message reaches the UI:
    /// - Masks any email-looking substring (`user@host.com` → `[email]`).
    /// - Caps length at 160 chars (notification banners truncate around
    ///   here anyway; this prevents a verbose payload from leaking
    ///   incidental user data past the first sentence).
    /// - Returns nil when the trimmed input is empty, so callers can fall
    ///   back to a generic category string.
    static func sanitiseUserFacing(_ raw: String?) -> String? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else { return nil }
        // Simple email pattern — matches the common case without being a
        // full RFC5322 validator. Anything that looks like a local-part +
        // '@' + domain label gets replaced.
        let emailPattern = #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#
        let masked: String
        if let regex = try? NSRegularExpression(pattern: emailPattern) {
            let range = NSRange(raw.startIndex..., in: raw)
            masked = regex.stringByReplacingMatches(
                in: raw, range: range, withTemplate: "[email]"
            )
        } else {
            masked = raw
        }
        if masked.count > 160 {
            return String(masked.prefix(160)) + "…"
        }
        return masked
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
