import Foundation
import Observation
import SwiftData

/// Read-only for `CalendarEvent` (events come from Google via the pull API).
/// Writable for `CalendarEventNote` — those are user-owned free-form notes.
@MainActor
@Observable
final class CalendarStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    // MARK: - Events (read-only)

    func fetchEvents(startDate: Date, endDate: Date) -> [CalendarEvent] {
        var descriptor = FetchDescriptor<CalendarEvent>(
            sortBy: [SortDescriptor(\.startTime)]
        )
        descriptor.predicate = #Predicate { event in
            event.deletedAt == nil
        }
        let events = (try? context.fetch(descriptor)) ?? []
        return events.filter { event in
            event.startTime < endDate && event.endTime > startDate
        }
    }

    func fetchById(_ id: String) -> CalendarEvent? {
        var descriptor = FetchDescriptor<CalendarEvent>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    // MARK: - Notes (read/write)

    func fetchNote(for eventId: String) -> CalendarEventNote? {
        var descriptor = FetchDescriptor<CalendarEventNote>()
        descriptor.predicate = #Predicate { note in
            note.calendarEventId == eventId && note.deletedAt == nil
        }
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    /// Upsert a note's content for the given event. Enqueues CREATE or UPDATE.
    @discardableResult
    func upsertNote(eventId: String, userId: String, content: String) -> CalendarEventNote {
        if let existing = fetchNote(for: eventId) {
            let previous = existing.content
            existing.content = content
            existing.updatedAt = Date()
            if existing._syncStatus == SyncStatus.synced.rawValue {
                existing._syncStatus = SyncStatus.pendingUpdate.rawValue
            }

            let entry = MutationQueueEntry(
                entityType: "calendar_event_note",
                entityId: existing.id,
                action: .update,
                endpoint: "/calendar/events/\(eventId)/note",
                method: .patch,
                payload: JSONCodec.encode(["content": content]),
                changedFields: JSONCodec.encode(["content"]),
                previousValues: JSONCodec.encode(["content": previous]),
                baseUpdatedAt: existing._baseUpdatedAt
            )
            context.insert(entry)
            save()
            SyncManager.shared.schedulePushDebounced()
            return existing
        }

        let note = CalendarEventNote(
            calendarEventId: eventId,
            userId: userId,
            content: content
        )
        note._syncStatus = SyncStatus.pendingCreate.rawValue
        context.insert(note)

        let payload: [String: Any] = [
            "id": note.id,
            "calendarEventId": eventId,
            "userId": userId,
            "content": content,
            "createdAt": note.createdAt.iso8601String(),
            "updatedAt": note.updatedAt.iso8601String(),
        ]
        let entry = MutationQueueEntry(
            entityType: "calendar_event_note",
            entityId: note.id,
            action: .create,
            endpoint: "/calendar/events/\(eventId)/note",
            method: .post,
            payload: JSONCodec.encode(payload)
        )
        context.insert(entry)

        save()
        SyncManager.shared.schedulePushDebounced()
        return note
    }

    private func save() {
        try? context.save()
    }
}
