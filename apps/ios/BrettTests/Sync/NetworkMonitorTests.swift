import Testing
import Network
import Foundation
@testable import Brett

/// Unit tests for `NetworkMonitor`. We can't meaningfully exercise the real
/// `NWPathMonitor` in a unit test (no way to fabricate an `NWPath`), so we
/// drive the monitor through an injected stub that produces synthetic path
/// snapshots.
@Suite("NetworkMonitor", .tags(.sync))
struct NetworkMonitorTests {
    // MARK: - start / stop

    @MainActor
    @Test func startAndStopToggleUnderlyingMonitor() async {
        let stub = StubPathMonitor()
        _ = NetworkMonitor(pathMonitor: stub)

        // The init calls start() once — verify via the stub.
        #expect(stub.startCount == 1)
    }

    // MARK: - isOnline updates

    @MainActor
    @Test func pathSatisfiedFlipsIsOnlineTrue() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        // Simulate the first inaugural path — wifi, satisfied.
        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))

        #expect(monitor.isOnline == true)
        #expect(monitor.connectionType == .wifi)
    }

    @MainActor
    @Test func pathUnsatisfiedSetsIsOnlineFalse() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))   // initial
        await stub.emit(.init(status: .unsatisfied, interfaces: []))      // transition

        #expect(monitor.isOnline == false)
        #expect(monitor.connectionType == .offline)
    }

    @MainActor
    @Test func cellularPathReportedAsCellular() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        await stub.emit(.init(status: .satisfied, interfaces: [.cellular]))

        #expect(monitor.isOnline == true)
        #expect(monitor.connectionType == .cellular)
    }

    // MARK: - AsyncStream transitions

    @MainActor
    @Test func onlineTransitionsEmitsFlips() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        var iterator = monitor.onlineTransitions().makeAsyncIterator()

        // First path is the "inaugural" — should NOT emit on the stream.
        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))

        // Flip offline — stream should receive false.
        await stub.emit(.init(status: .unsatisfied, interfaces: []))
        let first = await iterator.next()
        #expect(first == false)

        // Back online — stream should receive true.
        await stub.emit(.init(status: .satisfied, interfaces: [.wifi]))
        let second = await iterator.next()
        #expect(second == true)
    }

    @MainActor
    @Test func stopFinishesTransitionStream() async {
        let stub = StubPathMonitor()
        let monitor = NetworkMonitor(pathMonitor: stub)

        var iterator = monitor.onlineTransitions().makeAsyncIterator()
        monitor.stop()

        // After stop(), the stream's iterator should produce no more values.
        let value = await iterator.next()
        #expect(value == nil)
    }
}

// MARK: - Test stub

/// Test double for `NetworkPathMonitoring`. Lets a test fire synthetic path
/// snapshots synchronously. Uses `@unchecked Sendable` because the test owns
/// both the main actor and the stub itself, so there's no real cross-actor
/// state.
final class StubPathMonitor: NetworkPathMonitoring, @unchecked Sendable {
    var pathUpdateHandler: (@Sendable (NetworkPathSnapshot) -> Void)?
    private(set) var startCount = 0
    private(set) var cancelCount = 0

    init() {}

    func start() {
        startCount += 1
    }

    func cancel() {
        cancelCount += 1
    }

    /// Fire a synthetic path update and yield so the NetworkMonitor's
    /// `Task { @MainActor ... }` hop can land before the test continues.
    @MainActor
    func emit(_ snapshot: NetworkPathSnapshot) async {
        pathUpdateHandler?(snapshot)
        // Let the main-actor hop drain.
        await Task.yield()
        await Task.yield()
    }
}
