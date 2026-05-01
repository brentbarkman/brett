import Foundation

/// Minimal protocol for "schedule a debounced push." Lets stores accept a
/// `SyncManager` *or* a test double without coupling to the full sync
/// engine surface. `SyncManager` already has `schedulePushDebounced()` —
/// this just declares conformance.
@MainActor
protocol SyncTrigger: AnyObject {
    func schedulePushDebounced()
}

extension SyncManager: SyncTrigger {}
