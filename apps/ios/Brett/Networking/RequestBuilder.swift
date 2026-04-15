import Foundation

/// Helper to construct `URLRequest`s with common headers applied consistently.
/// All outgoing API requests flow through `APIClient`, which uses this builder.
enum RequestBuilder {
    /// Default user-agent for all API requests. The API logs it, and it helps
    /// distinguish iOS traffic from desktop.
    static let userAgent = "Brett-iOS/1.0"

    /// Build a request against an API endpoint. Common headers (Content-Type,
    /// User-Agent, optional Authorization) are attached here. Pass `body` as
    /// already-encoded JSON data, or nil for GET/DELETE.
    static func build(
        url: URL,
        method: String,
        token: String? = nil,
        body: Data? = nil,
        timeout: TimeInterval = 30
    ) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        return request
    }
}
