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

    init(context: ModelContext, saver: ModelContextSaving? = nil) {
        self.context = context
        self.saver = saver ?? LiveSaver(context: context)
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

    // MARK: - Fetch

    /// All non-deleted lists, ordered by `sortOrder`. `userId` scopes the
    /// query so a prior account's lists never appear after an account
    /// switch (CLAUDE.md multi-user rule). `nil` returns every user's rows;
    /// reserved for sync internals and tests.
    func fetchAll(userId: String? = nil, includeArchived: Bool = false) -> [ItemList] {
        var descriptor = FetchDescriptor<ItemList>(
            sortBy: [SortDescriptor(\.sortOrder)]
        )
        if let userId {
            descriptor.predicate = #Predicate { list in
                list.deletedAt == nil && list.userId == userId
            }
        } else {
            descriptor.predicate = #Predicate { list in
                list.deletedAt == nil
            }
        }
        let lists = fetch(descriptor)
        return lists.filter { includeArchived || $0.archivedAt == nil }
    }

    /// Fetch a single list by id. `userId` scopes the lookup so mutation
    /// paths never target another user's row. Passing `nil` preserves
    /// legacy behaviour (sync internals / tests only).
    func fetchById(_ id: String, userId: String? = nil) -> ItemList? {
        var descriptor = FetchDescriptor<ItemList>()
        if let userId {
            descriptor.predicate = #Predicate { $0.id == id && $0.userId == userId }
        } else {
            descriptor.predicate = #Predicate { $0.id == id }
        }
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

        ActiveSession.syncManager?.schedulePushDebounced()
        return list
    }

    /// Apply a changeset to an existing list. Store captures `previousValues`
    /// and `beforeSnapshot` from the model's current state — callers MUST
    /// NOT pre-mutate the model (see ItemStore for rationale).
    func update(id: String, changes: [String: Any]) {
        guard let list = fetchById(id, userId: ActiveSession.userId) else { return }
        let fields = Array(changes.keys)
        let capturedPrevious = list.previousValues(forFields: fields)
        applyUpdate(list: list, changes: changes, previousValues: capturedPrevious)
    }

    /// Apply a changeset using caller-supplied `previousValues`. Use when
    /// the caller already captured the pre-edit state (e.g. a settings
    /// form snapshotted on open).
    func update(id: String, changes: [String: Any], previousValues: [String: Any]) {
        guard let list = fetchById(id, userId: ActiveSession.userId) else { return }
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

        ActiveSession.syncManager?.schedulePushDebounced()
    }

    func archive(id: String) {
        update(id: id, changes: ["archivedAt": Date()])
    }

    func unarchive(id: String) {
        update(id: id, changes: ["archivedAt": NSNull()])
    }

    func reorder(ids: [String]) {
        let uid = ActiveSession.userId
        for (index, id) in ids.enumerated() {
            guard let list = fetchById(id, userId: uid), list.sortOrder != index else { continue }
            update(id: id, changes: ["sortOrder": index])
        }
    }

    // MARK: - Helpers

    /// Next sortOrder within the user's own lists. Without userId scoping,
    /// a new user's first list would inherit a large sortOrder from the
    /// previous account's lists still resident in SwiftData between sign-in
    /// and the first pull.
    private func nextSortOrder(userId: String) -> Int {
        let existing = fetchAll(userId: userId, includeArchived: true)
        return (existing.map(\.sortOrder).max() ?? -1) + 1
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

        // Insert directly rather than going through `MutationQueue.enqueue`:
        // that helper does eager compaction + commits a save mid-method,
        // which would split the model insert and queue-entry insert across
        // two transactions and break the atomic-rollback guarantee. A
        // brand-new CREATE never has anything to compact against, so the
        // helper's savings don't apply here.
        let entry = MutationQueueEntry(
            entityType: "list",
            entityId: list.id,
            action: .create,
            endpoint: "/lists",
            method: .post,
            payload: JSONCodec.encode(payload)
        )
        context.insert(entry)
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
        context.insert(entry)
    }
}
