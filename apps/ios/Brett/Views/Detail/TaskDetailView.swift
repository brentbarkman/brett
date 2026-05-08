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

    /// True once the user has touched any draft field. Without this guard
    /// a late-arriving `@Query` result (cold open / slow disk / tap into
    /// a freshly-pulled item where `.task` runs before the row resolves)
    /// would re-fire `.onChange(of: item?.id)` and re-seed the draft —
    /// trampling the typed characters. Reset alongside `hasSeededDraft`
    /// when the underlying item identity transitions to a different row.
    @State private var hasUserEdited: Bool = false

    @State private var uploader: AttachmentUploader?
    @State private var downloader: AttachmentDownloader?

    /// In-flight debounce task for picker-style draft commits (due date,
    /// list, reminder, recurrence). Cancelled and reset on each new
    /// change so a flurry of rapid edits collapses to a single commit
    /// after the trailing 500 ms of quiet. Title and notes commit via
    /// their own blur/submit handlers and bypass this path.
    @State private var commitDebounceTask: Task<Void, Never>?

    /// Watched tuple of the picker-style draft axes. Folding the four
    /// `.onChange(of:)` blocks into one watch-by-tuple keeps the commit
    /// path single-sourced and lets the debounce coalesce edits across
    /// fields (e.g. setting a due date *and* a reminder in the same
    /// breath emits one PATCH instead of two).
    private struct DraftChangeAxes: Equatable {
        let dueDate: Date?
        let listId: String?
        let reminder: String?
        let recurrence: String?
    }

    private var draftChangeAxes: DraftChangeAxes {
        DraftChangeAxes(
            dueDate: draft.dueDate,
            listId: draft.listId,
            reminder: draft.reminder,
            recurrence: draft.recurrence
        )
    }

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
        DetailViewContainer(bottomPadding: 40) {
            VStack(alignment: .leading, spacing: 12) {
                headerSection
                contentPreviewSection
                detailsCardSection
                notesSection
                attachmentsSectionView
                linksSectionView
                brettSection
            }
        }
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
        //
        // If the user navigated to a DIFFERENT task (id transition between
        // two non-nil values), reset both gates so the new row's values
        // can land fresh. The cold-open race itself (nil → some) keeps
        // `hasUserEdited` honest because seedDraftIfNeeded checks both.
        .onChange(of: item?.id) { oldId, newId in
            if oldId != nil, newId != nil, oldId != newId {
                hasSeededDraft = false
                hasUserEdited = false
            }
            seedDraftIfNeeded()
        }
        // Flush any pending in-flight text edits BEFORE cancelling the
        // debounce. Without this, drag-to-dismiss the sheet loses
        // unsaved title changes — the title TextField commits only on
        // .onSubmit (return key), and the title in the sheet header is
        // the most common edit path.
        //
        // Gated on `hasUserEdited` so a sheet that's only being viewed
        // (no edits) doesn't trigger spurious diffs. `commitDraft()` is
        // itself idempotent (early-returns when the diff is empty), but
        // skipping it for view-only dismissals keeps the trace clean.
        .onDisappear {
            if hasUserEdited {
                commitDraft()
            }
            commitDebounceTask?.cancel()
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
                    .onChange(of: draft.title) { _, _ in hasUserEdited = true }
                    .onSubmit { commitDraft() }
                    .accessibilityIdentifier("detail.titleField")
            }
        }
        // Pads below the sheet's drag indicator so the breadcrumb/title
        // doesn't sit right under it. DetailViewContainer's own top
        // padding of 8 leaves only ~12pt of breathing room which reads
        // tight against the indicator and the sheet's rounded edge.
        .padding(.top, 16)
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
            .onChange(of: draftChangeAxes) { _, _ in
                hasUserEdited = true
                scheduleDebouncedCommit()
            }
    }

    @ViewBuilder
    private var notesSection: some View {
        NotesEditor(text: $draft.notes) { _ in
            hasUserEdited = true
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
    ///
    /// Also bails if the user has already started typing — protects
    /// against the cold-open race where `.task` runs before SwiftData's
    /// @Query resolves the row, the user starts typing into the empty
    /// title, and THEN the row arrives and re-fires this seed via
    /// `.onChange(of: item?.id)`.
    private func seedDraftIfNeeded() {
        guard !hasSeededDraft, !hasUserEdited, let item else { return }
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
                // worse than a quiet fallback. Still log so real errors
                // are observable in Console.app.
                BrettLog.ui.info("TaskDetailView hydrateChat fetch failed (kept local): \(String(describing: error), privacy: .public)")
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
            // Non-fatal — keep whatever we had from local state. Logged at
            // info so transient network blips don't pollute the error
            // signal, but the failure is still observable in Console.app.
            BrettLog.ui.info("TaskDetailView refreshFromServer failed (non-fatal): \(String(describing: error), privacy: .public)")
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

    /// Coalesce picker-style draft changes into a single trailing commit.
    /// Replaces the prior four-`.onChange`-each-firing-`commitDraft`
    /// pattern: a date/list/reminder/recurrence edit re-arms a 500 ms
    /// quiet timer and the subsequent commit captures the latest state,
    /// so back-to-back tweaks (e.g. picking a due date and immediately
    /// setting a reminder) produce one PATCH instead of two.
    private func scheduleDebouncedCommit() {
        commitDebounceTask?.cancel()
        commitDebounceTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                commitDraft()
            }
        }
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
            // Surface in logs rather than swallowing — without this, a
            // failed link tap looks identical to a successful one (no UI
            // state changes) and the user has no signal anything went
            // wrong. Until a banner hook lands here, this at least makes
            // the failure visible in Console.app and to telemetry.
            BrettLog.ui.error("TaskDetailView addLink failed: \(String(describing: error), privacy: .public)")
        }
    }

    private func removeLink(_ link: LinkedItemSummary) async {
        do {
            try await APIClient.shared.deleteLink(fromItemId: itemId, linkId: link.linkId)
            await refreshFromServer()
        } catch {
            // Same rationale as addLink — a silent failure leaves the link
            // visible in the panel and the user assumes the unlink worked.
            BrettLog.ui.error("TaskDetailView removeLink failed: \(String(describing: error), privacy: .public)")
        }
    }
}
