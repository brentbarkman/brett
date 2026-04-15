import Foundation
import Observation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@Observable
final class MockStore {
    var items: [MockItem] = MockData.items
    var inboxItems: [MockItem] = MockData.inboxItems
    var lists: [MockList] = MockData.lists
    var events: [MockEvent] = MockData.events
    var briefing: String = MockData.briefing
    var scouts: [MockScout] = MockData.scouts
    var briefingDismissed: Bool = false
    var briefingCollapsed: Bool = false
    var selectedTaskId: String? = nil

    // List management state — session-local because the mock data layer
    // doesn't carry `archivedAt` / user-created entries. Moves to the real
    // `ItemList` model once the UI migrates off MockStore.
    var archivedListIds: Set<String> = []
    var listColorOverrides: [String: String] = [:] // listId → ListColor raw value
    var listNameOverrides: [String: String] = [:]  // listId → custom name

    // MARK: - Computed sections

    var overdueItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .overdue }
    }

    var todayItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .today }
    }

    var thisWeekItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .thisWeek }
    }

    var nextWeekItems: [MockItem] {
        items.filter { !$0.isCompleted && DateHelpers.computeUrgency(dueDate: $0.dueDate, isCompleted: false) == .nextWeek }
    }

    var doneItems: [MockItem] {
        items.filter { $0.isCompleted }
    }

    var todayEvents: [MockEvent] {
        events.sorted { $0.startHour < $1.startHour || ($0.startHour == $1.startHour && $0.startMinute < $1.startMinute) }
    }

    var totalTasks: Int { items.count }
    var completedTasks: Int { items.filter(\.isCompleted).count }
    var meetingCount: Int { events.count }
    var meetingDuration: String {
        let total = events.reduce(0) { $0 + $1.durationMinutes }
        let hours = total / 60
        let mins = total % 60
        if hours > 0 && mins > 0 { return "\(hours)h \(mins)m" }
        if hours > 0 { return "\(hours)h" }
        return "\(mins)m"
    }

    // MARK: - Actions

    func toggleItem(_ id: String) {
        if let idx = items.firstIndex(where: { $0.id == id }) {
            items[idx].isCompleted.toggle()
        }
    }

    func addItem(title: String, dueDate: Date? = nil, listId: String? = nil) {
        let listName = lists.first(where: { $0.id == listId })?.name
        let newItem = MockItem(
            id: UUID().uuidString,
            title: title,
            dueDate: dueDate,
            listId: listId,
            listName: listName
        )
        items.insert(newItem, at: 0)
    }

    func itemsForList(_ listId: String) -> [MockItem] {
        items.filter { $0.listId == listId && !$0.isCompleted }
    }

    // MARK: - List actions (session-local; wires into ListStore later)

    @discardableResult
    func createList(name: String, colorClass: String) -> MockList {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextSortOrder = (lists.map(\.sortOrder).max() ?? -1) + 1
        let id = "draft-list-\(UUID().uuidString)"
        let hex = ListColor(colorClass: colorClass)?.swiftUIColor.hexString ?? "#94A3B8"
        let list = MockList(
            id: id,
            name: trimmed.isEmpty ? "Untitled list" : trimmed,
            colorHex: hex,
            sortOrder: nextSortOrder
        )
        lists.append(list)
        listColorOverrides[id] = colorClass
        return list
    }

    func archiveList(_ id: String) {
        archivedListIds.insert(id)
    }

    func unarchiveList(_ id: String) {
        archivedListIds.remove(id)
    }

    func renameList(_ id: String, to newName: String) {
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        listNameOverrides[id] = trimmed
    }

    func setListColor(_ id: String, colorClass: String) {
        listColorOverrides[id] = colorClass
    }

    /// The display name for a list, honoring any in-session rename.
    func displayName(forList id: String) -> String? {
        if let override = listNameOverrides[id] { return override }
        return lists.first(where: { $0.id == id })?.name
    }

    /// The display color for a list, honoring any in-session color change.
    /// Falls back to the legacy hex → ListColor mapping, then `.default`.
    func displayColor(forList id: String) -> ListColor {
        if let override = listColorOverrides[id] {
            if let color = ListColor(rawValue: override) { return color }
            if let color = ListColor(colorClass: override) { return color }
        }
        guard let list = lists.first(where: { $0.id == id }) else { return .default }
        return legacyColor(fromHex: list.colorHex) ?? .default
    }

    private func legacyColor(fromHex hex: String) -> ListColor? {
        let normalized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted).lowercased()
        switch normalized {
        case "60a5fa", "3b82f6": return .blue
        case "38bdf8", "06b6d4": return .sky
        case "34d399", "10b981", "22c55e": return .emerald
        case "fbbf24", "f59e0b": return .amber
        case "fb923c", "f97316": return .orange
        case "fb7185", "ef4444", "ec4899": return .rose
        case "a78bfa", "8b5cf6", "a855f7": return .violet
        case "94a3b8": return .slate
        default: return nil
        }
    }
}

// MARK: - Color hex conversion helper

private extension Color {
    var hexString: String {
        #if canImport(UIKit)
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        let ri = Int(round(r * 255))
        let gi = Int(round(g * 255))
        let bi = Int(round(b * 255))
        return String(format: "#%02X%02X%02X", ri, gi, bi)
        #else
        return "#94A3B8"
        #endif
    }
}
