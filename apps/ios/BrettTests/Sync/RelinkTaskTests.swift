import Testing
@testable import Brett

/// Verifies re-link task detection from `source` + `sourceId` fields.
/// Contract mirrors the API in `apps/api/src/lib/connection-health.ts`:
/// - `source == "system"`
/// - `sourceId == "relink:<type>:<accountId>"`
@Suite("RelinkTask.parse", .tags(.sync))
struct RelinkTaskTests {
    @Test func parsesGoogleCalendar() {
        let task = RelinkTask.parse(source: "system", sourceId: "relink:google-calendar:acc_123")
        #expect(task == RelinkTask(type: .googleCalendar))
    }

    @Test func parsesGranola() {
        let task = RelinkTask.parse(source: "system", sourceId: "relink:granola:acc_abc")
        #expect(task == RelinkTask(type: .granola))
    }

    @Test func parsesAi() {
        let task = RelinkTask.parse(source: "system", sourceId: "relink:ai:provider_1")
        #expect(task == RelinkTask(type: .ai))
    }

    @Test func accountIdWithColonsIsTolerated() {
        // maxSplits=2 means accountIds containing colons are preserved in the
        // tail. We only care about the type token in position 1.
        let task = RelinkTask.parse(source: "system", sourceId: "relink:ai:prov:with:colons")
        #expect(task == RelinkTask(type: .ai))
    }

    // MARK: - Rejection cases

    @Test func rejectsNonSystemSource() {
        #expect(RelinkTask.parse(source: "Brett", sourceId: "relink:ai:x") == nil)
        #expect(RelinkTask.parse(source: "Granola", sourceId: "relink:ai:x") == nil)
    }

    @Test func rejectsMissingSourceId() {
        #expect(RelinkTask.parse(source: "system", sourceId: nil) == nil)
    }

    @Test func rejectsNonRelinkSourceId() {
        #expect(RelinkTask.parse(source: "system", sourceId: "system:update") == nil)
        #expect(RelinkTask.parse(source: "system", sourceId: "not-a-relink") == nil)
    }

    @Test func rejectsUnknownType() {
        #expect(RelinkTask.parse(source: "system", sourceId: "relink:slack:123") == nil)
    }

    @Test func rejectsMalformedSourceId() {
        // Just "relink:" — no type token.
        #expect(RelinkTask.parse(source: "system", sourceId: "relink:") == nil)
    }

    // MARK: - Settings tab mapping

    @Test func googleCalendarRoutesToCalendarTab() {
        #expect(RelinkType.googleCalendar.settingsTab == .calendar)
    }

    @Test func granolaRoutesToCalendarTab() {
        // Granola lives inside CalendarSettingsView — matches desktop.
        #expect(RelinkType.granola.settingsTab == .calendar)
    }

    @Test func aiRoutesToAiProvidersTab() {
        #expect(RelinkType.ai.settingsTab == .aiProviders)
    }
}
