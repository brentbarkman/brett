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
final class ItemStore: Clearable {
    private let context: ModelContext
    /// Injection seam for `context.save()` so mutation atomicity tests can
    /// simulate save failures and assert the store rolls back. Production
    /// callers leave this defaulted to `LiveSaver(context: context)`.
    @ObservationIgnored private let saver: ModelContextSaving
    /// Sync trigger captured at init so the store stops reading
    /// `ActiveSession.syncManager` on every mutation. `weak` because the
    /// trigger (`SyncManager`) is owned by `Session`, which can be torn
    /// down on sign-out before the store; we don't want to extend its
    /// lifetime. Optional so tests/preview-only stores can omit it.
    @ObservationIgnored private weak var syncManager: SyncTrigger?

    init(
        context: ModelContext,
        saver: ModelContextSaving? = nil,
        syncManager: SyncTrigger? = ActiveSession.syncManager
    ) {
        self.context = context
        self.saver = saver ?? LiveSaver(context: context)
        self.syncManager = syncManager
        ClearableStoreRegistry.register(self)
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    // MARK: - Clearable

    /// No in-memory caches today — every read goes through SwiftData
    /// `@Query` or `fetch()`. Conformance exists so the regression-guard
    /// test in `ClearableConformanceTests` passes; Wave B may fill this in
    /// if any per-instance caches get added.
    func clearForSignOut() {}

    // MARK: - Internal lookup

    /// Locate the row a mutation is about to act on.
    ///
    /// Private — the only callers are the store's own `update` / `delete` /
    /// `toggleStatus` paths plus the `commit` extension. Views read items
    /// via `@Query` directly; the previous public `fetchById(_:userId:)` was
    /// removed in Wave B along with `fetchAll` / `fetchInbox` / `fetchToday`
    /// / `fetchUpcoming`.
    ///
    /// `userId` scopes the lookup so a mutation issued from one user's flow
    /// can never target a row belonging to a different account that's still
    /// lingering in SwiftData (e.g. between sign-out and the wipe completing).
    private func findById(_ id: String, userId: String) -> Item? {
        var descriptor = FetchDescriptor<Item>(
            predicate: #Predicate { $0.id == id && $0.userId == userId }
        )
        descriptor.fetchLimit = 1
        return fetch(descriptor).first
    }

    // MARK: - Mutate

    /// Create a new item locally and enqueue a CREATE mutation.
    ///
    /// The optimistic insert + queued mutation are committed in a single
    /// `context.save()`. If that save fails the rollback discards both,
    /// keeping the model and the mutation queue in lockstep — without
    /// rollback, a partial-failure leaves a row visible to `@Query` with
    /// no queue entry, and the create never reaches the server.
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
    ) throws -> Item {
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

        do {
            try saver.save()
        } catch {
            // Rollback discards both the optimistic item insert AND the
            // queued mutation entry so model + queue stay aligned.
            saver.rollback()
            logSaveFailure("create", error)
            throw error
        }

        syncManager?.schedulePushDebounced()
        return item
    }

    /// Apply a changeset to an existing item. The store captures
    /// `previousValues` + `beforeSnapshot` from the model's current state
    /// *before* applying `changes` — callers must not pre-mutate the model.
    ///
    /// Preferred form for all new code. The 3-parameter overload below is
    /// kept for call sites (e.g. `ItemDraft`) that already captured the
    /// pre-edit state before the user began editing.
    ///
    /// `userId` scopes the row lookup so a caller from one user's flow
    /// can never mutate a row belonging to a different account that's
    /// still lingering in SwiftData.
    func update(id: String, changes: [String: Any], userId: String) {
        guard let item = findById(id, userId: userId) else { return }
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
        previousValues: [String: Any],
        userId: String
    ) {
        guard let item = findById(id, userId: userId) else { return }
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

        do {
            try saver.save()
        } catch {
            // Rollback the in-memory mutation AND the queued
            // MutationQueueEntry insert together. Without this, the field
            // change would remain visible to @Query while the queue had no
            // entry, so the edit would never reach the server.
            saver.rollback()
            logSaveFailure("applyUpdate", error)
            return
        }

        syncManager?.schedulePushDebounced()
    }

    /// Toggle the done/active state of an item (common Inbox + Today action).
    /// Routes through `update(id:changes:userId:)` so `beforeSnapshot` is
    /// captured from pre-mutation state — earlier versions mutated `item`
    /// first and then passed old values explicitly, which produced a
    /// post-mutation `beforeSnapshot` and silently broke
    /// permanent-failure rollback.
    func toggleStatus(id: String, userId: String) {
        guard let item = findById(id, userId: userId) else { return }
        let wasDone = item.itemStatus == .done
        update(
            id: id,
            changes: [
                "status": wasDone ? ItemStatus.active.rawValue : ItemStatus.done.rawValue,
                "completedAt": wasDone ? NSNull() : Date(),
            ],
            userId: userId
        )
    }

