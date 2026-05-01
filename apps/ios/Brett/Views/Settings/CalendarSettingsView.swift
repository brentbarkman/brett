import SwiftUI
import AuthenticationServices

/// Connected calendar accounts and their individual calendars, plus the
/// Granola meeting-notes integration.
///
/// Backed by:
/// - `CalendarAccountsStore` (which wraps the typed
///   `APIClient.listCalendarAccounts()` / `connectCalendarAccount()` /
///   `disconnectCalendarAccount()` / `setCalendarVisibility()` endpoints)
///   for the per-Google-account state.
/// - A local `@State granolaStatus` fetched from `/granola/auth` for the
///   Granola integration — Granola state isn't part of sync-pull, and
///   there's only one Granola account per user so a store would be
///   overkill.
///
/// Both OAuth flows run in-process via `ASWebAuthenticationSession`:
/// - Google Calendar uses `callbackScheme: "brett"` (the server redirects
///   back to a custom scheme that the app intercepts).
/// - Granola uses `callbackScheme: nil` — the server's OAuth callback
///   renders a page that calls `window.close()`, which the auth session
///   also interprets as completion.
struct CalendarSettingsView: View {
    var body: some View {
        BrettSettingsScroll {
            GoogleCalendarSection()
            GranolaIntegrationSection()
        }
        .navigationTitle("Calendar")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
    }
}

// MARK: - Google Calendar section

private struct GoogleCalendarSection: View {
    @State private var store = CalendarAccountsStore()
    @State private var isConnecting = false
    @State private var errorMessage: String?
    @State private var pendingDeleteId: String?

    // Per-account meeting-notes scope upgrade (Google Calendar).
    /// accountId being upgraded, so the inline "Enable meeting notes"
    /// button can show a spinner without freezing the whole list.
    @State private var reauthingAccountId: String?

