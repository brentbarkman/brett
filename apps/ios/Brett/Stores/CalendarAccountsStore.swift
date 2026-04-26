import Foundation
import Observation

/// Observable façade over the `/calendar/accounts` routes.
///
/// Unlike `CalendarStore` (which reads local SwiftData), account metadata
/// isn't part of the sync-pull flow — it's fetched on demand whenever the
/// Calendar page renders or Settings needs to list connected accounts.
///
/// The store exposes:
/// - A list of connected Google accounts, each with its subscribed calendars.
/// - A flattened `calendars` view for quick "is anything connected?" checks.
/// - Mutations for connect / disconnect / toggle visibility that mirror
///   optimistically and reconcile on the server response.
@MainActor
@Observable
final class CalendarAccountsStore: Clearable {
    /// Plain struct mirror of `APIClient.CalendarInfoResponse`. Kept as a
    /// distinct type (not a typealias) so upstream views don't need to import
    /// the endpoint extension directly.
    struct CalendarInfo: Identifiable, Hashable, Sendable {
        let id: String
        let googleCalendarId: String
        let name: String
        let color: String?
        let isPrimary: Bool
        var isVisible: Bool
    }

    struct CalendarAccount: Identifiable, Hashable, Sendable {
        let id: String
        let googleEmail: String
        let connectedAt: Date
        /// Whether the account has granted the Docs/Drive scopes needed to
        /// read Google Meet transcripts. False means the user can re-auth
        /// to add the scope; true means we can surface the meeting-notes
        /// toggle.
        var hasMeetingNotesScope: Bool
        /// Per-account preference for whether Brett should sync meeting
        /// transcripts / surface Google Meet notes. Defaults to the value
        /// of `hasMeetingNotesScope` on the initial connection and is
        /// preserved across re-auths.
        var meetingNotesEnabled: Bool
        var calendars: [CalendarInfo]
    }

    // MARK: - State
    private(set) var accounts: [CalendarAccount] = []
    private(set) var isLoading: Bool = false
    private(set) var lastError: String?

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
        ClearableStoreRegistry.register(self)
    }

    // MARK: - Clearable

    func clearForSignOut() {
        accounts = []
        isLoading = false
        lastError = nil
    }

    #if DEBUG
    /// Test-only: populate in-memory state without touching the network.
    func injectForTesting(accounts: [CalendarAccount]) {
        self.accounts = accounts
    }
    #endif

    // MARK: - Derived
    /// All visible calendars across every connected account — useful for the
    /// timeline filter and the "no calendars connected" CTA check.
    var calendars: [CalendarInfo] {
        accounts.flatMap { $0.calendars }
    }

    var hasAnyAccount: Bool {
        !accounts.isEmpty
    }

    // MARK: - Fetch

    /// Load the latest account + calendar list from the API.
    ///
    /// Errors are surfaced via `lastError` rather than re-thrown so views
    /// embedding this call in a `.task { ... }` don't need a local try/catch.
    /// Throws only if the caller explicitly wants to branch on failure.
    func fetchAccounts() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.listCalendarAccounts()
            accounts = response.map { acc in
                CalendarAccount(
                    id: acc.id,
                    googleEmail: acc.googleEmail,
                    connectedAt: acc.connectedAt,
                    // Servers older than the meeting-notes rollout don't
                    // include these fields. Treat missing as "no scope /
                    // disabled" so the UI shows the upgrade affordance.
                    hasMeetingNotesScope: acc.hasMeetingNotesScope ?? false,
                    meetingNotesEnabled: acc.meetingNotesEnabled ?? false,
                    calendars: acc.calendars.map {
                        CalendarInfo(
                            id: $0.id,
                            googleCalendarId: $0.googleCalendarId,
                            name: $0.name,
                            color: $0.color,
                            isPrimary: $0.isPrimary,
                            isVisible: $0.isVisible
                        )
                    }
                )
            }
            lastError = nil
        } catch {
            lastError = String(describing: error)
        }
    }

    // MARK: - Connect / disconnect

    /// Kick off OAuth. Returns the URL the app should open in a browser /
    /// ASWebAuthenticationSession. `meetingNotes` toggles Drive/Docs scopes.
    func connect(meetingNotes: Bool = false) async throws -> URL {
        try await api.connectCalendarAccount(meetingNotes: meetingNotes)
    }

    func disconnect(accountId: String) async throws {
        try await api.disconnectCalendarAccount(accountId: accountId)
        accounts.removeAll { $0.id == accountId }
    }

    // MARK: - Visibility

    /// Toggle per-calendar visibility. Updates local state optimistically
    /// and reverts on error.
    func toggleCalendarVisibility(
        accountId: String,
        calendarId: String,
        isVisible: Bool
    ) async throws {
        // Optimistic update
        let previous = applyVisibility(accountId: accountId, calendarId: calendarId, isVisible: isVisible)
        do {
            _ = try await api.setCalendarVisibility(
                accountId: accountId,
                calendarId: calendarId,
                isVisible: isVisible
            )
        } catch {
            if let previous {
                _ = applyVisibility(accountId: accountId, calendarId: calendarId, isVisible: previous)
            }
            throw error
        }
    }

    /// Returns the previous `isVisible` value (for rollback) or nil if the
    /// calendar wasn't found.
    @discardableResult
    private func applyVisibility(accountId: String, calendarId: String, isVisible: Bool) -> Bool? {
        guard let accIdx = accounts.firstIndex(where: { $0.id == accountId }),
              let calIdx = accounts[accIdx].calendars.firstIndex(where: { $0.id == calendarId }) else {
            return nil
        }
        let previous = accounts[accIdx].calendars[calIdx].isVisible
        accounts[accIdx].calendars[calIdx].isVisible = isVisible
        return previous
    }

    // MARK: - Meeting notes (per-account)

    /// Request an incremental-consent OAuth URL to upgrade an existing
    /// account's scopes to include Docs/Drive (so Brett can read Google
    /// Meet transcripts). Caller runs the returned URL in
    /// `ASWebAuthenticationSession` then re-fetches accounts.
    func reauthAccount(accountId: String) async throws -> URL {
        try await api.reauthCalendarAccount(accountId: accountId)
    }

    /// Toggle the per-account `meetingNotesEnabled` flag. Updates local
    /// state optimistically and reverts on error. Server returns 409 if
    /// attempting to enable without the Docs scope — caller should
    /// surface the re-auth prompt in that case.
    func toggleMeetingNotesEnabled(
        accountId: String,
        enabled: Bool
    ) async throws {
        let previous = applyMeetingNotesEnabled(accountId: accountId, enabled: enabled)
        do {
            _ = try await api.setCalendarMeetingNotesEnabled(
                accountId: accountId,
                enabled: enabled
            )
        } catch {
            if let previous {
                _ = applyMeetingNotesEnabled(accountId: accountId, enabled: previous)
            }
            throw error
        }
    }

    @discardableResult
    private func applyMeetingNotesEnabled(accountId: String, enabled: Bool) -> Bool? {
        guard let idx = accounts.firstIndex(where: { $0.id == accountId }) else {
            return nil
        }
        let previous = accounts[idx].meetingNotesEnabled
        accounts[idx].meetingNotesEnabled = enabled
        return previous
    }
}
