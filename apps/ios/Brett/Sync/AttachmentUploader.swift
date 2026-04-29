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

    /// Whether to route uploads through `BackgroundUploadService`'s
    /// background URLSession (survives app termination) or through the
    /// in-process `APIClient.uploadAttachment` path. Production defaults
    /// to background; tests opt out so MockURLProtocol works.
    private let useBackgroundSession: Bool

    private let backgroundService: BackgroundUploadService

    /// Bridges background URLSession completion callbacks back into the
    /// async/await caller. When the service's `onUploadFinished` fires we
    /// look up the matching continuation and resume it. If the app was
    /// killed and relaunched between the upload start and completion, the
    /// continuation is gone — the callback still updates the
    /// `AttachmentUpload` row directly so state stays consistent.
    @ObservationIgnored
    private var pendingContinuations: [String: CheckedContinuation<APIClient.AttachmentResponse, Error>] = [:]

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
        stagingDirectory: URL? = nil,
        useBackgroundSession: Bool = true,
        backgroundService: BackgroundUploadService = .shared
    ) {
        self.apiClient = apiClient
        self.attachmentStore = attachmentStore
        self.persistence = persistence
        self.fileManager = fileManager
        self.useBackgroundSession = useBackgroundSession
        self.backgroundService = backgroundService

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

        if useBackgroundSession {
            installBackgroundCallbacks()
            // Ask iOS to report any tasks that finished while we were
            // suspended/killed. The service logs them; per-task completion
            // callbacks flow through `onUploadFinished` as iOS replays them.
            backgroundService.reconcilePendingTasks()
        }
    }

    /// Route the shared background service's callbacks into this uploader.
    /// Called on init when `useBackgroundSession` is true.
    private func installBackgroundCallbacks() {
        backgroundService.onProgress = { [weak self] uploadId, fraction in
            guard let self else { return }
            // Look up the row to surface itemId alongside fraction. If
            // the row has been wiped (sign-out mid-upload, for example)
            // we still fire a best-effort progress event on the stream.
            if let upload = self.fetchUpload(id: uploadId) {
                self.updateProgress(uploadId: uploadId, itemId: upload.itemId, fraction: fraction)
            }
        }

        backgroundService.onUploadFinished = { [weak self] uploadId, data, httpStatus, error in
            guard let self else { return }
            self.handleBackgroundCompletion(
                uploadId: uploadId,
                data: data,
                httpStatus: httpStatus,
                error: error
            )
        }
    }

    /// Shared entry point invoked by the background service's delegate
    /// callback. Resolves any awaiting in-process continuation AND
    /// updates the persistent row — the two paths diverge only on
    /// cold-launch reconciliation where the continuation is gone.
    private func handleBackgroundCompletion(
        uploadId: String,
        data: Data?,
        httpStatus: Int?,
        error: Error?
    ) {
        // Transport-layer error (network drop, etc.) — surface as a
        // thrown error to any awaiting continuation; standalone path
        // marks the row failed.
        if let error = error {
            if let cont = pendingContinuations.removeValue(forKey: uploadId) {
                cont.resume(throwing: error)
            } else if let upload = fetchUpload(id: uploadId) {
                // Cold-launch path: no one is awaiting. Mark the row
                // failed so the queue's retry logic can decide whether
                // to re-enqueue.
                let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
                finalizeFailure(uploadId: uploadId, itemId: upload.itemId, error: message, keepFile: true)
            }
            return
        }

        // HTTP-layer: parse the body + status. APIClient's validator
        // throws on 4xx/5xx.
        do {
            let response = try APIClient.parseAttachmentUploadResponse(data: data, httpStatus: httpStatus)
            if let cont = pendingContinuations.removeValue(forKey: uploadId) {
                cont.resume(returning: response)
            } else {
                finalizeSuccess(uploadId: uploadId, response: response)
            }
        } catch {
            if let cont = pendingContinuations.removeValue(forKey: uploadId) {
                cont.resume(throwing: error)
            } else if let upload = fetchUpload(id: uploadId) {
                let message = (error as? APIError)?.userFacingMessage ?? String(describing: error)
                let permanent: Bool = {
                    if case .validation = (error as? APIError) { return true }
                    if case .unauthorized = (error as? APIError) { return true }
                    return false
                }()
                finalizeFailure(uploadId: uploadId, itemId: upload.itemId, error: message, keepFile: !permanent, permanent: permanent)
            }
        }
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
        do {
            try persistence.mainContext.save()
        } catch {
            BrettLog.attachments.error("AttachmentUploader enqueue save failed: \(String(describing: error), privacy: .public)")
        }

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
            await self?.drain()
            await MainActor.run { [weak self] in
                self?.queueTask = nil
            }
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
            do {
                try persistence.mainContext.save()
            } catch {
                BrettLog.attachments.error("AttachmentUploader retry-cap save failed: \(String(describing: error), privacy: .public)")
            }
            emit(uploadId: uploadId, itemId: itemId, fraction: 0, stage: .failed)
            return
        }

        upload.stage = AttachmentUploadStage.uploading.rawValue
        upload.uploadProgress = 0
        do {
            try persistence.mainContext.save()
        } catch {
            BrettLog.attachments.error("AttachmentUploader start-upload save failed: \(String(describing: error), privacy: .public)")
        }
        emit(uploadId: uploadId, itemId: itemId, fraction: 0, stage: .uploading)

        let fileURL = URL(fileURLWithPath: filePath)
        let taskHandle = Task<Void, Never> { [weak self] in
            guard let self else { return }
            do {
                let response = try await self.performUpload(
                    uploadId: uploadId,
                    itemId: itemId,
                    fileURL: fileURL,
                    filename: filename,
                    mimeType: mimeType
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

    /// Perform the actual HTTP transfer. Routes through the background
    /// URLSession when `useBackgroundSession` is true (production path —
    /// survives app termination) or through the in-process `APIClient`
    /// path when false (test path, keeps MockURLProtocol interception
    /// working). Both paths return the server's `AttachmentResponse` via
    /// async/await; the background path bridges the delegate callback
    /// via a `CheckedContinuation` registered in `pendingContinuations`.
    private func performUpload(
        uploadId: String,
        itemId: String,
        fileURL: URL,
        filename: String,
        mimeType: String
    ) async throws -> APIClient.AttachmentResponse {
        if useBackgroundSession {
            let request = try apiClient.buildAttachmentUploadRequest(
                itemId: itemId,
                fileURL: fileURL,
                filename: filename,
                mimeType: mimeType
            )
            return try await withCheckedThrowingContinuation { continuation in
                pendingContinuations[uploadId] = continuation
                backgroundService.upload(stagedFile: fileURL, to: request, uploadId: uploadId)
            }
        }

        return try await apiClient.uploadAttachment(
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
            do {
                try persistence.mainContext.save()
            } catch {
                BrettLog.attachments.error("AttachmentUploader finalizeFailure save failed: \(String(describing: error), privacy: .public)")
            }
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
            do {
                try persistence.mainContext.save()
            } catch {
                BrettLog.attachments.error("AttachmentUploader updateProgress save failed: \(String(describing: error), privacy: .public)")
            }
        }
        emit(uploadId: uploadId, itemId: itemId, fraction: fraction, stage: .uploading)
    }

    // MARK: - SwiftData helpers

    private func nextPendingUpload() -> AttachmentUpload? {
        let context = persistence.mainContext
        var descriptor = FetchDescriptor<AttachmentUpload>(
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        // Exclude `uploading` rows so a concurrent `processQueue()` call
        // doesn't pick up a row that already has an in-flight URLSession
        // task. Without this, the inner Task bookkeeping (`inFlight[id]`)
        // gets overwritten and both transfers race for the same row.
        descriptor.predicate = #Predicate { upload in
            upload.stage != "done"
                && upload.stage != "failed"
                && upload.stage != "uploading"
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
