import Foundation
import Network
import Observation

/// Categorises the current network path so callers can branch on it
/// (e.g. avoid heavy uploads on cellular, warn when offline).
enum ConnectionType: String, Sendable {
    case wifi
    case cellular
    case offline
    case other
}

/// Publishes reachability status using `Network.framework`'s `NWPathMonitor`.
///
/// The monitor is created lazily so that tests can inject a stubbed path
/// monitor; production code just uses `NetworkMonitor.shared` and doesn't
/// care. The class mutates `@Observable` state so it's pinned to the main
/// actor — callbacks from the underlying `NWPathMonitor` are hopped across.
@MainActor
@Observable
final class NetworkMonitor {
    // MARK: - Shared instance

    static let shared = NetworkMonitor()

    // MARK: - Observable state

    /// True when the device has an active network path that can reach the
    /// internet (satisfied OR requiresConnection == false). Defaults to true
    /// optimistically so the first sync attempt isn't blocked while the
    /// monitor warms up.
    private(set) var isOnline: Bool = true

    /// Most recent connection type. `.offline` when the path is unsatisfied.
    private(set) var connectionType: ConnectionType = .wifi

    // MARK: - Dependencies

    /// Abstraction so tests can feed synthetic paths without spinning up a
    /// real `NWPathMonitor` (which is effectively untestable in unit tests).
    private let pathMonitor: NetworkPathMonitoring

    /// Continuations for the online/offline AsyncStream. We hold onto each so
    /// we can emit transitions as they happen and finish cleanly on `stop()`.
    private var transitionContinuations: [UUID: AsyncStream<Bool>.Continuation] = [:]

    /// Suppress the inaugural callback from `NWPathMonitor` (emits once on
    /// first `start()` with the current path) so `start() → sync()` doesn't
    /// get a spurious "online transition" as soon as the monitor boots.
    private var hasEmittedInitialPath = false

    // MARK: - Init

    /// Production initialiser — wraps a real `NWPathMonitor`.
    convenience init() {
        self.init(pathMonitor: SystemPathMonitor())
    }

    /// Test initialiser — inject a stubbed monitor.
    init(pathMonitor: NetworkPathMonitoring) {
        self.pathMonitor = pathMonitor
        // Wire the callback before starting so we don't miss the first emission.
        self.pathMonitor.pathUpdateHandler = { [weak self] snapshot in
            // NWPathMonitor invokes its handler on a background queue; marshal
            // back to the main actor so @Observable writes are safe.
            Task { @MainActor [weak self] in
                self?.handlePathUpdate(snapshot)
            }
        }
        start()
    }

    // MARK: - Lifecycle

    /// Begin monitoring. Safe to call multiple times — subsequent calls are
    /// treated as a no-op by the underlying monitor.
    func start() {
        pathMonitor.start()
    }

    /// Stop monitoring and finish any active transition streams.
    func stop() {
        pathMonitor.cancel()
        for continuation in transitionContinuations.values {
            continuation.finish()
        }
        transitionContinuations.removeAll()
    }

    // MARK: - Transition stream

    /// An `AsyncStream<Bool>` that emits only on transitions between online and
    /// offline. The first element is NOT the current state — it fires when the
    /// state next changes. Subscribers should read `isOnline` up front.
    ///
    /// Multiple subscribers are supported; each gets its own continuation.
    func onlineTransitions() -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let id = UUID()
            self.transitionContinuations[id] = continuation

            continuation.onTermination = { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.transitionContinuations[id] = nil
                }
            }
        }
    }

    // MARK: - Path handling

    /// Apply a new path snapshot — updates observable state and fans out a
    /// transition event if online/offline flipped.
    private func handlePathUpdate(_ path: NetworkPathSnapshot) {
        let nextOnline = path.status == .satisfied
        let nextType = Self.connectionType(from: path)

        // Always update observable state so UI reflects reality even when the
        // online bool didn't flip (e.g. wifi → cellular while still online).
        connectionType = nextType

        let wasOnline = isOnline
        isOnline = nextOnline

        // Skip the very first emission — `NWPathMonitor` fires once on start
        // with the current path, which would masquerade as a transition.
        guard hasEmittedInitialPath else {
            hasEmittedInitialPath = true
            return
        }

        if wasOnline != nextOnline {
            for continuation in transitionContinuations.values {
                continuation.yield(nextOnline)
            }
        }
    }

    private static func connectionType(from path: NetworkPathSnapshot) -> ConnectionType {
        guard path.status == .satisfied else { return .offline }
        if path.usesInterfaceType(.wifi) { return .wifi }
        if path.usesInterfaceType(.cellular) { return .cellular }
        return .other
    }
}

// MARK: - Path monitor abstraction

/// A trimmed-down surface of `NWPathMonitor` that tests can stub. We don't
/// want `NetworkMonitor` to depend directly on `NWPathMonitor` because
/// `NWPath` is practically impossible to construct in tests.
protocol NetworkPathMonitoring: AnyObject {
    var pathUpdateHandler: (@Sendable (NetworkPathSnapshot) -> Void)? { get set }
    func start()
    func cancel()
}

/// A test-friendly snapshot of `NWPath`. Production code bridges from the real
/// `NWPath` into this struct so tests can construct one directly.
struct NetworkPathSnapshot: Sendable {
    enum Status: Sendable { case satisfied, unsatisfied, requiresConnection }

    var status: Status
    /// Interface types active on this path. Kept as raw enum cases for easy
    /// matching in tests (e.g. `.wifi`, `.cellular`).
    var interfaces: Set<NWInterface.InterfaceType>

    func usesInterfaceType(_ type: NWInterface.InterfaceType) -> Bool {
        interfaces.contains(type)
    }

    init(status: Status, interfaces: Set<NWInterface.InterfaceType> = []) {
        self.status = status
        self.interfaces = interfaces
    }
}

// MARK: - Production monitor

/// The default `NetworkPathMonitoring` implementation — wraps a real
/// `NWPathMonitor` on its own serial queue.
final class SystemPathMonitor: NetworkPathMonitoring, @unchecked Sendable {
    private let monitor: NWPathMonitor
    private let queue: DispatchQueue
    var pathUpdateHandler: (@Sendable (NetworkPathSnapshot) -> Void)?

    init() {
        self.monitor = NWPathMonitor()
        self.queue = DispatchQueue(label: "com.brett.sync.NetworkMonitor")
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let snapshot = NetworkPathSnapshot(
                status: Self.mapStatus(path.status),
                interfaces: Self.extractInterfaces(from: path)
            )
            self.pathUpdateHandler?(snapshot)
        }
    }

    func start() {
        monitor.start(queue: queue)
    }

    func cancel() {
        monitor.cancel()
    }

    private static func mapStatus(_ status: NWPath.Status) -> NetworkPathSnapshot.Status {
        switch status {
        case .satisfied: return .satisfied
        case .unsatisfied: return .unsatisfied
        case .requiresConnection: return .requiresConnection
        @unknown default: return .unsatisfied
        }
    }

    private static func extractInterfaces(from path: NWPath) -> Set<NWInterface.InterfaceType> {
        var out: Set<NWInterface.InterfaceType> = []
        for type in [NWInterface.InterfaceType.wifi, .cellular, .wiredEthernet, .loopback, .other] {
            if path.usesInterfaceType(type) {
                out.insert(type)
            }
        }
        return out
    }
}
