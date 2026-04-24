import Foundation

/// Typed `APIClient` extension for the attachment routes.
///
/// Notes:
/// - Upload uses a binary request body (not JSON), with `X-Filename` and a
///   custom `Content-Type`. Progress is surfaced via a continuation-based
///   delegate that forwards `URLSessionTaskDelegate.didSendBodyData` into
///   the caller's closure.
/// - Delete hits `/things/:itemId/attachments/:attachmentId` and expects
///   a 2xx body that we don't read (server returns `{ ok: true }` today).
/// - `attachmentPresignedURL(...)` targets `GET /attachments/:id/url`. That
///   endpoint does NOT yet exist on the server (confirmed 2026-04-14). The
///   method is kept for forward compatibility; callers currently receive a
///   404 and must fall back to the `/things/:id` detail response, which
///   embeds fresh presigned URLs for every attachment.
///   Server TODO: add `GET /attachments/:id/url` returning `{ url, expiresAt }`.
@MainActor
extension APIClient {
    // MARK: - Response shapes

    /// Mirrors the server response from `POST /things/:itemId/attachments`.
    /// Note: `storageKey` is currently NOT returned by the server (confirmed
    /// against `apps/api/src/routes/attachments.ts`). Kept as optional so we
    /// can consume a future additive response without breaking older clients.
    struct AttachmentResponse: Decodable, Sendable {
        let id: String
        let filename: String
        let mimeType: String
        let sizeBytes: Int
        let storageKey: String?
        let createdAt: Date
    }

    /// Response of `GET /attachments/:id/url` (not yet implemented server-side).
    struct AttachmentURLResponse: Decodable, Sendable {
        let url: URL
        let expiresAt: Date
    }

    // MARK: - Upload

