import Testing
import Foundation
import SwiftData
@testable import Brett

/// Exercises the upload queue end-to-end against a `MockURLProtocol`-stubbed
/// API. Each test is wrapped in a fresh in-memory SwiftData container and
/// staging directory, with MockURLProtocol injected via
/// `APIClient.testProtocolClasses` so the ephemeral upload session picks it up.
@Suite("AttachmentUploader", .tags(.sync), .serialized)
@MainActor
struct AttachmentUploaderTests {
    /// Per-test MockURLProtocol reset. Swift Testing constructs a new
    /// `Self` for each `@Test`, so this runs before every test and
    /// isolates the shared-static request log + stub registry from
    /// whatever the previous suite left behind.
    init() { MockURLProtocol.reset() }
    // MARK: - Harness

    final class Harness {
        let persistence: PersistenceController
        let apiClient: APIClient
        let attachmentStore: AttachmentStore
        let uploader: AttachmentUploader
        let stagingDir: URL
        let sourceFile: URL

        @MainActor
        init(size: Int = 128) throws {
            // Fresh in-memory persistence controller. Both uploader and store
            // share this controller's `mainContext`, so they see the same rows.
            self.persistence = PersistenceController.makePreview()

            // Route uploads through MockURLProtocol.
            APIClient.testProtocolClasses = [MockURLProtocol.self]
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [MockURLProtocol.self]
            let session = URLSession(configuration: config)
            self.apiClient = APIClient(session: session)
            self.apiClient.tokenProvider = { "test-token" }

            let ctx = persistence.mainContext
            self.attachmentStore = AttachmentStore(context: ctx)

            // Seed a UserProfile so Uploader can resolve userId on success.
            let profile = UserProfile(id: "user-test-001", email: "t@example.com", name: "Test")
            ctx.insert(profile)
            try ctx.save()

            // Isolated staging dir per test.
            let tempRoot = FileManager.default.temporaryDirectory
                .appendingPathComponent("uploader-test-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
            self.stagingDir = tempRoot

            self.uploader = AttachmentUploader(
                apiClient: apiClient,
                attachmentStore: attachmentStore,
                persistence: persistence,
                stagingDirectory: stagingDir,
                // Tests drive HTTP through MockURLProtocol on the
                // APIClient's URLSession. The production background
                // URLSession (owned by BackgroundUploadService) bypasses
                // that, so opt into the legacy in-process path here.
                useBackgroundSession: false
            )

            // Write a source file with deterministic bytes.
            let src = tempRoot.appendingPathComponent("source.bin")
            let data = Data(repeating: 0xAB, count: size)
            try data.write(to: src)
            self.sourceFile = src
        }

        deinit {
            APIClient.testProtocolClasses = nil
            try? FileManager.default.removeItem(at: stagingDir)
            MockURLProtocol.reset()
        }

        /// Wait for the upload queue to drain. Polls the SwiftData store for
        /// terminal state (done / failed) with a modest timeout.
        @MainActor
        func waitForTerminal(uploadId: String, timeout: TimeInterval = 5) async -> AttachmentUpload? {
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                var descriptor = FetchDescriptor<AttachmentUpload>()
                descriptor.predicate = #Predicate { $0.id == uploadId }
                descriptor.fetchLimit = 1
                if let row = (try? persistence.mainContext.fetch(descriptor))?.first {
                    let stage = row.stageEnum
                    if stage == .done || stage == .failed { return row }
                }
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
            return nil
        }
    }

    // MARK: - Helpers

    /// Build a stub response URL for an item. Base matches the `APIClient`
    /// default (`http://localhost:3001`).
    private func uploadURL(itemId: String) -> URL {
        let base = APIClient().baseURL
        return base.appendingPathComponent("things/\(itemId)/attachments")
    }

    /// Stub a 201 response for a given attachment id. We build the JSON
    /// by hand because `AttachmentResponse` is `Decodable`-only.
    private func stubSuccess(
        itemId: String,
        attachmentId: String,
        filename: String = "source.bin",
        mimeType: String = "application/octet-stream",
        sizeBytes: Int = 128,
        storageKey: String = "attachments/u/i/key"
    ) {
        let createdAt = ISO8601DateFormatter().string(from: Date())
        let json = """
        {
          "id": "\(attachmentId)",
          "filename": "\(filename)",
          "mimeType": "\(mimeType)",
          "sizeBytes": \(sizeBytes),
          "storageKey": "\(storageKey)",
          "createdAt": "\(createdAt)"
        }
        """
        MockURLProtocol.stub(
            url: uploadURL(itemId: itemId),
            statusCode: 201,
            body: Data(json.utf8),
            headers: ["Content-Type": "application/json"]
        )
    }

