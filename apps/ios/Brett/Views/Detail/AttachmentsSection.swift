import SwiftUI
import QuickLook
import UniformTypeIdentifiers

/// Glass-carded list of an item's attachments with an upload button. Hosts
/// two UIKit wrappers:
///   - `DocumentPickerView` for `UIDocumentPickerViewController` (file pick)
///   - `QuickLookPreview` for `QLPreviewController` (tap-to-open)
///
/// Upload is fire-and-forget: on pick we hand the URL to the injected
/// `AttachmentUploader`, which handles staging, progress, and server
/// confirmation. The UI re-reads `AttachmentStore.fetchForItem(itemId)` on
/// every render so new rows show up as the sync engine writes them.
struct AttachmentsSection: View {
    let itemId: String
    /// Fresh list of attachments for this item; caller refetches when the
    /// store signals a change. Passed in so the parent owns the store.
    let attachments: [Attachment]

    /// In-flight uploads for this item — rendered as ghost rows above the
    /// confirmed attachments so the user sees progress immediately.
    let pendingUploads: [AttachmentUpload]

    let uploader: AttachmentUploader
    let downloader: AttachmentDownloader

    /// Hook the parent uses to refresh after a delete. The row deletion also
    /// fires an API call; the store refetch is how the UI reflects it.
    let onAfterChange: () -> Void

    @State private var showingDocumentPicker = false
    @State private var previewURL: URL?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("ATTACHMENTS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Spacer()

                Button {
                    HapticManager.light()
                    showingDocumentPicker = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Add")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.textInactive)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(0.10), in: Capsule())
                }
            }

