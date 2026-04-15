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

            inputBar
        }
        .glassCard(tint: BrettColors.cerulean)
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
            TextField("Ask Brett about this task\u{2026}", text: $input, axis: .vertical)
                .focused($isFocused)
                .font(.system(size: 13))
                .foregroundStyle(.white)
                .tint(BrettColors.cerulean)
                .lineLimit(1...4)
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
