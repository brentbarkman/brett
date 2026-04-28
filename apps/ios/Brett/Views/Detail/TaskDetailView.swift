import SwiftUI
import SwiftData

/// Fully wired task detail view.
///
/// Design goals:
///  - Bind directly to SwiftData via `@Query` predicates that match the
///    target `(itemId, userId)` pair. Writes still go through
///    `ItemStore.update(id:changes:previousValues:userId:)` so the sync
///    engine picks them up.
///  - Buffer edits in an `ItemDraft`; commit on blur + explicit actions so
///    every keystroke isn't a round-trip.
///
/// Auth gate around `TaskDetailBody`. The body is the work-doer; this
/// outer view exists only to extract `userId` from the environment and
/// hand it to a child whose `@Query` predicates capture it directly.
///
/// SwiftData's `#Predicate` macro can't read `@Environment` values, so
/// the established workaround is an init-based subview where `userId`
/// is a stored property and each `@Query` is constructed in `init` with
/// the captured user. This pushes the user filter down into the
/// SwiftData fetch instead of doing it in Swift after the fact —
/// cheaper, and keeps cross-user rows from ever entering the working
/// set. Critically, this fixes the prior unscoped `itemStore.fetchById`
/// call that could resolve a row belonging to a different account
/// lingering in SwiftData (e.g. between sign-out and the wipe completing).
///
/// View identity:
/// `TaskDetailView` is a thin auth gate — when the user is authenticated
/// it renders `TaskDetailBody(userId:itemId:)` modified with
/// `.id("\(userId)-\(itemId)")`. The composite identity is intentional:
/// the same sheet host can reopen for a different task without unmounting,
/// and a user-swap should remount for the same reason as on the rest of
/// the page hierarchy. Sign-out is covered for free: `RootView`'s auth
/// gate unmounts `MainContainer` entirely, which destroys the body via
/// the structural path.
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
    // history inside this sheet. Held here (not in the body) so it
    // survives child remounts driven by the body's composite `.id`.
    @State private var linkStack: [String] = []

    @Environment(AuthManager.self) private var authManager

    init(itemId: String) {
        self.itemId = itemId
    }

    var body: some View {
        if let userId = authManager.currentUser?.id {
            NavigationStack(path: $linkStack) {
                TaskDetailBody(userId: userId, itemId: itemId) { id in
                    linkStack.append(id)
                }
                .id("\(userId)-\(itemId)")
                .navigationDestination(for: String.self) { linkedId in
                    TaskDetailBody(userId: userId, itemId: linkedId) { id in
                        linkStack.append(id)
                    }
                    .id("\(userId)-\(linkedId)")
                }
            }
        } else {
            // Signed-out fallback. The auth gate upstream (`MainContainer`)
            // usually prevents this branch, but render an empty state
            // defensively rather than nil-fallback so the type system
            // doesn't have to model a missing user here.
            EmptyView()
        }
    }
}

// MARK: - Body (the actual content, reusable for link navigation)

/// Detail data + UI. Owned by `TaskDetailView`'s auth gate, so `userId`
/// is guaranteed non-optional for this view's lifetime. Re-instantiated
/// on account switch OR `itemId` change because the parent applies
/// `.id("\(userId)-\(itemId)")` — SwiftUI treats a changed `id` as a new
/// view identity and remounts this body from scratch, which gives us a
/// fresh `@Query` with the new user/item predicate (plus a clean slate
/// for `@State` stores and caches).
private struct TaskDetailBody: View {
    let userId: String
    let itemId: String
    let onOpenLinkedItem: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var listStore = ListStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var attachmentStore = AttachmentStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var messageStore = MessageStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var chatStore = ChatStore()

    /// Single-row reactive read of the item for `(userId, itemId)`.
    /// Replaces the prior unscoped `itemStore.fetchById(itemId)` lookup
    /// — that legacy form could match a row belonging to a different
    /// account that was still lingering in SwiftData. The user-scoped
    /// predicate guarantees cross-user isolation.
    @Query private var matchedItems: [Item]

    /// Live reactive read of the user's non-archived lists for the
    /// list picker in `DetailsCard`. Replaces the prior imperative
    /// `listStore.fetchAll(userId:)` call so the picker refreshes
    /// automatically when a list is created / renamed elsewhere.
    @Query private var lists: [ItemList]

