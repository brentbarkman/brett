import Testing
@testable import Brett

/// Tests that deep-link fragments map to the right `SettingsTab` case.
///
/// We deliberately don't render the SwiftUI tree here — these are pure
/// logic tests. Rendering tests live in UI tests.
@Suite("SettingsNavigation", .tags(.views))
struct SettingsNavigationTests {

    @Test func profileFragmentMapsToProfileTab() {
        #expect(SettingsTab(fragment: "profile") == .profile)
    }

    @Test func calendarFragmentMapsToCalendarTab() {
        #expect(SettingsTab(fragment: "calendar") == .calendar)
    }

    @Test func aiProvidersFragmentMapsToAIProviders() {
        #expect(SettingsTab(fragment: "ai-providers") == .aiProviders)
        #expect(SettingsTab(fragment: "aiproviders") == .aiProviders)
    }

    @Test func newslettersFragmentMapsToNewsletters() {
        #expect(SettingsTab(fragment: "newsletters") == .newsletters)
    }

    @Test func timezoneLocationFragmentMapsToLocation() {
        #expect(SettingsTab(fragment: "timezone-location") == .location)
        #expect(SettingsTab(fragment: "location") == .location)
        #expect(SettingsTab(fragment: "timezone") == .location)
    }

    @Test func accountFragmentMapsToAccount() {
        #expect(SettingsTab(fragment: "account") == .account)
    }

    @Test func updatesFragmentMapsToUpdates() {
        #expect(SettingsTab(fragment: "updates") == .updates)
        #expect(SettingsTab(fragment: "about") == .updates)
    }

    @Test func securityFragmentMapsToSecurity() {
        #expect(SettingsTab(fragment: "security") == .security)
    }

    @Test func unknownFragmentReturnsNil() {
        #expect(SettingsTab(fragment: "nonsense") == nil)
        #expect(SettingsTab(fragment: "") == nil)
    }

    @Test func fragmentMatchingIsCaseInsensitive() {
        #expect(SettingsTab(fragment: "Profile") == .profile)
        #expect(SettingsTab(fragment: "AI-PROVIDERS") == .aiProviders)
    }
}
