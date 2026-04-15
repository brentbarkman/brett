import Foundation
import Observation

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
}
