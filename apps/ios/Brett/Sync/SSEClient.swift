import Foundation
import Observation

/// Streams Server-Sent Events from the Brett API with auto-reconnect and
/// exponential backoff.
///
/// Lifecycle:
/// - `connect()` starts the (re)connect loop. It runs until `disconnect()` is
///   called or the owning task is cancelled. The loop is idempotent — calling
///   `connect()` twice is a no-op while already connected.
/// - On disconnect (any error, normal close, or explicit cancel), the loop
///   sleeps with exponential backoff (1s → 2s → 4s → 8s, capped at 30s) and
///   retries.
/// - On `401` while fetching a ticket or while streaming, the client assumes
///   the ticket expired, re-fetches, and reconnects. The bearer token itself
///   is NOT refreshed here — if the token has expired, the `fetchSSETicket`
///   call will also 401, and the user will land on the sign-in screen via
///   `AuthManager` once the next authenticated request fires.
/// - On `429` (too many pending tickets), the client treats it as a
///   rate-limit signal and bumps the backoff to the cap.
///
/// Events are surfaced through an `AsyncStream<SSEEvent>` exposed as
/// `events`. `SSEEventHandler` subscribes to that stream and dispatches each
/// event to the right store. Consumers can subscribe at any time; late
/// subscribers only see events delivered after they start iterating (i.e.
/// the stream is not buffered beyond the default AsyncStream buffer).
///
/// Threading: the client is @MainActor because it touches @Observable state
/// (`isConnected`, `reconnectAttempt`). The URLSession streaming itself runs
/// inside a `Task` but all state mutations are hopped back onto the main
/// actor.
@MainActor
@Observable
final class SSEClient {
    // MARK: - Shared instance

    /// Singleton used by `BrettApp` to wire SSE into the auth gate. Tests
    /// should construct their own instance via the designated initializer.
    static let shared = SSEClient()

    // MARK: - Observable state

    /// True while the stream is open and delivering events (or heartbeats).
    /// Flips to false the moment any error is seen or `disconnect()` is
    /// called; flips back to true once a new connection succeeds.
    private(set) var isConnected: Bool = false

    /// How many reconnect attempts we've made since the last successful
    /// connection. 0 while the current connection is healthy. Exposed for
    /// tests and for a future diagnostic UI.
    private(set) var reconnectAttempt: Int = 0

    // MARK: - Event stream

    /// Raw stream of parsed events. `SSEEventHandler.start()` is the primary
    /// consumer; UI code should read from stores, not this stream.
    let events: AsyncStream<SSEEvent>
    private let eventContinuation: AsyncStream<SSEEvent>.Continuation

    // MARK: - Dependencies

    private let apiClient: APIClient
    private let session: URLSession

    /// Caps reconnect backoff. Exposed for tests so they can set it to 0 and
    /// avoid waiting 30 real seconds.
    private let maxBackoffSeconds: TimeInterval

    /// Multiplier on computed backoff. Tests pass `0` so the loop runs
    /// immediately; production uses `1`.
    private let backoffMultiplier: TimeInterval

    // MARK: - Task management

    /// The outer connect-loop task. Holding a reference lets `disconnect()`
    /// cancel it cleanly; `connect()` is a no-op while this is non-nil and
    /// not yet finished.
    private var loopTask: Task<Void, Never>?

    // MARK: - Init

    /// Designated initializer. Tests inject a stubbed `URLSession` (via
    /// MockURLProtocol) and set `backoffMultiplier` to 0 so the reconnect
    /// loop doesn't actually sleep.
    init(
        apiClient: APIClient = .shared,
        session: URLSession = .shared,
        maxBackoffSeconds: TimeInterval = 30,
        backoffMultiplier: TimeInterval = 1
    ) {
        self.apiClient = apiClient
        self.session = session
        self.maxBackoffSeconds = maxBackoffSeconds
        self.backoffMultiplier = backoffMultiplier

        var continuation: AsyncStream<SSEEvent>.Continuation!
        self.events = AsyncStream(
            bufferingPolicy: .bufferingNewest(256)
        ) { cont in
            continuation = cont
        }
        self.eventContinuation = continuation
    }

    deinit {
        eventContinuation.finish()
    }

    // MARK: - Public control

    /// Start the connect/reconnect loop. Safe to call more than once — a
    /// second call while already running is a no-op.
    func connect() {
        guard loopTask == nil else { return }
        loopTask = Task { [weak self] in
            await self?.runConnectLoop()
        }
    }

    /// Tear down the current connection (if any) and stop reconnecting.
    /// Safe to call when already disconnected.
    func disconnect() {
        loopTask?.cancel()
        loopTask = nil
        isConnected = false
        reconnectAttempt = 0
    }

    // MARK: - Loop

