import SwiftUI

/// Bottom-sheet prompt shown when no Google Calendar account is connected.
/// Presents the value proposition and kicks off OAuth via
/// `CalendarAccountsStore.connect()`. The returned URL is opened in the
/// system browser so the user lands on Google's consent screen.
struct ConnectCalendarModal: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @Bindable var accountsStore: CalendarAccountsStore

    @State private var isConnecting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Title
            VStack(alignment: .leading, spacing: 6) {
                Text("Connect Google Calendar")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Bring your meetings into Brett.")
                    .font(BrettTypography.body)
                    .foregroundStyle(Color.white.opacity(0.60))
            }

            // Benefits
            VStack(alignment: .leading, spacing: 14) {
                benefitRow(systemImage: "calendar", title: "See your meetings next to your tasks")
                benefitRow(systemImage: "sparkles", title: "Tap events for Brett's prep")
                benefitRow(systemImage: "note.text", title: "Meeting notes sync back to Brett")
            }
            .padding(.top, 4)

            if let errorMessage {
                Text(errorMessage)
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.error)
            }

            Spacer()

            // Actions
            VStack(spacing: 10) {
                Button {
                    Task { await connect() }
                } label: {
                    HStack(spacing: 8) {
                        if isConnecting {
                            ProgressView()
                                .tint(.black)
                        }
                        Text(isConnecting ? "Connecting..." : "Connect")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .disabled(isConnecting)

                Button("Later") {
                    dismiss()
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.60))
                .frame(maxWidth: .infinity)
                .frame(height: 40)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 28)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.black.opacity(0.85))
    }

    @ViewBuilder
    private func benefitRow(systemImage: String, title: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrettColors.gold)
                .frame(width: 22, height: 22)
                .background(BrettColors.gold.opacity(0.15), in: Circle())
            Text(title)
                .font(BrettTypography.body)
                .foregroundStyle(Color.white.opacity(0.85))
            Spacer()
        }
    }

    private func connect() async {
        isConnecting = true
        errorMessage = nil
        defer { isConnecting = false }
        do {
            let url = try await accountsStore.connect()
            openURL(url)
            dismiss()
        } catch {
            errorMessage = "Couldn't start connection. Please try again."
        }
    }
}
