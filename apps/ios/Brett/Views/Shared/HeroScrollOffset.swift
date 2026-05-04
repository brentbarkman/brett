import SwiftUI

/// Scroll offset published by `TodayPage` so the calm-hero adaptive
/// chrome can fade in the bottom view-pills row as the user scrolls
/// past the hero zone.
///
/// Why a `PreferenceKey` rather than a shared store: the offset is a
/// pure layout value. SwiftUI's preference system is the canonical
/// channel for child-to-parent layout reads — no `@Observable` lifetime
/// dance, no MainActor reentrancy concerns, and the value naturally
/// flows up the view tree to whichever ancestor reads it.
///
/// Reduce strategy: last-writer-wins. There is exactly one writer
/// (the probe at the top of `TodayPage`'s scroll content) by design;
/// if a future refactor produces multiple writers (e.g. a nested
/// ScrollView), each layout pass should publish the *current* offset,
/// not a stale maximum. A `max` reduce would latch the bar at the
/// deepest scroll ever observed, which is wrong for a hero that can
/// scroll back up.
struct HeroScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

extension View {
    /// Publish a scroll offset (in points) for `MainContainer` to read.
    /// Use at the top of the scroll content; values are layout-pass
    /// granular so SwiftUI batches updates with the rest of the
    /// transaction.
    func publishHeroScrollOffset(_ offset: CGFloat) -> some View {
        preference(key: HeroScrollOffsetKey.self, value: offset)
    }
}
