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
final class ChatStore {
    /// Messages in the current UI, keyed by itemId or eventId. These are
    /// NOT the persisted `BrettMessage` rows — they're the live view model
    /// that lets streaming deltas mutate without fighting SwiftData.
    var messages: [String: [ChatMessage]] = [:]

    /// True while we're streaming a response into `messages[key]`.
    var isStreaming: [String: Bool] = [:]

    /// Last error for each key, if any. Cleared on next successful send.
    var lastError: [String: String] = [:]

    private let apiClient: APIClient
    private let session: URLSession
    private let persistence: PersistenceController?

    /// In-flight streaming tasks keyed by chat key. Tracked so
    /// `cancelAll()` can tear them down synchronously on sign-out —
    /// without this, a stream that's mid-flight when the user signs out
    /// can land its final `persistAssistant` on the new user's context.
    /// See `ActiveSession.tearDown()`.
    @ObservationIgnored private var activeStreams: [String: Task<Void, Never>] = [:]

    init(
        apiClient: APIClient = .shared,
        session: URLSession = ChatStore.makeStreamingSession(),
        persistence: PersistenceController? = .shared
    ) {
        self.apiClient = apiClient
        self.session = session
        self.persistence = persistence
        ChatStoreRegistry.register(self)
    }

    // No explicit deinit: the registry holds weak refs and compacts on
    // every `register()` call, so dead slots never accumulate. A deinit
    // that touched the registry would need to hop to the main actor
    // (because ChatStore is @MainActor), which Swift 6 rejects for
    // synchronous nonisolated deinit contexts.

    /// Build a URLSession tuned for SSE streaming. The default
    /// `URLSession.shared` aggressively buffers responses on iOS — chunks
    /// arrive in big bursts (or never) for `text/event-stream` traffic
    /// over LAN HTTP. A dedicated configuration with a long resource
    /// timeout + disabled cookie/cache machinery streams reliably.
    private static func makeStreamingSession() -> URLSession {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 120         // wait up to 2 min for FIRST byte
        cfg.timeoutIntervalForResource = 600        // total stream lifetime cap
        cfg.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        cfg.urlCache = nil
        cfg.httpCookieStorage = nil
        cfg.httpShouldUsePipelining = false
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }

    // MARK: - Public API

    /// Seed the store with already-persisted messages for a scope. Called
    /// once by the detail view on appear so the user sees prior history.
    func hydrate(itemId: String, from messages: [BrettMessage]) {
        let sorted = messages.sorted(by: { $0.createdAt < $1.createdAt })
        self.messages[itemId] = sorted.map { message in
            ChatMessage(
                id: message.id,
                role: ChatMessage.Role(rawValue: message.role) ?? .brett,
                content: message.content,
                isStreaming: false,
                createdAt: message.createdAt
            )
        }
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
        self.messages[itemId] = sorted.map { message in
            ChatMessage(
                id: message.id,
                role: ChatMessage.Role(rawValue: message.role) ?? .brett,
                content: message.content,
                isStreaming: false,
                createdAt: message.createdAt
            )
        }
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

        appendUser(key: key, content: trimmed)
        let assistantIndex = beginAssistant(key: key)

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

        appendUser(key: key, content: trimmed)
        let assistantIndex = beginAssistant(key: key)

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
        for key in isStreaming.keys { isStreaming[key] = false }
    }

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
        isStreaming[key] = true
        lastError[key] = nil
        defer { isStreaming[key] = false }

