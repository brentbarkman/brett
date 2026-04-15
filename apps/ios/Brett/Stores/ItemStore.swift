import Foundation
import Observation
import SwiftData

/// Observable facade around SwiftData for Item queries + mutations.
///
/// Mutations also enqueue a `MutationQueueEntry` so the push engine (Wave 2)
/// has everything it needs: `changedFields`, `previousValues`, and a
/// `beforeSnapshot` for rollback on permanent failure.
@MainActor
@Observable
final class ItemStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    // MARK: - Fetch

    /// All non-deleted items for the current user, newest first.
    func fetchAll(listId: String? = nil, status: ItemStatus? = nil) -> [Item] {
        var descriptor = FetchDescriptor<Item>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        descriptor.predicate = #Predicate { item in
            item.deletedAt == nil
        }
        let items = (try? context.fetch(descriptor)) ?? []
        return items.filter { item in
            if let listId, item.listId != listId { return false }
            if let status, item.status != status.rawValue { return false }
            return true
        }
    }

    /// Inbox = items with no list assigned and no due date (spec §UI).
    func fetchInbox() -> [Item] {
        let items = fetchAll()
        return items.filter { $0.listId == nil && $0.dueDate == nil && $0.itemStatus == .active }
    }

    /// Today = due today or overdue, not yet done.
    func fetchToday() -> [Item] {
        let calendar = Calendar.current
        let endOfToday = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: Date()) ?? Date()
        let items = fetchAll()
        return items.filter { item in
            guard let due = item.dueDate, item.itemStatus != .done, item.itemStatus != .archived else { return false }
            return due <= endOfToday
        }
    }

    /// Upcoming = due after today, not yet done.
    func fetchUpcoming() -> [Item] {
        let calendar = Calendar.current
        let endOfToday = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: Date()) ?? Date()
        let items = fetchAll()
        return items
            .filter { item in
                guard let due = item.dueDate else { return false }
                return due > endOfToday && item.itemStatus != .done && item.itemStatus != .archived
            }
            .sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }
    }

    func fetchById(_ id: String) -> Item? {
        var descriptor = FetchDescriptor<Item>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    // MARK: - Mutate

    /// Create a new item locally and enqueue a CREATE mutation.
    @discardableResult
    func create(
        userId: String,
        title: String,
        type: ItemType = .task,
        status: ItemStatus = .active,
        dueDate: Date? = nil,
        listId: String? = nil,
        notes: String? = nil,
        source: String = "Brett"
    ) -> Item {
        let now = Date()
        let item = Item(
            userId: userId,
            type: type,
            status: status,
            title: title,
            source: source,
            dueDate: dueDate,
            listId: listId,
            notes: notes,
            createdAt: now,
            updatedAt: now
        )
        item._syncStatus = SyncStatus.pendingCreate.rawValue
        context.insert(item)

        enqueueCreate(item)
        save()
        SyncManager.shared.schedulePushDebounced()
        return item
    }

    /// Apply a changeset to an existing item.
    /// - Parameter changes: [fieldName: newValue] — the push engine uses
    ///   this + `previousValues` to perform field-level merge on conflict.
    /// - Parameter previousValues: [fieldName: oldValue] captured from the
    ///   item BEFORE the edit. Required for field-level conflict resolution.
    func update(
        id: String,
        changes: [String: Any],
        previousValues: [String: Any]
    ) {
        guard let item = fetchById(id) else { return }

        let before = snapshot(of: item)
        applyChanges(changes, to: item)

        item.updatedAt = Date()
        if item._syncStatus == SyncStatus.synced.rawValue {
            item._syncStatus = SyncStatus.pendingUpdate.rawValue
        }

        enqueueUpdate(
            item,
            changedFields: Array(changes.keys),
            previousValues: previousValues,
            beforeSnapshot: before
        )
        save()
        SyncManager.shared.schedulePushDebounced()
    }

    /// Toggle the done/active state of an item (common Inbox + Today action).
    func toggleStatus(id: String) {
        guard let item = fetchById(id) else { return }
        let wasDone = item.itemStatus == .done
        let previousStatus = item.status
        let previousCompletedAt = item.completedAt

        item.status = wasDone ? ItemStatus.active.rawValue : ItemStatus.done.rawValue
        item.completedAt = wasDone ? nil : Date()

        update(
            id: id,
            changes: [
                "status": item.status,
                "completedAt": item.completedAt as Any,
            ],
            previousValues: [
                "status": previousStatus,
                "completedAt": previousCompletedAt as Any,
            ]
        )
    }

    /// Soft-delete — sets `deletedAt` locally and enqueues a DELETE.
    func delete(id: String) {
        guard let item = fetchById(id) else { return }
        let before = snapshot(of: item)
        item.deletedAt = Date()
        item._syncStatus = SyncStatus.pendingDelete.rawValue

        enqueueDelete(item, beforeSnapshot: before)
        save()
        SyncManager.shared.schedulePushDebounced()
    }

    // MARK: - Bulk mutate

    /// Apply the same changeset to every id, computing per-item `previousValues`
    /// so field-level conflict resolution still works on the server.
    ///
    /// This simply enqueues one UPDATE mutation per item; the mutation queue's
    /// compactor coalesces redundant ops when it flushes.
    ///
    /// - Parameters:
    ///   - ids: item IDs to apply `changes` to. Missing IDs are silently skipped.
    ///   - changes: `[fieldName: newValue]`. The same values are applied to every
    ///     item, but previousValues are snapshotted per item (so the server
    ///     sees the correct base state for each).
    func bulkUpdate(ids: [String], changes: [String: Any]) {
        guard !ids.isEmpty, !changes.isEmpty else { return }
        for id in ids {
            guard let item = fetchById(id) else { continue }
            let previousValues = previousValuesForChanges(Array(changes.keys), on: item)
            update(id: id, changes: changes, previousValues: previousValues)
        }
    }

    /// Soft-delete many items at once. Enqueues one DELETE per item — the
    /// mutation queue compactor will collapse redundant ops.
    func bulkDelete(ids: [String]) {
        guard !ids.isEmpty else { return }
        for id in ids {
            delete(id: id)
        }
    }


    /// Snapshot the current value of a set of fields on an item. Used by
    /// `bulkUpdate` so each enqueued mutation has per-item previousValues.
    private func previousValuesForChanges(_ fields: [String], on item: Item) -> [String: Any] {
        var out: [String: Any] = [:]
        for field in fields {
            switch field {
            case "title": out["title"] = item.title
            case "description": out["description"] = item.itemDescription as Any
            case "notes": out["notes"] = item.notes as Any
            case "status": out["status"] = item.status
            case "type": out["type"] = item.type
            case "dueDate": out["dueDate"] = item.dueDate as Any
            case "dueDatePrecision": out["dueDatePrecision"] = item.dueDatePrecision as Any
            case "completedAt": out["completedAt"] = item.completedAt as Any
            case "snoozedUntil": out["snoozedUntil"] = item.snoozedUntil as Any
            case "listId": out["listId"] = item.listId as Any
            case "reminder": out["reminder"] = item.reminder as Any
            case "recurrence": out["recurrence"] = item.recurrence as Any
            case "recurrenceRule": out["recurrenceRule"] = item.recurrenceRule as Any
            case "brettObservation": out["brettObservation"] = item.brettObservation as Any
            case "sourceUrl": out["sourceUrl"] = item.sourceUrl as Any
            case "contentTitle": out["contentTitle"] = item.contentTitle as Any
            case "contentDescription": out["contentDescription"] = item.contentDescription as Any
            case "contentImageUrl": out["contentImageUrl"] = item.contentImageUrl as Any
            case "contentFavicon": out["contentFavicon"] = item.contentFavicon as Any
            case "contentDomain": out["contentDomain"] = item.contentDomain as Any
            default: continue
            }
        }
        return out
    }

    // MARK: - Helpers

    private func save() {
        do {
            try context.save()
        } catch {
            #if DEBUG
            print("[ItemStore] save failed: \(error)")
            #endif
        }
    }

    /// Apply a field-level changeset to an Item. Only known keys are written;
    /// unknown keys are ignored (forward-compatibility with server additions).
    private func applyChanges(_ changes: [String: Any], to item: Item) {
        for (key, value) in changes {
            switch key {
            case "title": if let v = value as? String { item.title = v }
            case "description": item.itemDescription = value as? String
            case "notes": item.notes = value as? String
            case "status": if let v = value as? String { item.status = v }
            case "type": if let v = value as? String { item.type = v }
            case "dueDate": item.dueDate = value as? Date
            case "dueDatePrecision": item.dueDatePrecision = value as? String
            case "completedAt": item.completedAt = value as? Date
            case "snoozedUntil": item.snoozedUntil = value as? Date
            case "listId": item.listId = value as? String
            case "reminder": item.reminder = value as? String
            case "recurrence": item.recurrence = value as? String
            case "recurrenceRule": item.recurrenceRule = value as? String
            case "brettObservation": item.brettObservation = value as? String
            case "sourceUrl": item.sourceUrl = value as? String
            case "contentTitle": item.contentTitle = value as? String
            case "contentDescription": item.contentDescription = value as? String
            case "contentImageUrl": item.contentImageUrl = value as? String
            case "contentFavicon": item.contentFavicon = value as? String
            case "contentDomain": item.contentDomain = value as? String
            default: continue
            }
        }
    }

    private func snapshot(of item: Item) -> [String: Any] {
        [
            "id": item.id,
            "title": item.title,
            "description": item.itemDescription as Any,
            "notes": item.notes as Any,
            "status": item.status,
            "type": item.type,
            "dueDate": item.dueDate as Any,
            "listId": item.listId as Any,
            "completedAt": item.completedAt as Any,
            "snoozedUntil": item.snoozedUntil as Any,
            "updatedAt": item.updatedAt,
        ]
    }

    // MARK: - Mutation queue enqueue

    private func enqueueCreate(_ item: Item) {
        let payload: [String: Any] = [
            "id": item.id,
            "type": item.type,
            "status": item.status,
            "title": item.title,
            "userId": item.userId,
            "dueDate": (item.dueDate?.iso8601String() as Any),
            "listId": (item.listId as Any),
            "notes": (item.notes as Any),
            "source": item.source,
            "createdAt": item.createdAt.iso8601String(),
            "updatedAt": item.updatedAt.iso8601String(),
        ]

        let entry = MutationQueueEntry(
            entityType: "item",
            entityId: item.id,
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: JSONCodec.encode(payload),
            baseUpdatedAt: nil,
            beforeSnapshot: nil
        )
        context.insert(entry)
    }

    private func enqueueUpdate(
        _ item: Item,
        changedFields: [String],
        previousValues: [String: Any],
        beforeSnapshot: [String: Any]
    ) {
        let payload = payloadForUpdate(item: item, changedFields: changedFields)

        let entry = MutationQueueEntry(
            entityType: "item",
            entityId: item.id,
            action: .update,
            endpoint: "/things/\(item.id)",
            method: .patch,
            payload: JSONCodec.encode(payload),
            changedFields: JSONCodec.encode(changedFields),
            previousValues: JSONCodec.encode(previousValues),
            baseUpdatedAt: item._baseUpdatedAt,
            beforeSnapshot: JSONCodec.encode(beforeSnapshot)
        )
        context.insert(entry)
    }

    private func enqueueDelete(_ item: Item, beforeSnapshot: [String: Any]) {
        let entry = MutationQueueEntry(
            entityType: "item",
            entityId: item.id,
            action: .delete,
            endpoint: "/things/\(item.id)",
            method: .delete,
            payload: "{}",
            baseUpdatedAt: item._baseUpdatedAt,
            beforeSnapshot: JSONCodec.encode(beforeSnapshot)
        )
        context.insert(entry)
    }

    private func payloadForUpdate(item: Item, changedFields: [String]) -> [String: Any] {
        var out: [String: Any] = [:]
        for field in changedFields {
            switch field {
            case "title": out["title"] = item.title
            case "description": out["description"] = item.itemDescription as Any
            case "notes": out["notes"] = item.notes as Any
            case "status": out["status"] = item.status
            case "type": out["type"] = item.type
            case "dueDate": out["dueDate"] = item.dueDate?.iso8601String() as Any
            case "dueDatePrecision": out["dueDatePrecision"] = item.dueDatePrecision as Any
            case "completedAt": out["completedAt"] = item.completedAt?.iso8601String() as Any
            case "snoozedUntil": out["snoozedUntil"] = item.snoozedUntil?.iso8601String() as Any
            case "listId": out["listId"] = item.listId as Any
            case "reminder": out["reminder"] = item.reminder as Any
            case "recurrence": out["recurrence"] = item.recurrence as Any
            case "recurrenceRule": out["recurrenceRule"] = item.recurrenceRule as Any
            case "brettObservation": out["brettObservation"] = item.brettObservation as Any
            case "sourceUrl": out["sourceUrl"] = item.sourceUrl as Any
            case "contentTitle": out["contentTitle"] = item.contentTitle as Any
            case "contentDescription": out["contentDescription"] = item.contentDescription as Any
            case "contentImageUrl": out["contentImageUrl"] = item.contentImageUrl as Any
            case "contentFavicon": out["contentFavicon"] = item.contentFavicon as Any
            case "contentDomain": out["contentDomain"] = item.contentDomain as Any
            default: continue
            }
        }
        return out
    }
}

