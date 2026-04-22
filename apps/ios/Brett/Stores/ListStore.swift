import Foundation
import Observation
import SwiftData

@MainActor
@Observable
final class ListStore {
    private let context: ModelContext
    // Lazy so tests/previews that never enqueue don't pay the allocation,
    // and so the queue always shares the store's ModelContext.
    private lazy var mutationQueue: MutationQueue = MutationQueue(context: context)

    init(context: ModelContext) {
        self.context = context
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    // MARK: - Fetch

    func fetchAll(includeArchived: Bool = false) -> [ItemList] {
        var descriptor = FetchDescriptor<ItemList>(
            sortBy: [SortDescriptor(\.sortOrder)]
        )
        descriptor.predicate = #Predicate { list in
            list.deletedAt == nil
        }
        let lists = (try? context.fetch(descriptor)) ?? []
        return lists.filter { includeArchived || $0.archivedAt == nil }
    }

    func fetchById(_ id: String) -> ItemList? {
        var descriptor = FetchDescriptor<ItemList>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    // MARK: - Mutate

    @discardableResult
    func create(userId: String, name: String, colorClass: String = "bg-gray-500") -> ItemList {
        let now = Date()
        let list = ItemList(
            userId: userId,
            name: name,
            colorClass: colorClass,
            sortOrder: nextSortOrder(),
            createdAt: now,
            updatedAt: now
        )
        list._syncStatus = SyncStatus.pendingCreate.rawValue
        context.insert(list)
        enqueueCreate(list)
        save()
        SyncManager.shared.schedulePushDebounced()
        return list
    }

    func update(id: String, changes: [String: Any], previousValues: [String: Any]) {
        guard let list = fetchById(id) else { return }
        let before = snapshot(of: list)

        for (key, value) in changes {
            switch key {
            case "name": if let v = value as? String { list.name = v }
            case "colorClass": if let v = value as? String { list.colorClass = v }
            case "sortOrder": if let v = value as? Int { list.sortOrder = v }
            case "archivedAt": list.archivedAt = value as? Date
            default: continue
            }
        }
        list.updatedAt = Date()
        if list._syncStatus == SyncStatus.synced.rawValue {
            list._syncStatus = SyncStatus.pendingUpdate.rawValue
        }
        enqueueUpdate(
            list,
            changedFields: Array(changes.keys),
            previousValues: previousValues,
            beforeSnapshot: before
        )
        save()
        SyncManager.shared.schedulePushDebounced()
    }

    func archive(id: String) {
        guard let list = fetchById(id) else { return }
        update(
            id: id,
            changes: ["archivedAt": Date()],
            previousValues: ["archivedAt": list.archivedAt as Any]
        )
    }

    func unarchive(id: String) {
        guard let list = fetchById(id) else { return }
        update(
            id: id,
            changes: ["archivedAt": NSNull()],
            previousValues: ["archivedAt": list.archivedAt as Any]
        )
    }

    func reorder(ids: [String]) {
        for (index, id) in ids.enumerated() {
            guard let list = fetchById(id) else { continue }
            let previous = list.sortOrder
            if previous != index {
                update(
                    id: id,
                    changes: ["sortOrder": index],
                    previousValues: ["sortOrder": previous]
                )
            }
        }
    }

    // MARK: - Helpers

    private func nextSortOrder() -> Int {
        let existing = fetchAll(includeArchived: true)
        return (existing.map(\.sortOrder).max() ?? -1) + 1
    }

    private func save() {
        try? context.save()
    }

    private func snapshot(of list: ItemList) -> [String: Any] {
        [
            "id": list.id,
            "name": list.name,
            "colorClass": list.colorClass,
            "sortOrder": list.sortOrder,
            "archivedAt": list.archivedAt as Any,
            "updatedAt": list.updatedAt,
        ]
    }

    private func enqueueCreate(_ list: ItemList) {
        let payload: [String: Any] = [
            "id": list.id,
            "name": list.name,
            "colorClass": list.colorClass,
            "sortOrder": list.sortOrder,
            "userId": list.userId,
            "createdAt": list.createdAt.iso8601String(),
            "updatedAt": list.updatedAt.iso8601String(),
        ]
        // Route through MutationQueue so eager compaction runs.
        mutationQueue.enqueue(
            entityType: "list",
            entityId: list.id,
            action: .create,
            endpoint: "/lists",
            method: .post,
            payload: JSONCodec.encode(payload)
        )
    }

    private func enqueueUpdate(
        _ list: ItemList,
        changedFields: [String],
        previousValues: [String: Any],
        beforeSnapshot: [String: Any]
    ) {
        var payload: [String: Any] = [:]
        for field in changedFields {
            switch field {
            case "name": payload["name"] = list.name
            case "colorClass": payload["colorClass"] = list.colorClass
            case "sortOrder": payload["sortOrder"] = list.sortOrder
            case "archivedAt": payload["archivedAt"] = list.archivedAt?.iso8601String() as Any
            default: continue
            }
        }
        let entry = MutationQueueEntry(
            entityType: "list",
            entityId: list.id,
            action: .update,
            endpoint: "/lists/\(list.id)",
            method: .patch,
            payload: JSONCodec.encode(payload),
            changedFields: JSONCodec.encode(changedFields),
            previousValues: JSONCodec.encode(previousValues),
            baseUpdatedAt: list._baseUpdatedAt,
            beforeSnapshot: JSONCodec.encode(beforeSnapshot)
        )
        context.insert(entry)
    }
}
