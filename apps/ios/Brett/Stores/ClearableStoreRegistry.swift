import Foundation

/// Stores adopt this so `Session.tearDown()` (called from sign-out) can wipe
/// their in-memory caches before SwiftData rows are deleted. Clearing
/// in-memory state is a separate concern from clearing the on-disk
/// SwiftData mirror — `wipeAllData()` handles the latter; this protocol
/// handles the former.
@MainActor
protocol Clearable: AnyObject {
    /// Drop any in-memory state that should not survive a sign-out. Called
    /// from `ClearableStoreRegistry.clearAll()` immediately before
    /// `PersistenceController.wipeAllData()` runs.
    ///
    /// No default impl: every conforming type must declare its own body
    /// explicitly. An empty body is acceptable for stores with no
    /// per-instance state — but the explicitness ensures a future store
    /// that gains state can't accidentally inherit a no-op clear.
    func clearForSignOut()
}

/// Weak-reference registry of every `Clearable` store the process has
/// instantiated. Single fan-out point for sign-out clearing.
///
/// Why a registry instead of a singleton list passed to `Session.tearDown`:
/// stores live at different layers — some are app-scoped singletons
/// (`AIProviderStore.shared`), some are page-scoped (`@State private var
/// chatStore = ChatStore()` inside a detail view), some are environment-
/// injected. The registry hides that variance behind a uniform fan-out.
@MainActor
enum ClearableStoreRegistry {
    /// Weak-box wrapper so registration doesn't pin stores in memory past
    /// their natural lifetime. The registry is itself main-actor isolated,
    /// so no locking is required.
    private final class WeakRef {
        weak var store: Clearable?
        init(_ store: Clearable) { self.store = store }
    }

    private static var refs: [WeakRef] = []

    /// Register a store. Idempotent for the same instance — a store
    /// registered twice clears once. Drops any empty weak boxes opportunistically.
    static func register(_ store: Clearable) {
        refs.removeAll { $0.store == nil }
        if refs.contains(where: { $0.store === store }) { return }
        refs.append(WeakRef(store))
    }

    /// Fan out `clearForSignOut()` across every live registered store.
    /// Called from `Session.tearDown()` before SwiftData is wiped.
    static func clearAll() {
        for ref in refs {
            ref.store?.clearForSignOut()
        }
    }

    /// Test-only: drop every registration so test-double stores from a
    /// prior test don't leak into the next case. Crash if called outside
    /// XCTest to keep production code from accidentally relying on it.
    static func resetForTesting() {
        #if DEBUG
        refs.removeAll()
        #else
        fatalError("ClearableStoreRegistry.resetForTesting called outside DEBUG")
        #endif
    }
}
