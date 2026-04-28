import Foundation
import Observation
import SwiftData

/// In-memory conductor for the Brett chat SSE stream on a single item or
/// calendar event.
///
/// Responsibilities:
///  - Holds per-item conversation state keyed by `itemId` / `eventId`.
///  - Appends a provisional user message immediately, then opens a streaming
///    POST to `/brett/chat/:itemId` (or `/brett/chat/event/:eventId`).
///  - Parses the SSE wire format (`event: chunk`, `event: done`, `event: error`)
///    off a raw `URLSession.bytes(for:)` response — same format as
///    `SSEClient.parse` but with one-shot lifecycle instead of reconnect.
///  - Appends text deltas into the trailing assistant message as they arrive
///    so the UI sees the response unfold.
///  - On completion, persists the final assistant message to the
///    `BrettMessage` SwiftData table so the message survives app restarts.
///
/// This store is @MainActor because it mutates observable state; the
/// streaming network work runs inside a `Task` but every state write hops
/// back onto the main actor.
@MainActor
@Observable
final class ChatStore: Clearable {
    /// Messages in the current UI, keyed by itemId or eventId. These are
    /// NOT the persisted `BrettMessage` rows — they're the live view model
    /// that lets streaming deltas mutate without fighting SwiftData.
    var messages: [String: [ChatMessage]] { buffer.messages }

    /// True while we're streaming a response into `messages[key]`.
    var isStreaming: [String: Bool] { buffer.isStreaming }

    /// Last error for each key, if any. Cleared on next successful send.
    var lastError: [String: String] { buffer.lastError }

    /// In-memory state + mutation primitives. Owns the per-key
    /// `messages` / `isStreaming` / `lastError` triple. Public properties
    /// above proxy straight through so callers don't need to change.
    private let buffer = ChatMessageBuffer()

    private let apiClient: APIClient
    private let persistence: PersistenceController?

    /// SwiftData write path for finalised assistant messages.
    /// Built from `persistence?.mainContext` (or the shared default) at
    /// init so the streaming finaliser doesn't re-derive context per call.
    private let persister: ChatPersister

    /// SSE transport — owns the URLSession + parser. ChatStore is now
    /// purely the orchestrator: open a stream, route events into the
    /// buffer, persist on completion.
    private let streaming: StreamingChatClient

    /// In-flight streaming tasks keyed by chat key. Tracked so
    /// `cancelAll()` can tear them down synchronously on sign-out —
    /// without this, a stream that's mid-flight when the user signs out
    /// can land its final `persistAssistant` on the new user's context.
    /// See `ActiveSession.tearDown()`.
    @ObservationIgnored private var activeStreams: [String: Task<Void, Never>] = [:]

    init(
        apiClient: APIClient = .shared,
        session: URLSession = StreamingChatClient.makeStreamingSession(),
        persistence: PersistenceController? = .shared
    ) {
        self.apiClient = apiClient
        self.persistence = persistence
        self.persister = ChatPersister(
            context: (persistence ?? PersistenceController.shared).mainContext
        )
        self.streaming = StreamingChatClient(apiClient: apiClient, session: session)
        ChatStoreRegistry.register(self)
        ClearableStoreRegistry.register(self)
    }

    // No explicit deinit: the registry holds weak refs and compacts on
    // every `register()` call, so dead slots never accumulate. A deinit
    // that touched the registry would need to hop to the main actor
    // (because ChatStore is @MainActor), which Swift 6 rejects for
    // synchronous nonisolated deinit contexts.

    // MARK: - Public API

    /// Seed the store with already-persisted messages for a scope. Called
    /// once by the detail view on appear so the user sees prior history.
    func hydrate(itemId: String, from messages: [BrettMessage]) {
        let sorted = messages.sorted(by: { $0.createdAt < $1.createdAt })
        let chatMessages = sorted.map { message in
            ChatMessage(
                id: message.id,
                role: ChatMessage.Role(rawValue: message.role) ?? .brett,
                content: message.content,
                isStreaming: false,
                createdAt: message.createdAt
            )
        }
        buffer.setMessages(key: itemId, messages: chatMessages)
    }

    /// Seed from server-fetched chat history. The server returns messages in
    /// `createdAt DESC` order (newest first); we sort ascending here so the
    /// rendered panel reads top-down chronologically. We replace any
    /// previously-hydrated bucket entirely — this is called after the local
    /// hydrate runs, so the server view authoritatively wins. Streaming
    /// bubbles in flight are blown away if they overlap, but in practice
    /// the user can't open a thread mid-stream without first finishing it.
    func hydrate(itemId: String, from messages: [APIClient.ChatHistoryMessage]) {
        let sorted = messages.sorted(by: { $0.createdAt < $1.createdAt })
        let chatMessages = sorted.map { message in
            ChatMessage(
                id: message.id,
                role: ChatMessage.Role(rawValue: message.role) ?? .brett,
                content: message.content,
                isStreaming: false,
                createdAt: message.createdAt
            )
        }
        buffer.setMessages(key: itemId, messages: chatMessages)
    }

