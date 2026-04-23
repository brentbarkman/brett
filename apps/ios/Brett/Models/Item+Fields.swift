import Foundation

/// Field-map conformance for `Item`. Every mutable wire-format field is
/// declared in `Field`; the server's JSON key is the raw value.
///
/// When adding a new mutable field to `Item`:
///   1. Add the property to `Item.swift`.
///   2. Add the case here, with raw value = server JSON key.
///   3. Add it to `mutableFields` below if it should be editable (almost
///      always yes). Leave out read-only / server-assigned fields.
///   4. Add the getter + setter cases in the switches below.
///
/// Forgetting any step now produces a compile error, not silent data loss.
extension Item: MutableFieldModel {
    enum Field: String, CaseIterable, Sendable {
        case title
        /// Swift property is `itemDescription` (collision with
        /// `CustomStringConvertible`) — wire key stays `"description"`.
        case description
        case notes
        case status
        case type
        case dueDate
        case dueDatePrecision
        case completedAt
        case snoozedUntil
        case listId
        case reminder
        case recurrence
        case recurrenceRule
        case brettObservation
        case sourceUrl
        case contentTitle
        case contentDescription
        case contentImageUrl
        case contentFavicon
        case contentDomain
    }

    /// Every case is mutable from the client today. If we ever mark a field
    /// server-only (e.g. `contentStatus` once pipeline owns it), drop it
    /// from this list — the PATCH payload + snapshot will skip it automatically.
    static let mutableFields: [Field] = Field.allCases

    func value(for field: Field) -> Any? {
        switch field {
        case .title: return title
        case .description: return itemDescription
        case .notes: return notes
        case .status: return status
        case .type: return type
        case .dueDate: return dueDate
        case .dueDatePrecision: return dueDatePrecision
        case .completedAt: return completedAt
        case .snoozedUntil: return snoozedUntil
        case .listId: return listId
        case .reminder: return reminder
        case .recurrence: return recurrence
        case .recurrenceRule: return recurrenceRule
        case .brettObservation: return brettObservation
        case .sourceUrl: return sourceUrl
        case .contentTitle: return contentTitle
        case .contentDescription: return contentDescription
        case .contentImageUrl: return contentImageUrl
        case .contentFavicon: return contentFavicon
        case .contentDomain: return contentDomain
        }
    }

    func set(_ value: Any?, for field: Field) {
        // Treat NSNull and nil as "clear" for optional fields. Required
        // String fields (title / status / type) refuse nil to protect against
        // a bad server payload wiping the row — unknown intent, keep the
        // existing value.
        let v: Any? = (value is NSNull) ? nil : value
        switch field {
        case .title: if let s = v as? String { self.title = s }
        case .status: if let s = v as? String { self.status = s }
        case .type: if let s = v as? String { self.type = s }
        case .description: self.itemDescription = v as? String
        case .notes: self.notes = v as? String
        case .dueDate: self.dueDate = coerceDate(v)
        case .dueDatePrecision: self.dueDatePrecision = v as? String
        case .completedAt: self.completedAt = coerceDate(v)
        case .snoozedUntil: self.snoozedUntil = coerceDate(v)
        case .listId: self.listId = v as? String
        case .reminder: self.reminder = v as? String
        case .recurrence: self.recurrence = v as? String
        case .recurrenceRule: self.recurrenceRule = v as? String
        case .brettObservation: self.brettObservation = v as? String
        case .sourceUrl: self.sourceUrl = v as? String
        case .contentTitle: self.contentTitle = v as? String
        case .contentDescription: self.contentDescription = v as? String
        case .contentImageUrl: self.contentImageUrl = v as? String
        case .contentFavicon: self.contentFavicon = v as? String
        case .contentDomain: self.contentDomain = v as? String
        }
    }
}

// MARK: - Date coercion

/// Dates cross the wire as ISO-8601 strings but the mutation queue holds
/// them as native `Date` in local applies. Accept either so callers don't
/// need to pre-convert.
private func coerceDate(_ value: Any?) -> Date? {
    if let d = value as? Date { return d }
    if let s = value as? String { return ISO8601DateFormatter.brettShared.date(from: s) }
    return nil
}

extension ISO8601DateFormatter {
    /// Shared formatter with the project's wire-format options (internet
    /// date-time + fractional seconds). Immutable after init → Sendable-safe.
    static let brettShared: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
