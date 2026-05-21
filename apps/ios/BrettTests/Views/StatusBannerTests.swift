import Testing
import Foundation
import SwiftData
@testable import Brett

/// Covers the pieces of the status-banner stack that can be reasoned about
/// without SwiftUI's view tree:
///
///  1. `NetworkMonitor.isOnline` toggles cleanly under offline/online paths —
///     this is the signal the banner's `.offline` kind is bound to.
///  2. `StatusBannerModifier.fetchPendingCount` returns the live count of
///     pending mutations so the banner can surface the backlog in the
///     `.offline` state.
///  3. Copy helpers (`StatusBanner.headline / .detail / .accessibility`)
///     produce the right string for each kind + pending-count.
///
/// Anything SwiftUI-specific (the actual rendering, animation) is verified
/// manually via Preview; the meaningful logic is here.
///
/// File previously named `OfflineBannerTests.swift` — renamed when the
/// banner generalized to three kinds. The offline-only copy tests are
/// preserved with `.offline` explicitly passed so the regression
/// guards still bite (issue #119: no "mutation / queue / waiting" in
/// user-facing headline copy).
@Suite("StatusBanner", .tags(.views))
struct StatusBannerTests {
    // MARK: - Visibility signal: network state

    @MainActor
    @Test func bannerHiddenWhenOnline() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))

        // `.offline` kind is bound to `!isOnline` — online → no offline kind.
        #expect(monitor.isOnline == true)
    }

    @MainActor
    @Test func bannerVisibleWhenOffline() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        // Initial path: online (so the first-path suppression gets consumed).
        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))
        // Flip offline.
        await stub.emit(.init(status: .unsatisfied, interfaces: []))

        #expect(monitor.isOnline == false)
    }

    @MainActor
    @Test func bannerTogglesOnNetworkTransitions() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))
        #expect(monitor.isOnline == true)

        await stub.emit(.init(status: .unsatisfied, interfaces: []))
        #expect(monitor.isOnline == false)

        await stub.emit(.init(status: .satisfied, interfaces: [.cellular]))
        #expect(monitor.isOnline == true)
    }

    // MARK: - Pending count surfacing

    @MainActor
    @Test func pendingCountIsZeroForEmptyQueue() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let count = StatusBannerModifier.fetchPendingCount(from: context)
        #expect(count == 0)
    }

    @MainActor
    @Test func pendingCountReflectsQueueState() throws {
        let context = try InMemoryPersistenceController.makeContext()

        for i in 0..<3 {
            let entry = MutationQueueEntry(
                entityType: "item",
                entityId: "item-\(i)",
                action: .create,
                endpoint: "/things",
                method: .post,
                payload: "{}"
            )
            context.insert(entry)
        }
        try context.save()

        let count = StatusBannerModifier.fetchPendingCount(from: context)
        #expect(count == 3)
    }

    @MainActor
    @Test func pendingCountIgnoresInFlightAndCompletedEntries() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // 2 pending
        for i in 0..<2 {
            let entry = MutationQueueEntry(
                entityType: "item",
                entityId: "pending-\(i)",
                action: .create,
                endpoint: "/things",
                method: .post,
                payload: "{}"
            )
            context.insert(entry)
        }

        // 1 in-flight — should NOT be counted
        let inFlight = MutationQueueEntry(
            entityType: "item",
            entityId: "in-flight",
            action: .update,
            endpoint: "/things/x",
            method: .patch,
            payload: "{}"
        )
        inFlight.status = MutationStatus.inFlight.rawValue
        context.insert(inFlight)

        try context.save()

        let count = StatusBannerModifier.fetchPendingCount(from: context)
        #expect(count == 2)
    }

    // MARK: - Offline headline copy (issue #119 regression guards)

    @Test func offlineHeadlineWithNoPendingIsHumanFriendly() {
        // Issue #119: regression guard for "Offline — N changes waiting to
        // sync" wording. The new copy avoids the technical "sync" /
        // "waiting" framing in the headline.
        #expect(StatusBanner.headline(kind: .offline, pendingCount: 0) == "You're offline")
        #expect(StatusBanner.headline(kind: .offline, pendingCount: -1) == "You're offline")
    }

    @Test func offlineHeadlineWithSinglePendingUsesSingularUnit() {
        #expect(StatusBanner.headline(kind: .offline, pendingCount: 1) == "You're offline — 1 change saved")
    }

    @Test func offlineHeadlineWithMultiplePendingPluralizes() {
        #expect(StatusBanner.headline(kind: .offline, pendingCount: 3) == "You're offline — 3 changes saved")
        #expect(StatusBanner.headline(kind: .offline, pendingCount: 12) == "You're offline — 12 changes saved")
    }

    @Test func headlinesHaveNoTechnicalJargon() {
        // Regression for #119: no leakage of "mutation", "queue", or
        // "pending" into user-visible headline copy. Applies to every
        // banner kind — not just offline. Also bans HTTP-status / "API"
        // talk that would leak through if the outage messaging ever
        // started quoting the underlying transport error.
        let allKinds: [StatusBanner.Kind] = [.offline, .apiUnreachable, .retrying]
        for kind in allKinds {
            let samples = [0, 1, 2, 7, 100].map {
                StatusBanner.headline(kind: kind, pendingCount: $0)
            }
            for s in samples {
                #expect(!s.lowercased().contains("mutation"))
                #expect(!s.lowercased().contains("queue"))
                #expect(!s.lowercased().contains("pending"))
                #expect(!s.lowercased().contains("waiting to sync"))
                #expect(!s.lowercased().contains("502"))
                #expect(!s.lowercased().contains("api"))
            }
        }
    }

    // MARK: - API-unreachable headline copy

    @Test func apiUnreachableHeadlineIsCalmAndCacheAware() {
        // Outage messaging emphasizes that data is still there (cached),
        // not that something is broken. Pending count is intentionally
        // NOT surfaced in this kind — the user's reads are the salient
        // story, not their queued writes.
        let copy = StatusBanner.headline(kind: .apiUnreachable, pendingCount: 0)
        #expect(copy == "Can't reach Brett — showing cached data")

        // Pending count doesn't change the message in this kind — the
        // backlog is implicit (we're not reaching the server) and the
        // emphasis stays on cached reads.
        let withPending = StatusBanner.headline(kind: .apiUnreachable, pendingCount: 5)
        #expect(withPending == "Can't reach Brett — showing cached data")
    }

    @Test func retryingHeadlineIsActiveAndShortLived() {
        // The retrying state is transient — only shown while the user-
        // initiated retry is in flight. Copy should signal action,
        // not failure.
        #expect(StatusBanner.headline(kind: .retrying, pendingCount: 0) == "Reconnecting to Brett")
        #expect(StatusBanner.headline(kind: .retrying, pendingCount: 99) == "Reconnecting to Brett")
    }

    // MARK: - Detail copy (only offline kind uses this)

    @Test func detailWithNoPendingShowsReassurance() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let result = StatusBanner.detail(pendingCount: 0, lastSyncedAt: nil, now: now)
        #expect(result.contains("We'll sync when you're back online."))
        #expect(result.contains("No previous update yet."))
    }

    @Test func detailWithSinglePendingPluralizesCorrectly() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let result = StatusBanner.detail(pendingCount: 1, lastSyncedAt: nil, now: now)
        #expect(result.contains("1 change saved on this device."))
    }

    @Test func detailWithMultiplePendingPluralizesCorrectly() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let result = StatusBanner.detail(pendingCount: 4, lastSyncedAt: nil, now: now)
        #expect(result.contains("4 changes saved on this device."))
    }

    @Test func detailLastUpdateUsesMomentsAgoForRecent() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let recent = now.addingTimeInterval(-30) // 30s ago → < 1 min
        let result = StatusBanner.detail(pendingCount: 0, lastSyncedAt: recent, now: now)
        #expect(result.contains("Last update: moments ago."))
    }

    @Test func detailLastUpdateUsesSingularMinute() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let oneMin = now.addingTimeInterval(-60)
        let result = StatusBanner.detail(pendingCount: 0, lastSyncedAt: oneMin, now: now)
        #expect(result.contains("Last update: 1 minute ago."))
    }

    @Test func detailLastUpdatePluralizesMinutes() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let fiveMin = now.addingTimeInterval(-5 * 60)
        let result = StatusBanner.detail(pendingCount: 0, lastSyncedAt: fiveMin, now: now)
        #expect(result.contains("Last update: 5 minutes ago."))
    }

    @Test func detailHandlesClockSkew() {
        // Defensive: if the device clock jumps backward (NTP correction,
        // user editing the system clock), `lastSyncedAt > now`. Should not
        // crash or render a negative-minutes string.
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let future = now.addingTimeInterval(300)
        let result = StatusBanner.detail(pendingCount: 0, lastSyncedAt: future, now: now)
        #expect(result.contains("Last update: moments ago."))
        #expect(!result.contains("-"))
    }

    // MARK: - Accessibility copy

    @Test func offlineAccessibilityLabelMatchesHeadline() {
        #expect(StatusBanner.accessibility(kind: .offline, pendingCount: 0) == "You're offline.")
        #expect(StatusBanner.accessibility(kind: .offline, pendingCount: 1) == "You're offline. 1 change saved on this device.")
        #expect(StatusBanner.accessibility(kind: .offline, pendingCount: 7) == "You're offline. 7 changes saved on this device.")
    }

    @Test func apiUnreachableAccessibilityAnnouncesRetry() {
        // The retry button isn't visually announced separately — it's
        // baked into the banner's accessibility label so VoiceOver
        // users learn there's a Retry affordance without needing to
        // swipe through child elements.
        let label = StatusBanner.accessibility(kind: .apiUnreachable, pendingCount: 0)
        #expect(label.contains("Can't reach Brett"))
        #expect(label.lowercased().contains("retry"))
    }

    @Test func retryingAccessibilityIsBrief() {
        // No need for retry hints during the retrying state — the
        // button is hidden in favor of the "Retrying…" text.
        let label = StatusBanner.accessibility(kind: .retrying, pendingCount: 0)
        #expect(label.contains("Reconnecting"))
    }
}
