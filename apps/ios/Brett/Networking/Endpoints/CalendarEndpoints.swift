import Foundation

/// Typed `APIClient` extension for the calendar + calendar-accounts routes.
///
/// Server paths (confirmed against `apps/api/src/routes/calendar.ts`,
/// `calendar-accounts.ts`, and `suggestions.ts`):
/// - `GET  /calendar/accounts`                                    — list accounts + calendars
/// - `POST /calendar/accounts/connect?meetingNotes=false`         — returns OAuth URL
/// - `DELETE /calendar/accounts/:id`                              — disconnect
/// - `PATCH /calendar/accounts/:accountId/calendars/:calId`       — toggle visibility
/// - `PATCH /calendar/events/:id/rsvp`                            — update RSVP
/// - `PUT  /calendar/events/:id/notes`                            — upsert note content
/// - `GET  /api/events/:id/related-items`                         — semantically-related items
/// - `GET  /api/events/:id/meeting-history`                       — recurring meeting context
///
/// NOTE: The task spec mentioned `POST /calendar/events/:id/rsvp` and
/// `GET /calendar/events/:id/meetings-with-attendees`. Neither exists.
/// The server uses PATCH for RSVP and exposes recurring-meeting history at
/// `/api/events/:id/meeting-history`. We use the actual paths here and flag
/// the gap as a TODO — see the readback in the task report.
@MainActor
extension APIClient {
    // MARK: - Account shapes

    struct CalendarInfoResponse: Decodable, Sendable {
        let id: String
        let googleCalendarId: String
        let name: String
        let color: String?
        let isPrimary: Bool
        let isVisible: Bool
    }

    struct CalendarAccountResponse: Decodable, Sendable {
        let id: String
        let googleEmail: String
        let connectedAt: Date
        let hasMeetingNotesScope: Bool?
        let meetingNotesEnabled: Bool?
        let calendars: [CalendarInfoResponse]
    }

    struct CalendarConnectResponse: Decodable, Sendable {
        let url: URL
    }

    struct CalendarReauthResponse: Decodable, Sendable {
        let url: URL
    }

    struct CalendarMeetingNotesResponse: Decodable, Sendable {
        let meetingNotesEnabled: Bool
    }

    // MARK: - Event detail shapes

    struct RsvpResponse: Decodable, Sendable {
        let id: String
        let myResponseStatus: String
    }

    struct RelatedItem: Decodable, Sendable, Identifiable {
        let entityId: String
        let title: String
        let type: String
        let status: String
        let similarity: Double?

        var id: String { entityId }
    }

    struct RelatedItemsResponse: Decodable, Sendable {
        let relatedItems: [RelatedItem]
    }

    struct MeetingHistoryResponse: Decodable, Sendable {
        let recurringEventId: String?
        let pastOccurrences: [PastOccurrence]
        let relatedItems: [RelatedItem]

        init(
            recurringEventId: String?,
            pastOccurrences: [PastOccurrence],
            relatedItems: [RelatedItem]
        ) {
            self.recurringEventId = recurringEventId
            self.pastOccurrences = pastOccurrences
            self.relatedItems = relatedItems
        }

        struct PastOccurrence: Decodable, Sendable, Identifiable {
            let eventId: String
            let title: String
            let startTime: Date
            let endTime: Date

            var id: String { eventId }

            init(eventId: String, title: String, startTime: Date, endTime: Date) {
                self.eventId = eventId
                self.title = title
                self.startTime = startTime
                self.endTime = endTime
            }
        }
    }

    struct CalendarNoteResponse: Decodable, Sendable {
        let content: String?
        let updatedAt: Date?
    }

    // MARK: - Calendar accounts

    /// GET /calendar/accounts — List connected accounts with their calendars.
    func listCalendarAccounts() async throws -> [CalendarAccountResponse] {
        try await request(
            [CalendarAccountResponse].self,
            path: "/calendar/accounts",
            method: "GET"
        )
    }

    /// POST /calendar/accounts/connect — Initiate OAuth. Returns the URL to
    /// present to the user. `meetingNotes=false` omits Drive/Docs scopes.
    func connectCalendarAccount(meetingNotes: Bool = false) async throws -> URL {
        let query = meetingNotes ? "" : "?meetingNotes=false"
        let response: CalendarConnectResponse = try await request(
            CalendarConnectResponse.self,
            path: "/calendar/accounts/connect\(query)",
            method: "POST"
        )
        return response.url
    }

