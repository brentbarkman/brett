import Foundation
import Observation
import SwiftData

/// Observable facade around SwiftData for `ItemList` queries + mutations.
///
/// Field-level wire format is declared in `ItemList+Fields.swift` via
/// `MutableFieldModel`; snapshot / apply / payload all derive from it so
/// adding a mutable field is a one-place change.
@MainActor
@Observable
final class ListStore: Clearable {
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

    /// No in-memory caches today — reads go through SwiftData. Conformance
    /// exists so the regression-guard test passes; Wave B may flesh this
    /// out if per-instance state appears.
    func clearForSignOut() {}

    // MARK: - Internal lookup

    /// Locate the row a mutation is about to act on.
    ///
    /// Private — the only callers are the store's own `update` /
    /// `archive` / `unarchive` / `reorder` paths. Views read lists via
    /// `@Query` directly; the previous public `fetchAll` / `fetchById`
    /// methods were removed in Wave B.
    ///
    /// `userId` scopes the lookup so a mutation issued from one user's flow
    /// can never target a row belonging to a different account that's still
    /// lingering in SwiftData.
    private func findById(_ id: String, userId: String) -> ItemList? {
        var descriptor = FetchDescriptor<ItemList>(
            predicate: #Predicate { $0.id == id && $0.userId == userId }
        )
        descriptor.fetchLimit = 1
        return fetch(descriptor).first
    }

    // MARK: - Mutate

    /// Create a new list locally and enqueue a CREATE mutation.
    ///
    /// The optimistic insert + queued mutation are committed in a single
    /// `context.save()`. If that save fails, the rollback discards both,
    /// keeping the model and the mutation queue in lockstep — without
    /// rollback, a partial-failure leaves a row visible to `@Query` with
    /// no queue entry, and the create never reaches the server.
    @discardableResult
    func create(userId: String, name: String, colorClass: String = "bg-gray-500") throws -> ItemList {
        let now = Date()
        let list = ItemList(
            userId: userId,
            name: name,
            colorClass: colorClass,
            sortOrder: nextSortOrder(userId: userId),
            createdAt: now,
            updatedAt: now
        )
        list._syncStatus = SyncStatus.pendingCreate.rawValue
        context.insert(list)
        enqueueCreate(list)

        do {
            try saver.save()
        } catch {
            // Rollback discards both the optimistic list insert AND the
            // queued mutation entry so model + queue stay aligned.
            saver.rollback()
            logSaveFailure("create", error)
            throw error
        }

        syncManager?.schedulePushDebounced()
        return list
    }

    /// Apply a changeset to an existing list. Store captures `previousValues`
    /// and `beforeSnapshot` from the model's current state — callers MUST
    /// NOT pre-mutate the model (see ItemStore for rationale).
    func update(id: String, changes: [String: Any], userId: String) {
        guard let list = findById(id, userId: userId) else { return }
        let fields = Array(changes.keys)
        let capturedPrevious = list.previousValues(forFields: fields)
        applyUpdate(list: list, changes: changes, previousValues: capturedPrevious)
    }

    /// Apply a changeset using caller-supplied `previousValues`. Use when
    /// the caller already captured the pre-edit state (e.g. a settings
    /// form snapshotted on open).
    func update(id: String, changes: [String: Any], previousValues: [String: Any], userId: String) {
        guard let list = findById(id, userId: userId) else { return }
        applyUpdate(list: list, changes: changes, previousValues: previousValues)
    }

