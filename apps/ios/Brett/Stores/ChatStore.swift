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

    init(
        apiClient: APIClient = .shared,
        session: URLSession = .shared,
        persistence: PersistenceController? = .shared
    ) {
        self.apiClient = apiClient
        self.session = session
        self.persistence = persistence
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

    /// POST `/brett/chat/:itemId` with `message`; append deltas into a
    /// trailing assistant bubble. Throws only on pre-flight failures (bad
    /// URL, missing auth); network errors are swallowed into `lastError`
    /// so the UI can render a soft banner.
    func send(itemId: String, message: String) async {
        let key = itemId
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        appendUser(key: key, content: trimmed)
        let assistantIndex = beginAssistant(key: key)

        await stream(
            path: "/brett/chat/\(itemId)",
            body: ["message": trimmed],
            key: key,
            assistantIndex: assistantIndex,
            itemId: itemId,
            calendarEventId: nil
        )
    }

    /// POST `/brett/chat/event/:eventId` — parallel method for Calendar.
    /// Kept here rather than forking a separate store so both UIs share the
    /// same streaming machinery.
    func send(eventId: String, message: String) async {
        let key = eventId
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        appendUser(key: key, content: trimmed)
        let assistantIndex = beginAssistant(key: key)

        await stream(
            path: "/brett/chat/event/\(eventId)",
            body: ["message": trimmed],
            key: key,
            assistantIndex: assistantIndex,
            itemId: nil,
            calendarEventId: eventId
        )
    }

    // MARK: - Streaming core

    private func stream(
        path: String,
        body: [String: Any],
        key: String,
        assistantIndex: Int,
        itemId: String?,
        calendarEventId: String?
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
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                lastError[key] = "Chat request failed"
                return
            }

            try await Self.parseSSE(lines: bytes.lines) { [weak self] event in
                guard let self else { return }
                await MainActor.run {
                    self.handle(event: event, key: key, assistantIndex: assistantIndex)
                }
            }

            // Finalise: persist the assistant text to BrettMessage + mark
            // the UI bubble as no-longer streaming.
            if let final = messages[key]?[safe: assistantIndex] {
                markAssistantComplete(key: key, index: assistantIndex)
                persistAssistant(
                    content: final.content,
                    itemId: itemId,
                    calendarEventId: calendarEventId
                )
            }
        } catch {
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

    private func persistAssistant(
        content: String,
        itemId: String?,
        calendarEventId: String?
    ) {
        guard !content.trimmingCharacters(in: .whitespaces).isEmpty,
              let persistence else { return }
        let context = persistence.mainContext

        // UserId: we can lift it from UserProfile if one is present.
        var userId = ""
        if let profile = (try? context.fetch(FetchDescriptor<UserProfile>()))?.first {
            userId = profile.id
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
        try? context.save()
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