    var body: some View {
        Group {
            if let errorMessage {
                BrettSettingsSection {
                    Text(errorMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.error)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            } else if let storeError = store.lastError {
                BrettSettingsSection {
                    Text(storeError)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.error)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }

            if store.accounts.isEmpty, !store.isLoading {
                BrettSettingsSection {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No calendars connected")
                            .font(BrettTypography.taskTitle)
                            .foregroundStyle(BrettColors.textCardTitle)
                        Text("Connect a Google Calendar to see your events in Brett.")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }

            ForEach(store.accounts) { account in
                BrettSettingsSection(account.googleEmail) {
                    accountHeaderRow(account)

                    BrettSettingsDivider()
                    meetingNotesAccountRow(account)

                    ForEach(Array(account.calendars.enumerated()), id: \.element.id) { _, calendar in
                        BrettSettingsDivider()
                        calendarToggleRow(account: account, calendar: calendar)
                    }
                }
            }

            BrettSettingsSection {
                Button {
                    Task { await connect() }
                } label: {
                    HStack {
                        if isConnecting {
                            ProgressView().progressViewStyle(.circular).tint(BrettColors.gold)
                        } else {
                            Image(systemName: "plus.circle.fill")
                                .foregroundStyle(BrettColors.gold)
                        }
                        Text("Connect Google Calendar")
                            .foregroundStyle(BrettColors.textCardTitle)
                    }
                }
                .disabled(isConnecting)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
        }
        .task {
            await store.fetchAccounts()
        }
        .confirmationDialog(
            "Disconnect this calendar account?",
            isPresented: Binding(
                get: { pendingDeleteId != nil },
                set: { if !$0 { pendingDeleteId = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                if let id = pendingDeleteId {
                    Task { await disconnect(accountId: id) }
                }
                pendingDeleteId = nil
            }
            Button("Cancel", role: .cancel) { pendingDeleteId = nil }
        } message: {
            Text("Events from this account will no longer sync.")
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func accountHeaderRow(_ account: CalendarAccountsStore.CalendarAccount) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "envelope.badge")
                .foregroundStyle(BrettColors.gold)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.googleEmail)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(BrettColors.textCardTitle)
                Text("Connected \(account.connectedAt.formatted(.dateTime.month().day().year()))")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }
            Spacer()
            Button(role: .destructive) {
                pendingDeleteId = account.id
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(BrettColors.error)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    /// Per-account meeting-notes row. Two states:
    /// - Scope not yet granted → inline "Enable meeting notes" button
    ///   that kicks off an incremental-consent OAuth.
    /// - Scope granted → a toggle bound to `meetingNotesEnabled`.
    @ViewBuilder
    private func meetingNotesAccountRow(_ account: CalendarAccountsStore.CalendarAccount) -> some View {
        if account.hasMeetingNotesScope {
            Toggle(isOn: Binding(
                get: { account.meetingNotesEnabled },
                set: { newValue in
                    Task {
                        do {
                            try await store.toggleMeetingNotesEnabled(
                                accountId: account.id,
                                enabled: newValue
                            )
                        } catch {
                            errorMessage = "Couldn't update meeting notes setting."
                        }
                    }
                }
            )) {
                HStack(spacing: 10) {
                    Image(systemName: "text.quote")
                        .foregroundStyle(BrettColors.gold)
                        .frame(width: 16)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Meeting notes")
                            .font(BrettTypography.taskTitle)
                            .foregroundStyle(BrettColors.textCardTitle)
                        Text("Sync Google Meet transcripts and action items")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                }
            }
            .tint(BrettColors.gold)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        } else {
            Button {
                Task { await enableMeetingNotes(accountId: account.id) }
            } label: {
                HStack(spacing: 10) {
                    if reauthingAccountId == account.id {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.gold)
                            .frame(width: 16)
                    } else {
                        Image(systemName: "text.quote")
                            .foregroundStyle(BrettColors.gold)
                            .frame(width: 16)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Enable meeting notes")
                            .font(BrettTypography.taskTitle)
                            .foregroundStyle(BrettColors.textCardTitle)
                        Text("Grant access to Google Meet transcripts")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrettColors.textMeta)
                }
            }
            .buttonStyle(.plain)
            .disabled(reauthingAccountId == account.id)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
    }

    @ViewBuilder
    private func calendarToggleRow(
        account: CalendarAccountsStore.CalendarAccount,
        calendar: CalendarAccountsStore.CalendarInfo
    ) -> some View {
        Toggle(isOn: Binding(
            get: { calendar.isVisible },
            set: { newValue in
                Task {
                    do {
                        try await store.toggleCalendarVisibility(
                            accountId: account.id,
                            calendarId: calendar.id,
                            isVisible: newValue
                        )
                    } catch {
                        errorMessage = "Couldn't update visibility."
                    }
                }
            }
        )) {
            HStack(spacing: 10) {
                Circle()
                    .fill(swatchColor(calendar.color))
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 1) {
                    Text(calendar.name)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                    if calendar.isPrimary {
                        Text("Primary")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                }
            }
        }
        .tint(BrettColors.gold)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Helpers

    private func swatchColor(_ hex: String?) -> Color {
        guard let hex, let c = BrettColors.fromHex(hex) else { return BrettColors.gold }
        return c
    }

    // MARK: - Actions

    private func connect() async {
        isConnecting = true
        defer { isConnecting = false }
        errorMessage = nil

        do {
            let url = try await store.connect(meetingNotes: false)
            try await WebAuthRunner.run(url: url, callbackScheme: "brett")
            await store.fetchAccounts()
        } catch WebAuthError.cancelled {
            // User closed the sheet — nothing to do.
        } catch {
            errorMessage = "Couldn't connect. Please try again."
        }
    }

    private func disconnect(accountId: String) async {
        do {
            try await store.disconnect(accountId: accountId)
        } catch {
            errorMessage = "Couldn't disconnect."
        }
    }

    /// Runs the incremental-consent flow to add Docs/Drive scope to an
    /// existing Google account. After the session closes we re-fetch the
    /// account list so `hasMeetingNotesScope` flips to true and the row
    /// switches to a toggle.
    private func enableMeetingNotes(accountId: String) async {
        reauthingAccountId = accountId
        defer { reauthingAccountId = nil }
        errorMessage = nil

        do {
            let url = try await store.reauthAccount(accountId: accountId)
            try await WebAuthRunner.run(url: url, callbackScheme: "brett")
            await store.fetchAccounts()
        } catch WebAuthError.cancelled {
            // User closed the sheet — nothing to do.
        } catch {
            errorMessage = "Couldn't enable meeting notes. Please try again."
        }
    }
}

// MARK: - Granola integration section

private struct GranolaIntegrationSection: View {
    @State private var granolaStatus: GranolaAuthStatus?
    @State private var isGranolaLoading = false
    @State private var isConnectingGranola = false
    @State private var isDisconnectingGranola = false
    @State private var pendingDisconnectGranola = false
    @State private var granolaErrorMessage: String?

    var body: some View {
        BrettSettingsSection("Meeting Notes") {
            if let status = granolaStatus, status.connected, let account = status.account {
                granolaConnectedRows(account)
            } else {
                granolaDisconnectedRows
            }
        }
        .task { await refreshGranolaStatus() }
        .confirmationDialog(
            "Disconnect Granola?",
            isPresented: $pendingDisconnectGranola,
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                Task { await disconnectGranola() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Meeting notes and any tasks auto-created from them will stop syncing. Past synced data will be removed.")
        }
    }

    @ViewBuilder
    private var granolaDisconnectedRows: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: "note.text")
                    .foregroundStyle(BrettColors.gold)
                Text("Connect Granola to sync meeting notes and auto-create tasks from your meetings.")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let granolaErrorMessage {
                Text(granolaErrorMessage)
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.error)
            }

            Button {
                Task { await connectGranola() }
            } label: {
                HStack(spacing: 8) {
                    if isConnectingGranola {
                        ProgressView().progressViewStyle(.circular).tint(BrettColors.gold)
                    } else {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(BrettColors.gold)
                    }
                    Text("Connect Granola")
                        .foregroundStyle(BrettColors.textCardTitle)
                }
            }
            .disabled(isConnectingGranola || isGranolaLoading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func granolaConnectedRows(_ account: GranolaAccount) -> some View {
        // Row 1 — identity + last sync + reconnect affordance.
        // The Reconnect button is always visible when connected because the
        // server doesn't expose a per-account "broken" flag. Users who land
        // here from a re-link task need a way to re-run OAuth without first
        // disconnecting; healthy users won't bother tapping it.
        HStack(spacing: 12) {
            Image(systemName: "note.text")
                .foregroundStyle(BrettColors.gold)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.email)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(BrettColors.textCardTitle)
                Text(lastSyncDescription(from: account.lastSyncAt))
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }
            Spacer()
            Button {
                Task { await connectGranola() }
            } label: {
                HStack(spacing: 4) {
                    if isConnectingGranola {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.gold)
                            .controlSize(.mini)
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    Text("Reconnect")
                        .font(.system(size: 11, weight: .semibold))
                }
                .foregroundStyle(BrettColors.gold)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(BrettColors.gold.opacity(0.15)))
            }
            .buttonStyle(.plain)
            .disabled(isConnectingGranola)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)

        // Row 2 — auto-create my tasks
        BrettSettingsDivider()
        Toggle(isOn: Binding(
            get: { account.autoCreateMyTasks },
            set: { newValue in
                Task { await updateGranolaPreferences(autoCreateMyTasks: newValue) }
            }
        )) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle")
                    .foregroundStyle(BrettColors.gold)
                    .frame(width: 16)
                Text("Auto-create my tasks")
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(BrettColors.textCardTitle)
            }
        }
        .tint(BrettColors.gold)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)

        // Row 3 — auto-create follow-ups
        BrettSettingsDivider()
        Toggle(isOn: Binding(
            get: { account.autoCreateFollowUps },
            set: { newValue in
                Task { await updateGranolaPreferences(autoCreateFollowUps: newValue) }
            }
        )) {
            HStack(spacing: 10) {
                Image(systemName: "arrow.uturn.forward.circle")
                    .foregroundStyle(BrettColors.gold)
                    .frame(width: 16)
                Text("Auto-create follow-ups")
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(BrettColors.textCardTitle)
            }
        }
        .tint(BrettColors.gold)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)

