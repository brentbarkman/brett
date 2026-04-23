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

    /// Events that overlap the window `[startDate, endDate)` for the given
    /// user. The overlap predicate (`startTime < endDate AND endTime >
    /// startDate`) runs in SQLite — previously this fetched every row and
    /// filtered in Swift, which was a perf cliff on accounts with thousands
    /// of historical events. `userId` scopes the query so a prior account's
    /// events never surface during an account switch.
    func fetchEvents(userId: String?, startDate: Date, endDate: Date) -> [CalendarEvent] {
        var descriptor = FetchDescriptor<CalendarEvent>(
            sortBy: [SortDescriptor(\.startTime)]
        )
        if let userId {
            descriptor.predicate = #Predicate { event in
                event.deletedAt == nil
                    && event.userId == userId
                    && event.startTime < endDate
                    && event.endTime > startDate
            }
        } else {
            descriptor.predicate = #Predicate { event in
                event.deletedAt == nil
                    && event.startTime < endDate
                    && event.endTime > startDate
            }
        }
        return fetch(descriptor)
    }

    func fetchById(_ id: String) -> CalendarEvent? {
        var descriptor = FetchDescriptor<CalendarEvent>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return fetch(descriptor).first
    }

    // MARK: - Notes (read/write)

    func fetchNote(for eventId: String) -> CalendarEventNote? {
        var descriptor = FetchDescriptor<CalendarEventNote>()
        descriptor.predicate = #Predicate { note in
            note.calendarEventId == eventId && note.deletedAt == nil
        }
        descriptor.fetchLimit = 1
        return fetch(descriptor).first
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
            "createdAt": note.createdAt,
            "updatedAt": note.updatedAt,
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

    // MARK: - Internals

    private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
        do {
            return try context.fetch(descriptor)
        } catch {
            BrettLog.store.error("CalendarStore fetch failed: \(String(describing: error), privacy: .public)")
            return []
        }
    }

    private func save() {
        do {
            try context.save()
        } catch {
            BrettLog.store.error("CalendarStore save failed: \(String(describing: error), privacy: .public)")
        }
    }
}
