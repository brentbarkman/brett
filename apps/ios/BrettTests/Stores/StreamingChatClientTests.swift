import Testing
import Foundation
@testable import Brett

@Suite("StreamingChatClient", .tags(.smoke))
@MainActor
struct StreamingChatClientTests {
    // MARK: - Synchronous parseEvent

    @Test func parsesSimpleChunkEvent() {
        let event = StreamingChatClient.parseEvent(lines: [
            "event: chunk",
            #"data: {"type":"text","content":"Hello"}"#,
        ])
        if case .chunk(let s) = event {
            #expect(s == #"{"type":"text","content":"Hello"}"#)
        } else {
            Issue.record("expected .chunk, got \(String(describing: event))")
        }
    }

    @Test func parsesErrorEvent() {
        let event = StreamingChatClient.parseEvent(lines: [
            "event: error",
            #"data: {"message":"rate limited"}"#,
        ])
        if case .error(let msg) = event {
            #expect(msg == "rate limited")
        } else {
            Issue.record("expected .error, got \(String(describing: event))")
        }
    }

    @Test func parsesDoneEvent() {
        let event = StreamingChatClient.parseEvent(lines: ["event: done"])
        if case .done = event {} else {
            Issue.record("expected .done, got \(String(describing: event))")
        }
    }

    @Test func unknownEventNameReturnsNil() {
        let event = StreamingChatClient.parseEvent(lines: [
            "event: mystery",
            "data: anything",
        ])
        #expect(event == nil)
    }

    @Test func malformedErrorJsonFallsBackToGenericMessage() {
        let event = StreamingChatClient.parseEvent(lines: [
            "event: error",
            "data: {bad json}",
        ])
        if case .error(let msg) = event {
            #expect(msg == "Something went wrong.")
        } else {
            Issue.record("expected .error, got \(String(describing: event))")
        }
    }

    // MARK: - Async parse(lines:onEvent:) parity tests
    //
    // Mirror the parser tests that previously lived in ChatStoreTests.swift
    // so behavioural parity is enforced after the refactor.

    @Test func asyncParserEmitsChunksInOrder() async throws {
        let events = try await collect(lines: [
            "event: chunk",
            #"data: {"type":"text","content":"Hello "}"#,
            "",
            "event: chunk",
            #"data: {"type":"text","content":"world"}"#,
            "",
            "event: done",
            #"data: {"type":"done"}"#,
            "",
        ])

        #expect(events.count == 3)
        if case .chunk = events[0] {} else { Issue.record("0 not chunk") }
        if case .chunk = events[1] {} else { Issue.record("1 not chunk") }
        if case .done = events[2] {} else { Issue.record("2 not done") }
    }

    @Test func asyncParserIgnoresHeartbeatComments() async throws {
        let events = try await collect(lines: [
            ": heartbeat",
            "",
            "event: chunk",
            #"data: {"type":"text","content":"Hi"}"#,
            "",
        ])

        #expect(events.count == 1)
    }

    @Test func asyncParserFlushesTailWithoutBlankLine() async throws {
        let events = try await collect(lines: [
            "event: chunk",
            #"data: {"type":"text","content":"partial"}"#,
        ])

        #expect(events.count == 1)
    }

    // MARK: - Helpers

    private func collect(lines: [String]) async throws -> [StreamEvent] {
        let collector = StreamEventCollector()
        try await StreamingChatClient.parse(lines: ScriptedLines(lines: lines)) { event in
            await collector.append(event)
        }
        return await collector.events
    }
}

/// An AsyncSequence of strings built from a synchronous array — lets tests
/// pipe canned SSE lines into the parser.
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

/// Actor-wrapped event collector so the async callback from parse can
/// safely append from any task. Reads `events` back from the main actor
/// after the parser finishes.
private actor StreamEventCollector {
    var events: [StreamEvent] = []

    func append(_ event: StreamEvent) {
        events.append(event)
    }
}
