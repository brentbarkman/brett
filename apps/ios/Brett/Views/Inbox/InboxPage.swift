import SwiftData
import SwiftUI

/// Inbox page wired to live sync data from `ItemStore`.
///
/// Auth gate around `InboxPageBody`. The body is the work-doer; this
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
/// `InboxPage` is a thin auth gate — when the user is authenticated it
/// renders `InboxPageBody(userId:)` modified with `.id(userId)`. The
/// `.id(...)` is the load-bearing piece: SwiftUI uses view identity to
/// decide whether to reuse a view's storage or remount fresh, and
/// pinning identity to `userId` guarantees that any future user-swap
/// (multi-account, server-side reassignment, refresh-returning-different-id)
/// triggers a full re-init of `InboxPageBody`'s `@Query` predicates,
/// `@State` stores, and any cached state. Sign-out is also covered for
/// free: `RootView`'s auth gate unmounts `MainContainer` entirely, which
/// destroys the body via the structural path. The `.id` makes that
/// invariant local instead of relying on a multi-component dance.
///
/// Inbox-specific caveat: the desktop's inbox filter is
/// `userId scope AND listId == nil AND dueDate == nil AND status ==
/// "active" AND (snoozedUntil == nil OR snoozedUntil <= now)`. We push
/// `userId`, `deletedAt`, and `dueDate` into the `#Predicate` (anything
/// beyond that trips Swift 6's "unable to type-check in reasonable
/// time" failure mode once `Date?` + `String?` nil checks mix with
/// string equality), and a small Swift post-filter on the resulting set
/// finishes the job — listId / status equality, plus the snoozedUntil
/// vs `Date()` check that can never live in `#Predicate` because
/// `Date()` isn't a compile-time constant the macro can capture.
struct InboxPage: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            InboxPageBody(userId: userId)
                .id(userId)
        } else {
            // Signed-out fallback. The auth gate upstream
            // (`MainContainer`) usually prevents this branch, but render
            // an empty state defensively rather than nil-fallback so the
            // type system doesn't have to model a missing user here.
            EmptyView()
        }
    }
}

/// Inbox's data + UI. Owned by `InboxPage`'s auth gate, so `userId` is
/// guaranteed non-optional for this view's lifetime. Re-instantiated on
/// account switch because the parent applies `.id(userId)` — SwiftUI
/// treats a changed `id` as a new view identity and remounts this body
/// from scratch, which gives us a fresh `@Query` with the new user's
/// predicate (plus a clean slate for `@State` stores and caches).
private struct InboxPageBody: View {
    let userId: String

    // Live sync-backed stores. We keep them as @State so SwiftUI owns their
    // lifecycle and re-renders this view when Observable state changes.
    @State private var itemStore = ItemStore()
    @State private var listStore = ListStore()

    // Filter + selection state
    @State private var selectedFilter: FilterType = .all
    @State private var selectedIDs: Set<String> = []
    @State private var isSelectMode: Bool = false

    // Triage sheet state
    @State private var triageMode: TriageMode? = nil
    @State private var showTriage: Bool = false

    /// Live reactive read of the user's non-deleted, undated items.
    /// The predicate is intentionally narrow — `deletedAt == nil`,
    /// user-scope, and the unbounded-side `dueDate == nil` shape — so
    /// the Swift 6 `#Predicate` type checker doesn't time out.
    /// (Mixing `Date?` and `String?` nil checks alongside string
    /// equality across more than a handful of clauses tips it into the
    /// "unable to type-check in reasonable time" failure mode.) The
    /// rest of the inbox narrowing — `listId == nil`, `status ==
    /// "active"`, snoozedUntil — runs as a Swift post-filter on the
    /// already-narrow result set in `visibleInboxItems`.
    @Query private var inboxItems: [Item]

