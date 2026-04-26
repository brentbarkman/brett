import Foundation

/// Typed `APIClient` extensions for the paginated chat history endpoints.
///
/// Mirrors the server handler in `apps/api/src/routes/brett-chat.ts`. The
/// streaming POST endpoints stay in `ChatStore` (raw URLSession bytes path);
/// these history methods are plain JSON and decode through the standard
/// `request` helper.
///
/// Why a separate concern from the streaming path: history is read-only and
/// cacheable (`RemoteCache.chatHistoryForItem`) — pagination + caching make
/// no sense on the streaming side, where every send is a one-shot SSE.
@MainActor
extension APIClient {
    // MARK: - Response DTOs

    /// One message in a paginated history page. Roles are a free-form string
    /// from the server (`"user" | "assistant" | "tool" | …`) rather than the
    /// iOS `MessageRole` enum so an unknown future role doesn't drop the
    /// whole page.
    struct ChatHistoryMessage: Codable, Equatable, Sendable {
        let id: String
        let role: String
        let content: String
        let createdAt: Date
    }

    struct ChatHistoryPage: Codable, Equatable, Sendable {
        let messages: [ChatHistoryMessage]
        let hasMore: Bool
        let cursor: String?
        let totalCount: Int?
    }

    // MARK: - Endpoints

    /// GET /brett/chat/:itemId — paginated history for a task chat thread.
    /// Default page size is the server's default (20). Pass `cursor` to
    /// load the page strictly older than that ISO timestamp.
    func fetchChatHistoryForItem(
        itemId: String,
        limit: Int = 50,
        cursor: String? = nil
    ) async throws -> ChatHistoryPage {
        let path = chatHistoryPath("/brett/chat/\(itemId)", limit: limit, cursor: cursor)
        return try await requestRelative(ChatHistoryPage.self, relativePath: path, method: "GET")
    }

    /// GET /brett/chat/event/:eventId — paginated history for a calendar
    /// event chat thread.
    func fetchChatHistoryForEvent(
        eventId: String,
        limit: Int = 50,
        cursor: String? = nil
    ) async throws -> ChatHistoryPage {
        let path = chatHistoryPath("/brett/chat/event/\(eventId)", limit: limit, cursor: cursor)
        return try await requestRelative(ChatHistoryPage.self, relativePath: path, method: "GET")
    }

    /// Build the `/brett/chat/...?limit&cursor` query string.
    /// Percent-encodes the cursor (it's an ISO timestamp containing `:`) so
    /// the query string survives URLComponents intact.
    nonisolated private func chatHistoryPath(
        _ base: String,
        limit: Int,
        cursor: String?
    ) -> String {
        var path = "\(base)?limit=\(limit)"
        if let cursor, !cursor.isEmpty {
            let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor
            path += "&cursor=\(encoded)"
        }
        return path
    }
}
