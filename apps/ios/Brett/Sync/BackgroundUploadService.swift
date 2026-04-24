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

    /// App Group identifier shared between the main app and the share
    /// extension. Declared on both targets' entitlements. The share
    /// extension needs this same group to eventually write attachments
    /// through the same background session without "identifier already
    /// exists" conflicts. Keep in sync with the entitlements files.
    private static let appGroupIdentifier = "group.com.brett.app"

    /// Lazy so we don't build the session — and trigger iOS's
    /// "any tasks for this identifier?" scan — until the app is actually
    /// about to upload something. That said, cold-launch reconciliation
    /// via `handleEventsForBackgroundURLSession` MUST touch this before
    /// iOS can deliver pending events — see `prepareForLaunch()`.
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        // Share-extension-ready: uploads initiated from the extension
        // need the same container so iOS can deliver events to whichever
        // process rehydrates the session. Set even if the extension
        // doesn't upload yet — retrofitting later would leave in-flight
        // sessions orphaned on the first build that flips the flag.
        config.sharedContainerIdentifier = Self.appGroupIdentifier
        // `isDiscretionary = false` — users expect attachments they just
        // dropped into a task to start uploading immediately, not wait
        // for the device to be plugged in on Wi-Fi. iOS still pauses on
        // Low Power Mode, which is the right behaviour.
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        // Defense-in-depth: main APIClient disables cookies because we're
        // bearer-only. The background session builds its own config from
        // scratch — apply the same policy so a redirect's Set-Cookie
        // can't land in HTTPCookieStorage.shared and leak across
        // requests. The presigned upload endpoint has no legitimate
        // reason to set cookies on us.
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.httpCookieStorage = nil
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
    ///
    /// IMPORTANT: touches `session` eagerly. When iOS relaunches the app
    /// specifically to deliver pending background events, the delegate
    /// callbacks (including `didCompleteWithError` for tasks finished
    /// while the app was dead) won't fire until the URLSession object
    /// with the matching identifier has been re-materialised. Without
    /// this force-touch, `handleEventsForBackgroundURLSession` would
    /// install a completion handler that never gets called because iOS
    /// has nothing to deliver to.
    func storeBackgroundCompletionHandler(_ handler: @escaping () -> Void) {
        lock.lock()
        backgroundCompletionHandler = handler
        lock.unlock()
        _ = session
    }

    /// Called from the app delegate during `didFinishLaunching` so the
    /// background URLSession is rebuilt synchronously — iOS can then
    /// re-deliver completion events for tasks finished while the app
    /// was killed. Without this, a user who force-quits the app during
    /// an upload won't see the upload marked as `done` until the next
    /// time a foreground upload is enqueued (which re-touches `session`).
    func prepareForLaunch() {
        _ = session
    }

    /// Walk every task currently known to the background session and
    /// log the in-flight count. The per-task completion delegate fires
    /// `onUploadFinished` for each task iOS has a pending event for —
    /// no explicit replay is needed here; iOS replays them automatically
    /// once the session is materialised (which `prepareForLaunch` /
    /// `storeBackgroundCompletionHandler` both ensure).
    func reconcilePendingTasks() {
        session.getAllTasks { tasks in
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