            if attachments.isEmpty && pendingUploads.isEmpty {
                emptyState
            } else {
                VStack(spacing: 0) {
                    ForEach(pendingUploads, id: \.id) { upload in
                        uploadRow(upload)
                        rowDivider()
                    }

                    ForEach(Array(attachments.enumerated()), id: \.element.id) { index, attachment in
                        attachmentRow(attachment)
                        if index < attachments.count - 1 {
                            rowDivider()
                        }
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 11))
                    .foregroundStyle(BrettColors.error)
            }
        }
        .glassCard()
        .sheet(isPresented: $showingDocumentPicker) {
            DocumentPickerView { url in
                handlePick(url)
            }
            .ignoresSafeArea()
        }
        .sheet(item: Binding(
            get: { previewURL.map(PreviewItem.init) },
            set: { if $0 == nil { previewURL = nil } }
        )) { item in
            QuickLookPreview(url: item.url)
                .ignoresSafeArea()
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func attachmentRow(_ attachment: Attachment) -> some View {
        Button {
            HapticManager.light()
            openAttachment(attachment)
        } label: {
            HStack(spacing: 12) {
                iconCircle(for: attachment.mimeType)

                VStack(alignment: .leading, spacing: 2) {
                    Text(attachment.filename)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(1)
                    Text(formatBytes(attachment.sizeBytes))
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textInactive)
                }

                Spacer()

                Menu {
                    Button(role: .destructive) {
                        Task { await deleteAttachment(attachment) }
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrettColors.textGhost)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
            }
            .contentShape(Rectangle())
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func uploadRow(_ upload: AttachmentUpload) -> some View {
        HStack(spacing: 12) {
            iconCircle(for: upload.mimeType)

            VStack(alignment: .leading, spacing: 3) {
                Text(upload.filename)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Text(uploadStageLabel(upload.stageEnum))
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textInactive)
                    Text("•")
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textGhost)
                    Text("\(Int(upload.uploadProgress * 100))%")
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.gold)
                }

                ProgressView(value: upload.uploadProgress)
                    .progressViewStyle(.linear)
                    .tint(BrettColors.gold)
                    .frame(height: 2)
            }

            Spacer()

            if upload.stageEnum != .done {
                Button {
                    uploader.cancelUpload(id: upload.id)
                    onAfterChange()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(BrettColors.textInactive)
                        .frame(width: 26, height: 26)
                        .background(Color.white.opacity(0.08), in: Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private func iconCircle(for mimeType: String) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(0.10))
                .frame(width: 34, height: 34)

            Image(systemName: iconName(mimeType))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(iconColor(mimeType))
        }
    }

    @ViewBuilder
    private func rowDivider() -> some View {
        Rectangle()
            .fill(BrettColors.hairline)
            .frame(height: 0.5)
    }

    @ViewBuilder
    private var emptyState: some View {
        Button {
            showingDocumentPicker = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "paperclip")
                    .font(.system(size: 13, weight: .medium))
                Text("Tap to attach a file")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(BrettColors.textPlaceholder)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(BrettColors.cardBorder, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func handlePick(_ url: URL) {
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }

        let filename = url.lastPathComponent
        let mimeType = mimeType(for: url) ?? "application/octet-stream"

        Task {
            do {
                try await uploader.enqueue(
                    itemId: itemId,
                    fileURL: url,
                    filename: filename,
                    mimeType: mimeType
                )
                await MainActor.run {
                    errorMessage = nil
                    onAfterChange()
                }
            } catch {
                await MainActor.run {
                    errorMessage = (error as? AttachmentUploader.EnqueueError).map(formatEnqueueError) ?? "Upload failed"
                }
            }
        }
    }

    private func openAttachment(_ attachment: Attachment) {
        Task {
            do {
                let localURL = try await downloader.localURL(for: attachment)
                await MainActor.run { previewURL = localURL }
            } catch {
                // Fall back: if we can't fetch a presigned URL (endpoint not
                // wired yet), surface a soft error instead of crashing.
                await MainActor.run {
                    errorMessage = "Can't open this file offline."
                }
            }
        }
    }

    private func deleteAttachment(_ attachment: Attachment) async {
        do {
            try await APIClient.shared.deleteAttachment(
                itemId: attachment.itemId,
                attachmentId: attachment.id
            )
            await MainActor.run {
                errorMessage = nil
                onAfterChange()
            }
        } catch {
            await MainActor.run {
                errorMessage = (error as? APIError)?.userFacingMessage ?? "Delete failed"
            }
        }
    }

    // MARK: - Helpers

    private func iconName(_ mimeType: String) -> String {
        if mimeType.hasPrefix("image/") { return "photo" }
        if mimeType.contains("pdf") { return "doc.text" }
        if mimeType.hasPrefix("video/") { return "film" }
        if mimeType.hasPrefix("audio/") { return "headphones" }
        return "doc"
    }

    private func iconColor(_ mimeType: String) -> Color {
        // Cerulean is Brett AI only — attachments are user content, not
        // AI surfaces. Use the listBlue tint for images so they're still
        // colour-coded without borrowing the brand signal.
        if mimeType.hasPrefix("image/") { return BrettColors.listBlue }
        if mimeType.contains("pdf") { return BrettColors.error }
        if mimeType.hasPrefix("video/") { return BrettColors.purple400 }
        return BrettColors.textInactive
    }

    private func uploadStageLabel(_ stage: AttachmentUploadStage) -> String {
        switch stage {
        case .pending, .requestingUrl: return "Preparing"
        case .uploading: return "Uploading"
        case .confirming: return "Saving"
        case .done: return "Done"
        case .failed: return "Failed"
        }
    }

    private func formatBytes(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }

    private func mimeType(for url: URL) -> String? {
        guard let type = UTType(filenameExtension: url.pathExtension.lowercased()) else {
            return nil
        }
        return type.preferredMIMEType
    }

    private func formatEnqueueError(_ error: AttachmentUploader.EnqueueError) -> String {
        switch error {
        case .fileNotFound: return "Couldn't read that file."
        case .fileTooLarge(let size):
            let limit = ByteCountFormatter.string(fromByteCount: Int64(AttachmentUploader.maxFileSize), countStyle: .file)
            let actual = ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
            return "File is \(actual) — max is \(limit)."
        case .missingMimeType: return "Unknown file type."
        case .copyFailed: return "Couldn't stage the upload."
        }
    }
}

// MARK: - Identifiable wrapper for preview sheet

private struct PreviewItem: Identifiable {
    let url: URL
    var id: String { url.path }
}

// MARK: - UIKit wrappers

private struct DocumentPickerView: UIViewControllerRepresentable {
    let onPick: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.content, .item, .data], asCopy: true)
        picker.allowsMultipleSelection = false
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void
        init(onPick: @escaping (URL) -> Void) { self.onPick = onPick }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            if let first = urls.first { onPick(first) }
        }
    }
}

private struct QuickLookPreview: UIViewControllerRepresentable {
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
