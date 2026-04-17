import SwiftUI

/// Bottom-sheet prompt shown when no Google Calendar account is connected.
/// Presents the value proposition and kicks off OAuth via
/// `CalendarAccountsStore.connect()`. The returned URL is opened in the
/// system browser so the user lands on Google's consent screen.
struct ConnectCalendarModal: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(AuthManager.self) private var authManager

    @Bindable var accountsStore: CalendarAccountsStore

    /// Mirrors desktop's `useState(true)` default. Opting out drops the
    /// Drive/Docs scopes; the server side reads the `meetingNotes`
    /// query param.
    @State private var includeMeetingNotes = true
    @State private var isConnecting = false
    @State private var errorMessage: String?

    private var assistantName: String {
        authManager.currentUser?.assistantName ?? "Brett"
    }

    var body: some View {
        VStack(spacing: 20) {
            // Header — mirrors desktop copy. Calendar glyph in a neutral
            // glass chip, centered title/subtitle.
            VStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                        }
                        .frame(width: 44, height: 44)
                    Image(systemName: "calendar")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.60))
                }

                Text("Connect your Google Calendar")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)

                Text("\(assistantName) will sync your events and keep them up to date")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 6)

            // Meeting-notes toggle — same framing as desktop: a card with
            // the toggle and an explanation that names the user's
            // assistant, so the value prop is concrete.
            meetingNotesCard

            if let errorMessage {
                Text(errorMessage)
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.error)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Spacer(minLength: 0)

            // Actions — matches desktop's "Cancel" + "Continue to Google
            // →" pair. Cancel is the secondary; continue is the gold CTA.
            HStack(spacing: 10) {
                Button("Cancel") { dismiss() }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.60))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(
                        Color.white.opacity(0.04),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )

                Button {
                    Task { await connect() }
                } label: {
                    HStack(spacing: 6) {
                        if isConnecting {
                            ProgressView().tint(.white).scaleEffect(0.85)
                        }
                        Text(isConnecting ? "Connecting…" : "Continue to Google")
                            .font(.system(size: 14, weight: .semibold))
                        if !isConnecting {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 12, weight: .semibold))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .disabled(isConnecting)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.85))
    }

    private var meetingNotesCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Include meeting notes")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.90))

                    Text("\(assistantName) reads your Meet transcripts to extract action items and build a richer picture of your work. Less note-taking, fewer dropped balls.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.50))
                        .lineSpacing(2)
                }

                Toggle("", isOn: $includeMeetingNotes)
                    .labelsHidden()
                    .tint(BrettColors.gold)
            }
        }
        .padding(14)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.04))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                }
        }
    }

    private func connect() async {
        isConnecting = true
        errorMessage = nil
        defer { isConnecting = false }
        do {
            let url = try await accountsStore.connect(meetingNotes: includeMeetingNotes)
            openURL(url)
            dismiss()
        } catch {
            errorMessage = "Couldn't start connection. Please try again."
        }
    }
}
