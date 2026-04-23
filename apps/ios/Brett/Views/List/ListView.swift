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
struct ListView: View {
    let listId: String
    @Environment(AuthManager.self) private var authManager

    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.container.mainContext
    )
    @State private var listStore = ListStore(
        context: PersistenceController.shared.container.mainContext
    )

    @State private var draftName: String = ""
    @State private var isEditingName = false
    @FocusState private var nameFocused: Bool

    /// See TodayPage — used to decide skeleton-vs-empty-state when this
    /// list has zero items on first render.
    @Query private var syncHealthRows: [SyncHealth]

    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    private var realList: ItemList? {
        listStore.fetchById(listId)
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

    private var items: [Item] {
        itemStore.fetchAll(
            userId: authManager.currentUser?.id,
            listId: listId,
            status: nil
        )
        .sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }
    }

    private var activeCount: Int {
        items.filter { $0.itemStatus != .done }.count
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

                            if items.isEmpty {
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
                                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                                    TaskRow(
                                        item: item,
                                        listName: nil,
                                        allowDrag: true,
                                        dragIDs: items.map(\.id),
                                        onToggle: { toggle(item.id) },
                                        onSelect: { SelectionStore.shared.selectedTaskId = item.id },
                                        onSchedule: { dueDate in schedule(item.id, dueDate: dueDate) },
                                        onArchive: { archive(item.id) },
                                        onDelete: { delete(item.id) },
                                        onReorder: { newOrder in reorder(newOrder) }
                                    )
                                    .padding(.horizontal, 16)

                                    if index < items.count - 1 {
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
                try? await SyncManager.shared.pullToRefresh()
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
        let count = items.count
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
                previousValues: ["name": existing.name]
            )
        }
        isEditingName = false
        nameFocused = false
    }

    // MARK: - Row handlers

    private func toggle(_ id: String) {
        HapticManager.success()
        itemStore.toggleStatus(id: id)
    }

    private func schedule(_ id: String, dueDate: Date?) {
        guard let item = itemStore.fetchById(id) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["dueDate": dueDate as Any? ?? NSNull()],
            previousValues: ["dueDate": item.dueDate as Any? ?? NSNull()]
        )
    }

    private func archive(_ id: String) {
        guard let item = itemStore.fetchById(id) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["status": ItemStatus.archived.rawValue],
            previousValues: ["status": item.status]
        )
    }

    private func delete(_ id: String) {
        HapticManager.heavy()
        itemStore.delete(id: id)
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

            Text("\(items.count)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.40))
        }
    }

    private func unarchiveCurrentList() {
        guard let existing = realList else { return }
        listStore.update(
            id: listId,
            changes: ["archivedAt": NSNull()],
            previousValues: ["archivedAt": existing.archivedAt as Any? ?? NSNull()]
        )
        HapticManager.success()
    }

    private func archiveCurrentList() {
        guard let existing = realList else { return }
        listStore.update(
            id: listId,
            changes: ["archivedAt": Date()],
            previousValues: ["archivedAt": existing.archivedAt as Any? ?? NSNull()]
        )
        HapticManager.success()
    }
}
