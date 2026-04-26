import Foundation

/// In-memory cache for on-demand server data — chat history, scout findings,
/// event notes. Anything mobile fetches lazily instead of replicating into
/// SwiftData lives here for the lifetime of the process.
///
/// Why an actor: cache reads and writes can fire from any task (multiple
/// detail views opening at once, push-success invalidations from a
/// background sync). The actor serialises access without forcing every
/// caller onto the main actor — and reads return value types so the
/// rest of the call site can run wherever it likes.
///
/// Persistence: in-memory only. Process restart drops everything; the next
/// detail-view open re-fetches. Disk persistence can come later if cold-
/// launch chat-thread perception ever suffers — for now the simplification
/// is worth more than the cache hit on a fresh launch.
///
/// TTL: each entry stamps a fetch time. `value(forKey:)` returns nil once
/// `now - fetchedAt > ttl`. Defaults to 5 min, but per-resource methods
/// can override (notes use a tighter TTL because edits flow through the
/// mutation queue and we want to see them quickly).
///
/// Sign-out: `clear()` is called from `ActiveSession.tearDown()` so a new
/// user can never observe the previous user's cached on-demand data.
actor RemoteCache {
    static let shared = RemoteCache()

    private struct Entry {
        let value: Any
        let fetchedAt: Date
        let ttl: TimeInterval
    }

    private var store: [String: Entry] = [:]

    /// Default TTL when a caller doesn't specify. 5 minutes balances
    /// freshness against re-fetch cost; per-call sites override when
    /// the resource changes more or less often.
    static let defaultTTL: TimeInterval = 5 * 60

    // MARK: - Generic primitives

    /// Read a value if present and within TTL. Returns nil for missing or expired.
    func value<T>(forKey key: String, as: T.Type = T.self) -> T? {
        guard let entry = store[key] else { return nil }
        if Date().timeIntervalSince(entry.fetchedAt) > entry.ttl {
            store.removeValue(forKey: key)
            return nil
        }
        return entry.value as? T
    }

    /// Write a value with the given TTL.
    func set<T>(_ value: T, forKey key: String, ttl: TimeInterval = RemoteCache.defaultTTL) {
        store[key] = Entry(value: value, fetchedAt: Date(), ttl: ttl)
    }

    /// Drop a single key. Called after a write that we know invalidates
    /// the cached server view (e.g. user sent a chat message → next read
    /// must re-fetch to see the assistant reply).
    func invalidate(key: String) {
        store.removeValue(forKey: key)
    }

    /// Drop every key with the given prefix. Used for bulk resets like
    /// "all chat history" without enumerating every itemId.
    func invalidate(prefix: String) {
        for k in store.keys where k.hasPrefix(prefix) {
            store.removeValue(forKey: k)
        }
    }

    /// Clear the entire cache. Called on sign-out so the next user can't
    /// see the previous user's cached on-demand data.
    func clear() {
        store.removeAll()
    }
}

// MARK: - Per-resource fetchers

extension RemoteCache {
    // Key formats — kept tight so `invalidate(prefix:)` can target by
    // resource family.
    private static func chatItemKey(_ itemId: String) -> String { "chat.item.\(itemId)" }
    private static func chatEventKey(_ eventId: String) -> String { "chat.event.\(eventId)" }
    private static func eventNoteKey(_ eventId: String) -> String { "event.note.\(eventId)" }

    /// Fetch the most-recent chat history page for an item. Returns the
    /// cached value if fresh, otherwise hits the server and caches the
    /// result. Errors propagate so the view can show a soft banner.
    func chatHistoryForItem(_ itemId: String) async throws -> APIClient.ChatHistoryPage {
        let key = Self.chatItemKey(itemId)
        if let cached: APIClient.ChatHistoryPage = value(forKey: key) {
            return cached
        }
        let page = try await APIClient.shared.fetchChatHistoryForItem(itemId: itemId)
        set(page, forKey: key)
        return page
    }

    /// Same as `chatHistoryForItem` but for calendar event chat threads.
    func chatHistoryForEvent(_ eventId: String) async throws -> APIClient.ChatHistoryPage {
        let key = Self.chatEventKey(eventId)
        if let cached: APIClient.ChatHistoryPage = value(forKey: key) {
            return cached
        }
        let page = try await APIClient.shared.fetchChatHistoryForEvent(eventId: eventId)
        set(page, forKey: key)
        return page
    }

    /// Drop the cached chat history so the next read fetches fresh.
    /// Called after a streaming send completes — the server has new
    /// messages we need to surface on the next detail-view open.
    func invalidateChatHistory(itemId: String? = nil, eventId: String? = nil) {
        if let itemId { invalidate(key: Self.chatItemKey(itemId)) }
        if let eventId { invalidate(key: Self.chatEventKey(eventId)) }
    }

    /// Fetch the private event note. Notes have a shorter TTL (30s)
    /// because user edits propagate through the mutation queue and we
    /// want a fresh-after-push view if the user re-opens the event.
    func eventNote(eventId: String) async throws -> APIClient.CalendarNoteResponse {
        let key = Self.eventNoteKey(eventId)
        if let cached: APIClient.CalendarNoteResponse = value(forKey: key) {
            return cached
        }
        let note = try await APIClient.shared.fetchEventNote(eventId: eventId)
        set(note, forKey: key, ttl: 30)
        return note
    }

    /// Drop the cached event note so the next read fetches fresh.
    func invalidateEventNote(eventId: String) {
        invalidate(key: Self.eventNoteKey(eventId))
    }
}
