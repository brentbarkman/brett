import SwiftUI

/// The Daily Briefing card on the Today page.
///
/// Cerulean-tinted StickyCardSection — Brett AI signature colour. The body
/// is full Markdown: headings, ordered + unordered lists, **bold**, _italic_,
/// `code`, and [links](url) all render via `MarkdownRenderer`. Links open
/// in-app in `SafariView` so the user never loses their place.
struct DailyBriefing: View {
    @Bindable var store: BriefingStore
    @State private var externalURL: IdentifiedURL?

    @ViewBuilder
    var body: some View {
        if !store.isDismissedToday {
            StickyCardSection(tint: BrettColors.cerulean) {
                // Icon dropped — Electron's daily briefing doesn't have
                // one in the header, just the label. The cerulean rim on
                // the card (added when `tint` is set on
                // StickyCardSection) carries the "Brett AI surface"
                // signal instead of an icon.
                HStack(spacing: 6) {
                    Text("DAILY BRIEFING")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(Color.white.opacity(0.60))

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

                    // Dismiss-for-today: drops the briefing card from
                    // Today until tomorrow morning. Backed by
                    // `BriefingStore.isDismissedToday` (UserDefaults
                    // keyed on yyyy-MM-dd). Replaces the old chevron
                    // collapse button — the page-level scroll-collapse
                    // already gives users a way to reduce the card's
                    // footprint, and a separate "hide it" affordance
                    // matches the desktop's behaviour.
                    Button {
                        HapticManager.light()
                        withAnimation(.easeOut(duration: 0.25)) {
                            store.dismiss()
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.40))
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss briefing for today")
                }
            } content: {
                bodyContent
                    .padding(16)
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
