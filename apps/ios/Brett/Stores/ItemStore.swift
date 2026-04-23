import Foundation
import Observation
import SwiftData

/// Observable facade around SwiftData for Item queries + mutations.
///
/// Mutations also enqueue a `MutationQueueEntry` so the push engine (Wave 2)
/// has everything it needs: `changedFields`, `previousValues`, and a
/// `beforeSnapshot` for rollback on permanent failure.
///
/// Field-level wire format is defined in `Item+Fields.swift` via
/// `MutableFieldModel`. Adding a new mutable field is a one-place change —
/// the snapshot / apply / payload / previousValues helpers all read from it.
@MainActor
@Observable
final class ItemStore {
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

    /// All non-deleted items for the current user, newest first.
    ///
    /// `userId` scopes the query so data from a previous account never
    /// leaks into the current session — critical for shared-device and
    /// sign-out-then-sign-in flows (CLAUDE.md multi-user rule).
    /// Passing `nil` preserves legacy behavior (returns every user's rows)
    /// but should only be used by tests or sync internals.
    func fetchAll(
        userId: String? = nil,
        listId: String? = nil,
        status: ItemStatus? = nil
    ) -> [Item] {
        var descriptor = FetchDescriptor<Item>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        if let userId {
            descriptor.predicate = #Predicate { item in
                item.deletedAt == nil && item.userId == userId
            }
        } else {
            descriptor.predicate = #Predicate { item in
                item.deletedAt == nil
            }
        }
        let items = fetch(descriptor)
        return items.filter { item in
            if let listId, item.listId != listId { return false }
            if let status, item.status != status.rawValue { return false }
            return true
        }
    }

    /// Inbox = items with no list assigned and no due date (spec §UI).
    func fetchInbox(userId: String? = nil) -> [Item] {
        fetchAll(userId: userId).filter {
            $0.listId == nil && $0.dueDate == nil && $0.itemStatus == .active
        }
    }

    /// Today = due today or overdue, not yet done.
    func fetchToday(userId: String? = nil) -> [Item] {
        let calendar = Calendar.current
        let endOfToday = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: Date()) ?? Date()
        return fetchAll(userId: userId).filter { item in
            guard let due = item.dueDate,
                  item.itemStatus != .done,
                  item.itemStatus != .archived else { return false }
            return due <= endOfToday
        }
    }

    /// Upcoming = due after today, not yet done.
    func fetchUpcoming(userId: String? = nil) -> [Item] {
        let calendar = Calendar.current
        let endOfToday = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: Date()) ?? Date()
        return fetchAll(userId: userId)
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
        return fetch(descriptor).first
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

    /// Apply a changeset to an existing item. The store captures
    /// `previousValues` + `beforeSnapshot` from the model's current state
    /// *before* applying `changes` — callers must not pre-mutate the model.
    ///
    /// Preferred form for all new code. The 3-parameter overload below is
    /// kept for call sites (e.g. `ItemDraft`) that already captured the
    /// pre-edit state before the user began editing.
    func update(id: String, changes: [String: Any]) {
        guard let item = fetchById(id) else { return }
        let fields = Array(changes.keys)
        let capturedPrevious = item.previousValues(forFields: fields)
        applyUpdate(item: item, changes: changes, previousValues: capturedPrevious)
    }

    /// Apply a changeset using caller-supplied `previousValues`. Use when
    /// the caller already has the true pre-mutation state (e.g. a form
    /// draft that snapshotted on open). The caller MUST NOT have mutated
    /// the model yet — if they have, `beforeSnapshot` would record the
    /// post-mutation state and permanent-failure rollback would be a no-op.
    func update(
        id: String,
        changes: [String: Any],
        previousValues: [String: Any]
    ) {
        guard let item = fetchById(id) else { return }
        applyUpdate(item: item, changes: changes, previousValues: previousValues)
    }

    private func applyUpdate(
        item: Item,
        changes: [String: Any],
        previousValues: [String: Any]
    ) {
        // beforeSnapshot starts from the current full model state, then is
        // overridden for changed fields with the authoritative previousValues.
        // This defends against call sites that mutate the model before
        // calling update() — those fields still roll back correctly because
        // their pre-mutation values live in previousValues.
        var beforeSnapshot = item.mutableFieldSnapshot()
        for (field, oldValue) in previousValues {
            beforeSnapshot[field] = oldValue
        }

        item.apply(changes: changes)
        item.updatedAt = Date()
        if item._syncStatus == SyncStatus.synced.rawValue {
            item._syncStatus = SyncStatus.pendingUpdate.rawValue
        }

        enqueueUpdate(
            item,
            changedFields: Array(changes.keys),
            previousValues: previousValues,
            beforeSnapshot: beforeSnapshot
        )
        save()
        SyncManager.shared.schedulePushDebounced()
    }

    /// Toggle the done/active state of an item (common Inbox + Today action).
    /// Routes through `update(id:changes:)` so `beforeSnapshot` is captured
    /// from pre-mutation state — earlier versions mutated `item` first and
    /// then passed old values explicitly, which produced a post-mutation
    /// `beforeSnapshot` and silently broke permanent-failure rollback.
    func toggleStatus(id: String) {
        guard let item = fetchById(id) else { return }
        let wasDone = item.itemStatus == .done
        update(id: id, changes: [
            "status": wasDone ? ItemStatus.active.rawValue : ItemStatus.done.rawValue,
            "completedAt": wasDone ? NSNull() : Date(),
        ])
    }

    /// Soft-delete — sets `deletedAt` locally and enqueues a DELETE.
    func delete(id: String) {
        guard let item = fetchById(id) else { return }
        let before = item.mutableFieldSnapshot()
        item.deletedAt = Date()
        item._syncStatus = SyncStatus.pendingDelete.rawValue

        enqueueDelete(item, beforeSnapshot: before)
        save()
        SyncManager.shared.schedulePushDebounced()
    }

    // MARK: - Bulk mutate

    /// Apply the same changeset to every id. Per-item `previousValues` are
    /// captured inside `update(id:changes:)` so each enqueued mutation has
    /// the correct pre-mutation baseline.
    func bulkUpdate(ids: [String], changes: [String: Any]) {
        guard !ids.isEmpty, !changes.isEmpty else { return }
        for id in ids {
            update(id: id, changes: changes)
        }
    }

    /// Soft-delete many items at once.
    func bulkDelete(ids: [String]) {
        guard !ids.isEmpty else { return }
        for id in ids { delete(id: id) }
    }

    // MARK: - Internals

    private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
        do {
            return try context.fetch(descriptor)
        } catch {
            BrettLog.store.error("ItemStore fetch failed: \(String(describing: error), privacy: .public)")
            return []
        }
    }

    private func save() {
        do {
            try context.save()
        } catch {
            // Silent failures here used to mean edits vanished on restart
            // with no trace. Log at error level so sysdiagnose picks it up.
            BrettLog.store.error("ItemStore save failed: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Mutation queue enqueue

    private func enqueueCreate(_ item: Item) {
        // CREATE payload = full mutable snapshot + identity + ownership +
        // lifecycle timestamps. Intermediate fields (sourceUrl etc.) are
        // picked up via mutableFieldSnapshot so adding a new Field here is
        // a one-line edit in Item+Fields.swift.
        var payload: [String: Any] = item.mutableFieldSnapshot()
        payload["id"] = item.id
        payload["userId"] = item.userId
        payload["source"] = item.source
        payload["createdAt"] = item.createdAt
        payload["updatedAt"] = item.updatedAt

        mutationQueue.enqueue(
            entityType: "item",
            entityId: item.id,
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: JSONCodec.encode(payload)
        )
    }

    private func enqueueUpdate(
        _ item: Item,
        changedFields: [String],
        previousValues: [String: Any],
        beforeSnapshot: [String: Any]
    ) {
        let payload = item.patchPayload(for: changedFields)

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
    // Cached because this extension is called for every mutation payload
    // (ItemStore.enqueue*, ListStore.enqueue*, JSONCodec.normaliseScalar).
    // Immutable after init → safe to share.
    private static let sharedISO8601Formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// ISO-8601 with fractional seconds — matches the server wire format.
    func iso8601String() -> String {
        Date.sharedISO8601Formatter.string(from: self)
    }
}
