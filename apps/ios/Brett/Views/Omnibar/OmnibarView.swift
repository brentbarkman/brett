import SwiftUI

struct OmnibarView: View {
    @Bindable var store: MockStore
    let placeholder: String
    @State private var text = ""
    @State private var isEditing = false
    @State private var showListDrawer = false
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Omnibar pill
            HStack(spacing: 12) {
                // List drawer button
                Button {
                    showListDrawer = true
                } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.4))
                }
                .buttonStyle(.plain)
                .frame(width: 28, height: 28)

                // Text field
                TextField(placeholder, text: $text)
                    .font(BrettTypography.omnibarPlaceholder)
                    .foregroundStyle(BrettColors.textPrimary)
                    .tint(BrettColors.gold)
                    .focused($isFocused)
                    .submitLabel(.done)
                    .onSubmit {
                        submitTask()
                    }

                // Mic button
                Button {
                    HapticManager.heavy()
                    // Voice mode — placeholder for now
                } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(BrettColors.gold.opacity(0.8))
                }
                .buttonStyle(.plain)
                .frame(width: 28, height: 28)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background {
                Capsule()
                    .fill(.regularMaterial)
                    .overlay {
                        Capsule()
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                    }
                    .overlay(alignment: .leading) {
                        // Subtle gold accent on left edge
                        Capsule()
                            .fill(BrettColors.gold.opacity(0.3))
                            .frame(width: 3)
                            .padding(.leading, 1)
                            .padding(.vertical, 6)
                    }
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