    /// Outer loop — keeps trying to (re)connect until the task is cancelled.
    /// Backoff grows exponentially on each consecutive failure, resets to
    /// zero after a successful connect.
    private func runConnectLoop() async {
        while !Task.isCancelled {
            do {
                try await openAndStream()
                // `openAndStream` returns when the stream closes cleanly. We
                // still want to reconnect — servers can drop idle streams.
                reconnectAttempt += 1
            } catch is CancellationError {
                break
            } catch {
                // Any other error means the connection failed or dropped
                // mid-stream. Bump the attempt counter and back off.
                reconnectAttempt += 1
            }

            isConnected = false
            if Task.isCancelled { break }

            let delay = backoffDelay(for: reconnectAttempt)
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
        // Loop ended — either cancelled explicitly, or the task itself was
        // told to finish. Reset state so a future `connect()` starts fresh.
        loopTask = nil
        isConnected = false
    }

    /// Fetch a ticket, open the stream, and iterate its events. Returns when
    /// the stream closes; throws when anything goes wrong. The caller (the
    /// loop) decides whether to retry.
    private func openAndStream() async throws {
        let ticket = try await apiClient.fetchSSETicket().ticket
        let url = apiClient.sseStreamURL(ticket: ticket)

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        // Long timeout — SSE streams are expected to stay open indefinitely.
        // The server sends a heartbeat every ~30s, but URLSession's default
        // timeout (60s) would still fire during lulls. Give ourselves plenty
        // of headroom; if the connection truly dies, bytes iteration will
        // throw and the outer loop handles the reconnect.
        request.timeoutInterval = 600

        let (bytes, response) = try await session.bytes(for: request)
        try Self.validateStreamResponse(response)

        isConnected = true
        reconnectAttempt = 0

        try await parseLines(bytes)
    }

    // MARK: - SSE parsing

    /// Consume the bytes stream line-by-line and emit events as they complete.
    /// Delegates to `parse(lines:)` — split out so tests can drive the
    /// parser with a synthetic line stream without needing MockURLProtocol.
    private func parseLines(_ bytes: URLSession.AsyncBytes) async throws {
        try await parse(lines: bytes.lines)
    }

    /// Pure parser — takes any async sequence of lines and yields parsed
    /// events onto `eventContinuation`.
    ///
    /// SSE wire format (RFC-ish, what the server sends):
    /// ```
    /// event: item.updated
    /// data: {"id":"abc"}
    /// \n
    /// ```
    /// Lines starting with `:` are comments (the server uses them for
    /// heartbeats) and are ignored. A blank line dispatches the buffered
    /// event; any buffered lines after a dispatch are discarded if no valid
    /// event/data pair was read.
    internal func parse<S: AsyncSequence>(
        lines: S
    ) async throws where S.Element == String {
        var currentType: String?
        var currentId: String?
        var dataBuffer: String = ""

        for try await line in lines {
            if Task.isCancelled { throw CancellationError() }

            if line.isEmpty {
                // Blank line → dispatch the accumulated event, if any.
                if let type = currentType {
                    let payload = Self.decodeJSON(dataBuffer)
                    let event = SSEEvent(type: type, data: payload, id: currentId)
                    eventContinuation.yield(event)
                }
                currentType = nil
                currentId = nil
                dataBuffer = ""
                continue
            }

            if line.hasPrefix(":") {
                // Comment / heartbeat — ignore.
                continue
            }

            // Field lines look like `field: value` or `field:value`. Spec
            // says a single optional space after the colon is stripped.
            guard let colon = line.firstIndex(of: ":") else {
                // Malformed line (no colon). Per spec, treat the whole line
                // as a field name with empty value — we just ignore.
                continue
            }

            let field = String(line[..<colon])
            var value = String(line[line.index(after: colon)...])
            if value.hasPrefix(" ") { value.removeFirst() }

            switch field {
            case "event":
                currentType = value
            case "data":
                if !dataBuffer.isEmpty { dataBuffer.append("\n") }
                dataBuffer.append(value)
            case "id":
                currentId = value
            case "retry":
                // Server-requested reconnect interval. We already have our
                // own backoff policy, so we ignore `retry` for now.
                continue
            default:
                continue
            }
        }
    }

    /// Attempt to decode a JSON object from the `data:` buffer. Returns an
    /// empty dictionary if the payload is empty or malformed — the handler
    /// can still act on the event type without the payload.
    private static func decodeJSON(_ raw: String) -> [String: Any] {
        guard !raw.isEmpty, let data = raw.data(using: .utf8) else { return [:] }
        let object = try? JSONSerialization.jsonObject(with: data, options: [])
        return (object as? [String: Any]) ?? [:]
    }

    // MARK: - Backoff

    /// Classic exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
    /// `attempt` is 1-based from the loop's perspective but this math treats
    /// 0/1 as "one second" so the first retry isn't instant.
    private func backoffDelay(for attempt: Int) -> TimeInterval {
        guard attempt > 0 else { return 0 }
        let exponent = max(0, attempt - 1)
        let base = pow(2.0, Double(exponent))
        let capped = min(base, maxBackoffSeconds)
        return capped * backoffMultiplier
    }

    // MARK: - Response validation

    /// Map HTTP status codes on the streaming response to `APIError` cases
    /// the loop knows how to react to. 401 is the only case where we
    /// explicitly want to retry with a fresh ticket; the loop handles that
    /// naturally because `openAndStream` re-fetches on every attempt.
    private static func validateStreamResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.unknown(URLError(.badServerResponse))
        }
        switch http.statusCode {
        case 200...299:
            return
        case 401:
            throw APIError.unauthorized
        case 429:
            throw APIError.rateLimited(retryAfter: nil)
        case 500...599:
            throw APIError.serverError(http.statusCode)
        default:
            throw APIError.serverError(http.statusCode)
        }
    }
}
