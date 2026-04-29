import Foundation
import SwiftData

/// Pure compaction logic — no I/O, no persistence. Given the current list of
/// pending mutations for a single entity and a new incoming mutation, returns
/// the deltas needed to maintain a minimal queue.
///
/// Rules (ported from `apps/mobile/src/sync/mutation-queue.ts::compactEntity`):
///   CREATE + UPDATE  →  merge UPDATE payload into the CREATE, drop the UPDATE.
///   CREATE + DELETE  →  net-zero; remove the CREATE, don't insert DELETE.
///   UPDATE + UPDATE  →  union changedFields, merge payload, keep earliest
///                       previousValues / baseUpdatedAt / beforeSnapshot.
///   UPDATE + DELETE  →  drop the UPDATE, keep the DELETE.
///   No match         →  just insert the incoming entry.
///
/// Eager compaction assumes there is at most ONE pending CREATE and at most
/// ONE pending UPDATE per entity at any given time (the previous enqueue
/// already collapsed them). We still defend against multiple pending rows by
/// merging against the latest CREATE/UPDATE we find.
struct MutationCompactor {
    /// Result of compacting `incoming` against a pool of existing pending rows.
    /// All callers must apply `toDelete` first, then `toUpdate`, then
    /// `toInsert` (if any) so the queue ends in a consistent state.
    struct CompactionResult {
        /// IDs of existing pending rows that should be removed outright.
        var toDelete: [String] = []
        /// An existing pending row whose payload/fields should be overwritten
        /// in place (merged). The compactor returns the MUTATED entry object —
        /// callers should pass it back to their persistence layer.
        var toUpdate: MutationQueueEntry?
        /// The incoming entry, if it should still be inserted as a new row.
        /// `nil` means the new mutation was absorbed into an existing one or
        /// cancelled out entirely.
        var toInsert: MutationQueueEntry?
    }

    // MARK: - Public API

    /// Compact `incoming` against the given pool of pending rows (for the
    /// same entity). The pool MUST already be filtered to status="pending"
    /// and the same `entityType + entityId`; the compactor doesn't re-check.
    static func compact(
        pending: [MutationQueueEntry],
        incoming: MutationQueueEntry
    ) -> CompactionResult {
        // Sort oldest-first so "the earliest values" semantics are clear.
        let ordered = pending.sorted { $0.createdAt < $1.createdAt }

        // Only look at the most recent CREATE / UPDATE — anything older would
        // already have been compacted on a previous enqueue.
        let existingCreate = ordered.last { $0.actionEnum == .create }
        let existingUpdate = ordered.last { $0.actionEnum == .update }

        switch incoming.actionEnum {
        case .create:
            // A second CREATE for the same entity is nonsensical — let it
            // pass through; the push engine can surface the server's 409.
            return CompactionResult(toInsert: incoming)

        case .update:
            if let create = existingCreate {
                mergeUpdateIntoCreate(create: create, update: incoming)
                return CompactionResult(toUpdate: create)
            }
            if let update = existingUpdate {
                mergeUpdateIntoUpdate(existing: update, incoming: incoming)
                return CompactionResult(toUpdate: update)
            }
            return CompactionResult(toInsert: incoming)

        case .delete:
            if let create = existingCreate {
                // CREATE + DELETE → net-zero. Also drop any pending UPDATEs
                // since there's nothing left to update.
                var toDelete: [String] = [create.id]
                for entry in ordered where entry.actionEnum == .update {
                    toDelete.append(entry.id)
                }
                return CompactionResult(toDelete: toDelete, toInsert: nil)
            }
            if let update = existingUpdate {
                // UPDATE + DELETE → drop the UPDATE, keep the DELETE.
                return CompactionResult(toDelete: [update.id], toInsert: incoming)
            }
            return CompactionResult(toInsert: incoming)

        case .custom:
            // Custom actions don't compact — always insert.
            return CompactionResult(toInsert: incoming)
        }
    }

    // MARK: - Merges

    /// Fold an incoming UPDATE into an existing CREATE. The CREATE absorbs
    /// the new payload keys and the fields array — callers will not persist
    /// the UPDATE as a separate row.
    private static func mergeUpdateIntoCreate(
        create: MutationQueueEntry,
        update: MutationQueueEntry
    ) {
        create.payload = mergedPayload(create.payload, update.payload)

        // CREATE's payload is the full record, so changedFields on the
        // absorbed CREATE isn't strictly needed. Keep any already-present
        // list plus the new fields for symmetry with the TS engine.
        create.changedFields = unionFields(create.changedFields, update.changedFields)

        // baseUpdatedAt stays nil (new record); beforeSnapshot stays nil
        // (nothing to roll back to). previousValues on a CREATE is moot.
    }