    /// Soft-delete — sets `deletedAt` locally and enqueues a DELETE.
    func delete(id: String, userId: String) {
        guard let item = findById(id, userId: userId) else { return }
        let before = item.mutableFieldSnapshot()
        item.deletedAt = Date()
        item._syncStatus = SyncStatus.pendingDelete.rawValue

        enqueueDelete(item, beforeSnapshot: before)

        do {
            try saver.save()
        } catch {
            // Rollback restores `deletedAt = nil` and discards the queued
            // DELETE entry — model + queue stay in lockstep.
            saver.rollback()
            logSaveFailure("delete", error)
            return
        }

        syncManager?.schedulePushDebounced()
    }

    // MARK: - Bulk mutate

    /// Apply the same changeset to every id, in a single transaction.
    ///
    /// **Atomicity:** Per-bulk. All rows + queue entries land or none do —
    /// if `saver.save()` throws, `saver.rollback()` reverts every model
    /// mutation AND every queued `MutationQueueEntry` together. The error
    /// is rethrown so callers can show a haptic-error fallback. Replaces
    /// the previous per-item-loop implementation, which committed each
    /// item in its own save and could leave the user with partial
    /// completion (e.g. items 1-4 committed, items 5-10 dropped) and no
    /// UI signal.
    ///
    /// Per-item `previousValues` are captured before any mutation so each
    /// enqueued UPDATE carries the correct pre-mutation baseline for
    /// server-side conflict resolution.
    @discardableResult
    func bulkUpdate(ids: [String], changes: [String: Any], userId: String) throws -> Int {
        guard !ids.isEmpty, !changes.isEmpty else { return 0 }
        let rows = ids.compactMap { findById($0, userId: userId) }
        guard !rows.isEmpty else { return 0 }

        let fields = Array(changes.keys)

        // Capture pre-mutation `previousValues` + `beforeSnapshot` for each
        // row BEFORE applying the changes. Doing this in a separate pass
        // means a row's enqueued mutation always sees its own pristine
        // baseline, never a sibling's post-mutation state.
        var perRow: [(item: Item, previousValues: [String: Any], beforeSnapshot: [String: Any])] = []
        perRow.reserveCapacity(rows.count)
        for row in rows {
            let capturedPrevious = row.previousValues(forFields: fields)
            var beforeSnapshot = row.mutableFieldSnapshot()
            for (field, oldValue) in capturedPrevious {
                beforeSnapshot[field] = oldValue
            }
            perRow.append((item: row, previousValues: capturedPrevious, beforeSnapshot: beforeSnapshot))
        }

        // Apply the optimistic mutation + enqueue + compact-and-apply for
        // each row. No `saver.save()` inside the loop — one save at the
        // end commits everything atomically.
        let now = Date()
        for entry in perRow {
            entry.item.apply(changes: changes)
            entry.item.updatedAt = now
            if entry.item._syncStatus == SyncStatus.synced.rawValue {
                entry.item._syncStatus = SyncStatus.pendingUpdate.rawValue
            }
            enqueueUpdate(
                entry.item,
                changedFields: fields,
                previousValues: entry.previousValues,
                beforeSnapshot: entry.beforeSnapshot
            )
        }

        do {
            try saver.save()
        } catch {
            // Rollback reverts every row's field changes AND every queued
            // MutationQueueEntry — model + queue stay in lockstep across
            // the whole batch.
            saver.rollback()
            logSaveFailure("bulkUpdate", error)
            throw error
        }

        syncManager?.schedulePushDebounced()
        return rows.count
    }

    /// Soft-delete many items at once, in a single transaction.
    ///
    /// **Atomicity:** Per-bulk. Either every row's `deletedAt` is set and
    /// every DELETE entry lands, or `saver.rollback()` reverts everything.
    /// The error is rethrown so callers can show a haptic-error fallback.
    @discardableResult
    func bulkDelete(ids: [String], userId: String) throws -> Int {
        guard !ids.isEmpty else { return 0 }
        let rows = ids.compactMap { findById($0, userId: userId) }
        guard !rows.isEmpty else { return 0 }

        for row in rows {
            let before = row.mutableFieldSnapshot()
            row.deletedAt = Date()
            row._syncStatus = SyncStatus.pendingDelete.rawValue
            enqueueDelete(row, beforeSnapshot: before)
        }

        do {
            try saver.save()
        } catch {
            saver.rollback()
            logSaveFailure("bulkDelete", error)
            throw error
        }

        syncManager?.schedulePushDebounced()
        return rows.count
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

    /// Shared rollback-log shape so each catch site doesn't repeat the
    /// store name + " save failed: " prefix. `Self.self` keeps the store
    /// name auto-attached even if this is ever copied to another store.
    private func logSaveFailure(_ operation: String, _ error: Error) {
        BrettLog.store.error("\(Self.self) \(operation) save failed: \(String(describing: error), privacy: .public)")
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

        let entry = MutationQueueEntry(
            entityType: "item",
            entityId: item.id,
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: JSONCodec.encode(payload)
        )
        MutationCompactor.compactAndApply(entry, in: context)
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
        MutationCompactor.compactAndApply(entry, in: context)
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
        MutationCompactor.compactAndApply(entry, in: context)
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
    /// Routes through the shared `BrettDate` formatter so there's a single
    /// source of truth for format options.
    func iso8601String() -> String {
        BrettDate.isoString(self)
    }
}
