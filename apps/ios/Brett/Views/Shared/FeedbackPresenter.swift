import SwiftUI
import UIKit

/// Presents the `FeedbackSheet` from the topmost view controller in response
/// to a shake. Bypasses SwiftUI's `.sheet(isPresented:)` semantics so the
/// sheet works even when other modals (TaskDetailView, SearchSheet, etc.)
/// are already presented.
///
/// **Why not a SwiftUI `.onShake` + `.sheet`?** That was the prior design.
/// The shake notification was attached to MainContainer's NavigationStack,
/// which is the *root* presenter. When TaskDetailView's sheet is up, the
/// NavigationStack is not the active presenter — SwiftUI can't open a
/// second sheet from the same anchor while the first is presented, and
/// any binding flip is either dropped or queued until dismiss. The user
/// reports this as "shake doesn't work when the thing panel is open."
///
/// **Why a marker subclass for dedup?** The presenter must not stack
/// FeedbackSheets on a rapid double-shake (or on a shake that fires while
/// FeedbackSheet is already up). Tagging the hosting controller with a
/// dedicated subclass gives a stable type for the topmost-VC check and
/// avoids state flags that have to be cleared on dismiss.
@MainActor
final class FeedbackPresenter {
    static let shared = FeedbackPresenter()

    /// Captured at install time so the presenter can inject the auth env
    /// onto the hosted FeedbackSheet (it reads `@Environment(AuthManager.self)`
    /// for the diagnostics payload's `userId`).
    private weak var authManager: AuthManager?

    /// Opaque observer token from `NotificationCenter.addObserver(forName:...)`.
    /// Held so we can deregister if `install` is ever called twice (it's
    /// idempotent today; this just keeps it cheap to reason about).
    private var observer: NSObjectProtocol?

    private init() {}

    /// Wire shake-detection → `FeedbackSheet` presentation. Idempotent.
    /// Call once from `BrettApp.init()`.
    func install(authManager: AuthManager) {
        self.authManager = authManager
        if observer != nil { return }
        observer = NotificationCenter.default.addObserver(
            forName: .deviceDidShake,
            object: nil,
            queue: .main
        ) { _ in
            // The notification queue is `.main`, but the closure isn't
            // automatically MainActor-isolated. Hop explicitly so we can
            // touch UIKit state.
            Task { @MainActor in
                FeedbackPresenter.shared.presentIfPossible()
            }
        }
    }

    /// Public for testability — the actual presentation also runs through
    /// here so unit tests can assert the dedup decision.
    func presentIfPossible() {
        guard let authManager else { return }
        guard let topVC = Self.topmostViewController() else { return }
        guard Self.shouldPresent(from: topVC) else { return }

        let view = FeedbackSheet().environment(authManager)
        let hosted = FeedbackSheetHostingController(rootView: AnyView(view))
        hosted.modalPresentationStyle = .pageSheet
        if let sheet = hosted.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = 20
        }
        hosted.overrideUserInterfaceStyle = .dark
        HapticManager.medium()
        topVC.present(hosted, animated: true)
    }

    // MARK: - Pure helpers (testable without UIApplication)

    /// Decides whether to present a fresh FeedbackSheet given the current
    /// topmost view controller. Returns `false` when the topmost is already
    /// a `FeedbackSheetHostingController` — prevents stacking.
    static func shouldPresent(from topVC: UIViewController) -> Bool {
        if topVC is FeedbackSheetHostingController { return false }
        return true
    }

    /// Walks `presentedViewController` chain to the deepest VC. Pure —
    /// takes a root and returns whatever's on top of it. Tested directly.
    static func deepestPresented(from root: UIViewController) -> UIViewController {
        var current = root
        while let next = current.presentedViewController {
            current = next
        }
        return current
    }

    /// Find the topmost view controller across all foreground-active scenes.
    /// Returns `nil` if the app has no key window yet (very early launch).
    static func topmostViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = scenes
            .filter { $0.activationState == .foregroundActive }
            .compactMap { $0 as? UIWindowScene }
            .first
            ?? scenes.compactMap { $0 as? UIWindowScene }.first
        let keyWindow = windowScene?.windows.first(where: { $0.isKeyWindow })
            ?? windowScene?.windows.first
        guard let root = keyWindow?.rootViewController else { return nil }
        return deepestPresented(from: root)
    }
}

/// Marker subclass so `shouldPresent(from:)` can identify an already-up
/// FeedbackSheet by type rather than a state flag. The whole point is
/// stability — a state flag has to be cleared on dismiss, which is one
/// more thing that can drift out of sync; a type check can't.
@MainActor
final class FeedbackSheetHostingController: UIHostingController<AnyView> {
    override init(rootView: AnyView) {
        super.init(rootView: rootView)
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) {
        fatalError("FeedbackSheetHostingController is presented programmatically")
    }
}
