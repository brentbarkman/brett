import Foundation
import Observation
import SwiftData

/// Read-only facade for BrettMessage. New messages come through the chat
/// endpoint + SSE stream; this store just surfaces them for the UI.
///
/// Queries are optionally scoped to `userId` — an item or event id alone
/// isn't enough because a malicious or buggy sync could insert a message
/// with a foreign user's id that happens to share the same item/event id.
/// Callers that have a user in context should always pass it.
@MainActor
@Observable
final class MessageStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    func fetchForItem(_ itemId: String, userId: String? = nil) -> [BrettMessage] {
        var descriptor = FetchDescriptor<BrettMessage>(
            sortBy: [SortDescriptor(\.createdAt)]
        )
        if let userId {
            descriptor.predicate = #Predicate { message in
                message.itemId == itemId
                    && message.userId == userId
                    && message.deletedAt == nil
            }
        } else {
            descriptor.predicate = #Predicate { message in
                message.itemId == itemId && message.deletedAt == nil
            }
        }
        return fetch(descriptor)
    }

    func fetchForEvent(_ eventId: String, userId: String? = nil) -> [BrettMessage] {
        var descriptor = FetchDescriptor<BrettMessage>(
            sortBy: [SortDescriptor(\.createdAt)]
        )
        if let userId {
            descriptor.predicate = #Predicate { message in
                message.calendarEventId == eventId
                    && message.userId == userId
                    && message.deletedAt == nil
            }
        } else {
            descriptor.predicate = #Predicate { message in
                message.calendarEventId == eventId && message.deletedAt == nil
            }
        }
        return fetch(descriptor)
    }

    // MARK: - Internals

    private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
        do {
            return try context.fetch(descriptor)
        } catch {
            BrettLog.store.error("MessageStore fetch failed: \(String(describing: error), privacy: .public)")
            return []
        }
    }
}
