import Foundation
import SwiftUI
import UserNotifications

/// Centralises writes to the iOS home-screen badge.
///
/// Count semantics: overdue + due today + this week (see
/// `TodaySections.badgeCount`). The actual value is pushed by
/// `MainContainer` whenever the live item set changes or the scene
/// becomes active.
///
/// TODO(push): While the app is backgrounded we can't re-compute the
/// badge — SwiftData observers are asleep and we have no background
/// refresh path. The count therefore goes stale until the user opens
/// the app or it becomes `.active`. Closing the loop requires an APNs
/// silent push that carries the new badge value in its payload. See
/// `docs/superpowers/specs/2026-04-24-today-count-badge-design.md`
/// ("Background staleness") — do this when real notifications ship.
@MainActor
@Observable
final class BadgeManager {
    static let shared = BadgeManager()

    private var didRequestAuthorization = false

    private init() {}

    /// Ask once for `.badge` authorization. Idempotent — subsequent calls
    /// are no-ops so we don't re-prompt on every sign-in. The prompt
    /// itself is fine to share with real notifications later; iOS merges
    /// authorization across option sets.
    func requestAuthorization() async {
        guard !didRequestAuthorization else { return }
        didRequestAuthorization = true
        do {
            _ = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.badge])
        } catch {
            // Best-effort; badge is cosmetic.
        }
    }

    /// Recompute the badge from the current item set and push it to
    /// iOS. Safe to call on every SwiftData change — the underlying
    /// `setBadgeCount` is cheap and idempotent.
    func refresh(items: [Item]) async {
        let count = TodaySections.badgeCount(items: items)
        try? await UNUserNotificationCenter.current().setBadgeCount(count)
    }

    /// Clear the badge — called on sign-out.
    func clear() async {
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
}
