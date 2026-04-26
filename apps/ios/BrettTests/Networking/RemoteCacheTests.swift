import Testing
import Foundation
@testable import Brett

/// Tests for `RemoteCache` — the in-memory TTL store backing on-demand
/// reads (chat history, event notes). The endpoint-fetcher methods
/// (`chatHistoryForItem`, etc.) hit `APIClient.shared` and aren't
/// exercised here; this suite covers the generic primitives + the
/// invalidation path used by the streaming send completion.
@Suite("RemoteCache")
struct RemoteCacheTests {

    // Each test creates its own cache instance so the shared singleton
    // doesn't leak state across tests.
    private func makeCache() -> RemoteCache {
        RemoteCache()
    }

    @Test func setAndGetReturnsCachedValue() async {
        let cache = makeCache()
        await cache.set("hello", forKey: "k.1")
        let v: String? = await cache.value(forKey: "k.1")
        #expect(v == "hello")
    }

    @Test func missingKeyReturnsNil() async {
        let cache = makeCache()
        let v: String? = await cache.value(forKey: "k.missing")
        #expect(v == nil)
    }

    @Test func expiredEntryReturnsNilAndEvicts() async throws {
        let cache = makeCache()
        // 100ms TTL — short enough to expire reliably within the test.
        await cache.set("ephemeral", forKey: "k.ttl", ttl: 0.1)
        let immediate: String? = await cache.value(forKey: "k.ttl")
        #expect(immediate == "ephemeral")

        try await Task.sleep(nanoseconds: 150_000_000)
        let afterExpiry: String? = await cache.value(forKey: "k.ttl")
        #expect(afterExpiry == nil)
    }

    @Test func invalidateKeyRemovesEntry() async {
        let cache = makeCache()
        await cache.set(42, forKey: "k.invalidate")
        await cache.invalidate(key: "k.invalidate")
        let v: Int? = await cache.value(forKey: "k.invalidate")
        #expect(v == nil)
    }

    @Test func invalidatePrefixDropsAllMatchingKeys() async {
        let cache = makeCache()
        await cache.set("a", forKey: "chat.item.A")
        await cache.set("b", forKey: "chat.item.B")
        await cache.set("c", forKey: "event.note.X")

        await cache.invalidate(prefix: "chat.item.")

        let a: String? = await cache.value(forKey: "chat.item.A")
        let b: String? = await cache.value(forKey: "chat.item.B")
        let c: String? = await cache.value(forKey: "event.note.X")
        #expect(a == nil)
        #expect(b == nil)
        // Non-matching prefix survives.
        #expect(c == "c")
    }

    @Test func clearRemovesEverything() async {
        let cache = makeCache()
        await cache.set("a", forKey: "k.1")
        await cache.set("b", forKey: "k.2")
        await cache.clear()
        let a: String? = await cache.value(forKey: "k.1")
        let b: String? = await cache.value(forKey: "k.2")
        #expect(a == nil)
        #expect(b == nil)
    }

    @Test func invalidateChatHistoryItemDropsItemKey() async {
        let cache = makeCache()
        // Seed manually using the same key shape `chatHistoryForItem`
        // would produce. We don't exercise the network fetcher here —
        // just the invalidation contract.
        await cache.set("seeded", forKey: "chat.item.item-1")

        await cache.invalidateChatHistory(itemId: "item-1", eventId: nil)

        let v: String? = await cache.value(forKey: "chat.item.item-1")
        #expect(v == nil)
    }

    @Test func invalidateChatHistoryEventDropsEventKey() async {
        let cache = makeCache()
        await cache.set("seeded", forKey: "chat.event.event-1")

        await cache.invalidateChatHistory(itemId: nil, eventId: "event-1")

        let v: String? = await cache.value(forKey: "chat.event.event-1")
        #expect(v == nil)
    }

    @Test func setOverwritesExistingValue() async {
        let cache = makeCache()
        await cache.set("first", forKey: "k.dup")
        await cache.set("second", forKey: "k.dup")
        let v: String? = await cache.value(forKey: "k.dup")
        #expect(v == "second")
    }

    @Test func valueReturnsCorrectTypeForGeneric() async {
        // Mixed-type entries shouldn't bleed across keys.
        let cache = makeCache()
        await cache.set([1, 2, 3], forKey: "k.array")
        await cache.set("text", forKey: "k.string")

        let arr: [Int]? = await cache.value(forKey: "k.array")
        let str: String? = await cache.value(forKey: "k.string")
        #expect(arr == [1, 2, 3])
        #expect(str == "text")

        // Wrong type for an existing key returns nil (the cast fails).
        let mismatched: [Int]? = await cache.value(forKey: "k.string")
        #expect(mismatched == nil)
    }
}
