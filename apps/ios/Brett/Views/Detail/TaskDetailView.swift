import SwiftUI
import SwiftData

/// Fully wired task detail view.
///
/// Design goals:
///  - Bind directly to SwiftData via `ItemStore.fetchById`. Writes go
///    through the existing `ItemStore.update(id:changes:previousValues:)`
///    path so the sync engine picks them up.
///  - Buffer edits in an `ItemDraft`; commit on blur + explicit actions so
///    every keystroke isn't a round-trip.
///  - Keep the existing `TaskDetailView(store:itemId:)` signature so
///    `MainContainer`'s sheet wiring keeps working. `MockStore` is kept for
///    back-compat; it is unused when the item exists in SwiftData.
///
/// Layout (top → bottom, scrollable):
///  1. Header: back breadcrumb + gold checkbox + editable title
///  2. Optional ContentPreview (articles, newsletters, tweets, PDFs, video)
///  3. DetailsCard (due date, list, reminder, recurrence)
///  4. NotesEditor
///  5. AttachmentsSection
///  6. LinksSection
///  7. BrettChatSection
struct TaskDetailView: View {
    let itemId: String

    // Stack of pushed linked-item detail views so tapping a link preserves
    // history inside this sheet.
    @State private var linkStack: [String] = []

    init(itemId: String) {
        self.itemId = itemId
    }

    var body: some View {
        NavigationStack(path: $linkStack) {
            TaskDetailBody(itemId: itemId) { id in
                linkStack.append(id)
            }
            .navigationDestination(for: String.self) { linkedId in
                TaskDetailBody(itemId: linkedId) { id in
                    linkStack.append(id)
                }
            }
        }
    }
}

// MARK: - Body (the actual content, reusable for link navigation)

private struct TaskDetailBody: View {
    let itemId: String
    let onOpenLinkedItem: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var itemStore = ItemStore()
    @State private var listStore = ListStore()
    @State private var attachmentStore = AttachmentStore()
    @State private var messageStore = MessageStore()
    @State private var chatStore = ChatStore()

    @State private var item: Item?
    @State private var draft: ItemDraft = .init()
    @State private var attachments: [Attachment] = []
    @State private var pendingUploads: [AttachmentUpload] = []
    @State private var lists: [ItemList] = []
    @State private var links: [LinkedItemSummary] = []