    private func stubFailure(itemId: String, statusCode: Int) {
        let body = Data(#"{"error":"boom"}"#.utf8)
        MockURLProtocol.stub(
            url: uploadURL(itemId: itemId),
            statusCode: statusCode,
            body: body
        )
    }

    // MARK: - Tests

    @Test func enqueueCreatesPendingUpload() async throws {
        let h = try Harness()
        defer { _ = h }

        // Stub a response even though we may not complete the cycle — the queue
        // drain kicks in immediately.
        stubSuccess(itemId: "item-1", attachmentId: "att-1")

        let upload = try await h.uploader.enqueue(
            itemId: "item-1",
            fileURL: h.sourceFile,
            filename: "source.bin",
            mimeType: "application/octet-stream"
        )

        #expect(upload.itemId == "item-1")
        #expect(upload.sizeBytes == 128)
        #expect(upload.filename == "source.bin")
        // File should have been copied into the staging dir.
        #expect(FileManager.default.fileExists(atPath: upload.localFilePath))
        #expect(upload.localFilePath.hasPrefix(h.stagingDir.path))
    }

    @Test func successfulUploadInsertsAttachmentAndCleansFile() async throws {
        let h = try Harness()

        stubSuccess(itemId: "item-1", attachmentId: "att-success")

        let upload = try await h.uploader.enqueue(
            itemId: "item-1",
            fileURL: h.sourceFile,
            filename: "source.bin",
            mimeType: "application/octet-stream"
        )
        let stagedPath = upload.localFilePath

        let terminal = await h.waitForTerminal(uploadId: upload.id)
        let finalStage = terminal?.stageEnum
        #expect(finalStage == .done)

        // Attachment row should now exist in the store.
        let attachments = h.attachmentStore.fetchForItem("item-1")
        #expect(attachments.contains { $0.id == "att-success" })

        // Staged file should be gone.
        #expect(!FileManager.default.fileExists(atPath: stagedPath))
    }

    @Test func failedUploadMarksFailedAndPreservesFile() async throws {
        let h = try Harness()

        stubFailure(itemId: "item-1", statusCode: 500)

        let upload = try await h.uploader.enqueue(
            itemId: "item-1",
            fileURL: h.sourceFile,
            filename: "source.bin",
            mimeType: "application/octet-stream"
        )

        let terminal = await h.waitForTerminal(uploadId: upload.id)
        #expect(terminal?.stageEnum == .failed)
        #expect(terminal?.retryCount ?? 0 >= 1)

        // Staged file kept for retry.
        if let path = terminal?.localFilePath {
            #expect(FileManager.default.fileExists(atPath: path))
        }
    }

    @Test func enqueueRejectsOversizedFile() async throws {
        let h = try Harness(size: 1)  // content irrelevant; we'll substitute a bigger file

        // Synthesize an oversized file by filling its reported size via a
        // dedicated 26 MB write. We skip the real allocation by creating a
        // sparse file using truncate — on APFS this is near-instant.
        let big = h.stagingDir.appendingPathComponent("big.bin")
        FileManager.default.createFile(atPath: big.path, contents: nil)
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: UInt64(AttachmentUploader.maxFileSize + 1))
        try handle.close()

        do {
            _ = try await h.uploader.enqueue(
                itemId: "item-1",
                fileURL: big,
                filename: "big.bin",
                mimeType: "application/octet-stream"
            )
            Issue.record("enqueue should have thrown fileTooLarge")
        } catch let err as AttachmentUploader.EnqueueError {
            if case .fileTooLarge = err {
                // expected
            } else {
                Issue.record("unexpected error: \(err)")
            }
        }

        // And no network activity should have happened.
        #expect(MockURLProtocol.recordedRequests().isEmpty)
    }

    @Test func enqueueRejectsMissingMimeType() async throws {
        let h = try Harness()

        do {
            _ = try await h.uploader.enqueue(
                itemId: "item-1",
                fileURL: h.sourceFile,
                filename: "source.bin",
                mimeType: ""
            )
            Issue.record("enqueue should have thrown missingMimeType")
        } catch let err as AttachmentUploader.EnqueueError {
            #expect(err == .missingMimeType)
        }
    }
}
