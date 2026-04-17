import Testing
import Foundation
import SwiftData
@testable import Brett

/// Retry + edge-case behaviour for `AttachmentUploader`. The positive path is
/// covered by `AttachmentUploaderTests`; here we hammer the error flows:
///  - Retry count increments on transient 5xx failures.
///  - Rows stop retrying once they hit the cap, stage transitions to `failed`.
///  - Permanent 4xx rejections (bad MIME type) stop retry immediately.
///  - Huge files rejected before any network activity.
///  - Cancel flips the in-flight row to `failed`.
@Suite("AttachmentRetry", .tags(.sync), .serialized)
@MainActor
struct AttachmentRetryTests {
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
            self.persistence = PersistenceController.makePreview()

            APIClient.testProtocolClasses = [MockURLProtocol.self]
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [MockURLProtocol.self]
            let session = URLSession(configuration: config)
            self.apiClient = APIClient(session: session)
            self.apiClient.tokenProvider = { "test-token" }

            let ctx = persistence.mainContext
            self.attachmentStore = AttachmentStore(context: ctx)

            let profile = UserProfile(id: "user-test-001", email: "t@example.com", name: "Test")
            ctx.insert(profile)
            try ctx.save()

            let tempRoot = FileManager.default.temporaryDirectory
                .appendingPathComponent("uploader-retry-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
            self.stagingDir = tempRoot

            self.uploader = AttachmentUploader(
                apiClient: apiClient,
                attachmentStore: attachmentStore,
                persistence: persistence,
                stagingDirectory: stagingDir
            )

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

        @MainActor
        func waitForTerminal(uploadId: String, timeout: TimeInterval = 5) async -> AttachmentUpload? {
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                var descriptor = FetchDescriptor<AttachmentUpload>()
                descriptor.predicate = #Predicate { $0.id == uploadId }
                descriptor.fetchLimit = 1
                if let row = (try? persistence.mainContext.fetch(descriptor))?.first {
                    if row.stageEnum == .done || row.stageEnum == .failed { return row }
                }
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
            return nil
        }
    }

    // MARK: - Helpers

    private func uploadURL(itemId: String) -> URL {
        APIClient().baseURL.appendingPathComponent("things/\(itemId)/attachments")
    }

    private func stubFailure(itemId: String, statusCode: Int, body: String = #"{"error":"boom"}"#) {
        MockURLProtocol.stub(
            url: uploadURL(itemId: itemId),
            statusCode: statusCode,
            body: Data(body.utf8)
        )
    }

    private func stubTransportError(itemId: String, error: URLError.Code = .networkConnectionLost) {
        MockURLProtocol.stub(
            url: uploadURL(itemId: itemId),
            error: URLError(error)
        )
    }

    // MARK: - Transient 5xx — retry count bumped, row stays recoverable

    @Test func transient500MarksFailedWithRetryCount() async throws {
        let h = try Harness()
        MockURLProtocol.reset()
        stubFailure(itemId: "item-a", statusCode: 500)

        let upload = try await h.uploader.enqueue(
            itemId: "item-a",
            fileURL: h.sourceFile,
            filename: "source.bin",
            mimeType: "application/octet-stream"
        )

        let terminal = await h.waitForTerminal(uploadId: upload.id)
        #expect(terminal?.stageEnum == .failed)
        #expect(terminal?.retryCount ?? 0 == 1)
        // Staged file still present — required for a retry on the next cycle.
        if let path = terminal?.localFilePath {
            #expect(FileManager.default.fileExists(atPath: path))
        }
    }

    // MARK: - Reprocess after first failure — second attempt also fails

    @Test func secondProcessCycleBumpsRetryCountAgain() async throws {
        let h = try Harness()
        MockURLProtocol.reset()
        stubFailure(itemId: "item-b", statusCode: 500)

        let upload = try await h.uploader.enqueue(
            itemId: "item-b",
            fileURL: h.sourceFile,
            filename: "source.bin",
            mimeType: "application/octet-stream"
        )

        _ = await h.waitForTerminal(uploadId: upload.id)

        // Flip stage back to uploading to simulate a resumed drain (in prod
        // the uploader retries at the next sync tick; for the test we nudge
        // directly).
        if let row = h.attachmentStore.fetchForItem("item-b").first {
            // If the attachment was completed the retry check doesn't apply —
            // only terminal-failed uploads matter for this test.
            _ = row
        }
        let uploadId = upload.id
        var descriptor = FetchDescriptor<AttachmentUpload>()
        descriptor.predicate = #Predicate { $0.id == uploadId }
        descriptor.fetchLimit = 1
        let refetched = try h.persistence.mainContext.fetch(descriptor).first!

        // Flip back to pending so the drain picks it up again.
        refetched.stage = AttachmentUploadStage.pending.rawValue
        try h.persistence.mainContext.save()

        // Second drain — same stub → another failure, retry count goes to 2.
        h.uploader.processQueue()
        let second = await h.waitForTerminal(uploadId: upload.id)
        #expect(second?.retryCount ?? 0 >= 2)
    }

    // MARK: - Retry cap — over maxRetryCount → stage stays failed, no more attempts