    /// DELETE /calendar/accounts/:id — Disconnect account (cascade delete).
    func disconnectCalendarAccount(accountId: String) async throws {
        _ = try await rawRequest(
            path: "/calendar/accounts/\(accountId)",
            method: "DELETE"
        )
    }

    /// PATCH /calendar/accounts/:accountId/calendars/:calId — Toggle visibility.
    func setCalendarVisibility(
        accountId: String,
        calendarId: String,
        isVisible: Bool
    ) async throws -> CalendarInfoResponse {
        struct Body: Encodable { let isVisible: Bool }
        return try await request(
            CalendarInfoResponse.self,
            path: "/calendar/accounts/\(accountId)/calendars/\(calendarId)",
            method: "PATCH",
            body: Body(isVisible: isVisible)
        )
    }

    /// POST /calendar/accounts/:accountId/reauth — Kick off an incremental
    /// OAuth to upgrade the account's granted scopes (specifically the
    /// Docs/Drive scopes needed to read Google Meet transcripts). Returns
    /// the URL to present in `ASWebAuthenticationSession`. After the user
    /// finishes the consent flow, re-fetch `listCalendarAccounts()` to
    /// pick up the new `hasMeetingNotesScope` value.
    func reauthCalendarAccount(accountId: String) async throws -> URL {
        let response: CalendarReauthResponse = try await request(
            CalendarReauthResponse.self,
            path: "/calendar/accounts/\(accountId)/reauth",
            method: "POST"
        )
        return response.url
    }

    /// PATCH /calendar/accounts/:accountId/meeting-notes — Toggle the
    /// per-account `meetingNotesEnabled` flag. Server rejects with 409
    /// when enabling without the Docs scope granted.
    @discardableResult
    func setCalendarMeetingNotesEnabled(
        accountId: String,
        enabled: Bool
    ) async throws -> CalendarMeetingNotesResponse {
        struct Body: Encodable { let enabled: Bool }
        return try await request(
            CalendarMeetingNotesResponse.self,
            path: "/calendar/accounts/\(accountId)/meeting-notes",
            method: "PATCH",
            body: Body(enabled: enabled)
        )
    }

    // MARK: - Event detail

    /// PATCH /calendar/events/:id/rsvp — Update the current user's RSVP.
    /// `status` must be one of accepted|declined|tentative|needsAction.
    @discardableResult
    func updateEventRsvp(
        eventId: String,
        status: CalendarRsvpStatus,
        comment: String? = nil
    ) async throws -> RsvpResponse {
        struct Body: Encodable {
            let status: String
            let comment: String?
        }
        return try await request(
            RsvpResponse.self,
            path: "/calendar/events/\(eventId)/rsvp",
            method: "PATCH",
            body: Body(status: status.rawValue, comment: comment)
        )
    }

    /// GET /calendar/events/:id/notes — Read the private note content.
    /// The store keeps a local SwiftData copy; this is for reconciliation.
    func fetchEventNote(eventId: String) async throws -> CalendarNoteResponse {
        try await request(
            CalendarNoteResponse.self,
            path: "/calendar/events/\(eventId)/notes",
            method: "GET"
        )
    }

    /// PUT /calendar/events/:id/notes — Upsert private note content.
    /// The offline-first path is `CalendarStore.upsertNote(...)`; this direct
    /// call is only used when we want an immediate server write.
    @discardableResult
    func upsertEventNote(eventId: String, content: String) async throws -> CalendarNoteResponse {
        struct Body: Encodable { let content: String }
        return try await request(
            CalendarNoteResponse.self,
            path: "/calendar/events/\(eventId)/notes",
            method: "PUT",
            body: Body(content: content)
        )
    }

    /// GET /api/events/:id/related-items — Items surfaced by embedding similarity.
    func fetchEventRelatedItems(eventId: String) async throws -> RelatedItemsResponse {
        try await request(
            RelatedItemsResponse.self,
            path: "/api/events/\(eventId)/related-items",
            method: "GET"
        )
    }

    /// GET /api/events/:id/meeting-history — Recurring meeting context + past
    /// occurrences. Use as the best-available proxy for the spec's
    /// "meetings-with-attendees" endpoint (which does not exist server-side).
    func fetchEventMeetingHistory(eventId: String) async throws -> MeetingHistoryResponse {
        try await request(
            MeetingHistoryResponse.self,
            path: "/api/events/\(eventId)/meeting-history",
            method: "GET"
        )
    }
}
