import Foundation

/// Connection types that can issue a re-link task when an integration breaks.
/// Mirrors the `ConnectionType` union in `apps/api/src/lib/connection-health.ts`.
enum RelinkType: String {
    case googleCalendar = "google-calendar"
    case granola
    case ai

    /// The Settings tab that owns the reconnect flow for this integration.
    /// Granola folds into Calendar because its settings live as a section
    /// inside `CalendarSettingsView` (matching the desktop layout).
    var settingsTab: SettingsTab {
        switch self {
        case .googleCalendar, .granola: return .calendar
        case .ai: return .aiProviders
        }
    }
}

/// A re-link task surfaced in Today when an external integration breaks.
/// The API writes items with `source == "system"` and `sourceId == "relink:<type>:<accountId>"`.
struct RelinkTask: Equatable {
    let type: RelinkType

    static func parse(source: String?, sourceId: String?) -> RelinkTask? {
        guard source == "system",
              let sid = sourceId,
              sid.hasPrefix("relink:") else { return nil }

        let parts = sid.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        guard parts.count >= 2,
              let type = RelinkType(rawValue: String(parts[1])) else { return nil }

        return RelinkTask(type: type)
    }
}