        if let granolaErrorMessage {
            BrettSettingsDivider()
            Text(granolaErrorMessage)
                .font(BrettTypography.taskMeta)
                .foregroundStyle(BrettColors.error)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
        }

        // Row 4 — disconnect
        BrettSettingsDivider()
        Button(role: .destructive) {
            pendingDisconnectGranola = true
        } label: {
            HStack(spacing: 10) {
                if isDisconnectingGranola {
                    ProgressView().progressViewStyle(.circular).tint(BrettColors.error)
                        .frame(width: 16)
                } else {
                    Image(systemName: "minus.circle")
                        .foregroundStyle(BrettColors.error)
                        .frame(width: 16)
                }
                Text("Disconnect Granola")
                    .foregroundStyle(BrettColors.error)
                Spacer()
            }
        }
        .buttonStyle(.plain)
        .disabled(isDisconnectingGranola)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Helpers

    /// "Last synced 2h ago" style string. The API returns an ISO-8601
    /// string so we parse it locally rather than relying on the generic
    /// `.iso8601` decoder (which would require the field to be a Date on
    /// the struct — keeping it as a String lets the Decodable decl
    /// mirror the server shape exactly).
    private func lastSyncDescription(from iso8601: String?) -> String {
        guard let iso8601, let date = Self.isoFormatter.date(from: iso8601) else {
            return "Not synced yet"
        }
        return "Last synced \(Self.relative(date)) ago"
    }

