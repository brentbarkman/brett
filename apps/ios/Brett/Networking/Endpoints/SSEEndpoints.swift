import Foundation

/// Typed wrappers for the `/sse/*` endpoints.
///
/// The SSE flow is two-step:
///  1. `POST /sse/ticket` (authenticated with bearer) — server mints a
///     single-use, 60-second-expiry hex ticket.
///  2. `GET /sse/stream?ticket=<ticket>` — streaming endpoint. Auth comes
///     from the ticket, not an Authorization header, because URLSession
///     streaming cookies/headers are finicky and the server's SSE consumers
///     historically couldn't set headers (EventSource in the browser).
///
/// We wrap the two calls here so `SSEClient` can stay focused on the
/// connection + reconnect lifecycle instead of URL assembly.
struct SSETicketResponse: Decodable, Sendable {
    let ticket: String
}

extension APIClient {
    /// Request a short-lived SSE ticket. Requires the client to have a bearer
    /// token set; throws `APIError.unauthorized` if the token is missing or
    /// rejected. Throws `APIError.rateLimited` when the server's per-user
    /// ticket cap (5) is exceeded — callers should back off aggressively.
    func fetchSSETicket() async throws -> SSETicketResponse {
        try await request(
            SSETicketResponse.self,
            path: "/sse/ticket",
            method: "POST"
        )
    }

    /// Build the `GET /sse/stream?ticket=…` URL using the client's configured
    /// `baseURL`. We use `URLComponents` so the ticket is percent-encoded
    /// safely (tickets are hex but this keeps us honest for future formats).
    func sseStreamURL(ticket: String) -> URL {
        // Safe to force-unwrap: baseURL is always a valid http(s) URL, and
        // we own the path.
        var components = URLComponents(
            url: baseURL.appendingPathComponent("sse/stream"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "ticket", value: ticket)]
        return components.url!
    }
}
