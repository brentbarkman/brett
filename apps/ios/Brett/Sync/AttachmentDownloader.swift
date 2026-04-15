import Foundation
import Observation

/// Attachment download + cache manager.
///
/// Fetches presigned URLs from the API, downloads the file, and stashes it in
/// `~/Library/Caches/attachments/<attachment.id>`. Returns the local path for
/// any subsequent hit without going back to the network.
///
/// LRU enforcement:
///  - Soft ceiling: 500 MB. When exceeded after a fresh write, we trim by
///    oldest-access time until we fall back below 400 MB.
///  - Uses `contentAccessDate` (best-effort) then `contentModificationDate`
///    for ordering — `accessDate` only updates when the cache is read via
///    our public API.
///
/// Server caveat: `GET /attachments/:id/url` does NOT exist yet (confirmed
/// 2026-04-14). Until it ships, `localURL(for:)` will throw `.presignedURLUnavailable`
/// on cache miss. Callers should fall back to the `url` already embedded in
/// `/things/:itemId` detail responses and write to the cache via
/// `cache(attachmentId:presignedURL:)`.
@MainActor
@Observable
final class AttachmentDownloader {
    /// Trim triggers when cached bytes exceed `maxCacheBytes`; drops files
    /// until under `trimTargetBytes`. 500 MB ceiling / 400 MB target.
    static let maxCacheBytes: Int = 500 * 1024 * 1024
    static let trimTargetBytes: Int = 400 * 1024 * 1024

    enum DownloadError: Error, Equatable {
        case presignedURLUnavailable
        case badResponse(Int)
        case emptyPayload
    }

    private let apiClient: APIClient
    private let fileManager: FileManager
    private let session: URLSession

    /// Root directory for cached attachment bodies. Created on first use.
    let cacheDirectory: URL

    // MARK: - Init

    init(
        apiClient: APIClient,
        cacheDirectory: URL? = nil,
        fileManager: FileManager = .default,
        session: URLSession = .shared
    ) {
        self.apiClient = apiClient
        self.fileManager = fileManager
        self.session = session

        if let cacheDirectory {
            self.cacheDirectory = cacheDirectory
        } else {
            let caches = (try? fileManager.url(
                for: .cachesDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )) ?? fileManager.temporaryDirectory
            self.cacheDirectory = caches.appendingPathComponent("attachments", isDirectory: true)
        }

        try? fileManager.createDirectory(at: self.cacheDirectory, withIntermediateDirectories: true)
    }

    // MARK: - Public API

    /// Returns a local file URL for the attachment. Fetches + caches on miss.
    /// The caller can open this with `UIDocumentInteractionController`,
    /// `QLPreviewController`, etc.
    func localURL(for attachment: Attachment) async throws -> URL {
        let destination = cachePath(for: attachment)

        if fileManager.fileExists(atPath: destination.path) {
            touchAccessTime(at: destination)
            return destination
        }

        // Cache miss — we need a presigned URL. Try the dedicated endpoint;
        // if the server hasn't shipped it yet we surface a typed error so
        // the caller can fall back to the detail-response URL.
        let presigned = try await apiClient.attachmentPresignedURL(attachmentId: attachment.id)
        try await download(presignedURL: presigned.url, destination: destination)
        touchAccessTime(at: destination)
        try enforceLRULimits()
        return destination
    }

    /// Download a file given a presigned URL directly. Useful when the caller
    /// already has a fresh URL from a `/things/:id` detail response and wants
    /// to pre-warm the cache without asking the (currently missing) presigned
    /// URL endpoint.
    @discardableResult
    func cache(attachmentId: String, presignedURL: URL) async throws -> URL {
        let destination = cacheDirectory.appendingPathComponent(attachmentId)

        if fileManager.fileExists(atPath: destination.path) {
            touchAccessTime(at: destination)
            return destination
        }

        try await download(presignedURL: presignedURL, destination: destination)
        touchAccessTime(at: destination)
        try enforceLRULimits()
        return destination
    }

    /// Wipe every file in the cache directory. Tolerant of permission errors
    /// so callers don't have to inspect results.
    func purgeCache() {
        guard let items = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: nil
        ) else { return }

        for url in items {
            try? fileManager.removeItem(at: url)
        }
    }

    /// Total bytes held in the cache directory. Reads the filesystem so it
    /// stays honest across launches.
    func cachedSize() -> Int {
        guard let items = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.fileSizeKey]
        ) else { return 0 }

        return items.reduce(0) { total, url in
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            return total + size
        }
    }

    /// Run LRU trimming manually. Normally called internally after a write.
    /// Exposed so tests can drive it without racing on download I/O.
    func enforceLRULimits() throws {
        var total = cachedSize()
        guard total > Self.maxCacheBytes else { return }

        let keys: [URLResourceKey] = [.fileSizeKey, .contentAccessDateKey, .contentModificationDateKey]
        guard let items = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: keys
        ) else { return }

        // Oldest-access-first. Fall back to modification date when access
        // dates are missing (HFS+ doesn't always record them).
        let sorted = items.sorted { a, b in
            let av = try? a.resourceValues(forKeys: Set(keys))
            let bv = try? b.resourceValues(forKeys: Set(keys))
            let aDate = av?.contentAccessDate ?? av?.contentModificationDate ?? .distantPast
            let bDate = bv?.contentAccessDate ?? bv?.contentModificationDate ?? .distantPast
            return aDate < bDate
        }

        for url in sorted {
            if total <= Self.trimTargetBytes { break }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            try fileManager.removeItem(at: url)
            total -= size
        }
    }

    // MARK: - Internals

    private func cachePath(for attachment: Attachment) -> URL {
        cacheDirectory.appendingPathComponent(attachment.id)
    }

    /// Download a file and atomically write it to `destination`. Uses
    /// `URLSession.download` which streams to a temporary file without
    /// buffering the whole body in memory.
    private func download(presignedURL: URL, destination: URL) async throws {
        let (tempURL, response) = try await session.download(from: presignedURL)

        guard let http = response as? HTTPURLResponse else {
            throw DownloadError.badResponse(0)
        }
        guard (200...299).contains(http.statusCode) else {
            throw DownloadError.badResponse(http.statusCode)
        }

        // Atomic move. If something already exists at destination (another
        // concurrent write, cache corruption), remove it first.
        if fileManager.fileExists(atPath: destination.path) {
            try? fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: tempURL, to: destination)

        let attrs = (try? fileManager.attributesOfItem(atPath: destination.path)) ?? [:]
        let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
        if size == 0 {
            try? fileManager.removeItem(at: destination)
            throw DownloadError.emptyPayload
        }
    }

    /// Nudge the file's access time forward so LRU considers it fresh. Done
    /// on every cache hit so recently-used files don't get trimmed first.
    private func touchAccessTime(at url: URL) {
        var urlCopy = url
        var values = URLResourceValues()
        values.contentAccessDate = Date()
        try? urlCopy.setResourceValues(values)
    }
}
