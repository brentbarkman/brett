import Foundation

/// A parsed Server-Sent Event from the Brett real-time stream.
///
/// Matches the wire format defined in `apps/api/src/routes/sse.ts`: each event
/// has a `type` (from the `event:` line), a JSON-decoded `data` payload (from
/// the `data:` line), and optionally an `id` (from the `id:` line). The server
/// does not currently emit `id:` lines, but we parse them anyway so future
/// Last-Event-ID resumption could drop in without reshaping the struct.
///
/// `data` is left as a loose `[String: Any]` because each event type has its
/// own payload shape and consumers in `SSEEventHandler` only read a handful of
/// fields. Strongly-typed per-event structs would be overkill given that the
/// handler's primary job is to invalidate caches and trigger a follow-up pull.
struct SSEEvent {
    let type: String
    let data: [String: Any]
    let id: String?

    /// Convenience initialiser for tests and for the parser.
    init(type: String, data: [String: Any] = [:], id: String? = nil) {
        self.type = type
        self.data = data
        self.id = id
    }

    /// Safely pull a string field out of `data`.
    func string(_ key: String) -> String? {
        data[key] as? String
    }
}

// MARK: - Sendable conformance

// `[String: Any]` isn't Sendable by default. We mark `SSEEvent` as Sendable
// via `@unchecked` below because the dictionary is only populated from
// `JSONSerialization` output (JSON primitives) and is read-only after init
// — callers never mutate it, and we never hand the same struct across
// isolation domains while also mutating.
extension SSEEvent: @unchecked Sendable {}

// MARK: - Known event types

/// The closed set of event types Brett emits. String-typed so unknown events
/// (added server-side before the client catches up) can still be received as
/// raw `SSEEvent.type` without crashing the parser.
///
/// Raw values MUST match the server's `publishSSE` calls — a typo here would
/// silently drop events. Compare against `packages/types/src/calendar.ts` and
/// `apps/api/src/routes/sse.ts` before editing.
enum SSEEventType: String, CaseIterable, Sendable {
    // Connection lifecycle
    case connected

    // Items (tasks / things)
    case itemCreated = "item.created"
    case itemUpdated = "item.updated"
    case itemDeleted = "item.deleted"

    // Lists
    case listCreated = "list.created"
    case listUpdated = "list.updated"
    case listDeleted = "list.deleted"

    // Calendar events
    case calendarEventCreated = "calendar_event.created"
    case calendarEventUpdated = "calendar_event.updated"
    case calendarEventDeleted = "calendar_event.deleted"

    // Calendar event notes
    case calendarEventNoteUpdated = "calendar_event_note.updated"

    // Scouts
    case scoutStatusChanged = "scout.status.changed"
    case scoutFindingCreated = "scout.finding.created"
    case scoutRunCompleted = "scout.run.completed"

    // Chat / messages
    case brettMessageCreated = "brett_message.created"

    // Attachments
    case attachmentCreated = "attachment.created"
    case attachmentDeleted = "attachment.deleted"

    // Content extraction pipeline
    case contentExtracted = "content.extracted"
}
