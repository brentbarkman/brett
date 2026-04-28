import SwiftData
import SwiftUI

/// A single list's detail view — pushed from the list drawer or any other
/// entry point that routes through `NavDestination.listView(id:)`.
///
/// Layout:
///   1. Header: editable list name (tap to rename) + "N items" subtitle.
///   2. Archived banner (if archived).
///   3. StickyCardSection with all items in the list — list-specific quick
///      capture sits at the top of the card.
///   4. Empty state when the card has zero items.
///
/// Auth gate around `ListViewBody`. The body is the work-doer; this
/// outer view exists only to extract `userId` from the environment and
/// hand it to a child whose `@Query` predicates capture it directly.
///
/// SwiftData's `#Predicate` macro can't read `@Environment` values, so
/// the established workaround is an init-based subview where `userId`
/// is a stored property and each `@Query` is constructed in `init` with
/// the captured user. This pushes the user filter down into the
/// SwiftData fetch instead of doing it in Swift after the fact —
/// cheaper, and keeps cross-user rows from ever entering the working set.
///
/// View identity:
/// `ListView` is a thin auth gate — when the user is authenticated it
/// renders `ListViewBody(userId:listId:)` modified with
/// `.id("\(userId)-\(listId)")`. The composite identity is intentional:
/// switching from one list to another should remount the body so the
/// `listId`-bound predicates re-bind, and a user-swap should also
/// remount for the same reason as on `TodayPage` / `InboxPage` /
/// `ListsPage`. Sign-out is covered for free: `RootView`'s auth gate
/// unmounts `MainContainer` entirely, which destroys the body via the
/// structural path.
struct ListView: View {
    let listId: String
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            ListViewBody(userId: userId, listId: listId)
                .id("\(userId)-\(listId)")
        } else {
            // Signed-out fallback. The auth gate upstream
            // (`MainContainer`) usually prevents this branch, but render
            // an empty state defensively rather than nil-fallback so the
            // type system doesn't have to model a missing user here.
            EmptyView()
        }
    }
}

