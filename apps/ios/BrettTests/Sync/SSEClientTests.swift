import Testing
import Foundation
@testable import Brett

/// Unit tests for `SSEClient` + `SSEEndpoints`.
///
/// Strategy:
/// - Stub `POST /sse/ticket` with `MockURLProtocol` so `fetchSSETicket()`
///   returns a canned ticket without hitting the network.
/// - Stub `GET /sse/stream?ticket=<T>` with a body containing one or more
///   SSE-formatted events; `URLSession.bytes(for:)` re-streams the stubbed
///   data as a line-by-line AsyncStream, which is all the parser needs.
/// - Run the client with `backoffMultiplier: 0` so the reconnect loop runs
///   instantly instead of waiting real seconds.
///
/// Test-specific concerns:
/// - MockURLProtocol is indexed by URL, and a URL can only hold one stub at
///   a time. To exercise multi-attempt scenarios we swap the stub between
///   steps, which matches how URLSession re-fetches the ticket each time.
/// - `APIClient.shared` is a @MainActor singleton with its own URLSession;
///   we build a dedicated APIClient in each test whose `session` injects
///   MockURLProtocol.
@Suite("SSEClient", .tags(.sync))
@MainActor
struct SSEClientTests {
    // MARK: - Helpers

    /// Build a URLSession wired to MockURLProtocol. Keeps tests isolated and
    /// ensures stubs don't leak into other tests.
    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        // Long timeouts so a slow CI runner doesn't trip them.
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }

    /// Build a client + API + session trio. Fresh per-test so there's no
    /// shared state between suites.
    /// Tests typically want the loop to connect once, parse the stubbed
    /// body, then sleep for a noticeable amount of time before reconnecting
    /// — otherwise the tight retry loop floods logs and gets the test host
    /// quarantined. A 2-second minimum backoff gives us plenty of room to
    /// assert, call `disconnect()`, and tear down cleanly.
    private static func makeClient(
        token: String = "test-token",
        maxBackoffSeconds: TimeInterval = 30,
        backoffMultiplier: TimeInterval = 2.0
    ) -> (client: SSEClient, api: APIClient, session: URLSession) {
        let session = makeSession()
        let api = APIClient(session: session)
        api.tokenProvider = { token }
        let client = SSEClient(
            apiClient: api,
            session: session,
            maxBackoffSeconds: maxBackoffSeconds,
            backoffMultiplier: backoffMultiplier
        )
        return (client, api, session)
    }

    /// Encode an SSE frame (`event:` + `data:` + blank line) as UTF-8.
    private static func sseFrame(event: String, data: String) -> String {
        "event: \(event)\ndata: \(data)\n\n"
    }

    // MARK: - Ticket fetch

    @Test func fetchTicketReturnsTicket() async throws {
        MockURLProtocol.reset()
        let (_, api, _) = Self.makeClient()
        let ticketURL = api.baseURL.appendingPathComponent("sse/ticket")

        MockURLProtocol.stub(
            url: ticketURL,
            statusCode: 200,
            body: Data("""
            {"ticket":"abc123"}
            """.utf8),
            headers: ["Content-Type": "application/json"]
        )

        let response = try await api.fetchSSETicket()
        #expect(response.ticket == "abc123")
    }

    @Test func streamURLEncodesTicketAsQuery() async {
        let (_, api, _) = Self.makeClient()
        let url = api.sseStreamURL(ticket: "xyz")
        #expect(url.path == "/sse/stream")
        #expect(url.query?.contains("ticket=xyz") == true)
    }

    // MARK: - Stream parsing

    /// Poll-style event collection: subscribe to `client.events` on a
    /// detached task, then poll its published result with a short sleep
    /// between tries. A hard deadline stops the test from hanging if the
    /// parser is broken and never yields anything.
    ///
    /// Avoiding `TaskGroup` here sidesteps a crash we saw in the Xcode 26 /
    /// Swift Testing combo where task-group teardown interacts badly with
    /// the still-running SSEClient reconnect loop on the main actor.
    @MainActor
    private static func collectEvents(
        from client: SSEClient,
        count: Int,
        deadline: Date = Date().addingTimeInterval(3)
    ) async -> [SSEEvent] {
        // The collector is "let the stream drain into this array".
        let stream = client.events
        let box = EventBox()
        let collector = Task.detached { [box] in
            for await event in stream {
                await box.append(event)
                if await box.count() >= count { break }
            }
        }

        while Date() < deadline, await box.count() < count {
            try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
        }
        collector.cancel()
        return await box.snapshot()
    }

    /// Tiny actor so the detached collector can append safely while the
    /// main-actor test polls for progress. Swift 6 refuses shared mutable
    /// state without isolation, and an actor is the most natural fit.
    private actor EventBox {
        private var items: [SSEEvent] = []
        func append(_ event: SSEEvent) { items.append(event) }
        func count() -> Int { items.count }
        func snapshot() -> [SSEEvent] { items }
    }

    /// Build an AsyncStream<String> from a multi-line SSE body so we can
    /// drive the pure parser directly without touching URLSession.
    private static func lineStream(from body: String) -> AsyncStream<String> {
        AsyncStream { continuation in
            // Split on newlines but preserve blank lines (the parser uses
            // them as event dispatchers).
            let lines = body.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" })
            for line in lines {
                continuation.yield(String(line))
            }
            continuation.finish()
        }
    }

    @Test func streamingBodyParsesTwoEvents() async throws {
        let (client, _, _) = Self.makeClient()

        let body =
            Self.sseFrame(event: "item.created", data: "{\"id\":\"abc\"}") +
            Self.sseFrame(event: "list.updated", data: "{\"id\":\"xyz\"}")
        let lines = Self.lineStream(from: body)

        // Subscribe BEFORE we kick off the parser so we don't miss any
        // early events. The parser yields into `client.eventContinuation`
        // synchronously as it walks the input.
        let box = EventBox()
        let stream = client.events
        let collector = Task.detached { [box] in
            for await event in stream {
                await box.append(event)
                if await box.count() >= 2 { break }
            }
        }

        try await client.parse(lines: lines)

        // Wait briefly for the collector to drain — it's on a detached task
        // so we can't guarantee it's caught up the moment parse() returns.
        let deadline = Date().addingTimeInterval(1)
        while Date() < deadline, await box.count() < 2 {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        collector.cancel()

        let events = await box.snapshot()
        #expect(events.count == 2, "expected 2 events, got \(events.count)")
        if events.count >= 2 {
            #expect(events[0].type == "item.created")
            #expect(events[0].string("id") == "abc")
            #expect(events[1].type == "list.updated")
            #expect(events[1].string("id") == "xyz")
        }
    }

    @Test func heartbeatCommentIsIgnored() async throws {
        let (client, _, _) = Self.makeClient()

        // A heartbeat comment followed by a real event. The parser must drop
        // the comment and only surface the event.
        let body =
            ": heartbeat\n\n" +
            Self.sseFrame(event: "item.updated", data: "{\"id\":\"h1\"}")
        let lines = Self.lineStream(from: body)

        let box = EventBox()
        let stream = client.events
        let collector = Task.detached { [box] in
            for await event in stream {
                await box.append(event)
                if await box.count() >= 1 { break }
            }
        }

        try await client.parse(lines: lines)

        let deadline = Date().addingTimeInterval(1)
        while Date() < deadline, await box.count() < 1 {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        collector.cancel()

        let events = await box.snapshot()
        #expect(events.count == 1, "expected 1 event, got \(events.count)")
        if events.count >= 1 {
            #expect(events[0].type == "item.updated")
            #expect(events[0].string("id") == "h1")
        }
    }

    // MARK: - Reconnect

    @Test func disconnectStopsReconnectLoop() async throws {
        MockURLProtocol.reset()
        // Tight backoff so we can observe the reconnect loop actually
        // cycling — we need a failed attempt visible before we kill it.
        let (client, api, _) = Self.makeClient(
            maxBackoffSeconds: 1,
            backoffMultiplier: 0.05
        )
        let ticketURL = api.baseURL.appendingPathComponent("sse/ticket")

        // Stub the ticket with a 500 so the loop tries to reconnect.
        MockURLProtocol.stub(
            url: ticketURL,
            statusCode: 500,
            body: Data()
        )

        client.connect()

        // Give the loop a moment to cycle through a failed attempt.
        try await Task.sleep(nanoseconds: 300_000_000) // 300ms

        client.disconnect()
        let beforeAttempts = client.reconnectAttempt

        // Wait a bit more — no further attempts should be recorded.
        try await Task.sleep(nanoseconds: 300_000_000)
        let afterAttempts = client.reconnectAttempt

        #expect(client.isConnected == false)
        // After disconnect we reset counters to 0; if the loop kept going,
        // afterAttempts would exceed beforeAttempts.
        #expect(afterAttempts <= beforeAttempts,
                "disconnect() must halt the loop")
    }

    @Test func reconnectHappensAfterStreamError() async throws {
        MockURLProtocol.reset()
        let (client, api, _) = Self.makeClient(
            maxBackoffSeconds: 1,
            backoffMultiplier: 0.05
        )
        let ticketURL = api.baseURL.appendingPathComponent("sse/ticket")

        // 503 forces the loop to classify as `.serverError`, which bumps the
        // retry counter.
        MockURLProtocol.stub(
            url: ticketURL,
            statusCode: 503,
            body: Data()
        )

        client.connect()

        // Wait long enough to guarantee at least one bumped attempt counter.
        try await Task.sleep(nanoseconds: 400_000_000) // 400ms

        let attempts = client.reconnectAttempt
        client.disconnect()

        #expect(attempts >= 1,
                "loop should have bumped reconnectAttempt after failed ticket fetch")
    }

    @Test func on401StreamRefetchesTicket() async throws {
        MockURLProtocol.reset()
        let (client, api, _) = Self.makeClient(
            maxBackoffSeconds: 1,
            backoffMultiplier: 0.05
        )
        let ticketURL = api.baseURL.appendingPathComponent("sse/ticket")

        // Ticket succeeds, stream returns 401 → loop re-fetches ticket on the
        // next iteration. The stubs are static so each iteration follows the
        // same pattern — we just count how many ticket requests fire.
        MockURLProtocol.stub(
            url: ticketURL,
            statusCode: 200,
            body: Data("""
            {"ticket":"first"}
            """.utf8)
        )

        let firstStreamURL = api.sseStreamURL(ticket: "first")
        MockURLProtocol.stub(
            url: firstStreamURL,
            statusCode: 401,
            body: Data()
        )

        client.connect()

        // 500ms covers multiple fetch → 401 → backoff → refetch cycles.
        try await Task.sleep(nanoseconds: 500_000_000)

        let ticketRequests = MockURLProtocol.recordedRequests().filter {
            $0.url?.path == "/sse/ticket"
        }
        client.disconnect()

        #expect(ticketRequests.count >= 2,
                "loop should refetch ticket after 401 on stream (saw \(ticketRequests.count))")
    }
}
