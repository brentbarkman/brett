import Testing
import Foundation
@testable import Brett

@Suite("ChatStore clear", .tags(.smoke))
@MainActor
struct ChatStoreClearTests {
    @Test func clearForSignOutCancelsStreamsAndClearsMessages() {
        ClearableStoreRegistry.resetForTesting()
        let store = ChatStore()
        let key = "item-123"
        store.injectForTesting(messages: [
            key: [
                ChatMessage(
                    id: "m1",
                    role: .user,
                    content: "hello",
                    isStreaming: false,
                    createdAt: Date()
                ),
                ChatMessage(
                    id: "m2",
                    role: .brett,
                    content: "world",
                    isStreaming: true,
                    createdAt: Date()
                ),
            ],
        ], isStreaming: [key: true])

        #expect(store.messages.isEmpty == false)
        #expect(store.isStreaming[key] == true)

        ClearableStoreRegistry.clearAll()

        #expect(store.messages.isEmpty)
        #expect(store.isStreaming.values.contains(true) == false)
        #expect(store.lastError.isEmpty)
    }
}
