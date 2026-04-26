import Foundation
@testable import Brett

/// Factory methods that build realistic `@Model` instances with sensible
/// defaults. Prefer these over hand-rolled initializers in tests so that
/// schema changes ripple through one place.
///
/// Every factory exposes the common properties as parameters with defaults,
/// so a test can override just the fields it cares about:
/// ```swift
/// let overdue = TestFixtures.makeItem(
///     title: "Ship release",
///     dueDate: Date().addingTimeInterval(-86_400)
/// )
/// ```
enum TestFixtures {
    /// Stable user id used by default in tests so IDs line up across fixtures
    /// unless a test explicitly cares about uniqueness.
    static let defaultUserId = "user-test-001"

    // MARK: - Item

    static func makeItem(
        id: String = UUID().uuidString,
        userId: String = defaultUserId,
        type: ItemType = .task,
        status: ItemStatus = .active,
        title: String = "Test task",
        source: String = "Brett",
        dueDate: Date? = nil,
        listId: String? = nil,
        notes: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) -> Item {
        Item(
            id: id,
            userId: userId,
            type: type,
            status: status,
            title: title,
            source: source,
            dueDate: dueDate,
            listId: listId,
            notes: notes,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    // MARK: - ItemList

    static func makeList(
        id: String = UUID().uuidString,
        userId: String = defaultUserId,
        name: String = "Test list",
        colorClass: String = "bg-blue-500",
        sortOrder: Int = 0
    ) -> ItemList {
        ItemList(
            id: id,
            userId: userId,
            name: name,
            colorClass: colorClass,
            sortOrder: sortOrder
        )
    }

    // MARK: - CalendarEvent

    static func makeEvent(
        id: String = UUID().uuidString,
        userId: String = defaultUserId,
        googleAccountId: String = "ga-test",
        calendarListId: String = "primary",
        googleEventId: String = "gcal-\(UUID().uuidString.prefix(8))",
        title: String = "Team standup",
        startTime: Date = Date().addingTimeInterval(3_600),
        endTime: Date = Date().addingTimeInterval(5_400),
        isAllDay: Bool = false,
        location: String? = nil,
        meetingLink: String? = nil,
        myResponseStatus: MyResponseStatus = .needsAction
    ) -> CalendarEvent {
        CalendarEvent(
            id: id,
            userId: userId,
            googleAccountId: googleAccountId,
            calendarListId: calendarListId,
            googleEventId: googleEventId,
            title: title,
            startTime: startTime,
            endTime: endTime,
            isAllDay: isAllDay,
            location: location,
            meetingLink: meetingLink,
            myResponseStatus: myResponseStatus
        )
    }

    // MARK: - Scout

    static func makeScout(
        id: String = UUID().uuidString,
        userId: String = defaultUserId,
        name: String = "Test scout",
        goal: String = "Monitor industry news",
        context: String? = nil,
        cadenceIntervalHours: Double = 24,
        budgetTotal: Int = 100,
        sensitivity: ScoutSensitivity = .medium,
        analysisTier: AnalysisTier = .standard
    ) -> Scout {
        Scout(
            id: id,
            userId: userId,
            name: name,
            goal: goal,
            context: context,
            cadenceIntervalHours: cadenceIntervalHours,
            budgetTotal: budgetTotal,
            sensitivity: sensitivity,
            analysisTier: analysisTier
        )
    }

    // MARK: - ScoutFinding

    static func makeFinding(
        id: String = UUID().uuidString,
        scoutId: String = "scout-test-001",
        scoutRunId: String? = nil,
        type: FindingType = .insight,
        title: String = "An interesting result",
        description: String = "Found a relevant article today.",
        sourceName: String = "Example Source",
        sourceUrl: String? = nil,
        relevanceScore: Double? = 0.8,
        reasoning: String = "Matches keywords and recent cadence."
    ) -> ScoutFinding {
        ScoutFinding(
            id: id,
            scoutId: scoutId,
            scoutRunId: scoutRunId,
            type: type,
            title: title,
            description: description,
            sourceName: sourceName,
            sourceUrl: sourceUrl,
            relevanceScore: relevanceScore,
            reasoning: reasoning
        )
    }

    // MARK: - CalendarAccount

    static func makeCalendarAccount(
        id: String = UUID().uuidString,
        googleEmail: String = "test@example.com",
        connectedAt: Date = Date(),
        hasMeetingNotesScope: Bool = false,
        meetingNotesEnabled: Bool = false,
        calendars: [CalendarAccountsStore.CalendarInfo] = []
    ) -> CalendarAccountsStore.CalendarAccount {
        CalendarAccountsStore.CalendarAccount(
            id: id,
            googleEmail: googleEmail,
            connectedAt: connectedAt,
            hasMeetingNotesScope: hasMeetingNotesScope,
            meetingNotesEnabled: meetingNotesEnabled,
            calendars: calendars
        )
    }

    // MARK: - SearchResult

    static func makeSearchResult(
        entityType: SearchEntityType = .item,
        entityId: String = UUID().uuidString,
        title: String = "Test result",
        snippet: String? = nil,
        score: Double = 1.0,
        matchType: SearchMatchType = .hybrid
    ) -> SearchResult {
        SearchResult(
            entityType: entityType,
            entityId: entityId,
            title: title,
            snippet: snippet,
            score: score,
            matchType: matchType,
            metadata: nil
        )
    }

    // MARK: - ScoutDTO

    /// Build a `APIClient.ScoutDTO` for tests. The DTO is `Decodable`-only
    /// (no memberwise init), so we round-trip through JSON. Sufficient
    /// fields are populated to make the result indistinguishable from a
    /// real server response for in-memory store tests.
    static func makeScoutDTO(
        id: String = UUID().uuidString,
        name: String = "Test scout",
        goal: String = "Monitor industry news",
        status: String = "active"
    ) throws -> APIClient.ScoutDTO {
        let json: [String: Any] = [
            "id": id,
            "name": name,
            "avatarLetter": String(name.prefix(1)),
            "avatarGradient": ["#000000", "#ffffff"],
            "goal": goal,
            "context": NSNull(),
            "sources": [],
            "sensitivity": "medium",
            "analysisTier": "standard",
            "cadenceIntervalHours": 24,
            "cadenceMinIntervalHours": 6,
            "cadenceCurrentIntervalHours": 24,
            "cadenceReason": NSNull(),
            "budgetUsed": 0,
            "budgetTotal": 100,
            "status": status,
            "statusLine": NSNull(),
            "bootstrapped": false,
            "endDate": NSNull(),
            "nextRunAt": NSNull(),
            "lastRun": NSNull(),
            "findingsCount": 0,
            "createdAt": ISO8601DateFormatter().string(from: Date()),
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(APIClient.ScoutDTO.self, from: data)
    }

    // MARK: - UserProfile

    static func makeUserProfile(
        id: String = defaultUserId,
        email: String = "test@example.com",
        name: String? = "Test User"
    ) -> UserProfile {
        UserProfile(id: id, email: email, name: name)
    }

    // MARK: - AuthUser (plain struct)

    static func makeAuthUser(
        id: String = defaultUserId,
        email: String = "test@example.com",
        name: String? = "Test User",
        timezone: String? = "America/Los_Angeles",
        assistantName: String? = "Brett"
    ) -> AuthUser {
        AuthUser(
            id: id,
            email: email,
            name: name,
            avatarUrl: nil,
            timezone: timezone,
            assistantName: assistantName
        )
    }
}