        guard let url = URL(string: apiClient.baseURL.absoluteString + path) else {
            lastError[key] = "Invalid URL"
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let token = apiClient.tokenProvider?(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            #if DEBUG
            print("[ChatStore] POST \(url) — opening stream")
            #endif
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else {
                lastError[key] = "Chat request returned a non-HTTP response"
                markAssistantComplete(key: key, index: assistantIndex)
                return
            }
            guard (200...299).contains(http.statusCode) else {
                #if DEBUG
                print("[ChatStore] HTTP \(http.statusCode) — abandoning stream")
                #endif
                // Try to read whatever JSON the server returned so the
                // user gets a useful message instead of "Chat request
                // failed". Particularly important for 403 (no AI key)
                // and 429 (rate limit). Drained via a manual for-await
                // loop because `AsyncSequence.reduce(into:)` takes a
                // non-`@Sendable` closure that Swift 6 strict
                // concurrency rejects in this `Task`-isolated context.
                var bodyData = Data()
                if let drained = try? await drainBytes(from: bytes) {
                    bodyData = drained
                }
                let bodyText = String(data: bodyData, encoding: .utf8) ?? ""
                if let json = bodyText.data(using: .utf8).flatMap({ try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any],
                   let msg = json["message"] as? String {
                    lastError[key] = msg
                } else {
                    lastError[key] = "Chat request failed (HTTP \(http.statusCode))"
                }
                markAssistantComplete(key: key, index: assistantIndex)
                return
            }

            #if DEBUG
            print("[ChatStore] HTTP 200 — streaming…")
            // Reference-type counter so the @Sendable closure passed to
            // parseSSE can mutate it under Swift 6 strict concurrency.
            // (parseSSE invokes the closure sequentially per line, but
            // the compiler can't prove that — the box keeps the data race
            // checker happy without us pulling in an actor.)
            let chunkCount = ChunkBox()
            #endif

            try await Self.parseSSE(lines: bytes.lines) { [weak self] event in
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
                markAssistantComplete(key: key, index: assistantIndex)
                if final.content.isEmpty {
                    // Stream finished but produced nothing. Keeping a
                    // blank assistant bubble is a worse failure than
                    // surfacing what happened — leave a soft message so
                    // the user knows to retry.
                    lastError[key] = lastError[key] ?? "No response — try again."
                } else {
                    persistAssistant(
                        content: final.content,
                        itemId: itemId,
                        calendarEventId: calendarEventId,
                        userId: userId
                    )
                    // Invalidate cached history so the next detail-view
                    // open re-fetches from the server (which now holds
                    // the messages we just streamed). Detached because
                    // `RemoteCache` is an actor and we don't want to
                    // block the stream-completion path on it.
                    Task.detached {
                        await RemoteCache.shared.invalidateChatHistory(
                            itemId: itemId,
                            eventId: calendarEventId
                        )
                    }
                }
            }
        } catch {
            #if DEBUG
            print("[ChatStore] stream error: \(error)")
            #endif
            lastError[key] = (error as? APIError)?.userFacingMessage ?? error.localizedDescription
            markAssistantComplete(key: key, index: assistantIndex)
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
                appendAssistantDelta(key: key, index: assistantIndex, delta: text)
            } else if type == "tool_result", let msg = json["message"] as? String {
                // Tool-result messages get appended too so the UI reflects
                // whatever Brett found. Matches desktop behaviour.
                appendAssistantDelta(key: key, index: assistantIndex, delta: msg + "\n")
            } else if type == "error", let msg = json["message"] as? String {
                lastError[key] = msg
            }
        case .done:
            // Server signals the stream is finished; no-op here — the outer
            // `stream` function handles finalisation after the bytes loop
            // terminates.
            break
        case .error(let message):
            lastError[key] = message
        }
    }

    // MARK: - Message ops

    private func appendUser(key: String, content: String) {
        var bucket = messages[key] ?? []
        bucket.append(
            ChatMessage(
                id: UUID().uuidString,
                role: .user,
                content: content,
                isStreaming: false,
                createdAt: Date()
            )
        )
        messages[key] = bucket
    }

    private func beginAssistant(key: String) -> Int {
        var bucket = messages[key] ?? []
        bucket.append(
            ChatMessage(
                id: UUID().uuidString,
                role: .brett,
                content: "",
                isStreaming: true,
                createdAt: Date()
            )
        )
        messages[key] = bucket
        return bucket.count - 1
    }