/// List-detail data + UI. Owned by `ListView`'s auth gate, so `userId`
/// is guaranteed non-optional for this view's lifetime. Re-instantiated
/// on account switch OR `listId` change because the parent applies
/// `.id("\(userId)-\(listId)")` — SwiftUI treats a changed `id` as a new
/// view identity and remounts this body from scratch, which gives us a
/// fresh `@Query` with the new user/list predicate (plus a clean slate
/// for `@State` stores and caches).
private struct ListViewBody: View {
    let userId: String
    let listId: String

    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.container.mainContext
    )
    @State private var listStore = ListStore(
        context: PersistenceController.shared.container.mainContext
    )

    @State private var draftName: String = ""
    @State private var isEditingName = false
    @FocusState private var nameFocused: Bool

    /// Single-row reactive read of the list metadata for `(userId, listId)`.
    /// Replaces the prior imperative `listStore.fetchById(listId)` lookup
    /// so the header + archived state refresh automatically when the row
    /// changes (rename, recolor, archive, unarchive) without manual nudges.
    @Query private var listsMatch: [ItemList]

    /// Live reactive read of this list's non-deleted items, scoped to the
    /// signed-in user. Replaces the prior imperative
    /// `itemStore.fetchAll(userId:listId:)` call so the card refreshes
    /// automatically on create/toggle/delete without a manual re-render.
    /// Sorted reverse-chronological by `createdAt` to match the desktop
    /// `/things` route's `orderBy: [{ createdAt: "desc" }]`.
    @Query private var items: [Item]

    /// Used to decide skeleton-vs-empty-state when this list has zero
    /// items on first render. NOT user-scoped — `SyncHealth` is a
    /// sync-internal row count that doesn't need cross-user isolation.
    @Query private var syncHealthRows: [SyncHealth]

    init(userId: String, listId: String) {
        self.userId = userId
        self.listId = listId

        let listPredicate = #Predicate<ItemList> { list in
            list.id == listId && list.userId == userId
        }
        _listsMatch = Query(filter: listPredicate)

        let itemPredicate = #Predicate<Item> { item in
            item.deletedAt == nil &&
            item.userId == userId &&
            item.listId == listId
        }
        _items = Query(filter: itemPredicate, sort: \Item.createdAt, order: .reverse)

        // Explicit reassignment to keep parallel structure with the
        // user-scoped queries above. Functionally redundant — the
        // property declaration's default `Query()` is identical — but
        // keeping it makes the init read as a complete inventory of
        // every `@Query` this view owns.
        _syncHealthRows = Query()
    }

    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    private var realList: ItemList? {
        listsMatch.first
    }

    private var listName: String {
        realList?.name ?? "List"
    }

    private var listColor: ListColor {
        if let colorClass = realList?.colorClass, let color = ListColor(colorClass: colorClass) {
            return color
        }
        return .slate
    }

    /// Stable secondary by `id` to break createdAt ties deterministically.
    /// The primary sort already happens at the `@Query` level
    /// (`createdAt` desc); this re-sort only kicks in when two rows share
    /// a `createdAt` value, which is rare but possible for batch creates.
    private var sortedItems: [Item] {
        items.sorted {
            if $0.createdAt != $1.createdAt {
                return $0.createdAt > $1.createdAt
            }
            return $0.id < $1.id
        }
    }

    private var activeCount: Int {
        sortedItems.filter { $0.itemStatus != .done }.count
    }

    private var isArchived: Bool {
        realList?.archivedAt != nil
    }

    var body: some View {
        ZStack {
            BackgroundView()

            ScrollView {
                VStack(spacing: 0) {
                    header()
                        .padding(.horizontal, 20)
                        .padding(.top, 4)
                        .padding(.bottom, 16)

                    if isArchived {
                        archivedBanner()
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                    }

                    StickyCardSection {
                        stickyHeaderContent()
                    } content: {
                        VStack(spacing: 0) {
                            // Embedded quick-capture used to live here but
                            // duplicated the always-visible Omnibar at the
                            // bottom of the screen (two inputs for the same
                            // "add to this list" action). The Omnibar is
                            // now passed `listId: listId` so typing there
                            // lands items in this list by default.

                            if sortedItems.isEmpty {
                                if hasCompletedInitialSync {
                                    VStack(spacing: 6) {
                                        Text("No items yet")
                                            .font(.system(size: 14, weight: .medium))
                                            .foregroundStyle(BrettColors.textBody)
                                        Text("Capture your first one below.")
                                            .font(.system(size: 13))
                                            .foregroundStyle(BrettColors.textMeta)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 32)
                                } else {
                                    TaskListPlaceholder()
                                        .padding(.vertical, 16)
                                }
                            } else {
                                ForEach(Array(sortedItems.enumerated()), id: \.element.id) { index, item in
                                    TaskRow(
                                        item: item,
                                        listName: nil,
                                        allowDrag: true,
                                        dragIDs: sortedItems.map(\.id),
                                        onToggle: { toggle(item.id) },
                                        onSelect: {
                                            // Wave D: route via the unified
                                            // sheet driver. Phase 3 will retire
                                            // the legacy `selectedTaskId`
                                            // mirror entirely; until then keep
                                            // both writes so any reader that
                                            // still inspects it continues to
                                            // work.
                                            SelectionStore.shared.selectedTaskId = item.id
                                            SelectionStore.shared.currentDestination = .taskDetail(id: item.id)
                                        },
                                        onSchedule: { dueDate in schedule(item.id, dueDate: dueDate) },
                                        onArchive: { archive(item.id) },
                                        onDelete: { delete(item.id) },
                                        onReorder: { newOrder in reorder(newOrder) }
                                    )
                                    .padding(.horizontal, 16)

                                    if index < sortedItems.count - 1 {
                                        Divider()
                                            .background(BrettColors.hairline)
                                            .padding(.horizontal, 16)
                                    }
                                }
                            }
                        }
                        .padding(.bottom, 8)
                    }
                }
                .padding(.bottom, 70)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .coordinateSpace(name: "scroll")
            .refreshable {
                try? await ActiveSession.syncManager?.pullToRefresh()
            }
        }
        .overlay(alignment: .bottom) {
            OmnibarView(
                placeholder: "Add to \(listName)...",
                listId: listId
            )
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(listColor.swiftUIColor)
                        .frame(width: 8, height: 8)
                    Text(listName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    if isArchived {
                        unarchiveCurrentList()
                    } else {
                        archiveCurrentList()
                    }
                } label: {
                    Image(systemName: isArchived ? "tray.and.arrow.up" : "archivebox")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.60))
                }
                .accessibilityLabel(isArchived ? "Unarchive list" : "Archive list")
            }
        }
    }

    @ViewBuilder
    private func header() -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if isEditingName {
                TextField("List name", text: $draftName)
                    .font(BrettTypography.dateHeader)
                    .foregroundStyle(.white)
                    .tint(BrettColors.gold)
                    .focused($nameFocused)
                    .submitLabel(.done)
                    .onSubmit { commitNameEdit() }
            } else {
                Button {
                    draftName = listName
                    isEditingName = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                        nameFocused = true
                    }
                } label: {
                    Text(listName)
                        .font(BrettTypography.dateHeader)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            }

            Text(subtitleText)
                .font(BrettTypography.stats)
                .foregroundStyle(BrettColors.textInactive)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: nameFocused) { _, focused in
            if !focused && isEditingName {
                commitNameEdit()
            }
        }
    }

    private var subtitleText: String {
        let count = sortedItems.count
        let noun = count == 1 ? "item" : "items"
        if activeCount != count {
            return "\(count) \(noun) · \(activeCount) active"
        }
        return "\(count) \(noun)"
    }

    private func commitNameEdit() {
        let trimmed = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, let existing = realList {
            listStore.update(
                id: listId,
                changes: ["name": trimmed],
                previousValues: ["name": existing.name],
                userId: userId
            )
        }
        isEditingName = false
        nameFocused = false
    }

    // MARK: - Row handlers

    private func toggle(_ id: String) {
        HapticManager.success()
        itemStore.toggleStatus(id: id, userId: userId)
    }

    /// Pre-edit row comes from this view's `@Query`-backed `items` array,
    /// which is already user-scoped — no need for a separate store fetch
    /// (those public read methods were removed in Wave B).
    private func schedule(_ id: String, dueDate: Date?) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["dueDate": dueDate as Any? ?? NSNull()],
            previousValues: ["dueDate": item.dueDate as Any? ?? NSNull()],
            userId: userId
        )
    }

    private func archive(_ id: String) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["status": ItemStatus.archived.rawValue],
            previousValues: ["status": item.status],
            userId: userId
        )
    }

    private func delete(_ id: String) {
        HapticManager.heavy()
        itemStore.delete(id: id, userId: userId)
    }

    private func reorder(_ newOrder: [String]) {
        // Visual + haptic only — persistence waits on a server-side
        // `Item.sortOrder` column + push allowlist update. Tracked in
        // BUILD_LOG under "remaining gaps".
        HapticManager.success()
    }

    @ViewBuilder
    private func archivedBanner() -> some View {
        HStack(spacing: 10) {
            Image(systemName: "archivebox.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BrettColors.textMeta)

            Text("Archived")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BrettColors.textBody)

            Spacer()

            Button {
                unarchiveCurrentList()
            } label: {
                Text("Unarchive")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrettColors.gold)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.06))
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
                }
        }
    }

    @ViewBuilder
    private func stickyHeaderContent() -> some View {
        // Match TaskSection / InboxPage: no icon, neutral white label,
        // count on the right. The list's color signal is already in the
        // navigation toolbar's color dot — no need for a second cue here.
        HStack(spacing: 6) {
            Text("ITEMS")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.60))

            Spacer()

            Text("\(sortedItems.count)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.40))
        }
    }

    private func unarchiveCurrentList() {
        guard let existing = realList else { return }
        listStore.update(
            id: listId,
            changes: ["archivedAt": NSNull()],
            previousValues: ["archivedAt": existing.archivedAt as Any? ?? NSNull()],
            userId: userId
        )
        HapticManager.success()
    }

    private func archiveCurrentList() {
        guard let existing = realList else { return }
        listStore.update(
            id: listId,
            changes: ["archivedAt": Date()],
            previousValues: ["archivedAt": existing.archivedAt as Any? ?? NSNull()],
            userId: userId
        )
        HapticManager.success()
    }
}