    /// Same as `hydrate(itemId:from:)` but for an event chat thread.
    /// Separate keying so the same server method can drive both paths.
    func hydrateEvent(eventId: String, from messages: [APIClient.ChatHistoryMessage]) {
        hydrate(itemId: eventId, from: messages)
    }

    /// POST `/brett/chat/:itemId` with `message`; append deltas into a
    /// trailing assistant bubble. Throws only on pre-flight failures (bad
    /// URL, missing auth); network errors are swallowed into `lastError`
    /// so the UI can render a soft banner.
    ///
    /// `userId` is captured here and plumbed all the way through to
    /// `persistAssistant` so the final row is written with the caller's
    /// authenticated id — never re-derived mid-stream from a potentially
    /// swapped `UserProfile` row.
    func send(itemId: String, message: String, userId: String?) async {
        let key = itemId
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        buffer.appendUser(key: key, content: trimmed)
        let assistantIndex = buffer.beginAssistant(key: key)

        await runTrackedStream(key: key) { [weak self] in
            await self?.stream(
                path: "/brett/chat/\(itemId)",
                body: ["message": trimmed],
                key: key,
                assistantIndex: assistantIndex,
                itemId: itemId,
                calendarEventId: nil,
                userId: userId
            )
        }
    }

    /// POST `/brett/chat/event/:eventId` — parallel method for Calendar.
    /// Kept here rather than forking a separate store so both UIs share the
    /// same streaming machinery.
    func send(eventId: String, message: String, userId: String?) async {
        let key = eventId
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        buffer.appendUser(key: key, content: trimmed)
        let assistantIndex = buffer.beginAssistant(key: key)

        await runTrackedStream(key: key) { [weak self] in
            await self?.stream(
                path: "/brett/chat/event/\(eventId)",
                body: ["message": trimmed],
                key: key,
                assistantIndex: assistantIndex,
                itemId: nil,
                calendarEventId: eventId,
                userId: userId
            )
        }
    }

    /// Cancel every in-flight chat stream. Called from `ActiveSession.tearDown()`
    /// so a stream that's mid-response when the user signs out can't land its
    /// final `persistAssistant` against the *next* user's context.
    func cancelAll() {
        for (_, task) in activeStreams {
            task.cancel()
        }
        activeStreams.removeAll()
        buffer.clearStreamingFlags()
    }

    // MARK: - Clearable

    /// Sign-out hook. Cancels every in-flight stream (same machinery as the
    /// existing `cancelAll()`) and drops the in-memory message buffers so a
    /// late SSE chunk can't repopulate them after the SwiftData wipe. The
    /// per-key `isStreaming` flags are reset by `cancelAll()`; we also blow
    /// away `lastError` so a stale banner from the prior session doesn't
    /// flash on the next user's first chat open.
    func clearForSignOut() {
        cancelAll()
        buffer.clear()
    }

    #if DEBUG
    /// Test-only: seed in-memory chat state without driving the streaming
    /// pipeline. Only the keys passed here are written; existing keys are
    /// untouched (mirrors `injectForTesting` shape on other stores).
    func injectForTesting(
        messages: [String: [ChatMessage]]? = nil,
        isStreaming: [String: Bool]? = nil,
        lastError: [String: String]? = nil
    ) {
        if let messages {
            for (k, v) in messages { buffer.setMessages(key: k, messages: v) }
        }
        if let isStreaming {
            for (k, v) in isStreaming { buffer.injectStreamingFlag(key: k, value: v) }
        }
        if let lastError {
            for (k, v) in lastError { buffer.setError(key: k, message: v) }
        }
    }
    #endif

    /// Wrap a stream launch so the inner Task is tracked in `activeStreams`
    /// and removed on completion. The caller `await`s the wrapped Task, so
    /// normal suspension semantics are preserved — the tracking is transparent.
    private func runTrackedStream(
        key: String,
        _ body: @escaping @Sendable () async -> Void
    ) async {
        let task = Task { await body() }
        activeStreams[key] = task
        await task.value
        activeStreams.removeValue(forKey: key)
    }

    // MARK: - Streaming core

