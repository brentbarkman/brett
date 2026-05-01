import Foundation

/// One typed event emitted by `StreamingChatClient` during an SSE stream.
///
/// Lifted out of `ChatStore` so the streaming surface is testable in
/// isolation. Same wire shape — `event: chunk` / `event: done` /
/// `event: error` — as the original parser, so existing servers and
/// callers continue to work.
enum StreamEvent: Equatable {
    case chunk(String)
    case done(String?)
    case error(String)
}

/// SSE transport for the Brett chat endpoints (`/brett/chat/:itemId` and
/// `/brett/chat/event/:eventId`).
///
/// Owns:
///  - The URLSession tuned for long-running `text/event-stream` reads.
///  - Request construction (POST + JSON body + bearer token via
///    `APIClient.tokenProvider`).
///  - The line-by-line SSE parser that turns raw bytes into `StreamEvent`s.
///  - HTTP error draining: on a non-2xx response we read the body so the
///    caller can surface the server's `message` rather than a generic
///    "Chat request failed" string.
///
/// Does NOT own:
///  - Any in-memory chat state — that's `ChatMessageBuffer`.
///  - SwiftData persistence — that's `ChatPersister`.
///  - Tracking in-flight `Task`s (cancel-on-sign-out is `ChatStore`'s job
///    via `activeStreams`).
///
/// The `stream(...)` method returns once the SSE stream has fully drained
/// (or thrown). The caller orchestrates user-bubble append, assistant-
/// bubble begin, persistence, and cache invalidation.
@MainActor
struct StreamingChatClient {
    private let apiClient: APIClient
    private let session: URLSession

    init(apiClient: APIClient, session: URLSession) {
        self.apiClient = apiClient
        self.session = session
    }

    /// Build a URLSession tuned for SSE streaming. The default
    /// `URLSession.shared` aggressively buffers responses on iOS — chunks
    /// arrive in big bursts (or never) for `text/event-stream` traffic
    /// over LAN HTTP. A dedicated configuration with a long resource
    /// timeout + disabled cookie/cache machinery streams reliably.
    static func makeStreamingSession() -> URLSession {
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

    // MARK: - Streaming entry point

    /// Open a streaming POST to `path` with the given JSON `body` and
    /// invoke `onEvent` for every parsed `StreamEvent`. Returns once the
    /// stream is drained; throws on transport failure.
    ///
    /// Surfaces a `StreamingChatError` on a non-2xx response with the
    /// server's body parsed in (preferring its `message` field) so the
    /// caller can show a meaningful error.
    func stream(
        path: String,
        body: [String: Any],
        onEvent: @Sendable @escaping (StreamEvent) async -> Void
    ) async throws {
        guard let url = URL(string: apiClient.baseURL.absoluteString + path) else {
            throw StreamingChatError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let token = apiClient.tokenProvider?(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw StreamingChatError.nonHTTPResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let drained = (try? await Self.drainBytes(from: bytes)) ?? Data()
            let message = Self.drainErrorMessage(from: drained)
            throw StreamingChatError.httpError(status: http.statusCode, message: message)
        }

        try await Self.parse(lines: bytes.lines, onEvent: onEvent)
    }

    // MARK: - SSE parser (async streaming form)

    /// Async-streaming line parser. Drives `onEvent` for every well-formed
    /// SSE event in the line stream. Mirrors the historical
    /// `ChatStore.parseSSE` shape so tests that drove the parser through
    /// `ChatStore.parseSSE` can retarget here.
    static func parse<S: AsyncSequence>(
        lines: S,
        onEvent: @Sendable @escaping (StreamEvent) async -> Void
    ) async throws where S.Element == String {
        var currentEvent: String?
        var dataBuffer: String = ""

        for try await line in lines {
            if line.isEmpty {
                if let event = currentEvent, let parsed = makeEvent(name: event, data: dataBuffer) {
                    await onEvent(parsed)
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
        if let event = currentEvent, !dataBuffer.isEmpty,
           let parsed = makeEvent(name: event, data: dataBuffer) {
            await onEvent(parsed)
        }
    }

    /// Synchronous parser for a single SSE event represented as an array of
    /// raw lines (e.g. `["event: chunk", "data: {...}"]`). Returns nil if
    /// the lines don't form a valid event. Exposed primarily so unit tests
    /// can exercise the parser without standing up an async sequence.
    static func parseEvent(lines: [String]) -> StreamEvent? {
        var currentEvent: String?
        var dataBuffer: String = ""

        for line in lines {
            if line.isEmpty || line.hasPrefix(":") { continue }
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

        guard let name = currentEvent else { return nil }
        return makeEvent(name: name, data: dataBuffer)
    }

    /// Common event-name dispatch shared by the async + sync parser paths.
    /// `nil` for unrecognised event names (mirrors the historical parser
    /// which silently dropped `default`-case events).
    private static func makeEvent(name: String, data: String) -> StreamEvent? {
        switch name {
        case "chunk":
            return .chunk(data)
        case "done":
            return .done(data.isEmpty ? nil : data)
        case "error":
            return .error(drainErrorMessage(fromString: data))
        default:
            return nil
        }
    }

    // MARK: - Error/body helpers

    /// Drain an `URLSession.AsyncBytes` sequence into a `Data` buffer.
    /// Used to read the body of error responses (4xx/5xx) so we can
    /// surface the server's message text to the user. The manual
    /// for-await loop avoids `AsyncSequence.reduce`'s non-`@Sendable`
    /// closure parameter, which Swift 6 won't let us pass from a
    /// `Task`-isolated context.
    static func drainBytes(from bytes: URLSession.AsyncBytes) async throws -> Data {
        var buffer = Data()
        for try await byte in bytes {
            buffer.append(byte)
        }
        return buffer
    }

    /// Pull a `message` field out of a JSON error body. Falls back to a
    /// generic string if the body isn't JSON or the key is missing.
    static func drainErrorMessage(from data: Data) -> String {
        guard let text = String(data: data, encoding: .utf8) else {
            return "Something went wrong."
        }
        return drainErrorMessage(fromString: text)
    }

    /// Same as `drainErrorMessage(from:)` but takes a string directly —
    /// used by the SSE `error` event path where the data is already
    /// decoded as text.
    static func drainErrorMessage(fromString text: String) -> String {
        guard
            let bytes = text.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            let message = json["message"] as? String
        else {
            return "Something went wrong."
        }
        return message
    }
}

/// Errors thrown out of `StreamingChatClient.stream(...)`.
///
/// The orchestrator (`ChatStore.stream(...)`) translates these into user-
/// facing `lastError` strings. Kept as a typed error so a `case let` in
/// the catch can branch on transport vs. server-side failures without
/// matching `localizedDescription` strings.
enum StreamingChatError: Error, LocalizedError {
    case invalidURL
    case nonHTTPResponse
    case httpError(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .nonHTTPResponse:
            return "Chat request returned a non-HTTP response"
        case .httpError(let status, let message):
            if message.isEmpty || message == "Something went wrong." {
                return "Chat request failed (HTTP \(status))"
            }
            return message
        }
    }
}
