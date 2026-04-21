import SwiftUI

/// Glass-cardded Markdown-capable notes editor.
///
/// Editing is always inline — tapping focuses the `TextEditor`. When the
/// user is *not* focused we render the text via `Text(markdown:)` so links,
/// bold, lists, etc. render nicely. Auto-save is debounced 800ms after the
/// last keystroke and also fires on blur.
///
/// The parent owns the source-of-truth string via `@Binding` on the draft,
/// so this editor is purely a UI adapter: no persistence, no network.
struct NotesEditor: View {
    @Binding var text: String

    /// Called when the editor decides it's time to persist — either after
    /// the debounce window has passed without new edits, or on blur. Called
    /// with the current value so the receiver can snapshot it.
    let onCommit: (String) -> Void

    @FocusState private var isFocused: Bool
    @State private var debounceTask: Task<Void, Never>?
    @State private var lastCommittedValue: String = ""

    /// How long to wait after the last keystroke before firing a save.
    /// 800ms balances snappy "feels saved" against unnecessary writes.
    private let debounceInterval: UInt64 = 800_000_000

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("NOTES")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Spacer()

                if isFocused {
                    Button("Done") {
                        isFocused = false
                        commit()
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BrettColors.gold)
                }
            }

            ZStack(alignment: .topLeading) {
                if text.isEmpty && !isFocused {
                    Text("Add notes\u{2026}")
                        .font(BrettTypography.body)
                        .foregroundStyle(BrettColors.textPlaceholder)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 4)
                        .allowsHitTesting(false)
                }

                if isFocused {
                    TextEditor(text: $text)
                        .font(BrettTypography.body)
                        .foregroundStyle(BrettColors.textBody)
                        .scrollContentBackground(.hidden)
                        .focused($isFocused)
                        .frame(minHeight: 100)
                        .tint(BrettColors.gold)
                        .onChange(of: text) { _, newValue in
                            scheduleSave(newValue)
                        }
                } else {
                    Text(markdownRendered)
                        .font(BrettTypography.body)
                        .foregroundStyle(BrettColors.textBody)
                        .lineSpacing(4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 4)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            isFocused = true
                        }
                }
            }
            .frame(minHeight: 100, alignment: .topLeading)
        }
        .glassCard()
        .onChange(of: isFocused) { _, focused in
            if !focused {
                // Blur → flush immediately so the next fetch sees the save.
                commit()
            }
        }
        .onAppear {
            lastCommittedValue = text
        }
        .onDisappear {
            // Cancel the pending debounce Task so we don't leak work after
            // the view is torn down. Commits on blur already happen above.
            debounceTask?.cancel()
            debounceTask = nil
        }
    }

    // MARK: - Markdown rendering

    /// Render the raw text as Markdown when possible. Falls back to plain
    /// text if the string can't be parsed (Markdown init never throws in
    /// practice, but we guard just in case).
    private var markdownRendered: AttributedString {
        if text.isEmpty { return AttributedString("") }
        if let parsed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return parsed
        }
        return AttributedString(text)
    }

    // MARK: - Debounced save

    private func scheduleSave(_ value: String) {
        debounceTask?.cancel()
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: debounceInterval)
            if Task.isCancelled { return }
            await MainActor.run { commit() }
        }
    }

    private func commit() {
        debounceTask?.cancel()
        debounceTask = nil
        if text == lastCommittedValue { return }
        lastCommittedValue = text
        onCommit(text)
    }
}
