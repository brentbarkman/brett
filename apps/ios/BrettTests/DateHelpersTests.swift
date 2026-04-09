import Testing
import Foundation
@testable import Brett

@Suite("DateHelpers")
struct DateHelpersTests {
    @Test func computeUrgencyOverdue() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        #expect(DateHelpers.computeUrgency(dueDate: yesterday, isCompleted: false) == .overdue)
    }

    @Test func computeUrgencyToday() {
        let today = Calendar.current.startOfDay(for: Date())
        #expect(DateHelpers.computeUrgency(dueDate: today, isCompleted: false) == .today)
    }

    @Test func computeUrgencyThisWeek() {
        let calendar = Calendar.current
        let today = Date()
        let weekday = calendar.component(.weekday, from: today)
        let daysUntilEndOfWeek = 7 - weekday
        if daysUntilEndOfWeek > 0 {
            let laterThisWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: today)!
            #expect(DateHelpers.computeUrgency(dueDate: laterThisWeek, isCompleted: false) == .thisWeek)
        }
    }

    @Test func computeUrgencyDone() {
        let today = Date()
        #expect(DateHelpers.computeUrgency(dueDate: today, isCompleted: true) == .done)
    }

    @Test func computeUrgencyNoDueDate() {
        #expect(DateHelpers.computeUrgency(dueDate: nil, isCompleted: false) == .later)
    }

    @Test func formatRelativeDate() {
        let today = Calendar.current.startOfDay(for: Date())
        #expect(DateHelpers.formatRelativeDate(today).contains("Today"))

        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: today)!
        #expect(DateHelpers.formatRelativeDate(tomorrow).contains("Tomorrow"))
    }

    @Test func formatTime() {
        var components = DateComponents()
        components.hour = 14
        components.minute = 30
        let date = Calendar.current.date(from: components)!
        let formatted = DateHelpers.formatTime(date)
        #expect(formatted.contains("2:30") || formatted.contains("14:30"))
    }
}
