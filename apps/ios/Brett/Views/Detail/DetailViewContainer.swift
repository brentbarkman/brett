import SwiftUI

/// Shared wireframe for detail views. Captures the scroll setup and
/// safe-area padding so `TaskDetailView` and `EventDetailView` (and
/// future detail views) don't duplicate it.
///
/// Intentionally minimal. Doesn't try to share the toolbar, navigation
/// title, or section components (header, notes editor, attachments) —
/// those have task-vs-event-specific semantics that resist a shared
/// abstraction. Just the outermost wireframe:
///
/// - `ScrollView` with hidden indicators and interactive keyboard
///   dismissal.
/// - Horizontal padding of 16 and top padding of 8 to match the
///   established detail-view rhythm.
/// - Bottom padding is parameterised because tasks (~40pt) and events
///   (~120pt to clear the tab bar) leave different amounts of breathing
///   room. Callers may also pass `.zero` and apply their own padding.
///
/// Background, navigation title, toolbar items, and `.task` modifiers
/// stay at the call site — they're either platform-specific (background
/// is supplied upstream) or content-specific (titles differ per detail
/// type).
struct DetailViewContainer<Content: View>: View {
    var bottomPadding: CGFloat
    @ViewBuilder let content: () -> Content

    init(bottomPadding: CGFloat = 40, @ViewBuilder content: @escaping () -> Content) {
        self.bottomPadding = bottomPadding
        self.content = content
    }

    var body: some View {
        ScrollView {
            content()
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, bottomPadding)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }
}