    private func appendAssistantDelta(key: String, index: Int, delta: String) {
        guard var bucket = messages[key], index < bucket.count else { return }
        bucket[index].content += delta
        messages[key] = bucket
    }

    private func markAssistantComplete(key: String, index: Int) {
        guard var bucket = messages[key], index < bucket.count else { return }
        bucket[index].isStreaming = false
        messages[key] = bucket
    }

    // MARK: - SwiftData persistence

    /// Persist the final assistant message. `userId` is captured by the
    /// caller (`send(...)`) at the top of the turn and plumbed through —
    /// we never re-derive it inside the persistence path, because between
    /// the send and the stream's end the user might have signed out, a new
    /// `UserProfile` row might have landed from a pull, and a late-arriving
    /// assistant chunk could otherwise be tagged with the wrong owner.
    ///
    /// If `userId` is nil (the caller signed out mid-stream), we skip the
    /// write entirely — there's no authenticated owner to attribute the
    /// message to, and the cancellation in `ActiveSession.tearDown()`
    /// should have short-circuited this path anyway.
    private func persistAssistant(
        content: String,
        itemId: String?,
        calendarEventId: String?,
        userId: String?
    ) {
        guard !content.trimmingCharacters(in: .whitespaces).isEmpty,
              let persistence else { return }
        guard let userId, !userId.isEmpty else {
            BrettLog.store.info("ChatStore: dropped assistant persist — no authenticated userId")
            return
        }
        let context = persistence.mainContext

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
        do {
            try context.save()
        } catch {
            BrettLog.store.error("ChatStore persistAssistant save failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Drain an `URLSession.AsyncBytes` sequence into a `Data` buffer.
    /// Used to read the body of error responses (4xx/5xx) so we can
    /// surface the server's message text to the user. The manual
    /// for-await loop avoids `AsyncSequence.reduce`'s non-`@Sendable`
    /// closure parameter, which Swift 6 won't let us pass from a
    /// `Task`-isolated context.
    private func drainBytes(from bytes: URLSession.AsyncBytes) async throws -> Data {
        var buffer = Data()
        for try await byte in bytes {
            buffer.append(byte)
        }
        return buffer
    }

    // MARK: - SSE parser (internal so tests can exercise it)

    enum StreamEvent: Equatable {
        case chunk(String)
        case done(String?)
        case error(String)
    }

    static func parseSSE<S: AsyncSequence>(
        lines: S,
        onEvent: @Sendable @escaping (StreamEvent) async -> Void
    ) async throws where S.Element == String {
        var currentEvent: String?
        var dataBuffer: String = ""

        for try await line in lines {
            if line.isEmpty {
                // Blank line → dispatch.
                if let event = currentEvent {
                    switch event {
                    case "chunk":
                        await onEvent(.chunk(dataBuffer))
                    case "done":
                        await onEvent(.done(dataBuffer.isEmpty ? nil : dataBuffer))
                    case "error":
                        let message = extractErrorMessage(from: dataBuffer)
                        await onEvent(.error(message))
                    default:
                        break
                    }
                }
                currentEvent = nil
                dataBuffer = ""
                continue
            }

            if line.hasPrefix(":") { continue }

            if line.hasPrefix("event:") {
                currentEvent = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                let value = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                if dataBuffer.isEmpty {
                    dataBuffer = String(value)
                } else {
                    dataBuffer += "\n" + value
                }
            }
        }

        // Tail — if the stream ends without a blank-line terminator, flush.
        if let event = currentEvent, !dataBuffer.isEmpty {
            switch event {
            case "chunk": await onEvent(.chunk(dataBuffer))
            case "done": await onEvent(.done(dataBuffer))
            case "error": await onEvent(.error(extractErrorMessage(from: dataBuffer)))
            default: break
            }
        }
    }

    private static func extractErrorMessage(from data: String) -> String {
        guard
            let bytes = data.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            let message = json["message"] as? String
        else {
            return "Something went wrong."
        }
        return message
    }
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
