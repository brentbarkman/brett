import Testing
import Foundation
import SwiftData
@testable import Brett

/// Tests the orchestration contract of `SyncManager`: the push→pull sequence,
/// offline skipping, debounce collapsing, transition-driven syncs, and the
/// crash-recovery step that resets in-flight mutations.
@Suite("SyncManager", .tags(.sync))
struct SyncManagerTests {
    // MARK: - Basic push/pull

    @MainActor
    @Test func syncCallsPushThenPull() async {
        let fixture = await TestHarness.make()
        await fixture.sut.sync()

        #expect(fixture.push.callCount == 1)
        #expect(fixture.pull.callCount == 1)
        #expect(fixture.push.calledBefore(fixture.pull))
        if case .error = fixture.sut.state { Issue.record("state should not be error") }
    }

    @MainActor
    @Test func syncSkipsWhenOffline() async {
        let fixture = await TestHarness.make(isOnline: false)
        await fixture.sut.sync()

        #expect(fixture.push.callCount == 0)
        #expect(fixture.pull.callCount == 0)
    }

    // MARK: - Error handling

    @MainActor
    @Test func pushErrorStillAttemptsPull() async {
        let fixture = await TestHarness.make()
        fixture.push.errorToThrow = TestError.boom

        await fixture.sut.sync()

        #expect(fixture.push.callCount == 1)
        #expect(fixture.pull.callCount == 1, "pull must still run even when push fails")
        if case .error = fixture.sut.state {
            // expected
        } else {
            Issue.record("state should be .error after a push failure")
        }
    }

    @MainActor
    @Test func pullErrorSetsErrorState() async {
        let fixture = await TestHarness.make()
        fixture.pull.errorToThrow = TestError.boom

        await fixture.sut.sync()

        #expect(fixture.pull.callCount == 1)
        if case .error = fixture.sut.state {
            // expected
        } else {
            Issue.record("state should be .error after pull failure")
        }
    }

    // MARK: - Debounce

    @MainActor
    @Test func rapidDebouncedCallsCollapseToOneSync() async throws {
        let fixture = await TestHarness.make(debounce: 0.08)

        // Fire three calls in quick succession — only the last wins.
        fixture.sut.schedulePushDebounced()
        fixture.sut.schedulePushDebounced()
        fixture.sut.schedulePushDebounced()

        // Wait comfortably longer than the debounce window.
        try await Task.sleep(nanoseconds: 200_000_000) // 200ms

        #expect(fixture.push.callCount == 1)
        #expect(fixture.pull.callCount == 1)
    }

    @MainActor
    @Test func offlineCancelsPendingDebouncedPush() async throws {
        let fixture = await TestHarness.make(debounce: 0.1)

        // Start online so the listener is primed.
        await fixture.networkStub.emit(.init(status: .satisfied, interfaces: [.wifi]))

        fixture.sut.schedulePushDebounced()

        // Transition offline before the debounce fires.
        await fixture.networkStub.emit(.init(status: .unsatisfied, interfaces: []))

        // Wait past the debounce window — nothing should have run.
        try await Task.sleep(nanoseconds: 250_000_000) // 250ms

        #expect(fixture.push.callCount == 0)
    }

    // MARK: - Network transitions

    @MainActor
    @Test func onlineTransitionTriggersSync() async throws {
        let fixture = await TestHarness.make(isOnline: false)

        // Simulate first-ever path, offline (inaugural — swallowed).
        await fixture.networkStub.emit(.init(status: .unsatisfied, interfaces: []))
        // Start: the listener attaches here. Since offline, no initial sync.
        fixture.sut.start()

        // Give the listener task a cycle to attach.
        try await Task.sleep(nanoseconds: 30_000_000)

        // Transition to online.
        await fixture.networkStub.emit(.init(status: .satisfied, interfaces: [.wifi]))

        // Wait for the async sync to complete.
        try await Task.sleep(nanoseconds: 150_000_000) // 150ms

        #expect(fixture.push.callCount >= 1, "online transition should trigger sync")
        #expect(fixture.pull.callCount >= 1)
    }

    // MARK: - Crash recovery