    /// Used to decide skeleton-vs-empty-state when the inbox has zero
    /// items. See TodayPage for the same pattern. NOT user-scoped —
    /// `SyncHealth` is a sync-internal row count that doesn't need
    /// cross-user isolation.
    @Query private var syncHealthRows: [SyncHealth]

    init(userId: String) {
        self.userId = userId

        // User-scoped, non-deleted, undated. Anything more complex in
        // a single `#Predicate` body trips Swift 6's type checker once
        // `Date?` + `String?` nil-checks mix with string equality, so
        // the remaining narrowing happens in Swift via
        // `visibleInboxItems` below.
        let predicate = #Predicate<Item> { item in
            item.deletedAt == nil &&
            item.userId == userId &&
            item.dueDate == nil
        }
        _inboxItems = Query(filter: predicate, sort: \Item.createdAt, order: .reverse)

        // Explicit reassignment to keep parallel structure with the
        // user-scoped query above. Functionally redundant — the
        // property declaration's default `Query()` is identical — but
        // keeping it makes the init read as a complete inventory of
        // every `@Query` this view owns.
        _syncHealthRows = Query()
    }

    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    /// Finish the inbox filter in Swift. We can't put `listId == nil
    /// && status == "active"` into the `#Predicate` above without
    /// tripping the Swift 6 type checker (see init), and the
    /// `snoozedUntil <= now` clause can never live there because
    /// `Date()` isn't a compile-time constant the macro can capture.
    /// The result set being filtered here is already user-scoped and
    /// dueDate-nil, so the post-filter is small.
    private var visibleInboxItems: [Item] {
        let activeStatus = ItemStatus.active.rawValue
        let now = Date()
        return inboxItems.filter { item in
            item.listId == nil
                && item.status == activeStatus
                && (item.snoozedUntil == nil || item.snoozedUntil! <= now)
        }
    }

    private var filteredItems: [Item] {
        FilterType.filter(visibleInboxItems, by: selectedFilter)
    }

    var body: some View {
        // Wrapped in a ScrollViewReader so a freshly-captured task can
        // be scrolled into view. Without this, the new row appears at
        // the top of the inbox card but the user might be scrolled
        // halfway down a long inbox and miss it entirely.
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    header

                    TypeFilterPills(selected: $selectedFilter)

                    if filteredItems.isEmpty {
                        if hasCompletedInitialSync {
                            EmptyState(heading: "Your inbox", copy: "Everything worth doing starts here.")
                                .padding(.top, 48)
                        } else {
                            TaskListPlaceholder()
                                .padding(.top, 24)
                        }
                    } else {
                        inboxCard
                            .id("inbox_top")
                    }
                }
                .padding(.bottom, isSelectMode ? 140 : 70)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .coordinateSpace(name: "scroll")
            .onChange(of: SelectionStore.shared.lastCreatedItemId) { _, newId in
                guard newId != nil else { return }
                // Inbox is sorted newest-first, so the new row lives at
                // the top of the card. Scroll there with a soft spring.
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                    proxy.scrollTo("inbox_top", anchor: .top)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    SelectionStore.shared.lastCreatedItemId = nil
                }
            }
        }
        // Multi-select toolbar rides above the omnibar via a safeAreaInset.
        // Using an overlay would fight the global OmnibarView placement, so
        // we mount the toolbar inline so both can coexist without layout shift.
        .safeAreaInset(edge: .bottom) {
            if isSelectMode {
                MultiSelectToolbar(
                    selectedCount: selectedIDs.count,
                    onCancel: exitSelectMode,
                    onAction: { action in
                        triageMode = action == .schedule ? .schedule : .move
                        showTriage = true
                    },
                    onDelete: confirmBulkDelete
                )
                .padding(.bottom, 56) // Leave room for the bottom-pinned omnibar.
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: isSelectMode)
        .sheet(isPresented: $showTriage) {
            if let triageMode {
                TriagePopup(
                    mode: triageMode,
                    selectedIDs: selectedIDs,
                    userId: userId,
                    itemStore: itemStore,
                    listStore: listStore,
                    isPresented: $showTriage,
                    onCommit: {
                        exitSelectMode()
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Color.black.opacity(0.90))
                .presentationCornerRadius(20)
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Inbox")
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)

            Text("\(visibleInboxItems.count) to triage")
                .font(BrettTypography.stats)
                // Bumped from /0.35 (per user "hard to see"). Aligns
                // with Today's stats line which renders at the same
                // brightness for the same role.
                .foregroundStyle(Color.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }

    // MARK: - Inbox card

    private var inboxCard: some View {
        StickyCardSection {
            // Match TaskSection: neutral white label, count on the right
            // (after the Spacer). The gold "INBOX" + count-next-to-title
            // diverged from every other section in the app.
            HStack(spacing: 6) {
                Text("INBOX")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(Color.white.opacity(0.60))

                Spacer()

                if isSelectMode {
                    Button("Done") {
                        exitSelectMode()
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BrettColors.gold)
                }

                Text("\(filteredItems.count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.40))
            }
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(filteredItems.enumerated()), id: \.element.id) { index, item in
                    rowWithAccent(item: item, isLast: index == filteredItems.count - 1)
                }
            }
            .padding(.bottom, 8)
        }
    }

    @ViewBuilder
    private func rowWithAccent(item: Item, isLast: Bool) -> some View {
        let isNewsletter = (item.contentType == "newsletter") ||
            (item.itemType == .content && item.source.lowercased().contains("newsletter"))

        VStack(spacing: 0) {
            HStack(spacing: 0) {
                if isNewsletter {
                    Rectangle()
                        .fill(BrettColors.cerulean)
                        .frame(width: 2)
                        .padding(.vertical, 4)
                }

                TaskRow(
                    item: item,
                    listName: nil,
                    allowSwipeRight: false,
                    allowSwipeLeft: false,
                    allowDrag: false,
                    isSelectMode: isSelectMode,
                    isSelected: selectedIDs.contains(item.id),
                    onToggle: {
                        if isSelectMode {
                            toggleSelection(item.id)
                        } else {
                            HapticManager.light()
                            itemStore.toggleStatus(id: item.id, userId: userId)
                        }
                    },
                    onSelect: {
                        if isSelectMode {
                            toggleSelection(item.id)
                        } else {
                            SelectionStore.shared.selectedTaskId = item.id
                        }
                    }
                )
                .padding(.leading, isNewsletter ? 6 : 0)
            }
            // Inbox owns the row-level swipe actions — TaskRow's default
            // Today/Lists swipe set (schedule leading, delete/archive
            // trailing) is turned off above via the allowSwipe* = false
            // flags. Replaced with Inbox's triage-flavoured actions:
            // Select (enter multi-select) + Delete.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button {
                    enterSelectMode(selecting: item.id)
                } label: {
                    Label("Select", systemImage: "checkmark.circle")
                }
                .tint(BrettColors.gold)

                Button(role: .destructive) {
                    HapticManager.heavy()
                    itemStore.delete(id: item.id, userId: userId)
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }

            if !isLast {
                Divider()
                    .background(BrettColors.hairline)
                    .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Selection mode helpers

    private func enterSelectMode(selecting id: String) {
        HapticManager.medium()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            isSelectMode = true
            selectedIDs.insert(id)
        }
    }

    private func toggleSelection(_ id: String) {
        HapticManager.light()
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
        if selectedIDs.isEmpty {
            exitSelectMode()
        }
    }

    private func exitSelectMode() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            selectedIDs.removeAll()
            isSelectMode = false
        }
    }

    private func confirmBulkDelete() {
        let ids = Array(selectedIDs)
        guard !ids.isEmpty else { return }
        itemStore.bulkDelete(ids: ids, userId: userId)
        exitSelectMode()
    }
}