    @State private var draft: ItemDraft = .init()
    @State private var attachments: [Attachment] = []
    @State private var pendingUploads: [AttachmentUpload] = []
    @State private var links: [LinkedItemSummary] = []

    /// Snapshot of the last item identity we synced the draft from.
    /// `@Query` is reactive: any mutation to the matched row pushes
    /// a fresh SwiftData notification through this view. Without a guard
    /// the draft would be reset on every keystroke (because each commit
    /// republishes the row through SwiftData), wiping the user's
    /// in-progress edit. We re-seed the draft only when the underlying
    /// item identity transitions from "absent" to "present" — i.e. on
    /// first match — and otherwise let the user's draft stay in flight.
    @State private var hasSeededDraft: Bool = false

    @State private var uploader: AttachmentUploader?
    @State private var downloader: AttachmentDownloader?

    init(userId: String, itemId: String, onOpenLinkedItem: @escaping (String) -> Void) {
        self.userId = userId
        self.itemId = itemId
        self.onOpenLinkedItem = onOpenLinkedItem

        let itemPredicate = #Predicate<Item> { item in
            item.id == itemId && item.userId == userId
        }
        _matchedItems = Query(filter: itemPredicate)

        let listPredicate = #Predicate<ItemList> { list in
            list.deletedAt == nil && list.userId == userId
        }
        _lists = Query(filter: listPredicate, sort: \ItemList.sortOrder)
    }

    private var item: Item? { matchedItems.first }

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
            seedDraftIfNeeded()
            refreshAttachments()
            hydrateChat()
            await refreshFromServer()
        }
        // Re-seed the draft when the item first lands. This handles the
        // cold-open case where `task` runs before SwiftData's @Query has
        // resolved the row — the seed inside `.task` then no-ops because
        // `item` is still nil, and this onChange picks it up on first match.
        .onChange(of: item?.id) { _, _ in
            seedDraftIfNeeded()
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

    /// Seed the edit buffer from the matched item the first time it
    /// appears. Subsequent SwiftData republishes (driven by every
    /// commit) leave the draft alone so the user's in-flight edits
    /// aren't trampled.
    private func seedDraftIfNeeded() {
        guard !hasSeededDraft, let item else { return }
        draft = ItemDraft(from: item)
        hasSeededDraft = true
    }

    /// Hydrate the chat panel from the server. Chat history is no longer
    /// replicated via /sync/pull — the local `BrettMessage` table only
    /// holds whatever assistant responses streamed during this install,
    /// so it's an incomplete view (no user messages, no cross-device
    /// history). Source of truth is `GET /brett/chat/:itemId`, cached
    /// in `RemoteCache` for the lifetime of the process.
    ///
    /// Run order on a cold open:
    ///   1. Show local SwiftData immediately (`MessageStore.fetchForItem`)
    ///      so the panel renders without a network round-trip on
    ///      reasonable connections — kept as a soft fallback for true
    ///      offline.
    ///   2. Fetch latest from server in a Task; replace the panel with
    ///      the server's authoritative ordering when it lands.
    private func hydrateChat() {
        let persisted = messageStore.fetchForItem(itemId, userId: userId)
        chatStore.hydrate(itemId: itemId, from: persisted)

        Task {
            do {
                let page = try await RemoteCache.shared.chatHistoryForItem(itemId)
                await MainActor.run {
                    chatStore.hydrate(itemId: itemId, from: page.messages)
                }
            } catch {
                // Network error — keep the local hydrate. The chat panel
                // already renders SOMETHING; surfacing a banner here is
                // worse than a quiet fallback.
            }
        }
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
        attachments = attachmentStore.fetchForItem(itemId, userId: userId)
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
        itemStore.commit(diff, to: item.id, userId: userId)
        // No manual reload needed — `@Query` reactively republishes the
        // matched row through `matchedItems` after the save lands.
    }

    private func toggleComplete() async {
        guard let item else { return }
        itemStore.toggleStatus(id: item.id, userId: userId)
        // No manual reload needed — `@Query` reactively republishes the
        // matched row through `matchedItems` after the save lands.
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