    @State private var uploader: AttachmentUploader?
    @State private var downloader: AttachmentDownloader?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                headerSection
                contentPreviewSection
                detailsCardSection
                notesSection
                attachmentsSectionView
                linksSectionView
                brettSection
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(Color.clear)
        .task {
            await initializeIfNeeded()
            reload()
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let listName = currentListName {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 11, weight: .semibold))
                        Text(listName)
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.textInactive)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("detail.close")
            }

            HStack(alignment: .top, spacing: 12) {
                goldCheckbox

                TextField("Task title", text: $draft.title, axis: .vertical)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(isCompleted ? BrettColors.textInactive : .white)
                    .strikethrough(isCompleted, color: BrettColors.textGhost)
                    .tint(BrettColors.gold)
                    .lineLimit(1...4)
                    .submitLabel(.done)
                    .onSubmit { commitDraft() }
                    .accessibilityIdentifier("detail.titleField")
            }
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private var goldCheckbox: some View {
        Button {
            HapticManager.light()
            Task { await toggleComplete() }
        } label: {
            ZStack {
                Circle()
                    .fill(isCompleted ? BrettColors.gold : Color.clear)
                    .frame(width: 26, height: 26)
                Circle()
                    .strokeBorder(isCompleted ? BrettColors.gold : BrettColors.textInactive, lineWidth: 1.5)
                    .frame(width: 26, height: 26)
                if isCompleted {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("detail.checkbox")
    }

    @ViewBuilder
    private var contentPreviewSection: some View {
        if let item {
            ContentPreview(item: item)
        }
    }

    @ViewBuilder
    private var detailsCardSection: some View {
        DetailsCard(draft: $draft, lists: lists)
            .onChange(of: draft.dueDate) { _, _ in commitDraft() }
            .onChange(of: draft.listId) { _, _ in commitDraft() }
            .onChange(of: draft.reminder) { _, _ in commitDraft() }
            .onChange(of: draft.recurrence) { _, _ in commitDraft() }
    }

    @ViewBuilder
    private var notesSection: some View {
        NotesEditor(text: $draft.notes) { _ in
            commitDraft()
        }
    }

    @ViewBuilder
    private var attachmentsSectionView: some View {
        if let uploader, let downloader {
            AttachmentsSection(
                itemId: itemId,
                attachments: attachments,
                pendingUploads: pendingUploads,
                uploader: uploader,
                downloader: downloader,
                onAfterChange: { refreshAttachments() }
            )
            .task(id: itemId) {
                for await _ in uploader.progressStream {
                    refreshAttachments()
                }
            }
        }
    }

    @ViewBuilder
    private var linksSectionView: some View {
        LinksSection(
            itemId: itemId,
            links: links,
            onAddLink: { targetId in await addLink(targetId) },
            onRemoveLink: { link in await removeLink(link) },
            onOpenLink: { link in onOpenLinkedItem(link.itemId) }
        )
    }

    @ViewBuilder
    private var brettSection: some View {
        BrettChatSection(store: chatStore, itemId: itemId)
    }

    // MARK: - Derived

    private var isCompleted: Bool {
        item?.itemStatus == .done
    }

    private var currentListName: String? {
        guard let listId = draft.listId,
              let list = lists.first(where: { $0.id == listId }) else {
            return nil
        }
        return list.name
    }

    // MARK: - Lifecycle

    private func initializeIfNeeded() async {
        if uploader == nil {
            uploader = AttachmentUploader(
                apiClient: .shared,
                attachmentStore: attachmentStore,
                persistence: .shared
            )
        }
        if downloader == nil {
            downloader = AttachmentDownloader(apiClient: .shared)
        }
    }

    private func reload() {
        item = itemStore.fetchById(itemId)
        lists = listStore.fetchAll()
        if let item {
            draft = ItemDraft(from: item)
        }
        refreshAttachments()
        hydrateChat()

        Task { await refreshFromServer() }
    }

    private func hydrateChat() {
        let persisted = messageStore.fetchForItem(itemId)
        chatStore.hydrate(itemId: itemId, from: persisted)
    }

    private func refreshFromServer() async {
        do {
            let detail = try await APIClient.shared.fetchThingDetail(id: itemId)
            await MainActor.run {
                links = (detail.links ?? []).map { link in
                    LinkedItemSummary(
                        linkId: link.id,
                        itemId: link.toItemId,
                        title: link.toItemTitle ?? "Untitled",
                        type: link.toItemType,
                        source: link.source ?? "manual"
                    )
                }
            }
        } catch {
            // Non-fatal — keep whatever we had from local state.
        }
    }

    private func refreshAttachments() {
        attachments = attachmentStore.fetchForItem(itemId)
        pendingUploads = fetchPendingUploads()
    }

    private func fetchPendingUploads() -> [AttachmentUpload] {
        let context = PersistenceController.shared.mainContext
        var descriptor = FetchDescriptor<AttachmentUpload>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        let currentItemId = itemId
        descriptor.predicate = #Predicate { upload in
            upload.itemId == currentItemId && upload.stage != "done"
        }
        return (try? context.fetch(descriptor)) ?? []
    }

    // MARK: - Actions

    private func commitDraft() {
        guard let item else { return }
        let diff = draft.diff(against: item)
        guard !diff.isEmpty else { return }
        itemStore.commit(diff, to: item.id)
        self.item = itemStore.fetchById(itemId)
    }

    private func toggleComplete() async {
        guard let item else { return }
        itemStore.toggleStatus(id: item.id)
        self.item = itemStore.fetchById(itemId)
    }

    private func addLink(_ targetId: String) async {
        do {
            _ = try await APIClient.shared.createLink(
                fromItemId: itemId,
                toItemId: targetId,
                toItemType: "task"
            )
            await refreshFromServer()
        } catch {
            // swallow
        }
    }

    private func removeLink(_ link: LinkedItemSummary) async {
        do {
            try await APIClient.shared.deleteLink(fromItemId: itemId, linkId: link.linkId)
            await refreshFromServer()
        } catch {
            // swallow
        }
    }
}
