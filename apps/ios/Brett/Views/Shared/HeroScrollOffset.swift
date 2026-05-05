import Observation
import SwiftUI

/// Shared scroll offset published by `TodayPage` so the calm-hero
/// adaptive chrome can fade in the bottom view-pills row + omnibar
/// background as the user scrolls past the hero zone.
///
/// Why a shared `@Observable` instead of a `PreferenceKey`: preference
/// keys flow up through the view tree, but TabView keeps every page
/// mounted simultaneously and SwiftUI doesn't reliably propagate
/// preferences from non-foreground TabView pages to a `.onPreferenceChange`
/// on the TabView's parent. Direct mutation through a shared
/// `@Observable` sidesteps that — TodayPage writes the offset, any
/// view that reads `HeroScrollState.shared.offset` re-renders, and
/// other TabView pages don't need to participate.
@MainActor
@Observable
final class HeroScrollState {
    static let shared = HeroScrollState()

    /// Latest scroll offset of the Today hero in points. 0 when at
    /// the top of the hero, grows as the user scrolls down. Bounded
    /// at 0 from below — negative scrolls (rubber-band overscroll
    /// past the top) don't drive the chrome past invisible.
    private(set) var offset: CGFloat = 0

    private init() {}

    func publish(_ value: CGFloat) {
        let clamped = max(0, value)
        if abs(clamped - offset) > 0.5 {
            offset = clamped
        }
    }
}
