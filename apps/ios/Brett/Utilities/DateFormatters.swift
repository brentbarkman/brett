import Foundation

/// Shared ISO-8601 formatters for the project's wire format.
///
/// Prisma emits `YYYY-MM-DDTHH:mm:ss.sssZ`. We cache a single formatter
/// per variant so the sync engine (hundreds of parse calls per pull) and
/// the mutation queue (one encode per field change) aren't reallocating.
///
/// `ISO8601DateFormatter` is documented as safe to read concurrently once
/// configured — configuration is immutable after `init`. Swift 6 still
/// flags it as non-Sendable at the type level, so the statics are marked
/// `nonisolated(unsafe)`. Do NOT mutate `formatOptions` after the statics
/// are initialized.
enum BrettDate {
    nonisolated(unsafe) static let iso8601WithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    nonisolated(unsafe) static let iso8601NoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Format a `Date` as ISO-8601 with fractional seconds (matches server).
    static func isoString(_ date: Date) -> String {
        iso8601WithFractional.string(from: date)
    }

    /// Optional convenience — returns nil for nil input.
    static func isoString(_ date: Date?) -> String? {
        date.map(isoString)
    }

    /// Parse an ISO-8601 string, tolerant of the server-emitted fractional
    /// form and the older no-fractional form. Returns nil for empty / non-string
    /// input so callers can use it directly against `Any?` dict values.
    static func parseISO(_ raw: Any?) -> Date? {
        guard let str = raw as? String, !str.isEmpty else { return nil }
        if let d = iso8601WithFractional.date(from: str) { return d }
        return iso8601NoFractional.date(from: str)
    }
}
