import Testing
import Foundation
@testable import Brett

@Suite("ChatMessageBuffer", .tags(.smoke))
@MainActor
struct ChatMessageBufferTests {
    @Test func appendUserCreatesMessageInOrder() {
        let buffer = ChatMessageBuffer()
        buffer.appendUser(key: "item-1", content: "Hello")
        buffer.appendUser(key: "item-1", content: "World")

        let messages = buffer.messages["item-1"] ?? []
        #expect(messages.count == 2)
        #expect(messages.map(\.content) == ["Hello", "World"])
        #expect(messages.allSatisfy { $0.role == .user })
    }

    @Test func beginAssistantReturnsIndexAndMarksStreaming() {
        let buffer = ChatMessageBuffer()
        let index = buffer.beginAssistant(key: "item-1")

        #expect(index == 0)
        let messages = buffer.messages["item-1"] ?? []
        #expect(messages.count == 1)
        #expect(messages[0].role == .brett)
        #expect(messages[0].isStreaming == true)
        #expect(messages[0].content.isEmpty)
        #expect(buffer.isStreaming["item-1"] == true)
    }

    @Test func appendAssistantDeltaAccumulatesContent() {
        let buffer = ChatMessageBuffer()
        let index = buffer.beginAssistant(key: "item-1")
        buffer.appendAssistantDelta(key: "item-1", index: index, delta: "Hello, ")
        buffer.appendAssistantDelta(key: "item-1", index: index, delta: "world.")

        let messages = buffer.messages["item-1"] ?? []
        #expect(messages[0].content == "Hello, world.")
    }

    @Test func markAssistantCompleteFlipsStreamingFalse() {
        let buffer = ChatMessageBuffer()
        let index = buffer.beginAssistant(key: "item-1")
        buffer.appendAssistantDelta(key: "item-1", index: index, delta: "Done")
        buffer.markAssistantComplete(key: "item-1", index: index)

        let messages = buffer.messages["item-1"] ?? []
        #expect(messages[0].isStreaming == false)
        #expect(buffer.isStreaming["item-1"] == false)
    }

    @Test func clearWipesAllState() {
        let buffer = ChatMessageBuffer()
        buffer.appendUser(key: "item-1", content: "Hi")
        _ = buffer.beginAssistant(key: "item-1")
        buffer.setError(key: "item-1", message: "stale")

        buffer.clear()

        #expect(buffer.messages.isEmpty)
        #expect(buffer.isStreaming.isEmpty)
        #expect(buffer.lastError.isEmpty)
    }

    @Test func multipleKeysAreIsolated() {
        let buffer = ChatMessageBuffer()
        buffer.appendUser(key: "item-1", content: "first")
        buffer.appendUser(key: "item-2", content: "second")

        #expect(buffer.messages["item-1"]?.count == 1)
        #expect(buffer.messages["item-2"]?.count == 1)
        #expect(buffer.messages["item-1"]?.first?.content == "first")
        #expect(buffer.messages["item-2"]?.first?.content == "second")
    }
}
