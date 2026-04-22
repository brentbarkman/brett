import Foundation

/// Per-list item counts used by `ListsPage`'s cards.
///
/// Pure grouper kept separate from `ListsPage` so the bucketing rules can
/// be unit tested without SwiftUI or SwiftData. Callers fetch items once
/// and hand the array in; the page does not refetch per card.
enum ListCounts {
    struct Entry: Equatable {
        let active: Int
        let completed: Int
        let total: Int

        static let empty = Entry(active: 0, completed: 0, total: 0)
    }

    /// Bucket the given items by `listId`. Items without a `listId`, and
    /// items in the `.archived` status, are skipped — the counts match
    /// what a list card renders under its progress ring (total = active
    /// + completed; archived rows do not influence the ring).
    ///
    /// Callers are expected to pass already-non-soft-deleted items (the
    /// iOS `ItemStore.fetchAll()` predicate filters `deletedAt == nil`).
    static func groupByListId(_ items: [Item]) -> [String: Entry] {
        var active: [String: Int] = [:]
        var completed: [String: Int] = [:]
        for item in items {
            guard let listId = item.listId else { continue }
            switch item.itemStatus {
            case .archived:
                continue
            case .done:
                completed[listId, default: 0] += 1
            case .active, .snoozed:
                // Snoozed rows count as active under the progress ring:
                // they're not done and the user hasn't archived them.
                active[listId, default: 0] += 1
            }
        }
        var out: [String: Entry] = [:]
        for id in Set(active.keys).union(completed.keys) {
            let a = active[id] ?? 0
            let c = completed[id] ?? 0
            out[id] = Entry(active: a, completed: c, total: a + c)
        }
        return out
    }
}
