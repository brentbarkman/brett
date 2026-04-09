import Foundation

enum ItemType: String, Codable, CaseIterable {
    case task
    case content
}

enum ItemStatus: String, Codable, CaseIterable {
    case active
    case snoozed
    case done
    case archived
}

enum Urgency: String, Codable, CaseIterable {
    case overdue
    case today
    case thisWeek = "this_week"
    case nextWeek = "next_week"
    case later
    case done
}

enum DueDatePrecision: String, Codable {
    case day
    case week
}

enum ReminderType: String, Codable {
    case morningOf = "morning_of"
    case oneHourBefore = "1_hour_before"
    case dayBefore = "day_before"
    case custom
}

enum RecurrenceType: String, Codable {
    case daily
    case weekly
    case monthly
    case custom
}

enum ContentType: String, Codable {
    case tweet, article, video, pdf, podcast, webPage = "web_page", newsletter
}

enum ContentStatus: String, Codable {
    case pending, extracted, failed
}

enum ScoutStatus: String, Codable {
    case active, paused, completed, expired
}

enum ScoutSensitivity: String, Codable {
    case low, medium, high
}

enum ScoutAnalysisTier: String, Codable {
    case standard, deep
}

enum FindingType: String, Codable {
    case insight, article, task
}

enum CalendarRsvpStatus: String, Codable {
    case accepted, declined, tentative, needsAction
}

enum SyncStatus: String, Codable {
    case synced, pending, failed
}

enum MutationAction: String, Codable {
    case create = "CREATE"
    case update = "UPDATE"
    case delete = "DELETE"
}
