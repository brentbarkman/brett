import UIKit

/// Minimal UIApplicationDelegate. Today its only job is to bridge
/// iOS's background-URLSession completion handoff to
/// `BackgroundUploadService` so attachment uploads can finish while
/// the app is suspended (or even terminated).
///
/// Wired into the SwiftUI app via `@UIApplicationDelegateAdaptor` in
/// `BrettApp`. Add new delegate responsibilities only when SwiftUI
/// doesn't expose a first-class hook — most iOS lifecycle events
/// already come through `scenePhase` and `.onOpenURL`.
final class BrettAppDelegate: NSObject, UIApplicationDelegate {
    /// iOS calls this when the system has additional events for a
    /// background URLSession (typically after waking the app to deliver
    /// the results of a transfer that finished while we were suspended).
    ///
    /// We stash `completionHandler` on `BackgroundUploadService`, which
    /// invokes it once the session finishes dispatching its backlog
    /// (see `urlSessionDidFinishEvents`). Calling it promptly keeps iOS
    /// happy and lets the system return the app to suspended state.
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == BackgroundUploadService.sessionIdentifier else {
            // Not our session — hand back control immediately.
            completionHandler()
            return
        }
        BackgroundUploadService.shared.storeBackgroundCompletionHandler(completionHandler)
    }
}
