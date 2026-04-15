import SwiftUI

struct OmnibarView: View {
    @Bindable var store: MockStore
    let placeholder: String
    @State private var text = ""
    @State private var showListDrawer = false
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Button {
                showListDrawer = true
            } label: {
                Image(systemName: "list.bullet")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.40))
                    .frame(width: 28, height: 28)
            }

            TextField(placeholder, text: $text)
                .font(.system(size: 15))
                .foregroundStyle(.white)
                .tint(BrettColors.gold)
                .focused($isFocused)
                .submitLabel(.done)
                .onSubmit { submitTask() }
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") { isFocused = false }
                            .foregroundStyle(BrettColors.gold)
                    }
                }

            if !text.trimmingCharacters(in: .whitespaces).isEmpty {
                Button { submitTask() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(BrettColors.gold, in: Circle())
                }
                .transition(.scale(scale: 0.5).combined(with: .opacity))
            } else {
                Button { HapticManager.heavy() } label: {
                    Image(systemName: "waveform")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.25))
                        .frame(width: 26, height: 26)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color.white.opacity(0.04))
                        .frame(height: 0.5)
                }
                .ignoresSafeArea(edges: .bottom)
        }
        .animation(.easeOut(duration: 0.15), value: text.isEmpty)
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
