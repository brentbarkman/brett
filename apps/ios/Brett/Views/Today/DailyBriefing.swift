import SwiftUI

/// The Daily Briefing card on the Today page.
///
/// Cerulean-tinted StickyCardSection — Brett AI signature colour. The body
/// is full Markdown: headings, ordered + unordered lists, **bold**, _italic_,
/// `code`, and [links](url) all render via `MarkdownRenderer`. Links open
/// in-app in `SafariView` so the user never loses their place.
struct DailyBriefing: View {
    @Bindable var store: BriefingStore
    @State private var isCollapsed: Bool = false
    @State private var externalURL: IdentifiedURL?

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
            .sheet(item: $externalURL) { identified in
                SafariView(url: identified.url)
                    .ignoresSafeArea()
            }
        }
    }

    @ViewBuilder
    private var bodyContent: some View {
        if let briefing = store.briefing, !briefing.isEmpty {
            MarkdownRenderer(source: briefing, style: .briefing) { url in
                HapticManager.light()
                externalURL = IdentifiedURL(url: url)
            }
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

}
