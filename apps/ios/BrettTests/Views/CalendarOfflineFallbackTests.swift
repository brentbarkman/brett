import Foundation
import Testing
@testable import Brett

/// Regression coverage for the offline calendar fallback (issues #120 and
/// #122). `CalendarAccountsStore.fetchAccounts()` hits the network — when
/// offline, `accountsStore.hasAnyAccount` resolves to false even if the
/// user has connected accounts and cached events. The original gating
/// `if accountsStore.hasAnyAccount { DayTimeline } else { connectCTA }`
/// dropped users into the "Connect Google Calendar" CTA whenever they
/// opened the calendar tab without connectivity, which surfaced as both
/// "no calendar entries" (#122) and "stuck — couldn't swipe right or left"
/// (#120 — there was no timeline to swipe on, only a static CTA).
///
/// `CalendarPage.shouldShowTimeline(hasAccount:hasCachedEvents:)` falls
/// back on cached-events presence so the timeline survives offline.
@Suite("CalendarOfflineFallback", .tags(.views))
struct CalendarOfflineFallbackTests {

    @Test func showsTimelineWhenAccountsAreLoaded() {
        // Online happy path — accounts loaded successfully.
        #expect(CalendarPage.shouldShowTimeline(hasAccount: true, hasCachedEvents: true))
        #expect(CalendarPage.shouldShowTimeline(hasAccount: true, hasCachedEvents: false))
    }

    @Test func showsTimelineOfflineWhenCacheHasEvents() {
        // The bug: offline launch, accounts haven't loaded yet, but the
        // local SwiftData cache has events from a prior sync. The
        // timeline must render — cached events imply a connected account.
        #expect(CalendarPage.shouldShowTimeline(hasAccount: false, hasCachedEvents: true))
    }

    @Test func showsConnectCTAWhenNoAccountsAndNoEvents() {
        // True "first run" / "never connected" state — no accounts, no
        // events. CTA is correct. This is the only state where the CTA
        // should still render after the fix.
        #expect(!CalendarPage.shouldShowTimeline(hasAccount: false, hasCachedEvents: false))
    }
}
