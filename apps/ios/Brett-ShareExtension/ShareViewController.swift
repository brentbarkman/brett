import UIKit

/// Entry point for the Brett share extension.
///
/// No custom UI — the view controller has a bare, dark-tinted view that
/// flashes for the brief moment between `viewDidAppear` and `completeRequest`.
/// The real work lives in `ShareService`; this class is just iOS-side
/// plumbing to receive the `NSExtensionItem`s and drive the dismiss.
///
/// ## Why no `SLComposeServiceViewController`?
///
/// That base class renders a Twitter-style compose sheet (avatar +
/// textarea + "Post" button). For a silent-save extension we don't want
/// any of that UI; a plain `UIViewController` subclass is cleaner.
final class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        // Brief dark-tinted background so the extension presents cleanly
        // during the sub-second window before it auto-dismisses. Matches
        // the main app's dark theme and feels intentional rather than broken.
        view.backgroundColor = UIColor.black.withAlphaComponent(0.001)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        // Snapshot the inputs — the extensionContext reference is only
        // guaranteed valid while the view controller is alive.
        let inputs = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let ctx = extensionContext

        Task { @MainActor in
            // Step 1 — fast + durable. Extract content, write the queue
            // file. Usually <200ms end-to-end.
            let persisted = await ShareService.persistPayload(inputItems: inputs)

            // Step 2 — dismiss IMMEDIATELY so the share sheet closes
            // without waiting on the network POST. iOS gives us a short
            // grace period after this to finish in-flight work.
            ctx?.completeRequest(returningItems: [], completionHandler: nil)

            // Step 3 — best-effort POST in whatever time remains before
            // iOS terminates the extension process. Kick off as a
            // detached Task so the view controller's actor isolation
            // doesn't gate it.
            if let persisted {
                Task.detached { await ShareService.attemptPost(persisted) }
            }
        }
    }
}
