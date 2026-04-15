import Testing
import Foundation
@testable import Brett

/// Covers the queueing / auto-dismissal / manual-dismissal contract of
/// `ToastManager`. We use a short `displayDuration` so the tests stay fast
/// without relying on brittle time math.
@Suite("ToastManager", .tags(.views))
struct ToastManagerTests {
    // MARK: - Queue behaviour

    @MainActor
    @Test func firstErrorBecomesCurrentImmediately() async {
        let manager = ToastManager(displayDuration: 0.25)

        #expect(manager.current == nil)

        manager.showError("Failed to save")

        #expect(manager.current?.message == "Failed to save")
        #expect(manager.current?.kind == .error)
    }

    @MainActor
    @Test func multipleErrorsDisplayInOrder() async throws {
        // Use a modest auto-dismiss window and manually step the queue.
        // Relying purely on sleep() timing is flaky under CI load; manual
        // dismissal gives us deterministic ordering assertions while still
        // exercising the real queue mechanics.
        let manager = ToastManager(displayDuration: 5.0)

        manager.showError("first")
        manager.showError("second")
        manager.showError("third")

        // First toast should be visible immediately.
        #expect(manager.current?.message == "first")

        // Dismiss and advance — second should now be current.
        manager.dismissCurrent()
        #expect(manager.current?.message == "second")

        // Dismiss and advance — third should now be current.
        manager.dismissCurrent()
        #expect(manager.current?.message == "third")

        // Dismiss the last one — queue drains.
        manager.dismissCurrent()
        #expect(manager.current == nil)
    }

    // MARK: - Auto-dismiss timing

    @MainActor
    @Test func singleToastAutoDismissesAfterDuration() async throws {
        let manager = ToastManager(displayDuration: 0.1)

        manager.showError("temporary")
        #expect(manager.current != nil)

        // Wait shorter than duration — should still be visible.
        try await Task.sleep(nanoseconds: 40_000_000)
        #expect(manager.current != nil)

        // Wait past duration — should be gone.
        try await Task.sleep(nanoseconds: 120_000_000)
        #expect(manager.current == nil)
    }

    // MARK: - Manual dismiss

    @MainActor
    @Test func dismissCurrentRemovesToastImmediately() async {
        let manager = ToastManager(displayDuration: 5.0)

        manager.showError("sticky")
        #expect(manager.current != nil)

        manager.dismissCurrent()
        #expect(manager.current == nil)
    }

    @MainActor
    @Test func dismissCurrentAdvancesQueue() async {
        let manager = ToastManager(displayDuration: 5.0)

        manager.showError("first")
        manager.showError("second")

        #expect(manager.current?.message == "first")

        manager.dismissCurrent()
        #expect(manager.current?.message == "second")
    }

    // MARK: - Success variant

    @MainActor
    @Test func showSuccessProducesSuccessKind() async {
        let manager = ToastManager(displayDuration: 0.25)

        manager.showSuccess("Copied")
        #expect(manager.current?.kind == .success)
        #expect(manager.current?.message == "Copied")
    }

    // MARK: - Clear

    @MainActor
    @Test func clearEmptiesQueueAndCurrent() async {
        let manager = ToastManager(displayDuration: 5.0)

        manager.showError("first")
        manager.showError("second")
        manager.showError("third")

        manager.clear()

        #expect(manager.current == nil)

        // Queue really is empty — advancing should not surface anything.
        manager.dismissCurrent()
        #expect(manager.current == nil)
    }

    // MARK: - Robustness

    @MainActor
    @Test func defaultDurationIsFourSeconds() {
        let manager = ToastManager()
        #expect(manager.displayDuration == 4.0)
    }
}
