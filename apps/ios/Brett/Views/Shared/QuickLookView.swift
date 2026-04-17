import SwiftUI
import QuickLook

/// `QLPreviewController` wrapped for SwiftUI — the standard iOS viewer for
/// PDFs, images, videos, and any file Quick Look can render.
///
/// ```swift
/// @State private var fileURL: URL?
/// …
/// .sheet(item: Binding(
///     get: { fileURL.map(IdentifiedURL.init) },
///     set: { if $0 == nil { fileURL = nil } }
/// )) { item in
///     QuickLookView(url: item.url)
///         .ignoresSafeArea()
/// }
/// ```
///
/// The wrapper reloads the preview when the URL changes so you can reuse
/// a single sheet across multiple attachments.
struct QuickLookView: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {
        context.coordinator.url = url
        uiViewController.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as QLPreviewItem
        }
    }
}
