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

    /// Cheap re-render nudge — bump after mutations so observation picks up
    /// store changes immediately. (SwiftData publishes on its own too; this
    /// just avoids sheet-scroll edge cases.)
    @State private var refreshTick: Int = 0

    private var allInboxItems: [Item] {
        _ = refreshTick
        return itemStore.fetchInbox()
    }

    private var filteredItems: [Item] {
        FilterType.filter(allInboxItems, by: selectedFilter)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header

                TypeFilterPills(selected: $selectedFilter)

                if filteredItems.isEmpty {
                    EmptyState(heading: "Your inbox", copy: "Everything worth doing starts here.")
                        .padding(.top, 48)
                } else {
                    inboxCard
                }
            }
            .padding(.bottom, isSelectMode ? 140 : 70)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .coordinateSpace(name: "scroll")
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
                        refreshTick += 1
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
                .foregroundStyle(Color.white.opacity(0.35))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }

    // MARK: - Inbox card

    private var inboxCard: some View {
        StickyCardSection {
            HStack(spacing: 6) {
                Text("INBOX")
                    .font(BrettTypography.sectionLabel)
                    .tracking(1.5)
                    .foregroundStyle(BrettColors.gold.opacity(0.50))

                Text("\(filteredItems.count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.35))

                Spacer()

                if isSelectMode {
                    Button("Done") {
                        exitSelectMode()
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BrettColors.gold)
                }
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

                InboxItemRow(
                    item: item,
                    isSelectMode: isSelectMode,
                    isSelected: selectedIDs.contains(item.id),
                    onToggle: {
                        if isSelectMode {
                            toggleSelection(item.id)
                        } else {
                            HapticManager.light()
                            itemStore.toggleStatus(id: item.id)
                            refreshTick += 1
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
                    refreshTick += 1
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
        refreshTick += 1
    }
}

// MARK: - Row

/// Inbox-specific row bound directly to `Item`. Lives here rather than in
/// `Shared/TaskRow.swift` because `TaskRow` is still tied to `MockItem` and is
/// shared with Today/Calendar during the mobile migration. Keeping the Inbox
/// row local avoids a cross-page ripple and lets us add the selection-mode
/// affordance without touching the mock-driven rows.
private struct InboxItemRow: View {
    let item: Item
    let isSelectMode: Bool
    let isSelected: Bool
    let onToggle: () -> Void
    let onSelect: () -> Void

    var body: some View {
        Button {
            onSelect()
        } label: {
            HStack(spacing: 12) {
                if isSelectMode {
                    selectionCircle
                } else {
                    leadingGlyph
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        Text("Captured \(capturedAgo)")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)

                        if let domain = item.contentDomain {
                            Text("·")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textGhost)
                            Text(domain)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.cerulean.opacity(0.6))
                        }
                    }
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), captured \(capturedAgo)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var leadingGlyph: some View {
        ZStack {
            Circle()
                .fill(Color.black.opacity(0.20))
                .overlay {
                    Circle().strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
                }
                .frame(width: 30, height: 30)

            Image(systemName: item.itemType == .content ? "doc.text" : "bolt.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(
                    item.itemType == .content
                        ? BrettColors.cerulean.opacity(0.7)
                        : BrettColors.gold.opacity(0.7)
                )
        }
        .frame(width: 34, height: 34)
        .contentShape(Rectangle())
        .highPriorityGesture(
            TapGesture().onEnded {
                onToggle()
            }
        )
    }

    private var selectionCircle: some View {
        ZStack {
            Circle()
                .strokeBorder(
                    isSelected ? BrettColors.gold : Color.white.opacity(0.25),
                    lineWidth: 1.5
                )
                .background {
                    Circle().fill(
                        isSelected
                            ? BrettColors.gold.opacity(0.25)
                            : Color.clear
                    )
                }
                .frame(width: 22, height: 22)

            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(BrettColors.gold)
            }
        }
        .frame(width: 34, height: 34)
        .contentShape(Rectangle())
        .highPriorityGesture(
            TapGesture().onEnded { onToggle() }
        )
        .transition(.scale.combined(with: .opacity))
    }

    private var capturedAgo: String {
        let interval = Date().timeIntervalSince(item.createdAt)
        let hours = Int(interval / 3_600)
        let days = hours / 24
        if days >= 1 { return days == 1 ? "yesterday" : "\(days)d ago" }
        if hours >= 1 { return "\(hours)h ago" }
        let minutes = max(1, Int(interval / 60))
        return "\(minutes)m ago"
    }
}
