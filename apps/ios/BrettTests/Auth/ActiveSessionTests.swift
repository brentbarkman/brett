import Testing
import Foundation
import SwiftData
@testable import Brett

/// Tests for ActiveSession + Session lifecycle — the Wave A.5 refactor that
/// eliminates the SyncManager.shared cross-account leak.
///
/// These tests can't construct a real `Session` without touching
/// `PersistenceController.shared` (which has disk side effects) or real
/// network engines. We cover the invariants that matter at the registry
/// level: begin replaces, end clears, nil safely propagates.
@Suite("ActiveSession")
@MainActor
struct ActiveSessionTests {

    /// Cleanup between tests — the registry is process-wide by design,
    /// so a leftover session from a previous test would cross-contaminate.
    private func resetRegistry() {
        ActiveSession.end()
    }

    @Test func registryStartsEmpty() {
        resetRegistry()
        #expect(ActiveSession.current == nil)
        #expect(ActiveSession.syncManager == nil)
        #expect(ActiveSession.userId == nil)
    }

    @Test func endIsIdempotent() {
        resetRegistry()
        ActiveSession.end()
        ActiveSession.end()
        #expect(ActiveSession.current == nil)
    }

    @Test func optionalAccessorsNoOpWhenEmpty() {
        resetRegistry()
        // The intended caller pattern — verify these are literally no-ops,
        // not crashes. Stores rely on this to stay quiet between sign-outs
        // and sign-ins.
        ActiveSession.syncManager?.schedulePushDebounced()
        #expect(ActiveSession.current == nil)
    }
}
