import Foundation

/// In-progress, in-memory edits to an `Item`. Held as `@State` by
/// `TaskDetailView` so changes are buffered until a blur/finalize event, at
/// which point the draft is diffed against the source `Item` and pushed via
/// `ItemStore.update(id:changes:previousValues:)`.
///
/// The draft owns only fields the detail view can edit; non-editable fields
/// (createdAt, sync metadata, etc.) stay on the backing `Item`. This keeps
/// `diff(against:)` small and side-effect-free.
struct ItemDraft: Equatable {
    var title: String
    var notes: String
    var dueDate: Date?
    var listId: String?
    var reminder: String?
    var recurrence: String?

    /// Snapshot an `Item` into a draft. All editable fields are copied out.
    init(from item: Item) {
        self.title = item.title
        self.notes = item.notes ?? ""
        self.dueDate = item.dueDate
        self.listId = item.listId
        self.reminder = item.reminder
        self.recurrence = item.recurrence
    }

    /// Explicit initializer for tests so we don't have to thread through a
    /// full SwiftData `Item`.
    init(
        title: String = "",
        notes: String = "",
        dueDate: Date? = nil,
        listId: String? = nil,
        reminder: String? = nil,
        recurrence: String? = nil
    ) {
        self.title = title
        self.notes = notes
        self.dueDate = dueDate
        self.listId = listId
        self.reminder = reminder
        self.recurrence = recurrence
    }

    /// Result of diffing the draft against the source item — a pair of
    /// dictionaries matching the shape `ItemStore.update(...)` expects.
    ///
    /// `changes[field]` holds the new value (or `NSNull()` when clearing).
    /// `previousValues[field]` holds the old value for conflict resolution.
    struct Diff: Equatable {
        /// Value type uses `AnyHashable` (not optional) + `NSNull()` as the
        /// explicit "cleared" sentinel. This avoids Swift's `dict[key] = nil`
        /// behaviour which removes the key entirely instead of storing a nil.
        var changes: [String: AnyHashable]
        var previousValues: [String: AnyHashable]

        var isEmpty: Bool { changes.isEmpty }
        var changedFields: [String] { Array(changes.keys).sorted() }
    }

    /// Compare this draft to an `Item` and return the diff.
    /// Skips fields that match byte-for-byte (empty strings are normalised to
    /// `nil` for the text fields so a cleared TextEditor doesn't beat a nil).
    func diff(against item: Item) -> Diff {
        var changes: [String: AnyHashable] = [:]
        var previousValues: [String: AnyHashable] = [:]

        func record(_ field: String, newValue: Any?, oldValue: Any?) {
            changes[field] = anyHashable(newValue)
            previousValues[field] = anyHashable(oldValue)
        }

        // Title — required, never nil. Trim trailing whitespace but don't
        // silently discard an empty title (the caller can validate upstream).
        if title != item.title {
            record("title", newValue: title, oldValue: item.title)
        }

        // Notes — empty string is treated as nil on the wire.
        let newNotes: String? = notes.isEmpty ? nil : notes
        if newNotes != item.notes {
            record("notes", newValue: newNotes, oldValue: item.notes)
        }

        // Due date
        if !datesEqual(dueDate, item.dueDate) {
            record("dueDate", newValue: dueDate, oldValue: item.dueDate)
        }

        // List id
        if listId != item.listId {
            record("listId", newValue: listId, oldValue: item.listId)
        }

        // Reminder
        if reminder != item.reminder {
            record("reminder", newValue: reminder, oldValue: item.reminder)
        }

        // Recurrence
        if recurrence != item.recurrence {
            record("recurrence", newValue: recurrence, oldValue: item.recurrence)
        }

        return Diff(changes: changes, previousValues: previousValues)
    }

    /// Wraps a value into `AnyHashable`, substituting `NSNull()` for nil so
    /// the dictionary preserves the "cleared" signal.
    private func anyHashable(_ value: Any?) -> AnyHashable {
        switch value {
        case let s as String: return AnyHashable(s)
        case let d as Date: return AnyHashable(d)
        case let n as Int: return AnyHashable(n)
        case let d as Double: return AnyHashable(d)
        case let b as Bool: return AnyHashable(b)
        case let h as AnyHashable: return h
        case nil: return AnyHashable(NSNull())
        default: return AnyHashable(String(describing: value!))
        }
    }

    /// Dates stored in SwiftData can drift sub-millisecond on re-encode; use
    /// a small tolerance so we don't emit a spurious write.
    private func datesEqual(_ a: Date?, _ b: Date?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case (let x?, let y?): return abs(x.timeIntervalSince(y)) < 0.001
        default: return false
        }
    }
}

// MARK: - ItemStore convenience

@MainActor
extension ItemStore {
    /// Convert the typed `ItemDraft.Diff` into the `[String: Any]` dicts the
    /// existing `update(...)` signature expects, then commit. `userId`
    /// scopes the row lookup so a draft for one user can never mutate
    /// another user's row.
    func commit(_ diff: ItemDraft.Diff, to id: String, userId: String) {
        guard !diff.isEmpty else { return }

        let changes = anyDict(diff.changes)
        let previousValues = anyDict(diff.previousValues)

        update(id: id, changes: changes, previousValues: previousValues, userId: userId)
    }

    /// Unwrap `AnyHashable` back into the `[String: Any]` shape `update(...)`
    /// expects. `NSNull()` sentinels pass through as-is so the downstream
    /// payload encoder writes JSON null for cleared fields.
    private func anyDict(_ input: [String: AnyHashable]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in input {
            out[k] = v.base
        }
        return out
    }
}
