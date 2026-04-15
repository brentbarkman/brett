import SwiftUI

/// The Daily Briefing card on the Today page.
///
/// Cerulean-tinted StickyCardSection — Brett AI signature colour. Markdown in
/// the briefing body (**bold**, _italic_, `code`, [links](url)) is rendered
/// via SwiftUI's `AttributedString(markdown:)` so asterisks and link syntax
/// never leak through to the user.
struct DailyBriefing: View {
    @Bindable var store: BriefingStore
    @State private var isCollapsed: Bool = false

    @ViewBuilder
    var body: some View {
        if !store.isDismissedToday {
            StickyCardSection(tint: BrettColors.cerulean) {
                HStack(spacing: 6) {
                    Image(systemName: "text.quote")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BrettColors.cerulean.opacity(0.80))

                    Text("DAILY BRIEFING")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(BrettColors.cerulean.opacity(0.80))

                    Spacer()

                    if store.isGenerating {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(BrettColors.cerulean.opacity(0.80))
                            .padding(.trailing, 8)
                    }

                    Button {
                        HapticManager.light()
                        Task { await store.regenerate() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.30))
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isGenerating)

                    Button {
                        HapticManager.light()
                        withAnimation(.easeOut(duration: 0.25)) {
                            isCollapsed.toggle()
                        }
                    } label: {
                        Image(systemName: isCollapsed ? "chevron.down" : "chevron.up")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.30))
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            } content: {
                if !isCollapsed {
                    bodyContent
                        .padding(16)
                }
            }
        }
    }

    @ViewBuilder
    private var bodyContent: some View {
        if let briefing = store.briefing, !briefing.isEmpty {
            Text(markdownAttributed(briefing))
                .font(BrettTypography.body)
                .foregroundStyle(BrettColors.textBody)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .gesture(swipeDismiss)
                .accessibilityAction(named: Text("Dismiss")) {
                    store.dismiss()
                }
        } else if store.isGenerating {
            Text("Brett is putting your briefing together…")
                .font(BrettTypography.body)
                .foregroundStyle(BrettColors.textMeta)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if let error = store.lastError {
            Text(error)
                .font(BrettTypography.body)
                .foregroundStyle(BrettColors.error.opacity(0.80))
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text("No briefing yet — tap the refresh icon to generate one.")
                .font(BrettTypography.body)
                .foregroundStyle(BrettColors.textMeta)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Swipe-right to dismiss — matches the iOS "peek and flick" pattern the
    /// rest of the app uses on Inbox rows.
    private var swipeDismiss: some Gesture {
        DragGesture(minimumDistance: 30)
            .onEnded { value in
                if value.translation.width > 60 && abs(value.translation.height) < 40 {
                    HapticManager.success()
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                        store.dismiss()
                    }
                }
            }
    }

    /// Parse the server's Markdown into an `AttributedString`. Falling back
    /// to the raw string keeps the card usable even when the server returns
    /// unexpected formatting.
    private func markdownAttributed(_ source: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        if let parsed = try? AttributedString(markdown: source, options: options) {
            return parsed
        }
        return AttributedString(source)
    }
}
