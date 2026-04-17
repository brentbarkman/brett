import Testing
import Foundation
@testable import Brett

/// Downloader tests use a real on-disk cache directory inside the test
/// temp space. We drive the network layer via a `URLSession` built on top of
/// `MockURLProtocol`, so all `URLSession.download(from:)` calls resolve to
/// stubs without touching the network.
@Suite("AttachmentDownloader", .tags(.sync), .serialized)
@MainActor
struct AttachmentDownloaderTests {
    // MARK: - Harness

    final class Harness {
        let cacheDir: URL
        let downloader: AttachmentDownloader
        let apiClient: APIClient

        @MainActor
        init() throws {
            // Fresh, isolated cache dir.
            let root = FileManager.default.temporaryDirectory
                .appendingPathComponent("downloader-test-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            self.cacheDir = root

            // Wire MockURLProtocol into both APIClient session and the
            // session the downloader uses for range-fetch of presigned URLs.
            MockURLProtocol.reset()
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [MockURLProtocol.self]
            let session = URLSession(configuration: config)

            self.apiClient = APIClient(session: session)
            self.apiClient.tokenProvider = { "test-token" }

            self.downloader = AttachmentDownloader(
                apiClient: apiClient,
                cacheDirectory: root,
                session: session
            )
        }

        deinit {
            try? FileManager.default.removeItem(at: cacheDir)
            MockURLProtocol.reset()
        }
    }

    // MARK: - Helpers

    private func makeAttachment(id: String = "att-1", size: Int = 64) -> Brett.Attachment {
        Brett.Attachment(
            id: id,
            filename: "\(id).bin",
            mimeType: "application/octet-stream",
            sizeBytes: size,
            storageKey: "attachments/u1/i1/\(id).bin",
            itemId: "item-1",
            userId: "user-1"
        )
    }

    private func writeFile(at url: URL, size: Int) {
        let data = Data(repeating: 0xCD, count: size)
        try? data.write(to: url)
    }

    // MARK: - Tests

    @Test func cachedFileReturnsImmediatelyWithoutNetwork() async throws {
        let h = try Harness()
        let attachment = makeAttachment(id: "cached-1")
        let cachedURL = h.cacheDir.appendingPathComponent(attachment.id)
        writeFile(at: cachedURL, size: 32)

        // No stubs registered — any network call will fail with resourceUnavailable.
        let resolved = try await h.downloader.localURL(for: attachment)
        #expect(resolved.path == cachedURL.path)
        #expect(FileManager.default.fileExists(atPath: resolved.path))
        #expect(MockURLProtocol.recordedRequests().isEmpty)
    }

    @Test func uncachedFetchesPresignedURLThenDownloads() async throws {
        let h = try Harness()
        let attachment = makeAttachment(id: "net-1")

        // Simulate the presigned URL endpoint (not yet shipped server-side,
        // but we verify the plumbing works when it does).
        let presignedEndpoint = h.apiClient.baseURL
            .appendingPathComponent("attachments/\(attachment.id)/url")
        let presignedFile = URL(string: "https://s3.fake/bucket/net-1")!
        let expiresAt = Date().addingTimeInterval(3600)
        let bodyString = """
        {"url":"\(presignedFile.absoluteString)","expiresAt":"\(ISO8601DateFormatter().string(from: expiresAt))"}
        """
        MockURLProtocol.stub(
            url: presignedEndpoint,
            statusCode: 200,
            body: Data(bodyString.utf8),
            headers: ["Content-Type": "application/json"]
        )

        // The actual file bytes.
        let payload = Data(repeating: 0xEE, count: 48)
        MockURLProtocol.stub(
            url: presignedFile,
            statusCode: 200,
            body: payload,
            headers: ["Content-Type": "application/octet-stream"]
        )

        let local = try await h.downloader.localURL(for: attachment)
        #expect(local.lastPathComponent == attachment.id)
        let bytes = try Data(contentsOf: local)
        #expect(bytes == payload)
    }

    @Test func lruTrimPurgesOldestWhenOverThreshold() async throws {
        let h = try Harness()

        // Seed 3 files. The first gets an old access date; it should be
        // trimmed first. Each is ~200 MB; two fit under the 400 MB trim target.
        let perFile = 200 * 1024 * 1024
        let ids = ["old", "middle", "new"]
        for id in ids {
            let url = h.cacheDir.appendingPathComponent(id)
            // Create a sparse file of the right size without actually
            // writing all the bytes — fast on APFS.
            FileManager.default.createFile(atPath: url.path, contents: nil)
            let fh = try FileHandle(forWritingTo: url)
            try fh.truncate(atOffset: UInt64(perFile))
            try fh.close()
        }

        // Stagger access dates so trimming order is deterministic.
        var oldURL = h.cacheDir.appendingPathComponent("old")
        var midURL = h.cacheDir.appendingPathComponent("middle")
        var newURL = h.cacheDir.appendingPathComponent("new")
        var oldV = URLResourceValues(); oldV.contentAccessDate = Date(timeIntervalSinceNow: -3600)
        var midV = URLResourceValues(); midV.contentAccessDate = Date(timeIntervalSinceNow: -1800)
        var newV = URLResourceValues(); newV.contentAccessDate = Date()
        try oldURL.setResourceValues(oldV)
        try midURL.setResourceValues(midV)
        try newURL.setResourceValues(newV)

        // Total is ~600 MB, over the 500 MB ceiling. Trim to 400 MB.
        try h.downloader.enforceLRULimits()

        let remaining = try FileManager.default.contentsOfDirectory(atPath: h.cacheDir.path).sorted()
        // The oldest ("old") should be gone; newer two remain.
        #expect(!remaining.contains("old"))
        #expect(remaining.contains("middle"))
        #expect(remaining.contains("new"))
    }

    @Test func purgeCacheRemovesAllFiles() async throws {
        let h = try Harness()

        for id in ["a", "b", "c"] {
            writeFile(at: h.cacheDir.appendingPathComponent(id), size: 16)
        }
        #expect(h.downloader.cachedSize() > 0)

        h.downloader.purgeCache()
        #expect(h.downloader.cachedSize() == 0)

        let remaining = try FileManager.default.contentsOfDirectory(atPath: h.cacheDir.path)
        #expect(remaining.isEmpty)
    }
}
