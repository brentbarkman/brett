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

    private init() {}

    /// Ask for `.badge` authorization if the user hasn't made a choice
    /// yet. Consults the system's `authorizationStatus` rather than a
    /// local flag so we skip the prompt correctly across app launches
    /// and correctly re-no-op if the user later grants or denies badge
    /// permissions in Settings. Best-effort: any error is swallowed
    /// because the badge is cosmetic.
    func requestAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.badge])
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
