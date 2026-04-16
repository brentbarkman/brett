import SwiftUI
import AuthenticationServices

/// Connected calendar accounts and their individual calendars.
///
/// Backed by W3-C's `CalendarAccountsStore` (which wraps the typed
/// `APIClient.listCalendarAccounts()` / `connectCalendarAccount()` /
/// `disconnectCalendarAccount()` / `setCalendarVisibility()` endpoints).
///
/// OAuth runs in-process via `ASWebAuthenticationSession` — after it
/// closes we re-fetch the account list to pick up the new account.
struct CalendarSettingsView: View {
    @State private var store = CalendarAccountsStore()
    @State private var isConnecting = false
    @State private var errorMessage: String?
    @State private var pendingDeleteId: String?

    var body: some View {
        BrettSettingsScroll {
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
        .navigationTitle("Calendar")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await store.fetchAccounts() }
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
}

// MARK: - Web auth runner

enum WebAuthError: Error { case cancelled, failed }

/// Wraps `ASWebAuthenticationSession` in an async API. We accept any
/// callback scheme — the server handles the redirect HTML page and our
/// flow just waits for the session to close.
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
