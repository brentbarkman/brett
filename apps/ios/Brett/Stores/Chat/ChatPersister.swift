import Foundation
import SwiftData

/// Persists final assistant messages from the chat stream to the
/// `BrettMessage` SwiftData table so they survive app restarts.
///
/// This is the SwiftData half of the chat pipeline split: the in-memory
/// `ChatMessageBuffer` holds the live view-model state, the
/// `StreamingChatClient` drives the SSE transport, and this type owns the
/// single point where streamed content lands on disk.
///
/// `userId` is captured by the caller (`ChatStore.send(...)`) at the top of
/// the turn and plumbed through — we never re-derive it inside the
/// persistence path, because between the send and the stream's end the user
/// might have signed out, a new `UserProfile` row might have landed from a
/// pull, and a late-arriving assistant chunk could otherwise be tagged with
/// the wrong owner.
///
/// If `userId` is nil (the caller signed out mid-stream), we skip the write
/// entirely — there's no authenticated owner to attribute the message to,
/// and the cancellation in `ActiveSession.tearDown()` should have
/// short-circuited this path anyway.
@MainActor
struct ChatPersister {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    /// Insert a new `BrettMessage` row with `role = .brett` for the given
    /// content and scope. No-ops if `content` is whitespace-only or if
    /// `userId` is missing. Throws on `context.save()` failure so callers
    /// can log via `BrettLog.store`.
    func persistAssistant(
        content: String,
        itemId: String?,
        calendarEventId: String?,
        userId: String?
    ) throws {
        guard !content.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        guard let userId, !userId.isEmpty else {
            BrettLog.store.info("ChatPersister: dropped assistant persist — no authenticated userId")
            return
        }

        let message = BrettMessage(
            userId: userId,
            role: .brett,
            content: content,
            itemId: itemId,
            calendarEventId: calendarEventId,
            createdAt: Date(),
            updatedAt: Date()
        )
        context.insert(message)
        try context.save()
    }
}
