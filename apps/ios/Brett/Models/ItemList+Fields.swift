import Foundation

/// Field-map conformance for `ItemList`. See `MutableFieldModel.swift` for
/// the protocol contract and `Item+Fields.swift` for the patterns (date
/// coercion, NSNull handling, required-field guard).
extension ItemList: MutableFieldModel {
    enum Field: String, CaseIterable, Sendable {
        case name
        case colorClass
        case sortOrder
        case archivedAt
    }

    static let mutableFields: [Field] = Field.allCases

    func value(for field: Field) -> Any? {
        switch field {
        case .name: return name
        case .colorClass: return colorClass
        case .sortOrder: return sortOrder
        case .archivedAt: return archivedAt
        }
    }

    func set(_ value: Any?, for field: Field) {
        let v: Any? = (value is NSNull) ? nil : value
        switch field {
        case .name: if let s = v as? String { self.name = s }
        case .colorClass: if let s = v as? String { self.colorClass = s }
        case .sortOrder: if let i = v as? Int { self.sortOrder = i }
        case .archivedAt:
            if let d = v as? Date {
                self.archivedAt = d
            } else if let s = v as? String {
                self.archivedAt = ISO8601DateFormatter.brettShared.date(from: s)
            } else {
                self.archivedAt = nil
            }
        }
    }
}
