import Testing
import Foundation
@testable import Brett

/// Tests for the unified `NavDestination` enum that drives both
/// `.sheet(item:)` and `.navigationDestination(for:)`. Verifies new
/// cases exist + their associated values are accessible.
@Suite("NavDestination", .tags(.smoke))
struct NavDestinationTests {
    @Test func taskDetailCarriesItemId() {
        let dest = NavDestination.taskDetail(id: "item-1")
        if case .taskDetail(let id) = dest {
            #expect(id == "item-1")
        } else {
            Issue.record("expected .taskDetail")
        }
    }

    @Test func searchHasNoAssociatedValue() {
        let dest = NavDestination.search
        if case .search = dest {} else { Issue.record("expected .search") }
    }

    // Feedback is intentionally NOT a NavDestination case — `FeedbackPresenter`
    // shows the feedback sheet at the UIWindow level so it works above any
    // other modal. See `apps/ios/Brett/Views/Shared/FeedbackPresenter.swift`.

    @Test func newScoutHasNoAssociatedValue() {
        let dest = NavDestination.newScout
        if case .newScout = dest {} else { Issue.record("expected .newScout") }
    }

    @Test func editScoutCarriesScoutId() {
        let dest = NavDestination.editScout(id: "scout-1")
        if case .editScout(let id) = dest {
            #expect(id == "scout-1")
        } else {
            Issue.record("expected .editScout")
        }
    }

    @Test func settingsTabCarriesTab() {
        let dest = NavDestination.settingsTab(.calendar)
        if case .settingsTab(let tab) = dest {
            #expect(tab == .calendar)
        } else {
            Issue.record("expected .settingsTab")
        }
    }

    @Test func equalityWorksForCasesWithAssociatedValues() {
        #expect(NavDestination.taskDetail(id: "x") == NavDestination.taskDetail(id: "x"))
        #expect(NavDestination.taskDetail(id: "x") != NavDestination.taskDetail(id: "y"))
    }

    @Test func isSheetSplitsCasesCorrectly() {
        // Sheet-style destinations.
        #expect(NavDestination.taskDetail(id: "x").isSheet == true)
        #expect(NavDestination.search.isSheet == true)
        #expect(NavDestination.newScout.isSheet == true)
        #expect(NavDestination.editScout(id: "x").isSheet == true)

        // Push-style destinations.
        #expect(NavDestination.settings.isSheet == false)
        #expect(NavDestination.settingsTab(.calendar).isSheet == false)
        #expect(NavDestination.scoutsRoster.isSheet == false)
        #expect(NavDestination.scoutDetail(id: "x").isSheet == false)
        #expect(NavDestination.eventDetail(id: "x").isSheet == false)
        #expect(NavDestination.listView(id: "x").isSheet == false)
    }
}

@Suite("Settings deep-link", .tags(.smoke))
struct SettingsDeepLinkTests {
    /// Wave D's central bug fix: settings deep-links push ONE thing
    /// (`NavDestination.settingsTab(...)`) onto the stack, not two
    /// (`NavDestination.settings` then `SettingsTab`). The
    /// destination's `isSheet` is false — it's a push.
    @Test func settingsTabDestinationIsPush() {
        let dest = NavDestination.settingsTab(.calendar)
        #expect(dest.isSheet == false)
    }

    @Test func settingsTabHashableAndEquatable() {
        let a = NavDestination.settingsTab(.calendar)
        let b = NavDestination.settingsTab(.calendar)
        let c = NavDestination.settingsTab(.aiProviders)
        #expect(a == b)
        #expect(a != c)
        #expect(a.hashValue == b.hashValue)
    }
}

@Suite("NavStore routing", .tags(.smoke))
@MainActor
struct NavStoreRoutingTests {
    @Test func goToSheetDestinationSetsCurrentDestination() {
        let store = NavStore()
        store.go(to: .search)
        #expect(store.currentDestination == .search)
        #expect(store.pendingPushDestinations.isEmpty)
    }

    @Test func goToPushDestinationSetsPendingPush() {
        let store = NavStore()
        store.go(to: .settingsTab(.calendar))
        #expect(store.pendingPushDestinations == [.settingsTab(.calendar)])
        #expect(store.currentDestination == nil)
    }

    @Test func multiplePushesAreQueued() {
        let store = NavStore()
        store.go(to: .settings)
        store.go(to: .settingsTab(.calendar))
        #expect(store.pendingPushDestinations == [.settings, .settingsTab(.calendar)])
    }

    @Test func dismissClearsCurrentDestination() {
        let store = NavStore()
        store.currentDestination = .search
        store.dismiss()
        #expect(store.currentDestination == nil)
    }

    @Test func clearForSignOutClearsEverything() {
        let store = NavStore()
        store.currentDestination = .search
        store.pendingPushDestinations = [.settings]
        store.lastCreatedItemId = "item-1"
        store.clearForSignOut()
        #expect(store.currentDestination == nil)
        #expect(store.pendingPushDestinations.isEmpty)
        #expect(store.lastCreatedItemId == nil)
    }

    /// Regression guard for the C3 drain-by-length fix
    /// (commit 0e44dee). `MainContainer` drains the push queue by snapshot
    /// length so any push that lands DURING the drain (e.g. a destination
    /// view's `.task` calling `go(to:)` synchronously) survives. The
    /// previous wipe-after-drain implementation lost that mid-drain push.
    ///
    /// This test exercises the drain-by-length pattern directly: snapshot
    /// the queue, simulate a write during drain, then `removeFirst(count)`
    /// — anything appended in the gap MUST remain.
    @Test func pushQueueDrainByLengthPreservesAppendsDuringDrain() {
        let store = NavStore()
        store.go(to: .settings)
        store.go(to: .scoutsRoster)

        // Snapshot the queue (this is what MainContainer feeds into its
        // .onChange handler).
        let snapshot = store.pendingPushDestinations
        let drained = snapshot.count

        // Simulate a destination's `.task` firing another go(to:) WHILE
        // the drain is in flight. With the fix, this lands at index 2.
        store.go(to: .scoutDetail(id: "sneaky"))

        // Drain by length, NOT by wipe.
        if store.pendingPushDestinations.count >= drained {
            store.pendingPushDestinations.removeFirst(drained)
        } else {
            store.pendingPushDestinations = []
        }

        // The during-drain push must survive — this is the bug the fix
        // closes. A wipe (`pendingPushDestinations = []`) would zero this.
        #expect(store.pendingPushDestinations == [.scoutDetail(id: "sneaky")])
    }
}
