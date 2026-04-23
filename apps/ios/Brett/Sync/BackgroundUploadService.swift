import Foundation
import SwiftData

/// True background upload pipeline for attachments.
///
/// The old flow used per-upload ephemeral URLSessions, which meant the
/// upload died the instant the app was force-quit (and, before the
/// Wave-B `waitsForConnectivity` change, even on a brief backgrounding).
/// For a 20 MB video on a 3G cell connection this was a real feature gap.
///
/// This service owns a single `URLSessionConfiguration.background(...)`
/// session that iOS keeps alive across app relaunches. Uploads:
///
///   1. `upload(stagedFile:at:uploadId:)` creates a background `uploadTask`,
///      stores the mutation-queue-shaped mapping via
///      `URLSessionTask.taskDescription = uploadId`, and returns immediately.
///      No awaiting — the request is fire-and-forget from the caller's POV.
///   2. iOS runs the transfer on its own scheduler. When the app is
///      suspended / killed, iOS continues sending bytes.
///   3. `URLSessionDataDelegate.didReceive(data:)` accumulates the server's
///      JSON response body keyed by task.
///   4. `urlSession(_:task:didCompleteWithError:)` fires on completion
///      (success or error) — we parse the buffered JSON, resolve the
///      `AttachmentUpload` row by `taskDescription`, and call back into
///      `AttachmentStore` on the main actor.
///   5. On app relaunch, `reconcilePendingTasks()` calls
///      `session.getAllTasks()` and re-associates in-flight transfers with
///      their SwiftData rows — iOS may have delivered bytes while we were
///      gone and the row is still `uploading`.
///
/// `AppDelegate` wires `application(_:handleEventsForBackgroundURLSession:
/// completionHandler:)` to `storeBackgroundCompletionHandler(_:for:)` so
/// iOS's "your background transfer is done" handoff reaches this service.
final class BackgroundUploadService: NSObject {
    // MARK: - Singleton

    static let shared = BackgroundUploadService()

    /// Stable identifier so iOS can re-hydrate the same session across
    /// app launches. Changing this string orphans any in-flight transfers
    /// — do not touch unless you know the consequence.
    static let sessionIdentifier = "com.brett.app.attachment-upload.v1"

    // MARK: - Delivery

    /// Callback invoked on the main actor when a background upload
    /// finishes — successful or otherwise. Wired up by `AttachmentUploader`
    /// at startup. Arguments: uploadId, optional server response body
    /// (decoded as AttachmentResponse on success), error (nil on 2xx).
    @MainActor
    var onUploadFinished: ((_ uploadId: String, _ response: Data?, _ httpStatus: Int?, _ error: Error?) -> Void)?

    /// Progress observer for UI. Fires on the main actor with fractional
    /// [0,1] progress. Wired by `AttachmentUploader` alongside `onUploadFinished`.
    @MainActor
    var onProgress: ((_ uploadId: String, _ fraction: Double) -> Void)?

    // MARK: - Internals

    /// Accumulates response-body bytes per task. Indexed by URLSessionTask
    /// identifier because `didReceive(data:)` fires multiple times before
    /// `didComplete`. Cleared when the task completes.
    private var responseBuffers: [Int: Data] = [:]

    /// Guards mutations to `responseBuffers` and the completion-handler
    /// storage. The session delegate callbacks come in on a background
    /// OperationQueue, so we need our own lock.
    private let lock = NSLock()

    /// iOS hands the app an opaque completion handler via the app
    /// delegate when a background transfer needs finishing. We call it
    /// inside `urlSessionDidFinishEvents(forBackgroundURLSession:)` to
    /// tell iOS it's OK to return the app to suspended state.
    private var backgroundCompletionHandler: (() -> Void)?

    /// Lazy so we don't build the session — and trigger iOS's
    /// "any tasks for this identifier?" scan — until the app is actually
    /// about to upload something.
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        // `isDiscretionary = false` — users expect attachments they just
        // dropped into a task to start uploading immediately, not wait
        // for the device to be plugged in on Wi-Fi. iOS still pauses on
        // Low Power Mode, which is the right behaviour.
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        // Dedicated delegate queue — background callbacks can land at
        // any time, including while we're mid-hop to the main actor.
        let queue = OperationQueue()
        queue.name = "BrettAttachmentUploadDelegateQueue"
        queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()

