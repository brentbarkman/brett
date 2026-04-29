import Testing
@testable import Brett

@Suite("ScenePhaseTaskTracker", .tags(.smoke))
@MainActor
struct ScenePhaseTaskTrackerTests {
    @Test func startingNewTaskCancelsPreviousOne() async throws {
        let tracker = ScenePhaseTaskTracker()
        actor Flags {
            var firstFinished = false
            var firstCancelled = false
            func setFinished() { firstFinished = true }
            func setCancelled() { firstCancelled = true }
            func snapshot() -> (Bool, Bool) { (firstFinished, firstCancelled) }
        }
        let flags = Flags()

        tracker.start {
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
                await flags.setFinished()
            } catch {
                await flags.setCancelled()
            }
        }
        try await Task.sleep(nanoseconds: 10_000_000)

        tracker.start {
            // No-op replacement — observe cancellation of first.
        }

        try await Task.sleep(nanoseconds: 250_000_000)
        let (finished, cancelled) = await flags.snapshot()
        #expect(finished == false)
        #expect(cancelled == true)
    }

    @Test func cancelStopsRunningTask() async throws {
        let tracker = ScenePhaseTaskTracker()
        actor Flag {
            var cancelled = false
            func mark() { cancelled = true }
            func snapshot() -> Bool { cancelled }
        }
        let flag = Flag()

        tracker.start {
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
            } catch {
                await flag.mark()
            }
        }
        try await Task.sleep(nanoseconds: 10_000_000)
        tracker.cancel()
        try await Task.sleep(nanoseconds: 30_000_000)
        let cancelled = await flag.snapshot()
        #expect(cancelled == true)
    }
}
