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

    @Test func feedbackHasNoAssociatedValue() {
        let dest = NavDestination.feedback
        if case .feedback = dest {} else { Issue.record("expected .feedback") }
    }

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
        #expect(NavDestination.feedback.isSheet == true)
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
        #expect(store.pendingPushDestination == nil)
    }

    @Test func goToPushDestinationSetsPendingPush() {
        let store = NavStore()
        store.go(to: .settingsTab(.calendar))
        #expect(store.pendingPushDestination == .settingsTab(.calendar))
        #expect(store.currentDestination == nil)
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
        store.pendingPushDestination = .settings
        store.lastCreatedItemId = "item-1"
        store.clearForSignOut()
        #expect(store.currentDestination == nil)
        #expect(store.pendingPushDestination == nil)
        #expect(store.lastCreatedItemId == nil)
    }
}
