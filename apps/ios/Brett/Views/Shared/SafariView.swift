import SwiftUI
import SafariServices

/// `SFSafariViewController` wrapped for SwiftUI.
///
/// Prefer this over `UIApplication.shared.open(url)` for in-app web reading
/// (articles, newsletters, tweets, videos) so the user stays inside Brett
/// with the system-provided reader mode, share sheet, and back button.
///
/// `SFSafariViewController` handles its own dismissal via the Done button,
/// so the callsite just presents it in a `.sheet`.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    /// Optional Reader-mode preference. If `.automatic`, Safari decides.
    var entersReaderIfAvailable: Bool = false
    /// Tint color for Done button + top bar controls. Defaults to gold to
    /// match Brett's accent language.
    var preferredControlTintColor: UIColor? = UIColor(
        red: 232/255, green: 185/255, blue: 49/255, alpha: 1
    )

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = entersReaderIfAvailable
        config.barCollapsingEnabled = true

        let controller = SFSafariViewController(url: url, configuration: config)
        controller.preferredControlTintColor = preferredControlTintColor
        controller.dismissButtonStyle = .done
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {
        // No-op: SFSafariViewController manages its own state.
    }
}

// MARK: - Identifiable URL wrapper

/// Small helper so callers can use `.sheet(item:)` with a raw `URL`.
///
/// ```swift
/// @State private var webURL: IdentifiedURL?
/// …
/// .sheet(item: $webURL) { item in SafariView(url: item.url) }
/// ```
struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
