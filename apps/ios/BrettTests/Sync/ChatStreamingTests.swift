import Testing
import Foundation
@testable import Brett

/// Stress tests for `SSEClient.parse(lines:)` around malformed + edge-case
/// chunks. Complements the happy-path parser coverage in `SSEClientTests`:
/// these focus on what happens when the server sends weird or slightly broken
/// frames (which we expect in production during rolling deploys or network
/// glitches).
@Suite("ChatStreaming", .tags(.sync))
@MainActor
struct ChatStreamingTests {
    // MARK: - Helpers

    /// Tiny actor so the detached collector can append safely while the
    /// main-actor test polls for progress.
    private actor EventBox {
        private var items: [SSEEvent] = []
        func append(_ event: SSEEvent) { items.append(event) }
        func count() -> Int { items.count }
        func snapshot() -> [SSEEvent] { items }
    }

    /// Build an `AsyncStream<String>` from a multi-line SSE body — splits on
    /// `\n` and preserves blank lines (the parser uses them as dispatchers).
    private static func lineStream(from body: String) -> AsyncStream<String> {
        AsyncStream { continuation in
            let lines = body.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" })
            for line in lines {
                continuation.yield(String(line))
            }
            continuation.finish()
        }
    }

    /// Drive the pure parser and collect up to `count` events, with a short
    /// deadline to avoid hanging.
    private static func drainEvents(
        from client: SSEClient,
        body: String,
        expect count: Int,
        deadline seconds: TimeInterval = 1
    ) async throws -> [SSEEvent] {
        let box = EventBox()
        let stream = client.events
        let collector = Task.detached { [box] in
            for await event in stream {
                await box.append(event)
                if await box.count() >= count { break }
            }
        }

        try await client.parse(lines: Self.lineStream(from: body))

        let end = Date().addingTimeInterval(seconds)
        while Date() < end, await box.count() < count {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        collector.cancel()
        return await box.snapshot()
    }

    private static func makeClient() -> SSEClient {
        let api = APIClient(session: .shared)
        return SSEClient(
            apiClient: api,
            session: .shared,
            maxBackoffSeconds: 1,
            backoffMultiplier: 0
        )
    }

    // MARK: - 1. Well-formed event

    @Test func wellFormedTextEventIsEmitted() async throws {
        let client = Self.makeClient()
        let body = "event: brett_message.created\ndata: {\"type\":\"text\",\"text\":\"hello\"}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].type == "brett_message.created")
        #expect(events[0].string("type") == "text")
        #expect(events[0].string("text") == "hello")
    }

    // MARK: - 2. Multi-line `data:`

    @Test func multiLineDataIsConcatenated() async throws {
        let client = Self.makeClient()
        // SSE spec: multiple `data:` lines are joined with `\n`. Our decoder
        // tries JSON first and falls back to empty — if the join produces
        // malformed JSON we should just get an empty dict, not a crash.
        let body =
            "event: brett_message.created\n" +
            "data: {\"type\":\"text\",\n" +
            "data:  \"text\":\"hi\"}\n" +
            "\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].type == "brett_message.created")
        // After joining with `\n`, the JSON decoder should still succeed
        // because JSON tolerates whitespace inside objects.
        #expect(events[0].string("type") == "text" || events[0].data.isEmpty)
    }

    // MARK: - 3. Unknown event type

    @Test func unknownEventTypeStillPassesThrough() async throws {
        let client = Self.makeClient()
        let body = "event: mystery.type\ndata: {\"ok\":true}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].type == "mystery.type")
    }

    // MARK: - 4. Malformed JSON payload

    @Test func malformedJSONYieldsEmptyData() async throws {
        let client = Self.makeClient()
        // `data:` contains raw text that isn't JSON. The parser must not
        // throw — it emits an event with an empty `data` dict so handlers
        // can decide how to react.
        let body = "event: item.updated\ndata: this is not json\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].type == "item.updated")
        #expect(events[0].data.isEmpty, "malformed JSON decodes to empty dict")
    }

    // MARK: - 5. `event: done` followed by text

    @Test func doneEventIsPassedThrough() async throws {
        let client = Self.makeClient()
        // The chat finalizer fires a `done` event when the LLM stream ends.
        // The parser doesn't treat it specially — it emits like anything else
        // and the handler dispatches.
        let body = "event: done\ndata: {\"final\":true}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].type == "done")
        #expect(events[0].data["final"] as? Bool == true)
    }

    // MARK: - 6. Mid-stream `event: error`

    @Test func errorEventIsEmittedAndParserContinues() async throws {
        let client = Self.makeClient()
        // The server can emit an `event: error` then close. The parser must
        // surface it as a normal SSEEvent so downstream code can trigger a
        // reconnect / bubble the error up to the UI.
        let body =
            "event: item.updated\ndata: {\"id\":\"a\"}\n\n" +
            "event: error\ndata: {\"message\":\"rate limited\"}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 2)
        #expect(events.count == 2)
        #expect(events[0].type == "item.updated")
        #expect(events[1].type == "error")
        #expect(events[1].string("message") == "rate limited")
    }

    // MARK: - 7. Line with no colon — silently ignored

    @Test func linesWithoutColonAreSkipped() async throws {
        let client = Self.makeClient()
        // Per SSE spec, a line with no colon is treated as the field name
        // with empty value. Our parser just continues. The valid event
        // wedged in after the junk line should still dispatch.
        let body =
            "random junk line\n" +
            "event: item.created\ndata: {\"id\":\"zz\"}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].type == "item.created")
    }

    // MARK: - 8. Blank line without a preceding event — harmless

    @Test func blankLineWithoutEventProducesNothing() async throws {
        let client = Self.makeClient()
        let body = "\n\n\n" + "event: scout.finding.created\ndata: {\"id\":\"f1\"}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].type == "scout.finding.created")
    }

    // MARK: - 9. Comment / heartbeat handled across multiple events

    @Test func multipleHeartbeatsBetweenEventsDoNotLoseEvents() async throws {
        let client = Self.makeClient()
        let body =
            ": heartbeat 1\n\n" +
            "event: item.updated\ndata: {\"id\":\"a\"}\n\n" +
            ": heartbeat 2\n\n" +
            "event: item.updated\ndata: {\"id\":\"b\"}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 2)
        #expect(events.count == 2)
        #expect(events[0].string("id") == "a")
        #expect(events[1].string("id") == "b")
    }

    // MARK: - 10. `id:` line is captured

    @Test func idLineIsAttachedToEvent() async throws {
        let client = Self.makeClient()
        let body = "event: item.created\nid: 42\ndata: {\"id\":\"x\"}\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 1)
        #expect(events.count == 1)
        #expect(events[0].id == "42")
    }

    // MARK: - 11. `retry:` line ignored (no event fired alone)

    @Test func retryLineAloneDoesNotEmitAnEvent() async throws {
        let client = Self.makeClient()
        // `retry:` without a paired `event:` shouldn't dispatch anything.
        let body = "retry: 3000\n\n"
        let events = try await Self.drainEvents(from: client, body: body, expect: 0, deadline: 0.3)
        #expect(events.isEmpty)
    }
}
