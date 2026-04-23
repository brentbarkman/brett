import SwiftData
import SwiftUI

/// Inbox page wired to live sync data from `ItemStore`.
///
/// - Owns an `ItemStore` + `ListStore` backed by the shared persistence
///   container. The legacy `MockStore` param is kept for backwards compat
///   with `MainContainer` during the mobile migration and is otherwise unused.
/// - Filters via `TypeFilterPills` (All / Tasks / Content).
/// - Multi-select mode triggered by a trailing swipe → "Select" action on any
///   row. Once any IDs are selected, a glass `MultiSelectToolbar` rides above
///   the omnibar offering Schedule / Move / Delete.
/// - Triage lives in `TriagePopup`, a medium-detent sheet that calls
///   `itemStore.bulkUpdate(ids:changes:)` and dismisses on confirm.
struct InboxPage: View {
    // Live sync-backed stores. We keep them as @State so SwiftUI owns their
    // lifecycle and re-renders this view when Observable state changes.
    @State private var itemStore = ItemStore()
    @State private var listStore = ListStore()

    @Environment(AuthManager.self) private var authManager

    // Filter + selection state
    @State private var selectedFilter: FilterType = .all
    @State private var selectedIDs: Set<String> = []
    @State private var isSelectMode: Bool = false

    // Triage sheet state
    @State private var triageMode: TriageMode? = nil
    @State private var showTriage: Bool = false

    /// Used to decide skeleton-vs-empty-state when the inbox has zero
    /// items. See TodayPage for the same pattern.
    @Query private var syncHealthRows: [SyncHealth]

    /// Live reactive read of inbox items. SwiftData broadcasts mutations
    /// to @Query consumers automatically, which is the whole point — the
    /// previous `refreshTick` anti-pattern existed only because the page
    /// fetched imperatively via `itemStore.fetchInbox()` and needed a
    /// manual poke to re-render. Predicate mirrors ItemStore.fetchInbox:
    /// no list, no due date, active status.
    ///
    /// Inbox-status is interpolated as a literal string because
    /// #Predicate can't call `ItemStatus.active.rawValue` at macro
    /// expansion time. If the enum's raw values ever drift, update both.
    @Query(
        filter: #Predicate<Item> {
            $0.deletedAt == nil
                && $0.listId == nil
                && $0.dueDate == nil
                && $0.status == "active"
        },
        sort: \Item.createdAt,
        order: .reverse
    ) private var inboxItemsAnyUser: [Item]

    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    private var allInboxItems: [Item] {
        guard let uid = authManager.currentUser?.id else { return [] }
        return inboxItemsAnyUser.filter { $0.userId == uid }
    }

    private var filteredItems: [Item] {
        FilterType.filter(allInboxItems, by: selectedFilter)
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
                    userId: authManager.currentUser?.id,
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

            Text("\(allInboxItems.count) to triage")
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
                            itemStore.toggleStatus(id: item.id)
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
                    itemStore.delete(id: item.id)
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
        itemStore.bulkDelete(ids: ids)
        exitSelectMode()
    }
}

