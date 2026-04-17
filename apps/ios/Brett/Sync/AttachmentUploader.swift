import Foundation
import Observation
import SwiftData

/// Orchestrates the on-device upload queue for attachments.
///
/// Flow:
///  1. `enqueue(...)` — copies the source file into the app's documents
///     container (sandbox-safe, durable across relaunches) and creates a
///     pending `AttachmentUpload` row.
///  2. `processQueue()` — drains non-terminal rows oldest-first:
///     `pending → uploading → done` or `→ failed`.
///  3. On success we insert a real `Attachment` row via `AttachmentStore` and
///     delete the cached upload file.
///  4. On error we flip the row to `failed`, bump `retryCount`, keep the file
///     so a future retry can re-read it.
///
/// Progress is published through an `AsyncStream<UploadProgress>` for UI
/// binding (a detail sheet that shows a progress bar per item).
@MainActor
@Observable
final class AttachmentUploader {
    /// Max retries before a row is abandoned on `failed`.
    static let maxRetryCount = 5

    /// Server-enforced ceiling — we pre-flight locally so we don't spend
    /// bandwidth on a doomed POST. Keep in sync with API route.
    static let maxFileSize = 25 * 1024 * 1024

    private let apiClient: APIClient
    private let attachmentStore: AttachmentStore
    private let persistence: PersistenceController
    private let fileManager: FileManager

    /// Directory inside the app's Documents container where we stash copies of
    /// queued uploads. Re-created on first enqueue if it doesn't exist.
    let uploadStagingDirectory: URL

    /// In-flight `Task` handles keyed by AttachmentUpload.id so `cancelUpload`
    /// can find and cancel them. Touch only from the main actor.
    @ObservationIgnored
    private var inFlight: [String: Task<Void, Never>] = [:]

    /// Serialises queue drains so concurrent calls don't double-process rows.
    @ObservationIgnored
    private var queueTask: Task<Void, Never>?

    // MARK: - Progress stream

    struct UploadProgress: Sendable, Equatable {
        let uploadId: String
        let itemId: String
        let fraction: Double
        let stage: AttachmentUploadStage
    }

    /// AsyncStream backing the public `progressStream` property. `let` so the
    /// `@Observable` macro doesn't try to wrap it in an observation setter
    /// (it only wraps `var`).
    let progressStream: AsyncStream<UploadProgress>
    private let progressContinuation: AsyncStream<UploadProgress>.Continuation

    // MARK: - Init

    init(
        apiClient: APIClient,
        attachmentStore: AttachmentStore,
        persistence: PersistenceController,
        fileManager: FileManager = .default,
        stagingDirectory: URL? = nil
    ) {
        self.apiClient = apiClient
        self.attachmentStore = attachmentStore
        self.persistence = persistence
        self.fileManager = fileManager

        if let stagingDirectory {
            self.uploadStagingDirectory = stagingDirectory
        } else {
            let docs = (try? fileManager.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )) ?? fileManager.temporaryDirectory
            self.uploadStagingDirectory = docs.appendingPathComponent("attachment-uploads", isDirectory: true)
        }

        try? fileManager.createDirectory(at: self.uploadStagingDirectory, withIntermediateDirectories: true)

