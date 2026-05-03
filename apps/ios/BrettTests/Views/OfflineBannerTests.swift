import Testing
import Foundation
import SwiftData
@testable import Brett

/// Covers the two pieces of logic inside the offline-banner stack that can be
/// reasoned about without SwiftUI's view tree:
///  1. `NetworkMonitor.isOnline` toggles cleanly under offline/online paths —
///     this is the signal the banner's visibility is bound to.
///  2. `OfflineBannerModifier.fetchPendingCount` returns the live count of
///     pending mutations so the banner can surface the backlog.
///
/// Anything SwiftUI-specific (the actual rendering, animation) is verified
/// manually via Preview; the meaningful logic is here.
@Suite("OfflineBanner", .tags(.views))
struct OfflineBannerTests {
    // MARK: - Visibility signal: network state

    @MainActor
    @Test func bannerHiddenWhenOnline() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))

        // Banner visibility is `!isOnline` — so online → banner hidden.
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
        let count = OfflineBannerModifier.fetchPendingCount(from: context)
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

        let count = OfflineBannerModifier.fetchPendingCount(from: context)
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

        let count = OfflineBannerModifier.fetchPendingCount(from: context)
        #expect(count == 2)
    }

    // MARK: - Headline copy

    @Test func headlineWithNoPendingIsHumanFriendly() {
        // Issue #119: regression guard for "Offline — N changes waiting to
        // sync" wording. The new copy avoids the technical "sync" /
        // "waiting" framing in the headline.
        #expect(OfflineBanner.headline(pendingCount: 0) == "You're offline")
        #expect(OfflineBanner.headline(pendingCount: -1) == "You're offline")
    }

    @Test func headlineWithSinglePendingUsesSingularUnit() {
        #expect(OfflineBanner.headline(pendingCount: 1) == "You're offline — 1 change saved")
    }

    @Test func headlineWithMultiplePendingPluralizes() {
        #expect(OfflineBanner.headline(pendingCount: 3) == "You're offline — 3 changes saved")
        #expect(OfflineBanner.headline(pendingCount: 12) == "You're offline — 12 changes saved")
    }

    @Test func headlineHasNoTechnicalJargon() {
        // Regression for #119: no leakage of "mutation", "queue", or
        // "pending" into user-visible headline copy.
        let samples = [0, 1, 2, 7, 100].map { OfflineBanner.headline(pendingCount: $0) }
        for s in samples {
            #expect(!s.lowercased().contains("mutation"))
            #expect(!s.lowercased().contains("queue"))
            #expect(!s.lowercased().contains("pending"))
            #expect(!s.lowercased().contains("waiting to sync"))
        }
    }

    // MARK: - Detail copy

    @Test func detailWithNoPendingShowsReassurance() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let result = OfflineBanner.detail(pendingCount: 0, lastSyncedAt: nil, now: now)
        #expect(result.contains("We'll sync when you're back online."))
        #expect(result.contains("No previous update yet."))
    }

    @Test func detailWithSinglePendingPluralizesCorrectly() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let result = OfflineBanner.detail(pendingCount: 1, lastSyncedAt: nil, now: now)
        #expect(result.contains("1 change saved on this device."))
    }

    @Test func detailWithMultiplePendingPluralizesCorrectly() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let result = OfflineBanner.detail(pendingCount: 4, lastSyncedAt: nil, now: now)
        #expect(result.contains("4 changes saved on this device."))
    }

    @Test func detailLastUpdateUsesMomentsAgoForRecent() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let recent = now.addingTimeInterval(-30) // 30s ago → < 1 min
        let result = OfflineBanner.detail(pendingCount: 0, lastSyncedAt: recent, now: now)
        #expect(result.contains("Last update: moments ago."))
    }

    @Test func detailLastUpdateUsesSingularMinute() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let oneMin = now.addingTimeInterval(-60)
        let result = OfflineBanner.detail(pendingCount: 0, lastSyncedAt: oneMin, now: now)
        #expect(result.contains("Last update: 1 minute ago."))
    }

    @Test func detailLastUpdatePluralizesMinutes() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let fiveMin = now.addingTimeInterval(-5 * 60)
        let result = OfflineBanner.detail(pendingCount: 0, lastSyncedAt: fiveMin, now: now)
        #expect(result.contains("Last update: 5 minutes ago."))
    }

    @Test func detailHandlesClockSkew() {
        // Defensive: if the device clock jumps backward (NTP correction,
        // user editing the system clock), `lastSyncedAt > now`. Should not
        // crash or render a negative-minutes string.
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let future = now.addingTimeInterval(300)
        let result = OfflineBanner.detail(pendingCount: 0, lastSyncedAt: future, now: now)
        #expect(result.contains("Last update: moments ago."))
        #expect(!result.contains("-"))
    }

    // MARK: - Accessibility copy

    @Test func accessibilityLabelMatchesHeadline() {
        #expect(OfflineBanner.accessibility(pendingCount: 0) == "You're offline.")
        #expect(OfflineBanner.accessibility(pendingCount: 1) == "You're offline. 1 change saved on this device.")
        #expect(OfflineBanner.accessibility(pendingCount: 7) == "You're offline. 7 changes saved on this device.")
    }
}
