import SwiftUI

/// Cerulean-tinted chat panel at the bottom of the detail view.
///
/// Binds to a `ChatStore` keyed by `itemId` (or `eventId` for calendar).
/// Sends kick off a streaming POST; `ChatStore` handles incremental updates
/// and the final persistence. This view is purely presentational aside from
/// input ownership.
struct BrettChatSection: View {
    @Bindable var store: ChatStore
    let itemId: String

    @State private var input: String = ""
    @State private var aiStore = AIProviderStore.shared
    @FocusState private var isFocused: Bool

    private var messages: [ChatMessage] {
        store.messages[itemId] ?? []
    }

    private var isStreaming: Bool {
        store.isStreaming[itemId] ?? false
    }

    private var errorMessage: String? {
        store.lastError[itemId]
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespaces).isEmpty && !isStreaming
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            if !messages.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(messages) { message in
                        bubble(for: message)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 11))
                    .foregroundStyle(BrettColors.error)
            }

            // Hide the input behind a gate until we know there's an AI
            // provider configured. `nil` means unchecked — we render the
            // input anyway so the user isn't blocked by a probe round-
            // trip; once the refresh lands we either keep the input or
            // swap in the configure-CTA.
            if aiStore.hasActiveProvider == false {
                notConfiguredGate
            } else {
                inputBar
            }
        }
        .glassCard(tint: BrettColors.cerulean)
        .task {
            // Refresh in the background; views react as `hasActiveProvider`
            // resolves. Kept simple: no polling, just one check per mount.
            await aiStore.refresh()
        }
    }

    /// Shown in place of the input bar when the user hasn't set up an AI
    /// provider yet. Short, friendly, points them at Settings.
    private var notConfiguredGate: some View {
        HStack(spacing: 10) {
            Image(systemName: "cpu")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrettColors.cerulean.opacity(0.70))

            VStack(alignment: .leading, spacing: 2) {
                Text("Add an AI provider to chat with Brett")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.85))
                Text("Settings → AI Providers")
                    .font(.system(size: 11))
                    .foregroundStyle(BrettColors.textMeta)
            }

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            Color.white.opacity(0.04),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(BrettColors.cerulean.opacity(0.25), lineWidth: 0.5)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            HStack(spacing: 4) {
                Circle()
                    .fill(BrettColors.gold)
                    .frame(width: 5, height: 5)
                RoundedRectangle(cornerRadius: 1)
                    .fill(BrettColors.cerulean.opacity(0.60))
                    .frame(width: 16, height: 2.5)
            }

            Text("BRETT")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.cerulean.opacity(0.60))

            Spacer()

            if isStreaming {
                HStack(spacing: 4) {
                    ProgressView()
                        .scaleEffect(0.5)
                        .tint(BrettColors.cerulean)
                    Text("thinking")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(BrettColors.cerulean.opacity(0.60))
                }
            }
        }
    }

    // MARK: - Bubbles

    @ViewBuilder
    private func bubble(for message: ChatMessage) -> some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 48)
                Text(message.content)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        BrettColors.gold.opacity(0.15),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                    )
            }
        default:
            // Brett / assistant / system — same styling for MVP.
            HStack(alignment: .top) {
                Group {
                    if message.content.isEmpty && message.isStreaming {
                        HStack(spacing: 4) {
                            ForEach(0..<3, id: \.self) { _ in
                                Circle()
                                    .fill(BrettColors.cerulean.opacity(0.50))
                                    .frame(width: 5, height: 5)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                    } else {
                        Text(markdown(for: message.content))
                            .font(.system(size: 13))
                            .foregroundStyle(Color.white.opacity(0.85))
                            .lineSpacing(3)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    BrettColors.cerulean.opacity(0.15),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                Spacer(minLength: 48)
            }
        }
    }

    private func markdown(for string: String) -> AttributedString {
        (try? AttributedString(markdown: string, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ??
        AttributedString(string)
    }

    // MARK: - Input

    private var inputBar: some View {
        HStack(spacing: 8) {
            // Placeholder via NeutralPlaceholder: iOS renders `prompt:`
            // Text in the system accent color, which on a Brett AI
            // surface would clash with the cerulean caret by mis-tinting
            // the hint. Neutral muted white keeps the hint readable.
            // Cerulean caret stays — this IS a Brett AI surface.
            NeutralPlaceholder(
                "Ask Brett about this task\u{2026}",
                isEmpty: input.isEmpty,
                alignment: .topLeading
            ) {
                TextField("", text: $input, axis: .vertical)
                    .focused($isFocused)
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
                    .tint(BrettColors.cerulean)
                    .lineLimit(1...4)
            }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(
                    Color.white.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(BrettColors.cardBorder, lineWidth: 0.5)
                }

            Button {
                send()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(
                        canSend ? BrettColors.gold : BrettColors.gold.opacity(0.35),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
    }

    private func send() {
        let pending = input
        input = ""
        Task {
            await store.send(itemId: itemId, message: pending)
        }
    }
}
