import SwiftUI

struct OmnibarView: View {
    @Bindable var store: MockStore
    let placeholder: String
    @State private var text = ""
    @State private var showListDrawer = false
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                // List drawer button
                Button {
                    showListDrawer = true
                } label: {
                    Image(systemName: "square.stack.3d.up")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.40))
                }
                .buttonStyle(.plain)
                .frame(width: 32, height: 32)

                // Divider
                Rectangle()
                    .fill(Color.white.opacity(0.10))
                    .frame(width: 1, height: 20)

                // Text field
                HStack(spacing: 8) {
                    // Subtle sparkle icon — AI hint
                    Image(systemName: "sparkle")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [BrettColors.gold.opacity(0.5), BrettColors.cerulean.opacity(0.4)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )

                    TextField(placeholder, text: $text)
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(BrettColors.textPrimary)
                        .tint(BrettColors.gold)
                        .focused($isFocused)
                        .submitLabel(.done)
                        .onSubmit {
                            submitTask()
                        }
                }

                // Mic button with ambient glow
                Button {
                    HapticManager.heavy()
                } label: {
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [BrettColors.gold.opacity(0.15), BrettColors.gold.opacity(0.05)],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                            .frame(width: 32, height: 32)

                        Image(systemName: "waveform")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(BrettColors.gold)
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background {
                Capsule()
                    .fill(.ultraThinMaterial)
                    .overlay {
                        Capsule()
                            .strokeBorder(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.10),
                                        Color.white.opacity(0.05),
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ),
                                lineWidth: 0.5
                            )
                    }
                    .shadow(color: .black.opacity(0.3), radius: 20, y: 5)
            }
            .padding(.horizontal, 16)
        }
        .sheet(isPresented: $showListDrawer) {
            ListDrawer(store: store)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
        }
    }

    private func submitTask() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        HapticManager.light()
        store.addItem(title: trimmed, dueDate: Date())
        text = ""
        isFocused = false
    }
}
