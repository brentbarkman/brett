import Testing
import Foundation
import SwiftUI
@testable import Brett

/// Pure-logic tests for `ScoutCard`. We don't render the view — we exercise
/// its static helpers and validate the presentation data flow through
/// `StatusDot` and `ScoutAvatar` via code inspection.
@Suite("ScoutCard", .tags(.views))
@MainActor
struct ScoutCardTests {

    // MARK: - Budget fraction

    @Test func budgetFractionZeroTotalIsZero() {
        #expect(ScoutCard.budgetFraction(used: 5, total: 0) == 0)
    }

    @Test func budgetFractionAtHalf() {
        #expect(ScoutCard.budgetFraction(used: 30, total: 60) == 0.5)
    }

    @Test func budgetFractionClampsAtOne() {
        // Over-budget scouts should not overflow their bar.
        #expect(ScoutCard.budgetFraction(used: 80, total: 60) == 1)
    }

    @Test func budgetFractionNegativeUsedIsZero() {
        // Defensive — shouldn't happen in practice, but the server could return
        // a phantom adjustment.
        #expect(ScoutCard.budgetFraction(used: -10, total: 60) == 0)
    }

    @Test func budgetFractionFullSpend() {
        #expect(ScoutCard.budgetFraction(used: 60, total: 60) == 1)
    }

    // MARK: - FindingCard.relative timestamp

    @Test func relativeReturnsNowForRecent() {
        let now = Date()
        let recent = now.addingTimeInterval(-10)
        #expect(FindingCard.relative(recent, now: now) == "now")
    }

    @Test func relativeReturnsMinutes() {
        let now = Date()
        #expect(FindingCard.relative(now.addingTimeInterval(-180), now: now) == "3m")
    }

    @Test func relativeReturnsHours() {
        let now = Date()
        #expect(FindingCard.relative(now.addingTimeInterval(-7_200), now: now) == "2h")
    }

    @Test func relativeReturnsDays() {
        let now = Date()
        #expect(FindingCard.relative(now.addingTimeInterval(-86_400 * 4), now: now) == "4d")
    }
}