    private func stream(
        path: String,
        body: [String: Any],
        key: String,
        assistantIndex: Int,
        itemId: String?,
        calendarEventId: String?,
        userId: String?
    ) async {
        buffer.setError(key: key, message: nil)

        do {
            #if DEBUG
            print("[ChatStore] POST \(path) — opening stream")
            // Reference-type counter so the @Sendable closure passed to
            // the streaming parser can mutate it under Swift 6 strict
            // concurrency. The parser invokes the closure sequentially
            // per line, but the compiler can't prove that — the box keeps
            // the data race checker happy without pulling in an actor.
            let chunkCount = ChunkBox()
            #endif

            try await streaming.stream(path: path, body: body) { [weak self] event in
                guard let self else { return }
                #if DEBUG
                if case .chunk = event { chunkCount.increment() }
                #endif
                await MainActor.run {
                    self.handle(event: event, key: key, assistantIndex: assistantIndex)
                }
            }

            #if DEBUG
            print("[ChatStore] stream closed after \(chunkCount.value) chunks")
            #endif

            // Finalise: persist the assistant text to BrettMessage + mark
            // the UI bubble as no-longer streaming.
            if let final = messages[key]?[safe: assistantIndex] {
                buffer.markAssistantComplete(key: key, index: assistantIndex)
                if final.content.isEmpty {
                    // Stream finished but produced nothing. Keeping a
                    // blank assistant bubble is a worse failure than
                    // surfacing what happened — leave a soft message so
                    // the user knows to retry.
                    if lastError[key] == nil {
                        buffer.setError(key: key, message: "No response — try again.")
                    }
                } else {
                    do {
                        try persister.persistAssistant(
                            content: final.content,
                            itemId: itemId,
                            calendarEventId: calendarEventId,
                            userId: userId
                        )
                    } catch {
                        BrettLog.store.error("ChatStore persistAssistant failed: \(String(describing: error), privacy: .public)")
                    }
                    // Invalidate cached history so the next detail-view
                    // open re-fetches from the server (which now holds
                    // the messages we just streamed). Awaited inline —
                    // a detached Task here would yield, allowing a new
                    // detail-view open to read the still-cached stale
                    // entry between persistAssistant and the eviction.
                    // The actor hop is cheap (one suspension) and we're
                    // already inside a Task on the streaming path, so
                    // there's nothing meaningful to "block."
                    await RemoteCache.shared.invalidateChatHistory(
                        itemId: itemId,
                        eventId: calendarEventId
                    )
                }
            } else {
                // Defensive: if the bucket vanished mid-stream (e.g. a
                // sign-out clear) make sure the streaming flag clears.
                buffer.markAssistantComplete(key: key, index: assistantIndex)
            }
        } catch let streamingError as StreamingChatError {
            #if DEBUG
            print("[ChatStore] stream error: \(streamingError)")
            #endif
            buffer.setError(key: key, message: streamingError.errorDescription ?? "Chat request failed")
            buffer.markAssistantComplete(key: key, index: assistantIndex)
        } catch {
            #if DEBUG
            print("[ChatStore] stream error: \(error)")
            #endif
            let message = (error as? APIError)?.userFacingMessage ?? error.localizedDescription
            buffer.setError(key: key, message: message)
            buffer.markAssistantComplete(key: key, index: assistantIndex)
        }
    }

    // MARK: - Event handling

    private func handle(event: StreamEvent, key: String, assistantIndex: Int) {
        switch event {
        case .chunk(let data):
            guard
                let json = try? JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any],
                let type = json["type"] as? String
            else { return }

            if type == "text", let text = json["content"] as? String {
                buffer.appendAssistantDelta(key: key, index: assistantIndex, delta: text)
            } else if type == "tool_result", let msg = json["message"] as? String {
                // Tool-result messages get appended too so the UI reflects
                // whatever Brett found. Matches desktop behaviour.
                buffer.appendAssistantDelta(key: key, index: assistantIndex, delta: msg + "\n")
            } else if type == "error", let msg = json["message"] as? String {
                buffer.setError(key: key, message: msg)
            }
        case .done:
            // Server signals the stream is finished; no-op here — the outer
            // `stream` function handles finalisation after the bytes loop
            // terminates.
            break
        case .error(let message):
            buffer.setError(key: key, message: message)
        }
    }
}

// MARK: - Array safe subscript

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

#if DEBUG
/// Reference-type counter for use inside `@Sendable` closures under Swift
/// 6 strict concurrency. Mutating a `var Int` from a sendable closure is
/// rejected because the compiler can't prove sequential access; boxing
/// the count in a class side-steps that without forcing us to pull in an
/// actor or `Atomics`. Only used in DEBUG (chunk-count log line).
private final class ChunkBox: @unchecked Sendable {
    private(set) var value: Int = 0
    func increment() { value += 1 }
}
#endif

// MARK: - Registry

/// Weak-reference registry of live `ChatStore` instances. Lets
/// `ActiveSession.tearDown()` cancel every in-flight chat stream in the
/// process without introducing a singleton or plumbing a reference
/// through every view that hosts a chat.
///
/// Why a registry instead of a singleton: chat state is per-view
/// (`@State private var chatStore = ChatStore()` in `TaskDetailView`),
/// so there may be several concurrent stores at once. The registry
/// fans the cancellation out to all of them.
@MainActor
enum ChatStoreRegistry {
    /// Weak-box wrapper so stores can be registered without pinning them
    /// in memory past their view's lifetime. The registry is itself
    /// main-actor-isolated, so no locking is required.
    private final class WeakRef {
        weak var store: ChatStore?
        init(_ store: ChatStore) { self.store = store }
    }

    private static var refs: [WeakRef] = []

    static func register(_ store: ChatStore) {
        // Opportunistic compact: drop empty weak boxes while we're here.
        refs.removeAll { $0.store == nil }
        refs.append(WeakRef(store))
    }

    /// Cancel every in-flight stream across all live `ChatStore`s.
    /// Called from `ActiveSession.tearDown()` before SwiftData is wiped
    /// so no stream can land `persistAssistant` on the next user's rows.
    static func cancelAllActive() {
        for ref in refs {
            ref.store?.cancelAll()
        }
    }
}
