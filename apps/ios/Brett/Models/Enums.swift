import Foundation

// ── Item domain ──

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
    case tweet
    case article
    case video
    case pdf
    case podcast
    case webPage = "web_page"
    case newsletter
}

enum ContentStatus: String, Codable {
    case pending
    case extracted
    case failed
}

// ── Calendar ──

enum CalendarRsvpStatus: String, Codable {
    case accepted
    case declined
    case tentative
    case needsAction
}

// Alias — Prisma name is myResponseStatus; keep a semantic type for it.
typealias MyResponseStatus = CalendarRsvpStatus

// ── Scouts ──

enum ScoutStatus: String, Codable {
    case active
    case paused
    case completed
    case expired
    case archived
}

enum ScoutSensitivity: String, Codable {
    case low
    case medium
    case high
}

enum AnalysisTier: String, Codable {
    case standard
    case advanced
    case deep
}

// Retained legacy name used elsewhere in the iOS target.
typealias ScoutAnalysisTier = AnalysisTier

enum FindingType: String, Codable {
    case insight
    case article
    case task
}

// ── Messages ──

enum MessageRole: String, Codable {
    case user
    case brett
    case assistant
    case system
}

// ── User profile ──

enum BackgroundStyle: String, Codable {
    case photography
    case gradient
}

enum TempUnit: String, Codable {
    case auto
    case c
    case f
}

// ── Sync ──

enum SyncStatus: String, Codable {
    case synced
    case pendingCreate = "pending_create"
    case pendingUpdate = "pending_update"
    case pendingDelete = "pending_delete"
    case provisional
    case conflict
    case dead

    // Legacy / short aliases kept for convenience.
    static let pending: SyncStatus = .pendingUpdate
    static let failed: SyncStatus = .dead
}

enum MutationAction: String, Codable {
    case create = "CREATE"
    case update = "UPDATE"
    case delete = "DELETE"
    case custom = "CUSTOM"
}

enum MutationStatus: String, Codable {
    case pending
    case inFlight = "in_flight"
    case failed
    case dead
    case blocked
    case done
}

enum MutationMethod: String, Codable {
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

enum AttachmentUploadStage: String, Codable {
    case pending
    case requestingUrl = "requesting_url"
    case uploading
    case confirming
    case done
    case failed
}
