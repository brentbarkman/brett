import Foundation

/// The surface area the push engine depends on from the mutation queue.
///
/// Declared as a protocol so the push engine can compile independently of
/// W2-A's `MutationQueue` class: as long as the concrete type adopts this
/// protocol, the engine can be wired up without changing any call-sites.
///
/// All methods run on the main actor because they mutate the SwiftData
/// `ModelContext`, which is not `Sendable`.
@MainActor
protocol MutationQueueProtocol: AnyObject {
    /// Fetch the next batch of pending mutations, oldest first.
    /// Returns at most `limit` entries whose status is `pending`.
    func pendingEntries(limit: Int) -> [MutationQueueEntry]

    /// Flip the given mutations to `in_flight` so another engine invocation
    /// doesn't pick them up a second time.
    func markInFlight(ids: [String])

    /// Mark a mutation as successfully applied (or definitively terminated) so
    /// it's removed from the queue. Idempotent.
    func complete(id: String)

    /// Record a failed delivery. `errorCode` carries the HTTP status if we
    /// have one — the queue may use it to decide whether to bounce the
    /// mutation to dead-letter or keep retrying.
    func fail(id: String, error: String, errorCode: Int?)

    /// Look up an entry by its idempotency key. Used to cross-reference
    /// push results (which echo the key) back to the originating mutation.
    func getByIdempotencyKey(_ key: String) -> MutationQueueEntry?
}

extension MutationQueueProtocol {
    /// Default limit of 50 mirrors the server's `MAX_MUTATIONS` per push.
    func pendingEntries(limit: Int = 50) -> [MutationQueueEntry] {
        pendingEntries(limit: limit)
    }
}
