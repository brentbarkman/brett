import Foundation
import SwiftData

/// Pure logic for field-level merges plus a side-effecting helper that records
/// resolved conflicts to the `ConflictLogEntry` table.
///
/// The algorithm mirrors `apps/api/src/lib/sync-merge.ts` and
/// `apps/mobile/src/sync/conflict-resolver.ts`:
///
///   For every field in `changedFields`:
///     - If `current[field]` (what the server has now) equals
///       `previousValues[field]` (what the client thought the server had),
///       the server never changed it out from under us — so our new value in
///       `payload[field]` is safe to apply.
///     - Otherwise, the field diverged: both sides edited it. Server wins;
///       we record the field in `conflictedFields` and keep `current[field]`.
///
/// The server runs this same check. The client-side variant exists so we can
/// re-apply a `merged` response locally (taking the server's authoritative
/// record) and log the exact fields the server rejected.
enum ConflictResolver {
    struct MergeOutcome {
        /// What to write back locally — a mix of our payload (for
        /// non-conflicted fields) and the server's current (for conflicted).
        let merged: [String: Any]
        /// Fields the server refused because of a concurrent edit.
        let conflictedFields: [String]
    }

    /// Field-level three-way merge.
    ///
    /// - Parameters:
    ///   - current: the server's current record (the source of truth).
    ///   - changedFields: the field names the client attempted to change.
    ///   - payload: the client's proposed new values.
    ///   - previousValues: what the client believed `current[field]` was when
    ///     the mutation was enqueued.
    /// - Returns: The dict the caller should apply locally, plus the subset
    ///   of `changedFields` that were conflicted (server retained its value).
    static func fieldLevelMerge(
        current: [String: Any],
        changedFields: [String],
        payload: [String: Any],
        previousValues: [String: Any]
    ) -> MergeOutcome {
        var merged: [String: Any] = [:]
        var conflicts: [String] = []

        for field in changedFields {
            let serverValue = current[field]
            let clientPrev = previousValues[field]

            if deepEqual(serverValue, clientPrev) {
                // Server hasn't touched this field since we read it — safe
                // to apply. Preserve null vs. missing by substituting NSNull
                // if the payload explicitly set null.
                if let newValue = payload[field] {
                    merged[field] = newValue
                } else {
                    merged[field] = NSNull()
                }
            } else {
                conflicts.append(field)
                if let serverValue {
                    merged[field] = serverValue
                } else {
                    merged[field] = NSNull()
                }
            }
        }

        return MergeOutcome(merged: merged, conflictedFields: conflicts)
    }

    /// Append a `ConflictLogEntry` row for observability / post-mortem.
    ///
    /// The engines call this whenever the server reports `merged` or
    /// `conflict` on a mutation so we can reconstruct what the client tried
    /// vs. what the server had. Non-fatal: a log failure is swallowed.
    @MainActor
    static func logConflict(
        entityType: String,
        entityId: String,
        mutationId: String?,
        localValues: [String: Any],
        serverValues: [String: Any],
        conflictedFields: [String],
        resolution: String,
        context: ModelContext
    ) {
        let entry = ConflictLogEntry(
            entityType: entityType,
            entityId: entityId,
            mutationId: mutationId,
            localValuesJSON: Self.jsonString(localValues),
            serverValuesJSON: Self.jsonString(serverValues),
            conflictedFieldsJSON: Self.jsonString(conflictedFields),
            resolution: resolution,
            resolvedAt: Date()
        )
        context.insert(entry)
        // Best-effort save. The sync engines call `context.save()` at the
        // end of each pass anyway; we don't want an intermediate save failure
        // to swallow sync progress.
        do {
            try context.save()
        } catch {
            BrettLog.sync.error("ConflictResolver logConflict save failed: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Private helpers

    /// Convert a dict / array / primitive to a deterministic JSON string.
    /// Falls back to empty JSON on failure so we never crash logging.
    static func jsonString(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value) else {
            // Wrap scalars in a dict to keep the log parseable.
            let wrapped: [String: Any] = ["value": String(describing: value)]
            if let data = try? JSONSerialization.data(withJSONObject: wrapped),
               let str = String(data: data, encoding: .utf8) {
                return str
            }
            return "{}"
        }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }

    /// Deep equality for the subset of JSON values we ever see in a sync
    /// payload: String, Bool, Int, Double, NSNumber, NSNull, nil, Array, Dict.
    ///
    /// Why handroll instead of comparing JSON strings? `JSONSerialization`
    /// reorders dict keys nondeterministically on some platforms; going
    /// through a stable serializer in a hot path adds overhead for little
    /// benefit. The fields we check are single values anyway — arrays and
    /// nested dicts only appear in `contentMetadata`, which isn't in
    /// `MUTABLE_FIELDS`. Still, we handle them correctly for completeness.
    static func deepEqual(_ lhs: Any?, _ rhs: Any?) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil):
            return true
        case (nil, _?), (_?, nil):
            // One present, one nil → could still match NSNull on the other side.
            let nilSide = lhs == nil ? rhs : lhs
            if let nilSide, nilSide is NSNull { return true }
            return false
        case let (l?, r?):
            if l is NSNull && r is NSNull { return true }
            if l is NSNull || r is NSNull { return false }

            // Homogeneous primitives
            if let ls = l as? String, let rs = r as? String { return ls == rs }
            if let lb = l as? Bool, let rb = r as? Bool { return lb == rb }

            // Numbers — compare via NSNumber to handle Int/Double/NSNumber mixes.
            if let ln = asNumber(l), let rn = asNumber(r) {
                return ln == rn
            }

            if let la = l as? [Any], let ra = r as? [Any] {
                guard la.count == ra.count else { return false }
                for (a, b) in zip(la, ra) where !deepEqual(a, b) { return false }
                return true
            }

            if let ld = l as? [String: Any], let rd = r as? [String: Any] {
                guard ld.keys.sorted() == rd.keys.sorted() else { return false }
                for key in ld.keys {
                    if !deepEqual(ld[key], rd[key]) { return false }
                }
                return true
            }

            return false
        default:
            return false
        }
    }

    /// Coerce anything numeric-looking into an `NSNumber` for comparison.
    private static func asNumber(_ v: Any) -> NSNumber? {
        // Bool bridges to NSNumber(value: 1/0) but we've already branched on
        // Bool above, so ordering in `deepEqual` avoids conflating 1 == true.
        if let n = v as? NSNumber { return n }
        if let i = v as? Int { return NSNumber(value: i) }
        if let i = v as? Int64 { return NSNumber(value: i) }
        if let d = v as? Double { return NSNumber(value: d) }
        return nil
    }
}