// MARK: - Shared JSON helper

enum JSONCodec {
    /// Encodes a `[String: Any]` (including `NSNull`-bridgeable values) into a compact JSON string.
    /// Nil values are preserved as JSON `null`. Non-JSON values (eg `Date`) are stringified.
    static func encode(_ value: Any) -> String {
        let normalised = normalise(value)
        do {
            let data = try JSONSerialization.data(withJSONObject: normalised, options: [])
            return String(data: data, encoding: .utf8) ?? "null"
        } catch {
            return "null"
        }
    }

    private static func normalise(_ value: Any) -> Any {
        if let dict = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (k, v) in dict {
                if let opt = v as? OptionalProtocol, opt.isNil {
                    out[k] = NSNull()
                } else {
                    out[k] = normaliseScalar(v)
                }
            }
            return out
        }
        if let array = value as? [Any] {
            return array.map { normaliseScalar($0) }
        }
        return normaliseScalar(value)
    }

    private static func normaliseScalar(_ value: Any) -> Any {
        if let date = value as? Date {
            return date.iso8601String()
        }
        if let dict = value as? [String: Any] { return normalise(dict) }
        if let array = value as? [Any] { return normalise(array) }
        return value
    }
}

private protocol OptionalProtocol {
    var isNil: Bool { get }
}
extension Optional: OptionalProtocol {
    var isNil: Bool {
        if case .none = self { return true }
        return false
    }
}

extension Date {
    /// ISO-8601 with fractional seconds — matches the server wire format.
    func iso8601String() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: self)
    }
}
