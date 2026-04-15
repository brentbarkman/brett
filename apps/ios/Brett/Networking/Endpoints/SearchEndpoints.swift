import Foundation

/// Typed `APIClient` extension for `/api/search` — the hybrid keyword +
/// semantic search endpoint used by the Spotlight-style search sheet.
///
/// Server contract (`apps/api/src/routes/search.ts`):
/// - `GET /api/search?q=<query>&types=<t1,t2>&limit=<20-50>`
/// - Min query length: 2 chars (server rejects shorter, we short-circuit in the store).
/// - Returns an array of `SearchResult` objects — see `SearchStore.swift`.
///
/// Query params are percent-encoded via `URLComponents` so reserved chars
/// in the user's query (`&`, spaces, unicode) go through cleanly. We build
/// `path?query` as a single string because `APIClient.request(path:)` treats
/// its input as a path relative to `baseURL`.
@MainActor
extension APIClient {
    /// Run a hybrid keyword + semantic search.
    ///
    /// - Parameters:
    ///   - q: User's query. Caller is expected to trim + validate min length;
    ///        this method still sends whatever it's given.
    ///   - types: Optional entity-type filter. `nil` or empty = all types.
    ///   - limit: 20–50 range enforced server-side; caller should clamp.
    func search(
        q: String,
        types: Set<SearchEntityType>? = nil,
        limit: Int = 20
    ) async throws -> [SearchResult] {
        var components = URLComponents()
        components.path = "/api/search"
        var items: [URLQueryItem] = [
            URLQueryItem(name: "q", value: q),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let types, !types.isEmpty {
            // Sort so the wire order is deterministic — makes tests and
            // any log-based debugging predictable.
            let joined = types
                .map(\.rawValue)
                .sorted()
                .joined(separator: ",")
            items.append(URLQueryItem(name: "types", value: joined))
        }
        components.queryItems = items

        // Match the pattern used by ScoutEndpoints.fetchScoutFindings:
        // hand the raw `path?query` string to `request`, which forwards to
        // `URL.appendingPathComponent`. Using a pre-encoded query string
        // avoids round-tripping through `URL` twice.
        let path = "\(components.path)?\(components.percentEncodedQuery ?? "")"
        return try await request(
            [SearchResult].self,
            path: path,
            method: "GET"
        )
    }
}
