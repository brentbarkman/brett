import Foundation
import Observation

/// Shared HTTP client for talking to the Brett API.
///
/// Responsibilities:
/// - Resolves base URL from `Info.plist` key `BrettAPIURL` (default
///   `http://localhost:3001` for dev).
/// - Injects `Authorization: Bearer <token>` using a pluggable token provider
///   — wired to `AuthManager` at app launch so auth state changes are picked
///   up without the client holding a strong reference back to the manager.
/// - Decodes JSON with `.iso8601` date strategy.
/// - Maps `URLError`s to `APIError` cases so callers can branch on transport
///   failures uniformly.
@MainActor
@Observable
final class APIClient {
    static let shared = APIClient()

    /// Parsed base URL for all API calls. Read once at init; Info.plist
    /// changes require a relaunch anyway.
    let baseURL: URL

    /// Closure that returns the current bearer token, or nil if unauthenticated.
    /// Wired by `AuthManager` at app startup. Kept as a closure (not a direct
    /// reference) so the client stays usable even during AuthManager tear-down.
    var tokenProvider: (@Sendable () -> String?)?

    private let session: URLSession
    private let decoder: JSONDecoder

    /// Preferred initialiser for tests — pass a stubbed URLSession.
    init(session: URLSession = .shared) {
        self.baseURL = Self.resolveBaseURL()
        self.session = session

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        // Mirror the resolved base URL into the App Group so the share
        // extension talks to the same API server the main app does. Matters
        // in dev where `BrettAPIURL` is a LAN IP that changes by network —
        // without this the extension would silently post to production.
        SharedConfig.writeAPIURL(self.baseURL)
    }

    // MARK: - Base URL resolution

    private static func resolveBaseURL() -> URL {
        let fallback = URL(string: "http://localhost:3001")!
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "BrettAPIURL") as? String,
              !raw.isEmpty,
              let url = URL(string: raw) else {
            return fallback
        }
        return url
    }

    // MARK: - Core request primitives

    /// Perform a raw request and return the body as `Data`. Used by auth
    /// endpoints that need to read `Set-Cookie` alongside the body.
    func rawRequest(
        path: String,
        method: String,
        body: Data? = nil,
        timeout: TimeInterval = 30
    ) async throws -> (data: Data, response: HTTPURLResponse) {
        let url = baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
        let token = tokenProvider?()
        let request = RequestBuilder.build(
            url: url,
            method: method,
            token: token,
            body: body,
            timeout: timeout
        )

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.unknown(URLError(.badServerResponse))
            }
            try Self.validate(status: http.statusCode, data: data)
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch let urlError as URLError {
            throw Self.map(urlError: urlError)
        } catch {
            throw APIError.unknown(error)
        }
    }

    /// Perform a request and decode the JSON body to `T`.
    func request<T: Decodable>(
        _ type: T.Type = T.self,
        path: String,
        method: String,
        body: Encodable? = nil,
        timeout: TimeInterval = 30
    ) async throws -> T {
        let encoded: Data?
        if let body {
            encoded = try JSONEncoder().encode(AnyEncodable(body))
        } else {
            encoded = nil
        }

        let (data, _) = try await rawRequest(
            path: path,
            method: method,
            body: encoded,
            timeout: timeout
        )

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    /// Perform a request with a raw relative path+query string (e.g.
    /// `"/api/search?q=hello&limit=30"`). `request(path:)` routes through
    /// `URL.appendingPathComponent`, which percent-encodes `?` — use this
    /// variant when the query string must stay intact.
    func requestRelative<T: Decodable>(
        _ type: T.Type = T.self,
        relativePath: String,
        method: String,
        body: Encodable? = nil,
        timeout: TimeInterval = 30
    ) async throws -> T {
        let encoded: Data?
        if let body {
            encoded = try JSONEncoder().encode(AnyEncodable(body))
        } else {
            encoded = nil
        }

        let trimmed = relativePath.hasPrefix("/") ? String(relativePath.dropFirst()) : relativePath
        guard let url = URL(string: trimmed, relativeTo: baseURL)?.absoluteURL else {
            throw APIError.unknown(URLError(.badURL))
        }

        let token = tokenProvider?()
        let request = RequestBuilder.build(
            url: url,
            method: method,
            token: token,
            body: encoded,
            timeout: timeout
        )

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.unknown(URLError(.badServerResponse))
            }
            try Self.validate(status: http.statusCode, data: data)
            return try decoder.decode(T.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let decoding as DecodingError {
            throw APIError.decodingFailed(decoding)
        } catch let urlError as URLError {
            throw Self.map(urlError: urlError)
        } catch {
            throw APIError.unknown(error)
        }
    }

    // MARK: - Status validation

    private static func validate(status: Int, data: Data) throws {
        switch status {
        case 200...299:
            return
        case 401:
            throw APIError.unauthorized
        case 429:
            // We can't read headers here — caller can use rawRequest if it
            // needs Retry-After. For now surface nil.
            throw APIError.rateLimited(retryAfter: nil)
        case 400, 422:
            // Try to pull a message out of the JSON body.
            let message = Self.extractErrorMessage(from: data) ?? "Invalid request."
            throw APIError.validation(message)
        case 500...599:
            throw APIError.serverError(status)
        default:
            throw APIError.serverError(status)
        }
    }

    private static func extractErrorMessage(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return (json["message"] as? String) ?? (json["error"] as? String)
    }

    private static func map(urlError: URLError) -> APIError {
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
            return .offline
        case .timedOut:
            return .unknown(urlError)
        default:
            return .unknown(urlError)
        }
    }
}

// MARK: - Type erasure for encodable bodies

/// Small wrapper to let `request(...)` accept an `Encodable` without making
/// the method generic on the body type. Swift's stdlib doesn't give us an
/// easy `AnyEncodable` so we roll our own.
private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        self.encodeFunc = { try wrapped.encode(to: $0) }
    }

    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}
