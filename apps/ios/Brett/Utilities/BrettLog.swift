import Foundation
import OSLog

/// Structured logging facade over `os.Logger`.
///
/// Why this exists:
///  - Replaces the project's ad-hoc `#if DEBUG print(...)` pattern with a
///    single discipline: log in Debug AND Release, but route through OSLog so
///    Release output lives in Console.app, stays bounded, and respects the
///    system privacy markers.
///  - Every `try? context.save()` in the store / sync layer used to swallow
///    errors silently. Handlers now call `BrettLog.store.error(...)` so a
///    disk-full / corrupt-store scenario becomes debuggable from a sysdiagnose.
///  - Enforces redaction at the call site. Strings containing user PII
///    (email, token, userId) pass through `.redacted(...)` helpers so OSLog
///    stores them as `<private>` in Release and plaintext in Debug.
///
/// Categories mirror the subsystems in the codebase so Console.app filtering
/// matches the mental model (auth / sync / push / pull / sse / store / ui /
/// attachments). Add a new category only when a new subsystem appears —
/// granular categories beat a single "default" bucket for production triage.
enum BrettLog {
    /// Matches the bundle id so sysdiagnose / Console filter cleanly.
    static let subsystem = "com.brett.app"

    static let auth = Logger(subsystem: subsystem, category: "auth")
    static let store = Logger(subsystem: subsystem, category: "store")
    static let sync = Logger(subsystem: subsystem, category: "sync")
    static let push = Logger(subsystem: subsystem, category: "push")
    static let pull = Logger(subsystem: subsystem, category: "pull")
    static let sse = Logger(subsystem: subsystem, category: "sse")
    static let attachments = Logger(subsystem: subsystem, category: "attachments")
    static let ui = Logger(subsystem: subsystem, category: "ui")
    static let app = Logger(subsystem: subsystem, category: "app")
}

// MARK: - Redaction helpers

extension BrettLog {
    /// Shortens a userId / entity id to its first 8 chars for log correlation
    /// without exposing the full identifier. Use this when the id is helpful
    /// for threading logs together but not sensitive enough to warrant
    /// full `<private>` treatment.
    static func shortId(_ id: String?) -> String {
        guard let id, !id.isEmpty else { return "<nil>" }
        return String(id.prefix(8))
    }

    /// Masks an email for logs — `"brent@example.com"` → `"b***@example.com"`.
    /// Not a security boundary; an auxiliary layer on top of OSLog's `<private>`.
    static func maskEmail(_ email: String?) -> String {
        guard let email, let at = email.firstIndex(of: "@") else { return "<nil>" }
        let local = email[..<at]
        let domain = email[at...]
        guard let first = local.first else { return "<\(domain)>" }
        return "\(first)***\(domain)"
    }
}