    /// Lazily-initialised decoder for the `lastSyncAt` string. Uses
    /// `.withFractionalSeconds` because server-side Prisma emits
    /// millisecond precision.
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Mirrors `FindingCard.relative` — kept inline to avoid a dependency
    /// on Scouts internals from the settings screen. If we grow a third
    /// caller we should lift this into a shared utility.
    private static func relative(_ date: Date, now: Date = Date()) -> String {
        let interval = now.timeIntervalSince(date)
        let minutes = Int(interval / 60)
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 30 { return "\(days)d" }
        let months = days / 30
        return "\(months)mo"
    }

    // MARK: - Actions

    private func refreshGranolaStatus() async {
        isGranolaLoading = true
        defer { isGranolaLoading = false }
        do {
            let status: GranolaAuthStatus = try await APIClient.shared.request(
                GranolaAuthStatus.self,
                path: "/granola/auth",
                method: "GET"
            )
            granolaStatus = status
            granolaErrorMessage = nil
        } catch {
            // Soft-fail: if the user has never connected Granola, show
            // the disconnected state rather than an error banner. Only
            // surface the message on a real connected-status fetch fail.
            granolaStatus = GranolaAuthStatus(connected: false, account: nil)
        }
    }

    private func connectGranola() async {
        isConnectingGranola = true
        defer { isConnectingGranola = false }
        granolaErrorMessage = nil

        do {
            let response: GranolaConnectResponse = try await APIClient.shared.request(
                GranolaConnectResponse.self,
                path: "/granola/auth/connect",
                method: "POST"
            )
            guard let url = URL(string: response.url) else {
                granolaErrorMessage = "Couldn't start connection. Please try again."
                return
            }
            // Granola's OAuth callback page runs `window.close()`, which
            // ASWebAuthenticationSession picks up as completion — we
            // don't need (and don't have) a custom URL scheme.
            try await WebAuthRunner.run(url: url, callbackScheme: nil)
            await refreshGranolaStatus()
        } catch WebAuthError.cancelled {
            // User closed the window without connecting — no-op.
        } catch {
            granolaErrorMessage = "Couldn't connect to Granola. Please try again."
        }
    }