    private func applyUpdate(
        list: ItemList,
        changes: [String: Any],
        previousValues: [String: Any]
    ) {
        var beforeSnapshot = list.mutableFieldSnapshot()
        for (field, oldValue) in previousValues {
            beforeSnapshot[field] = oldValue
        }

        list.apply(changes: changes)
        list.updatedAt = Date()
        if list._syncStatus == SyncStatus.synced.rawValue {
            list._syncStatus = SyncStatus.pendingUpdate.rawValue
        }

        enqueueUpdate(
            list,
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

    func archive(id: String, userId: String) {
        update(id: id, changes: ["archivedAt": Date()], userId: userId)
    }

    func unarchive(id: String, userId: String) {
        update(id: id, changes: ["archivedAt": NSNull()], userId: userId)
    }

    /// Rewrite `sortOrder` on every list to match its index in `ids`.
    ///
    /// **Atomicity:** Per-bulk. All affected rows + queue entries land or
    /// none do — if `saver.save()` throws, `saver.rollback()` reverts every
    /// model mutation AND every queued `MutationQueueEntry` together. The
    /// error is rethrown so callers can show a haptic-error fallback.
    /// Replaces the previous loop-of-`update` implementation, which
    /// committed each row in its own save and could leave the user with
    /// rows 1-3 reordered and rows 4-N at their old positions, with no UI
    /// signal. Mirrors `ItemStore.bulkUpdate`.
    @discardableResult
    func reorder(ids: [String], userId: String) throws -> Int {
        // Find rows whose sortOrder actually needs to change. Skipping
        // already-correct rows mirrors the old behavior and keeps the
        // mutation queue lean (a no-op reorder enqueues nothing).
        var rowsToUpdate: [(list: ItemList, newIndex: Int)] = []
        for (index, id) in ids.enumerated() {
            guard let list = findById(id, userId: userId), list.sortOrder != index else { continue }
            rowsToUpdate.append((list: list, newIndex: index))
        }
        guard !rowsToUpdate.isEmpty else { return 0 }

        // Capture pre-mutation `previousValues` + `beforeSnapshot` for each
        // row BEFORE applying any changes. Mirrors `ItemStore.bulkUpdate`
        // so each enqueued mutation carries its own pristine baseline.
        let fields = ["sortOrder"]
        var perRow: [(list: ItemList, newIndex: Int, previousValues: [String: Any], beforeSnapshot: [String: Any])] = []
        perRow.reserveCapacity(rowsToUpdate.count)
        for entry in rowsToUpdate {
            let capturedPrevious = entry.list.previousValues(forFields: fields)
            var beforeSnapshot = entry.list.mutableFieldSnapshot()
            for (field, oldValue) in capturedPrevious {
                beforeSnapshot[field] = oldValue
            }
            perRow.append((
                list: entry.list,
                newIndex: entry.newIndex,
                previousValues: capturedPrevious,
                beforeSnapshot: beforeSnapshot
            ))
        }

        // Apply optimistic mutation + enqueue + compact-and-apply for each
        // row. No `saver.save()` inside the loop — one save at the end
        // commits everything atomically.
        let now = Date()
        for entry in perRow {
            entry.list.sortOrder = entry.newIndex
            entry.list.updatedAt = now
            if entry.list._syncStatus == SyncStatus.synced.rawValue {
                entry.list._syncStatus = SyncStatus.pendingUpdate.rawValue
            }
            enqueueUpdate(
                entry.list,
                changedFields: fields,
                previousValues: entry.previousValues,
                beforeSnapshot: entry.beforeSnapshot
            )
        }

        do {
            try saver.save()
        } catch {
            // Rollback reverts every row's sortOrder change AND every queued
            // MutationQueueEntry — model + queue stay in lockstep across
            // the whole batch.
            saver.rollback()
            logSaveFailure("reorder", error)
            throw error
        }

        syncManager?.schedulePushDebounced()
        return perRow.count
    }

    // MARK: - Helpers

    /// Next sortOrder within the user's own lists. Without userId scoping,
    /// a new user's first list would inherit a large sortOrder from the
    /// previous account's lists still resident in SwiftData between sign-in
    /// and the first pull.
    ///
    /// Inlines the `FetchDescriptor` (rather than going through a helper)
    /// because Wave B removed `fetchAll` and there's exactly one caller —
    /// pulling the highest existing `sortOrder` for new-list creation.
    private func nextSortOrder(userId: String) -> Int {
        var descriptor = FetchDescriptor<ItemList>(
            predicate: #Predicate { list in
                list.deletedAt == nil && list.userId == userId
            },
            sortBy: [SortDescriptor(\.sortOrder, order: .reverse)]
        )
        descriptor.fetchLimit = 1
        let highest = (try? context.fetch(descriptor))?.first?.sortOrder ?? -1
        return highest + 1
    }

    private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
        do {
            return try context.fetch(descriptor)
        } catch {
            BrettLog.store.error("ListStore fetch failed: \(String(describing: error), privacy: .public)")
            return []
        }
    }

    /// Shared rollback-log shape so each catch site doesn't repeat the
    /// store name + " save failed: " prefix. `Self.self` keeps the store
    /// name auto-attached even if this is ever copied to another store.
    private func logSaveFailure(_ operation: String, _ error: Error) {
        BrettLog.store.error("\(Self.self) \(operation) save failed: \(String(describing: error), privacy: .public)")
    }

    private func enqueueCreate(_ list: ItemList) {
        var payload: [String: Any] = list.mutableFieldSnapshot()
        payload["id"] = list.id
        payload["userId"] = list.userId
        payload["createdAt"] = list.createdAt
        payload["updatedAt"] = list.updatedAt

        let entry = MutationQueueEntry(
            entityType: "list",
            entityId: list.id,
            action: .create,
            endpoint: "/lists",
            method: .post,
            payload: JSONCodec.encode(payload)
        )
        MutationCompactor.compactAndApply(entry, in: context)
    }

    private func enqueueUpdate(
        _ list: ItemList,
        changedFields: [String],
        previousValues: [String: Any],
        beforeSnapshot: [String: Any]
    ) {
        let payload = list.patchPayload(for: changedFields)

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
        MutationCompactor.compactAndApply(entry, in: context)
    }

}
