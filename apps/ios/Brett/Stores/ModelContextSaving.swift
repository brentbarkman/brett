import Foundation
import SwiftData

/// Injection seam for `ModelContext.save()` so store mutations can be made
/// atomic in tests.
///
/// Production stores construct `LiveSaver(context: context)` and the call
/// sites are indistinguishable from raw `try context.save()`. Tests inject
/// the throwing variants below to exercise the rollback path — verifying
/// that the optimistic SwiftData insert AND the queued
/// `MutationQueueEntry` get reverted together. Without this, a partial
/// failure leaves a row visible to `@Query` while the queue is empty —
/// the create never reaches the server and sync silently stalls.
@MainActor
protocol ModelContextSaving {
    func save() throws
    func rollback()
}

/// Thin pass-through to a real `ModelContext`. Used everywhere outside
/// tests.
@MainActor
struct LiveSaver: ModelContextSaving {
    let context: ModelContext
    func save() throws { try context.save() }
    func rollback() { context.rollback() }
}

#if DEBUG
/// Saver that always throws. Use when the test only cares that the store
/// rejects the mutation and surfaces an error — not what `rollback()` does.
@MainActor
struct ThrowingSaver: ModelContextSaving {
    enum InjectedError: Error, Equatable { case armed }
    func save() throws { throw InjectedError.armed }
    /// No-op: nothing was committed and there is no underlying context to
    /// rewind. Tests that need the production rollback to actually revert
    /// in-memory SwiftData state should use `ThrowingSaverWrappingLive`.
    func rollback() { /* no-op */ }
}

/// Saver that throws on `save()` but forwards `rollback()` to the live
/// context. Use this when the test wants to verify the production store
/// invokes the real `context.rollback()` on failure (i.e., that the
/// in-memory SwiftData insert is reverted, not just that the store
/// catches).
@MainActor
struct ThrowingSaverWrappingLive: ModelContextSaving {
    let live: LiveSaver
    enum InjectedError: Error, Equatable { case armed }
    func save() throws { throw InjectedError.armed }
    func rollback() { live.rollback() }
}
#endif
