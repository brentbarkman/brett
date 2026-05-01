import Foundation
import Observation

/// In-memory chat message buffer keyed by item id or calendar event id.
///
/// Owns the live view-model state that backs `ChatStore` (messages
/// dictionary, per-key streaming flag, per-key last-error string) and the
/// mutation primitives the streaming pipeline calls into. Pure in-memory —
/// no networking, no SwiftData. The persistence + transport halves of the
/// chat pipeline live in `ChatPersister` and `StreamingChatClient`.
///
/// `@Observable` so SwiftUI re-renders when the buffer mutates: the parent
/// `ChatStore` proxies its public properties straight through to this
/// instance, so views observing `chatStore.messages[key]` pick up changes
/// here without `ChatStore` itself needing to be `@Observable` for these
/// fields.
@MainActor
@Observable
final class ChatMessageBuffer {
    /// Messages in the current UI, keyed by itemId or eventId. NOT the
    /// persisted `BrettMessage` rows — this is the live view model that
    /// lets streaming deltas mutate without fighting SwiftData.
    private(set) var messages: [String: [ChatMessage]] = [:]

    /// True while we're streaming a response into `messages[key]`.
    private(set) var isStreaming: [String: Bool] = [:]

    /// Last error for each key, if any. Cleared on next successful send.
    private(set) var lastError: [String: String] = [:]

    init() {}

    // MARK: - Hydration

    /// Replace the entire bucket for `key`. Used by hydrate paths that
    /// reseed the conversation from local SwiftData or server history.
    func setMessages(key: String, messages: [ChatMessage]) {
        self.messages[key] = messages
    }

    // MARK: - Mutations

    /// Append a user message and return immediately.
    func appendUser(key: String, content: String, id: String = UUID().uuidString) {
        var bucket = messages[key] ?? []
        bucket.append(
            ChatMessage(
                id: id,
                role: .user,
                content: content,
                isStreaming: false,
                createdAt: Date()
            )
        )
        messages[key] = bucket
    }

    /// Begin a streaming assistant bubble. Returns the index in the bucket
    /// so subsequent deltas can target this exact message even if more
    /// messages are appended later.
    @discardableResult
    func beginAssistant(key: String, id: String = UUID().uuidString) -> Int {
        var bucket = messages[key] ?? []
        bucket.append(
            ChatMessage(
                id: id,
                role: .brett,
                content: "",
                isStreaming: true,
                createdAt: Date()
            )
        )
        messages[key] = bucket
        isStreaming[key] = true
        return bucket.count - 1
    }

    /// Append a chunk of streamed text to the assistant bubble at `index`.
    func appendAssistantDelta(key: String, index: Int, delta: String) {
        guard var bucket = messages[key], index < bucket.count else { return }
        bucket[index].content += delta
        messages[key] = bucket
    }

    /// Mark the assistant bubble as no-longer streaming. Called once the
    /// SSE stream has terminated cleanly OR an error happens mid-stream.
    func markAssistantComplete(key: String, index: Int) {
        if var bucket = messages[key], index < bucket.count {
            bucket[index].isStreaming = false
            messages[key] = bucket
        }
        isStreaming[key] = false
    }

    /// Stash an error string the UI can render. Cleared on next send.
    func setError(key: String, message: String?) {
        if let message {
            lastError[key] = message
        } else {
            lastError.removeValue(forKey: key)
        }
    }

    /// Drop every bucket. Used by sign-out so a late SSE chunk can't
    /// repopulate the buffer after the SwiftData wipe.
    func clear() {
        messages = [:]
        isStreaming = [:]
        lastError = [:]
    }

    /// Internal helper for `cancelAll()`-style flows: flip every per-key
    /// streaming flag to false without touching messages or lastError.
    func clearStreamingFlags() {
        for key in isStreaming.keys { isStreaming[key] = false }
    }

    #if DEBUG
    /// Test-only: set the streaming flag for a key directly. Used by
    /// `ChatStore.injectForTesting(...)` to seed a streaming bubble
    /// without driving the network pipeline.
    func injectStreamingFlag(key: String, value: Bool) {
        isStreaming[key] = value
    }
    #endif
}

// MARK: - View model

struct ChatMessage: Identifiable, Equatable {
    enum Role: String {
        case user
        case brett
        case assistant
        case system
    }

    let id: String
    let role: Role
    var content: String
    var isStreaming: Bool
    let createdAt: Date
}