    /// Build the URLRequest used by the attachment upload endpoint without
    /// executing it. `BackgroundUploadService` needs this so it can hand
    /// the request to `URLSessionConfiguration.background` — which is the
    /// only way an upload survives app termination. Shape matches what
    /// `uploadAttachment(...)` below sends, so a server that works for
    /// the foreground path works for the background path.
    func buildAttachmentUploadRequest(
        itemId: String,
        fileURL: URL,
        filename: String,
        mimeType: String
    ) throws -> URLRequest {
        let url = baseURL.appendingPathComponent("things/\(itemId)/attachments")
        let sizeBytes = try Self.fileSize(at: fileURL)
        let encodedFilename = filename.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? filename

        var request = URLRequest(url: url, timeoutInterval: 300)
        request.httpMethod = "POST"
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(encodedFilename, forHTTPHeaderField: "X-Filename")
        request.setValue(String(sizeBytes), forHTTPHeaderField: "Content-Length")
        request.setValue(RequestBuilder.userAgent, forHTTPHeaderField: "User-Agent")
        if let token = tokenProvider?(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// POST a file to `/things/:itemId/attachments`.
    ///
    /// - Parameters:
    ///   - itemId: owning item id.
    ///   - fileURL: on-disk file to stream up. Must be a file:// URL.
    ///   - filename: human-readable filename (will be URL-encoded into `X-Filename`).
    ///   - mimeType: wire `Content-Type`. Server re-validates via magic bytes.
    ///   - progress: called on arbitrary threads with fraction in `[0, 1]`.
    /// - Returns: server-assigned attachment metadata.
    /// - Throws: `APIError`.
    func uploadAttachment(
        itemId: String,
        fileURL: URL,
        filename: String,
        mimeType: String,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> AttachmentResponse {
        let url = baseURL.appendingPathComponent("things/\(itemId)/attachments")
        let sizeBytes = try Self.fileSize(at: fileURL)

        // X-Filename must be URL-percent-encoded so non-ASCII filenames survive.
        let encodedFilename = filename.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? filename

        var request = URLRequest(url: url, timeoutInterval: 300)
        request.httpMethod = "POST"
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(encodedFilename, forHTTPHeaderField: "X-Filename")
        request.setValue(String(sizeBytes), forHTTPHeaderField: "Content-Length")
        request.setValue(RequestBuilder.userAgent, forHTTPHeaderField: "User-Agent")
        if let token = tokenProvider?(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // One-shot session per upload so the delegate forwards *our* progress
        // closure. URLSessionDelegate is retained strongly by the session, so
        // we `finishTasksAndInvalidate()` after the upload completes.
        //
        // Config choice: `.default` (not `.ephemeral`) so the session has the
        // URL cache + connection pooling the OS uses for regular transfers,
        // then tuned for the large-file upload case:
        //
        //   - waitsForConnectivity = true: if the user drops off Wi-Fi
        //     mid-upload we pause and resume instead of failing instantly.
        //   - timeoutIntervalForResource = 600s: a 20 MB video on 3G can take
        //     multiple minutes; the default 7-day resource timeout is fine
        //     but we cap explicitly so a stuck upload eventually gives up.
        //   - allowsExpensiveNetworkAccess / allowsConstrainedNetworkAccess
        //     = true: users sharing a file after a Low Data Mode toggle
        //     should still succeed.
        //
        // TODO(WAVE-B-follow-up): migrate to a true background URLSession
        // (URLSessionConfiguration.background(withIdentifier:)) so uploads
        // survive app termination. Requires plumbing through the app
        // delegate's `application(_:handleEventsForBackgroundURLSession:)`
        // handler plus persisting in-flight uploadTask state across launches.
        let delegate = UploadProgressDelegate(progress: progress)
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForResource = 600
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        // Piggy-back on the shared-session's protocol classes so tests using
        // MockURLProtocol on the APIClient-owned session still get intercepted.
        config.protocolClasses = APIClient.testProtocolClasses ?? config.protocolClasses
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.upload(for: request, fromFile: fileURL)
        } catch let urlError as URLError {
            throw Self.mapForAttachments(urlError: urlError)
        } catch {
            throw APIError.unknown(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.unknown(URLError(.badServerResponse))
        }
        try Self.validateAttachments(status: http.statusCode, data: data)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(AttachmentResponse.self, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    // MARK: - Delete

    /// DELETE `/things/:itemId/attachments/:attachmentId`. Ignores the body.
    func deleteAttachment(itemId: String, attachmentId: String) async throws {
        _ = try await rawRequest(
            path: "/things/\(itemId)/attachments/\(attachmentId)",
            method: "DELETE"
        )
    }

    // MARK: - Presigned URL fetch

    /// GET `/attachments/:id/url` — NOT CURRENTLY IMPLEMENTED SERVER-SIDE.
    /// Kept as forward-compat stub. Returns 404 today; callers should fall
    /// back to re-fetching `/things/:itemId` to grab a fresh presigned URL.
    func attachmentPresignedURL(attachmentId: String) async throws -> AttachmentURLResponse {
        try await request(
            AttachmentURLResponse.self,
            path: "/attachments/\(attachmentId)/url",
            method: "GET"
        )
    }

    // MARK: - Response parsing

    /// Decode the body of an attachment upload response. Used by
    /// `BackgroundUploadService` to reconstruct the typed result from the
    /// raw bytes its URLSession delegate callback receives. Status-code
    /// validation mirrors the foreground path.
    static func parseAttachmentUploadResponse(
        data: Data?,
        httpStatus: Int?
    ) throws -> AttachmentResponse {
        guard let httpStatus else {
            throw APIError.unknown(URLError(.badServerResponse))
        }
        let body = data ?? Data()
        try validateAttachments(status: httpStatus, data: body)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(AttachmentResponse.self, from: body)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    // MARK: - Test plumbing

    /// Tests set this to inject `MockURLProtocol` into per-upload ephemeral
    /// sessions. Untouched in production (remains nil).
    nonisolated(unsafe) static var testProtocolClasses: [AnyClass]?

    // MARK: - Helpers

    private static func fileSize(at url: URL) throws -> Int {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        return values.fileSize ?? 0
    }

    /// Duplicates `APIClient.validate` — kept inline so we can call it from
    /// the extension (the original is `private`). Keep logic in sync.
    /// Response validator, accessible from `BackgroundUploadService` via
    /// `parseAttachmentUploadResponse`. Intentionally `internal` so test
    /// harnesses can drive edge cases.
    static func validateAttachments(status: Int, data: Data) throws {
        switch status {
        case 200...299:
            return
        case 401:
            throw APIError.unauthorized
        case 429:
            throw APIError.rateLimited(retryAfter: nil)
        case 400, 422:
            let message = Self.extractAttachmentsErrorMessage(from: data) ?? "Invalid request."
            throw APIError.validation(message)
        case 500...599:
            throw APIError.serverError(status)
        default:
            throw APIError.serverError(status)
        }
    }

    static func extractAttachmentsErrorMessage(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return (json["message"] as? String) ?? (json["error"] as? String)
    }

    fileprivate static func mapForAttachments(urlError: URLError) -> APIError {
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
            return .offline
        case .cancelled:
            return .unknown(urlError)
        default:
            return .unknown(urlError)
        }
    }
}

/// URLSession delegate that forwards `didSendBodyData` into a client-supplied
/// progress closure. Kept at file-scope (not nested) so we can construct it
/// without capturing self, and so tests can instantiate it directly.
final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let progress: @Sendable (Double) -> Void

    init(progress: @escaping @Sendable (Double) -> Void) {
        self.progress = progress
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard totalBytesExpectedToSend > 0 else { return }
        let fraction = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
        progress(min(max(fraction, 0), 1))
    }
}