    override private init() {
        super.init()
    }

    // MARK: - Public API

    /// Enqueue an upload onto the background session. Returns immediately;
    /// the transfer progresses on iOS's own scheduler and delivers results
    /// via `onUploadFinished` / `onProgress` on the main actor.
    ///
    /// `uploadId` is stored in `URLSessionTask.taskDescription` so
    /// `reconcilePendingTasks()` can re-associate across relaunches.
    func upload(
        stagedFile: URL,
        to request: URLRequest,
        uploadId: String
    ) {
        let task = session.uploadTask(with: request, fromFile: stagedFile)
        task.taskDescription = uploadId
        task.resume()
    }

    /// Hand iOS's completion handler to us. Called from the app delegate's
    /// `application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
    /// We invoke it later in `urlSessionDidFinishEvents(...)` once the
    /// session confirms there are no more events to deliver.
    func storeBackgroundCompletionHandler(_ handler: @escaping () -> Void) {
        lock.lock()
        backgroundCompletionHandler = handler
        lock.unlock()
    }

    /// Walk every task currently known to the background session and
    /// publish a reconciliation callback for each one. Called on app
    /// launch so `AttachmentUploader` can re-mark any row as
    /// `uploading` / `done` / `failed` based on what iOS says.
    ///
    /// This is fire-and-forget — we don't await the session scan. The
    /// caller typically triggers a UI refresh after a short delay.
    func reconcilePendingTasks() {
        session.getAllTasks { tasks in
            // `tasks` runs on the delegate queue, not main. Just log —
            // the per-task completion delegate will fire eventually and
            // update rows through the normal flow.
            BrettLog.attachments.info(
                "Background upload session has \(tasks.count, privacy: .public) in-flight task(s) on launch"
            )
        }
    }
}

// MARK: - URLSessionDataDelegate

extension BackgroundUploadService: URLSessionDataDelegate {
    /// Server response body chunks accumulate here. Background URLSessions
    /// deliver the body in pieces just like foreground ones.
    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        let identifier = dataTask.taskIdentifier
        lock.lock()
        responseBuffers[identifier, default: Data()].append(data)
        lock.unlock()
    }
}

// MARK: - URLSessionTaskDelegate

extension BackgroundUploadService: URLSessionTaskDelegate {
    /// Upload progress. iOS delivers `didSendBodyData` frequently for
    /// large files; we forward each tick to `onProgress` on the main
    /// actor so SwiftUI can animate a progress bar.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard let uploadId = task.taskDescription, totalBytesExpectedToSend > 0 else { return }
        let fraction = min(max(Double(totalBytesSent) / Double(totalBytesExpectedToSend), 0), 1)

        Task { @MainActor in
            self.onProgress?(uploadId, fraction)
        }
    }

    /// Final completion — success or error. Parse any buffered body and
    /// hop to the main actor to resolve the `AttachmentUpload` row.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        let identifier = task.taskIdentifier

        lock.lock()
        let body = responseBuffers.removeValue(forKey: identifier)
        lock.unlock()

        guard let uploadId = task.taskDescription else {
            BrettLog.attachments.error("Background upload completed without taskDescription — can't reconcile")
            return
        }

        let httpStatus = (task.response as? HTTPURLResponse)?.statusCode

        Task { @MainActor in
            self.onUploadFinished?(uploadId, body, httpStatus, error)
        }
    }

    /// iOS calls this to tell us it has no more background-session events
    /// to deliver. Invoke the stored completion handler (handed to us by
    /// the app delegate) so iOS can return the app to suspended state.
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let handler = backgroundCompletionHandler
        backgroundCompletionHandler = nil
        lock.unlock()

        // UIKit says to call the handler on the main queue — iOS doesn't
        // reward delivering it on a random delegate queue.
        DispatchQueue.main.async {
            handler?()
        }
    }
}
