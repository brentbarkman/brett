import Foundation
import Observation
import SwiftData

/// Read-only facade for BrettMessage. New messages come through the chat
/// endpoint + SSE stream; this store just surfaces them for the UI.
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

    func fetchForItem(_ itemId: String) -> [BrettMessage] {
        var descriptor = FetchDescriptor<BrettMessage>(
            sortBy: [SortDescriptor(\.createdAt)]
        )
        descriptor.predicate = #Predicate { message in
            message.itemId == itemId && message.deletedAt == nil
        }
        return (try? context.fetch(descriptor)) ?? []
    }

    func fetchForEvent(_ eventId: String) -> [BrettMessage] {
        var descriptor = FetchDescriptor<BrettMessage>(
            sortBy: [SortDescriptor(\.createdAt)]
        )
        descriptor.predicate = #Predicate { message in
            message.calendarEventId == eventId && message.deletedAt == nil
        }
        return (try? context.fetch(descriptor)) ?? []
    }
}
