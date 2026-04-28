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
