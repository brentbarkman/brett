import Foundation
@testable import Brett

#if DEBUG
/// Test double for `SyncTrigger`. Counts how many times the store
/// invoked `schedulePushDebounced()` so atomicity tests can assert
/// successful mutations push exactly once and rolled-back mutations
/// don't push at all.
@MainActor
final class MockSyncTrigger: SyncTrigger {
    private(set) var scheduleCallCount = 0
    func schedulePushDebounced() { scheduleCallCount += 1 }
}
#endif