    @MainActor
    @Test func startResetsInFlightMutations() async throws {
        let fixture = await TestHarness.make(isOnline: false) // avoid auto-sync

        // Seed an "in_flight" mutation left over from a crash.
        let stranded = MutationQueueEntry(
            entityType: "item",
            entityId: "stranded",
            action: .update,
            endpoint: "/things/stranded",
            method: .patch,
            payload: "{}"
        )
        stranded.status = MutationStatus.inFlight.rawValue
        fixture.context.insert(stranded)
        try fixture.context.save()

        fixture.sut.start()
        try await Task.sleep(nanoseconds: 20_000_000)

        let descriptor = FetchDescriptor<MutationQueueEntry>()
        let entries = try fixture.context.fetch(descriptor)
        #expect(entries.count == 1)
        #expect(entries.first?.status == MutationStatus.pending.rawValue)
    }

    // MARK: - pullToRefresh

    @MainActor
    @Test func pullToRefreshThrowsWhenOffline() async {
        let fixture = await TestHarness.make(isOnline: false)
        do {
            try await fixture.sut.pullToRefresh()
            Issue.record("expected pullToRefresh to throw when offline")
        } catch SyncError.offline {
            // expected
        } catch {
            Issue.record("unexpected error: \(error)")
        }
    }

    @MainActor
    @Test func pullToRefreshSucceedsWhenOnline() async throws {
        let fixture = await TestHarness.make()
        try await fixture.sut.pullToRefresh()
        #expect(fixture.push.callCount == 1)
        #expect(fixture.pull.callCount == 1)
        #expect(fixture.sut.lastSyncedAt != nil)
    }
}

// MARK: - Test harness

/// Bundles a SyncManager under test with its mocked dependencies so each test
/// gets a clean, isolated fixture without leaking state across cases.
@MainActor
private struct TestHarness {
    let sut: SyncManager
    let push: MockPushEngine
    let pull: MockPullEngine
    let networkStub: StubPathMonitor
    let context: ModelContext

    static func make(
        isOnline: Bool = true,
        debounce: TimeInterval = 1.0,
        pollInterval: TimeInterval = 3600 // disable poll in tests
    ) async -> TestHarness {
        let push = MockPushEngine()
        let pull = MockPullEngine()
        let stub = StubPathMonitor()
        let network = NetworkMonitor(pathMonitor: stub)

        // Prime the initial online state.
        await stub.emit(.init(
            status: isOnline ? .satisfied : .unsatisfied,
            interfaces: isOnline ? [.wifi] : []
        ))

        let container = try! InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)

        let sut = SyncManager(
            pushEngine: push,
            pullEngine: pull,
            networkMonitor: network,
            modelContext: context,
            pollInterval: pollInterval,
            debounceInterval: debounce
        )

        return TestHarness(
            sut: sut,
            push: push,
            pull: pull,
            networkStub: stub,
            context: context
        )
    }
}

// MARK: - Mock engines

/// Shared monotonic clock the mock engines stamp onto each call so tests can
/// assert ordering (push-before-pull). Isolated to the main actor so a single
/// test's calls don't interleave with another test's counter.
@MainActor
private enum CallSequence {
    static var next: Int = 0
    static func bump() -> Int {
        next += 1
        return next
    }
}

@MainActor
final class MockPushEngine: PushEngineProtocol {
    private(set) var callCount = 0
    private(set) var callOrder: Int = -1

    var errorToThrow: Error?

    func push() async throws -> PushOutcome {
        callCount += 1
        callOrder = CallSequence.bump()
        if let errorToThrow { throw errorToThrow }
        return PushOutcome()
    }

    func calledBefore(_ other: MockPullEngine) -> Bool {
        callOrder >= 0 && other.callOrder >= 0 && callOrder < other.callOrder
    }
}

@MainActor
final class MockPullEngine: PullEngineProtocol {
    private(set) var callCount = 0
    private(set) var callOrder: Int = -1

    var errorToThrow: Error?

    func pull() async throws -> PullOutcome {
        callCount += 1
        callOrder = CallSequence.bump()
        if let errorToThrow { throw errorToThrow }
        return PullOutcome()
    }
}

// MARK: - Test errors

private enum TestError: Error, LocalizedError {
    case boom
    var errorDescription: String? { "boom" }
}
