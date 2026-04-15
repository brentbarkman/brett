import Foundation
import UniformTypeIdentifiers

/// Core logic of the share extension: extract URL/text from NSItemProviders,
/// build a `SharePayload`, persist it to the App Group queue, and best-effort
/// POST to `/sync/push`.
///
/// Separated from `ShareViewController` so the logic is testable without
/// needing an actual running extension + share sheet. The view controller
/// is just plumbing — all interesting behaviour lives here.
///
/// Pinned to the main actor because `NSExtensionItem` / `NSItemProvider`
/// aren't `Sendable` in Swift 6 — passing them across actor boundaries
/// warns/errors. The work here is I/O bound (file write + network), not
/// CPU bound, so main-actor isolation has no performance cost.
@MainActor
enum ShareService {

    // MARK: - Public entry points

    /// Output of `persistPayload(inputItems:)` — the pending queue file URL
    /// and the payload it was built from. Passed through to the best-effort
    /// POST step after `completeRequest` dismisses the share sheet.
    struct PersistedShare: Sendable {
        let payload: SharePayload
        let pendingURL: URL
    }

    /// Step 1 — synchronously extract content, build the payload, and write
    /// the `.pending.json` queue file. This is the fast, durable half of the
    /// pipeline; the caller (`ShareViewController`) should call
    /// `extensionContext.completeRequest` IMMEDIATELY after this returns so
    /// the share sheet dismisses without waiting on the network POST.
    ///
    /// Returns `nil` if nothing was shareable or the queue file couldn't be
    /// written — in either case there's no follow-up work for the POST step.
    static func persistPayload(inputItems: [NSExtensionItem]) async -> PersistedShare? {
        let extracted = await extractRawContent(from: inputItems)

        let userId = SharedConfig.resolveCurrentUserId()
        guard let payload = SharePayload.build(
            url: extracted.url,
            text: extracted.text,
            userId: userId
        ) else {
            log("share: nothing to save (no URL, no non-empty text)")
            return nil
        }

        guard let queueDir = SharedConfig.shareQueueDirectory() else {
            log("share: App Group unavailable — cannot persist queue file")
            return nil
        }

        let pendingURL = queueDir.appendingPathComponent("\(payload.id).pending.json")
        do {
            let data = try encoder.encode(payload)
            // `.completeUntilFirstUserAuthentication` (not `.completeFileProtection`)
            // so share extensions can write while the device is locked after
            // first unlock since boot — share sheet can fire from the lock
            // screen via Today/Notification panel in some flows.
            try data.write(to: pendingURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            log("share: failed to write queue file: \(error)")
            return nil
        }

        return PersistedShare(payload: payload, pendingURL: pendingURL)
    }

    /// Step 2 — best-effort POST to `/sync/push`. Called AFTER
    /// `completeRequest` fires so it runs in the extension's grace period.
    /// On success, renames `.pending.json` → `.posted.json` so the main
    /// app's `ShareIngestor` inserts the Item as already-synced.
    ///
    /// The extension process may be terminated at any point during this
    /// call; the queue file is the durable truth and the main app reconciles
    /// whichever state the file is left in.
    static func attemptPost(_ persisted: PersistedShare) async {
        guard let token = SharedKeychain.readToken() else {
            log("share: no token — leaving .pending for main app reconciliation")
            return
        }

        do {
            try await postToSyncPush(payload: persisted.payload, token: token)
            let postedURL = persisted.pendingURL
                .deletingLastPathComponent()
                .appendingPathComponent("\(persisted.payload.id).posted.json")
            try? FileManager.default.moveItem(at: persisted.pendingURL, to: postedURL)
            log("share: posted + renamed to \(persisted.payload.id).posted.json")
        } catch {
            log("share: POST failed (\(error)) — leaving .pending for main app")
        }
    }

    // MARK: - Provider extraction

    /// Iterate every attachment across every extension item, loading URL
    /// and/or plain text. If multiple URLs or texts are offered we take the
    /// first match — the share sheet contract is that a single target gets
    /// a cohesive payload, so "first wins" is safe.
    private static func extractRawContent(
        from items: [NSExtensionItem]
    ) async -> (url: URL?, text: String?) {
        var foundURL: URL?
        var foundText: String?

        for item in items {
            guard let attachments = item.attachments else { continue }

            for provider in attachments {
                if foundURL == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    foundURL = await loadURL(from: provider)
                }
                if foundText == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    foundText = await loadText(from: provider)
                }
                // Short-circuit once we've got both.
                if foundURL != nil && foundText != nil {
                    return (foundURL, foundText)
                }
            }
        }
        return (foundURL, foundText)
    }

    private static func loadURL(from provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                if let url = item as? URL {
                    continuation.resume(returning: url)
                } else if let data = item as? Data,
                          let string = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: URL(string: string))
                } else if let string = item as? String {
                    continuation.resume(returning: URL(string: string))
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private static func loadText(from provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                if let string = item as? String {
                    continuation.resume(returning: string)
                } else if let data = item as? Data {
                    continuation.resume(returning: String(data: data, encoding: .utf8))
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    // MARK: - /sync/push

    /// POST a single CREATE mutation to `/sync/push`. Throws on transport
    /// failure, non-2xx status, or timeout. The extension's caller catches
    /// and logs — the queue file carries the retry responsibility.
    private static func postToSyncPush(payload: SharePayload, token: String) async throws {
        let baseURL = SharedConfig.resolveAPIURL()
        let pushURL = baseURL.appendingPathComponent("sync/push")

        // Build the mutation payload to match the server's SyncMutation shape.
        // Keep this in sync with `apps/api/src/routes/sync.ts`.
        var itemPayload: [String: Any] = [
            "type": payload.type,
            "title": payload.title,
            "source": payload.source,
            "status": "active",
        ]
        if let sourceUrl = payload.sourceUrl {
            itemPayload["sourceUrl"] = sourceUrl
        }
        if let notes = payload.notes {
            itemPayload["notes"] = notes
        }

        let mutation: [String: Any] = [
            "idempotencyKey": payload.idempotencyKey,
            "entityType": "item",
            "entityId": payload.id,
            "action": "CREATE",
            "payload": itemPayload,
        ]

        let body: [String: Any] = [
            "protocolVersion": 1,
            "mutations": [mutation],
        ]

        var request = URLRequest(url: pushURL)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        // Tight timeout — the extension has a limited lifetime. If we can't
        // finish in 3s, the queue file catches us.
        request.timeoutInterval = 3.0

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 3.0
        config.timeoutIntervalForResource = 3.0
        // No caching — auth responses shouldn't be cached and we don't benefit.
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        // Don't carry cookies — the endpoint is Bearer-auth'd.
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never

        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ShareServiceError.badResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ShareServiceError.httpStatus(http.statusCode)
        }
    }

    // MARK: - Helpers

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static func log(_ message: String) {
        #if DEBUG
        // os_log would be more structured but NSLog is fine for an extension
        // and shows up in Console.app without extra setup.
        NSLog("[BrettShareExtension] %@", message)
        #endif
    }
}

enum ShareServiceError: Error {
    case badResponse
    case httpStatus(Int)
}