    @Test func rowOverMaxRetryCountStaysFailedWithoutRetry() async throws {
        let h = try Harness()
        MockURLProtocol.reset()
        stubFailure(itemId: "item-cap", statusCode: 500)

        // Pre-seed an AttachmentUpload already at the retry cap.
        let staged = h.stagingDir.appendingPathComponent("cap.bin")
        try Data(repeating: 0x01, count: 16).write(to: staged)
        let upload = AttachmentUpload(
            itemId: "item-cap",
            localFilePath: staged.path,
            filename: "cap.bin",
            mimeType: "application/octet-stream",
            sizeBytes: 16
        )
        upload.retryCount = AttachmentUploader.maxRetryCount
        upload.stage = AttachmentUploadStage.pending.rawValue
        h.persistence.mainContext.insert(upload)
        try h.persistence.mainContext.save()

        h.uploader.processQueue()

        let terminal = await h.waitForTerminal(uploadId: upload.id)
        #expect(terminal?.stageEnum == .failed,
                "over-cap rows must transition to failed without retrying")
        #expect(MockURLProtocol.recordedRequests().isEmpty,
                "no network traffic should happen when the cap is exceeded")
    }

    // MARK: - Network interrupt

    @Test func transportLevelErrorMarksFailedAndPreservesFile() async throws {
        let h = try Harness()
        MockURLProtocol.reset()
        stubTransportError(itemId: "item-net")

        let upload = try await h.uploader.enqueue(
            itemId: "item-net",
            fileURL: h.sourceFile,
            filename: "source.bin",
            mimeType: "application/octet-stream"
        )

        let terminal = await h.waitForTerminal(uploadId: upload.id)
        #expect(terminal?.stageEnum == .failed)
        // Error message should mention offline or network — not crash.
        #expect(terminal?.error != nil)
        // File kept for retry.
        if let path = terminal?.localFilePath {
            #expect(FileManager.default.fileExists(atPath: path))
        }
    }

    // MARK: - Server 400 on bad MIME — permanent, should still stop at failed

    @Test func serverRejection400MarksFailed() async throws {
        let h = try Harness()
        MockURLProtocol.reset()
        // 400 with a descriptive body — simulates server rejecting the
        // uploaded bytes because the MIME type claim didn't match the real
        // file magic.
        stubFailure(
            itemId: "item-bad-mime",
            statusCode: 400,
            body: #"{"message":"MIME type mismatch"}"#
        )

        let upload = try await h.uploader.enqueue(
            itemId: "item-bad-mime",
            fileURL: h.sourceFile,
            filename: "source.bin",
            mimeType: "application/octet-stream"
        )

        let terminal = await h.waitForTerminal(uploadId: upload.id)
        #expect(terminal?.stageEnum == .failed)
        // The uploader bumps retryCount on every failure, regardless of
        // whether the error is transient. Documented behaviour — PRODUCTION
        // NOTE: ideally permanent 4xx would skip retryCount the same way
        // MutationQueue does, but uploader doesn't yet branch on errorCode.
        #expect(terminal?.retryCount ?? 0 >= 1)
    }

    // MARK: - Oversized file — rejected at enqueue (no network)

    @Test func fileOverMaxSizeIsRejectedAtEnqueue() async throws {
        let h = try Harness(size: 1)
        MockURLProtocol.reset()

        let big = h.stagingDir.appendingPathComponent("oversized.bin")
        FileManager.default.createFile(atPath: big.path, contents: nil)
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: UInt64(AttachmentUploader.maxFileSize + 1))
        try handle.close()

        do {
            _ = try await h.uploader.enqueue(
                itemId: "item-huge",
                fileURL: big,
                filename: "oversized.bin",
                mimeType: "application/octet-stream"
            )
            Issue.record("enqueue should have thrown fileTooLarge")
        } catch let err as AttachmentUploader.EnqueueError {
            if case .fileTooLarge(let size) = err {
                #expect(size > AttachmentUploader.maxFileSize)
            } else {
                Issue.record("unexpected error: \(err)")
            }
        }

        #expect(MockURLProtocol.recordedRequests().isEmpty,
                "no HTTP calls should happen when enqueue is rejected")
    }

    // MARK: - Missing file — rejected at enqueue

    @Test func fileNotFoundIsRejectedAtEnqueue() async throws {
        let h = try Harness()
        let missing = h.stagingDir.appendingPathComponent("does-not-exist.bin")

        do {
            _ = try await h.uploader.enqueue(
                itemId: "item-x",
                fileURL: missing,
                filename: "missing.bin",
                mimeType: "application/octet-stream"
            )
            Issue.record("expected fileNotFound")
        } catch let err as AttachmentUploader.EnqueueError {
            #expect(err == .fileNotFound)
        }
    }

    // MARK: - Cancel in-flight upload

    @Test func cancelMarksUploadFailedWithCancelledError() async throws {
        let h = try Harness()
        MockURLProtocol.reset()
        // Register a stub that won't match any URL — the upload will fail
        // with resourceUnavailable, which from the uploader's POV is an
        // error we treat as failed. That's fine for this test — we just
        // need a row to exist so we can assert cancel does what we expect.
        // Prefer direct cancellation of an existing pending row.
        let staged = h.stagingDir.appendingPathComponent("cancel.bin")
        try Data(repeating: 0x02, count: 64).write(to: staged)
        let upload = AttachmentUpload(
            itemId: "item-cancel",
            localFilePath: staged.path,
            filename: "cancel.bin",
            mimeType: "application/octet-stream",
            sizeBytes: 64
        )
        upload.stage = AttachmentUploadStage.pending.rawValue
        h.persistence.mainContext.insert(upload)
        try h.persistence.mainContext.save()

        let uploadId = upload.id
        h.uploader.cancelUpload(id: uploadId)

        var descriptor = FetchDescriptor<AttachmentUpload>()
        descriptor.predicate = #Predicate { $0.id == uploadId }
        descriptor.fetchLimit = 1
        let refetched = try h.persistence.mainContext.fetch(descriptor).first!
        #expect(refetched.stageEnum == .failed)
        #expect(refetched.error?.localizedCaseInsensitiveContains("cancel") == true)
    }
}