    /// Fold an incoming UPDATE into an existing UPDATE:
    ///   - Payloads are merged key-by-key; incoming wins on conflict.
    ///   - `changedFields` becomes the set-union of both.
    ///   - `previousValues` keeps the EARLIEST recorded value for each field
    ///     (i.e. the value before the first local edit).
    ///   - `baseUpdatedAt` and `beforeSnapshot` stay with the earlier entry.
    private static func mergeUpdateIntoUpdate(
        existing: MutationQueueEntry,
        incoming: MutationQueueEntry
    ) {
        existing.payload = mergedPayload(existing.payload, incoming.payload)
        existing.changedFields = unionFields(existing.changedFields, incoming.changedFields)
        existing.previousValues = mergedPreviousValues(
            earliest: existing.previousValues,
            later: incoming.previousValues
        )
        // Intentionally leave baseUpdatedAt / beforeSnapshot alone so we
        // compare against the server version the user first diverged from.
    }

    // MARK: - JSON helpers

    /// Decode two JSON objects and merge them, with `overlay` keys winning
    /// on conflict. Non-object inputs (or decode failures) fall back to the
    /// overlay string untouched.
    static func mergedPayload(_ base: String, _ overlay: String) -> String {
        let baseDict = decodeObject(base) ?? [:]
        let overlayDict = decodeObject(overlay) ?? [:]
        var merged = baseDict
        for (key, value) in overlayDict {
            merged[key] = value
        }
        return encodeObject(merged) ?? overlay
    }

    /// Decode two JSON arrays of strings and return the deduplicated union.
    /// Order: `existing` first, then new entries from `incoming`, so callers
    /// can read a stable field order.
    static func unionFields(_ existing: String?, _ incoming: String?) -> String? {
        let existingFields = decodeStringArray(existing) ?? []
        let incomingFields = decodeStringArray(incoming) ?? []
        guard !existingFields.isEmpty || !incomingFields.isEmpty else { return nil }

        var seen = Set<String>()
        var merged: [String] = []
        for field in existingFields where seen.insert(field).inserted {
            merged.append(field)
        }
        for field in incomingFields where seen.insert(field).inserted {
            merged.append(field)
        }

        return encodeStringArray(merged)
    }

    /// Keep the earliest-recorded `previousValues` per field. Callers must
    /// pass `earliest` first so overlapping keys resolve to the original.
    static func mergedPreviousValues(earliest: String?, later: String?) -> String? {
        let earliestDict = decodeObject(earliest ?? "") ?? [:]
        let laterDict = decodeObject(later ?? "") ?? [:]
        guard !earliestDict.isEmpty || !laterDict.isEmpty else { return earliest ?? later }

        // Start with `later` (so fields only touched in the newer update get
        // their previous values recorded) then overlay `earliest` so any
        // field touched twice keeps the original baseline.
        var merged = laterDict
        for (key, value) in earliestDict {
            merged[key] = value
        }
        return encodeObject(merged)
    }

    // MARK: - Low-level codecs

    private static func decodeObject(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func decodeStringArray(_ json: String?) -> [String]? {
        guard let json, let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String]
    }

    private static func encodeObject(_ dict: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(dict),
              let data = try? JSONSerialization.data(withJSONObject: dict)
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func encodeStringArray(_ array: [String]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: array) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - Compact + apply (single source of truth)

extension MutationCompactor {
    /// Compact `incoming` against the pool of pending entries for the same
    /// entity, then stage the resulting deltas (delete / mutate-in-place /
    /// insert) on `context`. **Does not call `save()`** — the caller owns
    /// the surrounding transaction so the optimistic SwiftData write and
    /// the queue-entry change commit (or roll back) together.
    ///
    /// This is the single source of truth used by `ItemStore.enqueueCreate`
    /// / `enqueueUpdate` / `enqueueDelete`, the equivalent helpers on
    /// `ListStore`, and `ShareIngestor.enqueueMutation`. The pure
    /// `compact(pending:incoming:)` value function is still callable on its
    /// own for tests that don't want to set up a `ModelContext`.
    @MainActor
    static func compactAndApply(
        _ incoming: MutationQueueEntry,
        in context: ModelContext
    ) {
        let pending = fetchPendingMutations(
            entityType: incoming.entityType,
            entityId: incoming.entityId,
            in: context
        )
        let result = compact(pending: pending, incoming: incoming)

        // Apply deltas. Order: delete first, then insert — so a delete-then-
        // insert for the same entity can't conflict at the SwiftData layer.
        // `result.toUpdate` is mutated in place by the compactor; SwiftData
        // re-persists the dirty fields on the next save, no explicit step.
        for id in result.toDelete {
            if let entry = fetchMutationEntry(id: id, in: context) {
                context.delete(entry)
            }
        }
        if let toInsert = result.toInsert {
            context.insert(toInsert)
        }
    }

    @MainActor
    private static func fetchPendingMutations(
        entityType: String,
        entityId: String,
        in context: ModelContext
    ) -> [MutationQueueEntry] {
        let pendingRaw = MutationStatus.pending.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate {
                $0.entityType == entityType
                    && $0.entityId == entityId
                    && $0.status == pendingRaw
            },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        descriptor.includePendingChanges = true
        return (try? context.fetch(descriptor)) ?? []
    }

    @MainActor
    private static func fetchMutationEntry(
        id: String,
        in context: ModelContext
    ) -> MutationQueueEntry? {
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.id == id }
        )
        descriptor.fetchLimit = 1
        descriptor.includePendingChanges = true
        return try? context.fetch(descriptor).first
    }
}