        // Build the progress stream once, eagerly. Swift's AsyncStream gives
        // us the continuation immediately via `makeStream`.
        let (stream, continuation) = AsyncStream.makeStream(of: UploadProgress.self)
        self.progressStream = stream
        self.progressContinuation = continuation
    }

    // MARK: - Public API

    enum EnqueueError: Error, Equatable {
        case fileNotFound
        case fileTooLarge(Int)
        case missingMimeType
        case copyFailed
    }

    /// Copies the file to the staging directory and inserts an
    /// `AttachmentUpload`. Then kicks the queue.
    @discardableResult
    func enqueue(
        itemId: String,
        fileURL: URL,
        filename: String,
        mimeType: String
    ) async throws -> AttachmentUpload {
        guard !mimeType.isEmpty else {
            throw EnqueueError.missingMimeType
        }
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw EnqueueError.fileNotFound
        }

        let size: Int
        do {
            let values = try fileURL.resourceValues(forKeys: [.fileSizeKey])
            size = values.fileSize ?? 0
        } catch {
            throw EnqueueError.fileNotFound
        }

        guard size <= Self.maxFileSize else {
            throw EnqueueError.fileTooLarge(size)
        }

        let uploadId = UUID().uuidString
        let stagedName = "\(uploadId)-\(filename)"
        let stagedURL = uploadStagingDirectory.appendingPathComponent(stagedName)

        do {
            // Copy (not move) — the source may be a security-scoped file the
            // caller still owns (Photos, document picker, etc.).
            if fileManager.fileExists(atPath: stagedURL.path) {
                try fileManager.removeItem(at: stagedURL)
            }
            try fileManager.copyItem(at: fileURL, to: stagedURL)
        } catch {
            throw EnqueueError.copyFailed
        }

        let upload = attachmentStore.createUpload(
            itemId: itemId,
            localPath: stagedURL.path,
            filename: filename,
            mimeType: mimeType,
            size: size
        )
        // Ensure the generated id matches what we staged under so retries can
        // find the file. `createUpload` picks a fresh UUID internally, so we
        // overwrite the id with ours.
        upload.id = uploadId
        try? persistence.mainContext.save()

        emit(
            uploadId: uploadId,
            itemId: itemId,
            fraction: 0,
            stage: .pending
        )

        processQueue()
        return upload
    }

    /// Drains the queue. Safe to call from anywhere; only one drain runs at
    /// a time.
    func processQueue() {
        if let existing = queueTask, !existing.isCancelled { return }
        queueTask = Task { [weak self] in
            guard let self else { return }
            await self.drain()
            await MainActor.run { self.queueTask = nil }
        }
    }

    /// Cancel a specific upload. Marks the row as failed (user-initiated).
    func cancelUpload(id: String) {
        if let task = inFlight[id] {
            task.cancel()
            inFlight.removeValue(forKey: id)
        }
        attachmentStore.markFailed(uploadId: id, error: "Cancelled by user.")

        // Best-effort progress update.
        if let upload = fetchUpload(id: id) {
            emit(uploadId: id, itemId: upload.itemId, fraction: upload.uploadProgress, stage: .failed)
        }
    }

    // MARK: - Queue drain

    private func drain() async {
        while let next = nextPendingUpload() {
            await run(upload: next)
        }
    }

    private func run(upload: AttachmentUpload) async {
        let uploadId = upload.id
        let itemId = upload.itemId
        let filePath = upload.localFilePath
        let filename = upload.filename
        let mimeType = upload.mimeType

        // Retry guard — don't pick up rows that have exhausted their attempts.
        if upload.retryCount >= Self.maxRetryCount {
            upload.stage = AttachmentUploadStage.failed.rawValue
            try? persistence.mainContext.save()
            emit(uploadId: uploadId, itemId: itemId, fraction: 0, stage: .failed)
            return
        }

        upload.stage = AttachmentUploadStage.uploading.rawValue
        upload.uploadProgress = 0
        try? persistence.mainContext.save()
        emit(uploadId: uploadId, itemId: itemId, fraction: 0, stage: .uploading)

        let fileURL = URL(fileURLWithPath: filePath)
        let taskHandle = Task<Void, Never> { [weak self] in
            guard let self else { return }
            do {
                let response = try await self.apiClient.uploadAttachment(
                    itemId: itemId,
                    fileURL: fileURL,
                    filename: filename,
                    mimeType: mimeType,
                    progress: { [weak self] fraction in
                        guard let self else { return }
                        Task { @MainActor in
                            self.updateProgress(uploadId: uploadId, itemId: itemId, fraction: fraction)
                        }
                    }
                )
                await MainActor.run {
                    self.finalizeSuccess(uploadId: uploadId, response: response)
                }
            } catch is CancellationError {
                await MainActor.run {
                    self.finalizeFailure(uploadId: uploadId, itemId: itemId, error: "Cancelled", keepFile: true, permanent: true)
                }
            } catch {
                let message = (error as? APIError)?.userFacingMessage ?? String(describing: error)
                // 4xx responses mean the file itself is bad (wrong MIME, too
                // large, etc.) — retrying won't help. Mirror MutationQueue's
                // retry policy: permanent failures short-circuit the cap.
                let permanent: Bool = {
                    if case .validation = (error as? APIError) { return true }
                    if case .unauthorized = (error as? APIError) { return true }
                    return false
                }()
                await MainActor.run {
                    self.finalizeFailure(uploadId: uploadId, itemId: itemId, error: message, keepFile: !permanent, permanent: permanent)
                }
            }
        }

        inFlight[uploadId] = taskHandle
        await taskHandle.value
        inFlight.removeValue(forKey: uploadId)
    }

    // MARK: - Finalisation

    private func finalizeSuccess(uploadId: String, response: APIClient.AttachmentResponse) {
        // The server doesn't always return `storageKey`. When missing we fall
        // back to an empty string — the real value will be hydrated on the
        // next `/things/:id` fetch and overwrite the row.
        let storageKey = response.storageKey ?? ""

        // Pull userId from the upload's sibling Attachment context. Since
        // attachments are scoped to an item, the userId must match the item
        // owner — fetch it from the upload's item's attachment if we have one,
        // otherwise fall back to the currently-known upload row and leave it
        // blank (sync pull will backfill).
        let userId = userIdForUpload(id: uploadId) ?? ""

        attachmentStore.markComplete(
            uploadId: uploadId,
            attachmentId: response.id,
            userId: userId,
            storageKey: storageKey
        )

        // Clean up the cached copy — we got a server confirmation.
        if let upload = fetchUpload(id: uploadId) {
            let path = upload.localFilePath
            try? fileManager.removeItem(atPath: path)
            emit(uploadId: uploadId, itemId: upload.itemId, fraction: 1, stage: .done)
        }
    }

    private func finalizeFailure(uploadId: String, itemId: String, error: String, keepFile: Bool, permanent: Bool = false) {
        // When the failure is permanent (4xx, cancel), jump the retry count
        // past the cap so `processUpload` won't pick it up again.
        if permanent, let upload = fetchUpload(id: uploadId) {
            upload.retryCount = Self.maxRetryCount
            try? persistence.mainContext.save()
        }
        attachmentStore.markFailed(uploadId: uploadId, error: error)
        // For transient failures, keep the staged file so retries can re-read it.
        // For permanent failures, the client decided further retries are
        // useless; the staged file is preserved for user-initiated retry but
        // the queue processor will skip it.
        _ = keepFile
        if let upload = fetchUpload(id: uploadId) {
            emit(uploadId: uploadId, itemId: itemId, fraction: upload.uploadProgress, stage: .failed)
        } else {
            emit(uploadId: uploadId, itemId: itemId, fraction: 0, stage: .failed)
        }
    }

    private func updateProgress(uploadId: String, itemId: String, fraction: Double) {
        if let upload = fetchUpload(id: uploadId) {
            upload.uploadProgress = fraction
            try? persistence.mainContext.save()
        }
        emit(uploadId: uploadId, itemId: itemId, fraction: fraction, stage: .uploading)
    }

    // MARK: - SwiftData helpers

    private func nextPendingUpload() -> AttachmentUpload? {
        let context = persistence.mainContext
        var descriptor = FetchDescriptor<AttachmentUpload>(
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        descriptor.predicate = #Predicate { upload in
            upload.stage != "done" && upload.stage != "failed"
        }
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }

    private func fetchUpload(id: String) -> AttachmentUpload? {
        var descriptor = FetchDescriptor<AttachmentUpload>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return (try? persistence.mainContext.fetch(descriptor))?.first
    }

    /// Best-effort userId resolution. If we have the current signed-in user
    /// stashed elsewhere we could wire it through init; for now we read the
    /// UserProfile table which is populated on sign-in.
    private func userIdForUpload(id: String) -> String? {
        var descriptor = FetchDescriptor<UserProfile>()
        descriptor.fetchLimit = 1
        if let profile = (try? persistence.mainContext.fetch(descriptor))?.first {
            return profile.id
        }
        return nil
    }

    // MARK: - Progress emit

    private func emit(uploadId: String, itemId: String, fraction: Double, stage: AttachmentUploadStage) {
        progressContinuation.yield(
            UploadProgress(uploadId: uploadId, itemId: itemId, fraction: fraction, stage: stage)
        )
    }
}
