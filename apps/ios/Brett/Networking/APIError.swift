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

    /// Diagnostic message intended for the in-app sync-error alert
    /// (`SyncStatusIndicator`'s tap-to-reveal). Distinct from
    /// `description` (log-safe, scrubbed) and `userFacingMessage`
    /// (sign-in-screen-quality, polite). This includes the URLError
    /// code for `.unknown` so support / the user can tell "timed out"
    /// from "host unreachable" from "DNS failed" — none of which are
    /// PII. Without this, the previous formatter rendered every
    /// transport failure as bare "APIError.unknown" with no signal.
    var diagnosticMessage: String {
        switch self {
        case .offline:
            return "You're offline."
        case .unauthorized:
            return "Session expired."
        case .invalidCredentials:
            return "Invalid credentials."
        case .rateLimited(let retry):
            if let retry { return "Rate limited (retry in \(retry)s)." }
            return "Rate limited."
        case .serverError(let status):
            return "Server error \(status)."
        case .validation:
            return "Invalid request."
        case .decodingFailed:
            return "Couldn't parse server response."
        case .unknown(let underlying):
            if let urlError = underlying as? URLError {
                return Self.urlErrorMessage(urlError)
            }
            // Type name only — never the message string, since unknown
            // wraps arbitrary Errors which may stringify to PII.
            return "Network error (\(type(of: underlying)))."
        }
    }

    /// Map a `URLError.Code` to a short human label. Codes are stable
    /// across iOS versions and contain no PII. Unknown codes fall
    /// through to the bare integer code so support can look it up.
    private static func urlErrorMessage(_ error: URLError) -> String {
        switch error.code {
        case .timedOut: return "Timed out."
        case .cannotConnectToHost: return "Couldn't reach the server."
        case .cannotFindHost: return "Server hostname not found."
        case .networkConnectionLost: return "Connection lost mid-request."
        case .notConnectedToInternet: return "Not connected to internet."
        case .dnsLookupFailed: return "DNS lookup failed."
        case .secureConnectionFailed: return "Secure connection failed."
        case .serverCertificateUntrusted: return "Server certificate untrusted."
        case .badServerResponse: return "Bad server response."
        case .resourceUnavailable: return "Resource unavailable."
        case .dataNotAllowed: return "Cellular data disallowed for this app."
        case .internationalRoamingOff: return "International roaming off."
        case .callIsActive: return "Call active — network unavailable."
        case .cancelled: return "Request cancelled."
        default: return "Network error (URLError \(error.code.rawValue))."
        }
    }
}