    private func disconnectGranola() async {
        isDisconnectingGranola = true
        defer { isDisconnectingGranola = false }
        granolaErrorMessage = nil

        do {
            _ = try await APIClient.shared.rawRequest(
                path: "/granola/auth",
                method: "DELETE"
            )
            await refreshGranolaStatus()
        } catch {
            granolaErrorMessage = "Couldn't disconnect Granola. Please try again."
        }
    }

    /// Shared preferences patch — callers pass just the field they want
    /// to change; nil fields are omitted from the body so we don't
    /// overwrite the companion preference.
    private func updateGranolaPreferences(
        autoCreateMyTasks: Bool? = nil,
        autoCreateFollowUps: Bool? = nil
    ) async {
        guard let current = granolaStatus?.account else { return }

        // Optimistic local update so the toggle animates instantly.
        let previous = current
        let updatedAccount = GranolaAccount(
            id: current.id,
            email: current.email,
            lastSyncAt: current.lastSyncAt,
            autoCreateMyTasks: autoCreateMyTasks ?? current.autoCreateMyTasks,
            autoCreateFollowUps: autoCreateFollowUps ?? current.autoCreateFollowUps,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt
        )
        granolaStatus = GranolaAuthStatus(connected: true, account: updatedAccount)

        do {
            _ = try await APIClient.shared.request(
                GranolaPreferencesResponse.self,
                path: "/granola/auth/preferences",
                method: "PATCH",
                body: GranolaPreferencesBody(
                    autoCreateMyTasks: autoCreateMyTasks,
                    autoCreateFollowUps: autoCreateFollowUps
                )
            )
            granolaErrorMessage = nil
        } catch {
            // Roll back optimistic update.
            granolaStatus = GranolaAuthStatus(connected: true, account: previous)
            granolaErrorMessage = "Couldn't update preference. Please try again."
        }
    }
}

// MARK: - Granola API shapes

/// Matches the response of `GET /granola/auth`. We keep `lastSyncAt` as a
/// String (not Date) so we don't have to fight the APIClient's global
/// `.iso8601` decoder over the server's fractional-seconds output — we
/// parse it lazily at render time in `lastSyncDescription`.
struct GranolaAccount: Decodable, Equatable {
    let id: String
    let email: String
    let lastSyncAt: String?
    let autoCreateMyTasks: Bool
    let autoCreateFollowUps: Bool
    let createdAt: String
    let updatedAt: String
}

struct GranolaAuthStatus: Decodable, Equatable {
    let connected: Bool
    let account: GranolaAccount?
}

/// Matches `POST /granola/auth/connect` response.
private struct GranolaConnectResponse: Decodable {
    let url: String
}

/// Matches `PATCH /granola/auth/preferences` response.
private struct GranolaPreferencesResponse: Decodable {
    let autoCreateMyTasks: Bool
    let autoCreateFollowUps: Bool
}

/// Body for `PATCH /granola/auth/preferences`. Omitted fields stay
/// unchanged server-side — Swift's encoder skips nil values by default.
private struct GranolaPreferencesBody: Encodable {
    let autoCreateMyTasks: Bool?
    let autoCreateFollowUps: Bool?
}

// MARK: - Web auth runner

enum WebAuthError: Error { case cancelled, failed }

/// Wraps `ASWebAuthenticationSession` in an async API. We accept any
/// callback scheme — the server handles the redirect HTML page and our
/// flow just waits for the session to close. Pass `nil` for providers
/// whose callback page closes the window via `window.close()` (Granola
/// does this); pass a real scheme (e.g. "brett") when the server
/// redirects to `brett://…` and the app intercepts it.
@MainActor
enum WebAuthRunner {
    static func run(url: URL, callbackScheme: String?) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let presenter = PresentationContextProvider()
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { _, error in
                if let authError = error as? ASWebAuthenticationSessionError,
                   authError.code == .canceledLogin {
                    continuation.resume(throwing: WebAuthError.cancelled)
                } else if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
                _ = presenter // keep alive until completion
            }
            session.presentationContextProvider = presenter
            session.prefersEphemeralWebBrowserSession = false
            if !session.start() {
                continuation.resume(throwing: WebAuthError.failed)
            }
        }
    }
}

private final class PresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
