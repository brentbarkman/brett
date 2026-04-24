import Foundation
import Testing
@testable import Brett

/// Tests for `ChatStore.parseSSE` — the pure parser that turns an async line
/// stream into typed `StreamEvent`s.
///
/// We test the parser in isolation (not behind a real URLSession) so we can
/// drive it with scripted line sequences and assert on the emitted event
/// list. Happy-path streaming, error events, comment lines, and trailing
/// content without a terminator are all covered here.
@MainActor
@Suite("ChatStore", .tags(.views))
struct ChatStoreTests {

    // MARK: - Helpers

    /// An AsyncSequence of strings built from a synchronous array — lets
    /// tests pipe canned SSE lines into the parser.
    private struct ScriptedLines: AsyncSequence {
        typealias Element = String
        let lines: [String]

        struct AsyncIterator: AsyncIteratorProtocol {
            var remaining: [String]
            mutating func next() async -> String? {
                guard !remaining.isEmpty else { return nil }
                return remaining.removeFirst()
            }
        }

        func makeAsyncIterator() -> AsyncIterator {
            AsyncIterator(remaining: lines)
        }
    }

    private func collect(lines: [String]) async throws -> [ChatStore.StreamEvent] {
        let collector = EventCollector()
        try await ChatStore.parseSSE(lines: ScriptedLines(lines: lines)) { event in
            await collector.append(event)
        }
        return await collector.events
    }

    // MARK: - Parser: happy path

    @Test func parsesSingleChunkEvent() async throws {
        let events = try await collect(lines: [
            "event: chunk",
            #"data: {"type":"text","content":"Hello"}"#,
            "",
        ])

        #expect(events.count == 1)
        if case .chunk(let data) = events[0] {
            #expect(data.contains("Hello"))
        } else {
            Issue.record("Expected chunk event")
        }
    }

    @Test func parsesMultipleChunksInSequence() async throws {
        let events = try await collect(lines: [
            "event: chunk",
            #"data: {"type":"text","content":"Hello "}"#,
            "",
            "event: chunk",
            #"data: {"type":"text","content":"world"}"#,
            "",
            "event: done",
            #"data: {"type":"done","sessionId":"s-1","usage":{"input":10,"output":5}}"#,
            "",
        ])

        #expect(events.count == 3)
        if case .chunk = events[0] {} else { Issue.record("0 not chunk") }
        if case .chunk = events[1] {} else { Issue.record("1 not chunk") }
        if case .done = events[2] {} else { Issue.record("2 not done") }
    }

    @Test func ignoresCommentHeartbeatLines() async throws {
        let events = try await collect(lines: [
            ": heartbeat",
            "",
            "event: chunk",
            #"data: {"type":"text","content":"Hi"}"#,
            "",
        ])

        #expect(events.count == 1)
    }

    @Test func parsesErrorEventIntoMessage() async throws {
        let events = try await collect(lines: [
            "event: error",
            #"data: {"message":"Something went wrong"}"#,
            "",
        ])

        #expect(events.count == 1)
        if case .error(let message) = events[0] {
            #expect(message == "Something went wrong")
        } else {
            Issue.record("Expected error event")
        }
    }

    @Test func flushesTailEventWithoutBlankLineTerminator() async throws {
        // No trailing blank line — parser should still flush the final event.
        let events = try await collect(lines: [
            "event: chunk",
            #"data: {"type":"text","content":"partial"}"#,
        ])

        #expect(events.count == 1)
    }

    // MARK: - Store integration

    @Test func emptyMessageIsNoOp() async {
        let store = ChatStore(session: noopSession(), persistence: nil)
        await store.send(itemId: "item-1", message: "   ", userId: "u1")
        #expect((store.messages["item-1"] ?? []).isEmpty)
    }

    // MARK: - Fixtures

    /// A URLSession that immediately fails every request — good enough for
    /// pre-flight tests that only care about the local buffering behaviour.
    private func noopSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }
}

/// Actor-wrapped event collector so the async callback from parseSSE can
/// safely append from any task. The test reads `events` back from the main
/// actor after the parser finishes.
private actor EventCollector {
    var events: [ChatStore.StreamEvent] = []

    func append(_ event: ChatStore.StreamEvent) {
        events.append(event)
    }
}
