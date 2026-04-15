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
        var changes: [String: AnyHashable?]
        var previousValues: [String: AnyHashable?]

        var isEmpty: Bool { changes.isEmpty }
        var changedFields: [String] { Array(changes.keys).sorted() }
    }

    /// Compare this draft to an `Item` and return the diff.
    /// Skips fields that match byte-for-byte (empty strings are normalised to
    /// `nil` for the text fields so a cleared TextEditor doesn't beat a nil).
    func diff(against item: Item) -> Diff {
        var changes: [String: AnyHashable?] = [:]
        var previousValues: [String: AnyHashable?] = [:]

        // Title — required, never nil. Trim trailing whitespace but don't
        // silently discard an empty title (the caller can validate upstream).
        let newTitle = title
        if newTitle != item.title {
            changes["title"] = newTitle
            previousValues["title"] = item.title
        }

        // Notes — empty string is treated as nil on the wire.
        let newNotes: String? = notes.isEmpty ? nil : notes
        if newNotes != item.notes {
            changes["notes"] = newNotes
            previousValues["notes"] = item.notes
        }

        // Due date
        if !datesEqual(dueDate, item.dueDate) {
            changes["dueDate"] = dueDate
            previousValues["dueDate"] = item.dueDate
        }

        // List id
        if listId != item.listId {
            changes["listId"] = listId
            previousValues["listId"] = item.listId
        }

        // Reminder
        if reminder != item.reminder {
            changes["reminder"] = reminder
            previousValues["reminder"] = item.reminder
        }

        // Recurrence
        if recurrence != item.recurrence {
            changes["recurrence"] = recurrence
            previousValues["recurrence"] = item.recurrence
        }

        return Diff(changes: changes, previousValues: previousValues)
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
    /// existing `update(...)` signature expects, then commit.
    func commit(_ diff: ItemDraft.Diff, to id: String) {
        guard !diff.isEmpty else { return }

        let changes = anyDict(diff.changes)
        let previousValues = anyDict(diff.previousValues)

        update(id: id, changes: changes, previousValues: previousValues)
    }

    /// Strip the `Optional` wrapper — `NSNull` slots in for explicit nils so
    /// the downstream payload encoder writes JSON null instead of omitting
    /// the field.
    private func anyDict(_ input: [String: AnyHashable?]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in input {
            if let v { out[k] = v as Any } else { out[k] = NSNull() }
        }
        return out
    }
}
