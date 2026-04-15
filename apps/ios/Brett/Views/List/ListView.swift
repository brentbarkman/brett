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
    @Bindable var store: MockStore
    let listId: String
    @Environment(AuthManager.self) private var authManager

    // Real sync-backed stores. MockStore stays on the view only to drive
    // `selectedTaskId` (which MainContainer's task-detail sheet reads) and
    // to cover the prototype fallback when a list exists only in mock data.
    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.container.mainContext
    )
    @State private var listStore = ListStore(
        context: PersistenceController.shared.container.mainContext
    )

    @State private var draftName: String = ""
    @State private var isEditingName = false
    @State private var captureText: String = ""
    @FocusState private var nameFocused: Bool
    @FocusState private var captureFocused: Bool

    // Real-store resolution, with MockStore fallback so the prototype lists
    // in `MockData` still render until every list originates from sync.
    private var realList: ItemList? {
        listStore.fetchById(listId)
    }

    private var listName: String {
        realList?.name ?? store.displayName(forList: listId) ?? store.lists.first(where: { $0.id == listId })?.name ?? "List"
    }

    private var listColor: ListColor {
        if let colorClass = realList?.colorClass, let color = ListColor(colorClass: colorClass) {
            return color
        }
        return store.displayColor(forList: listId)
    }

    /// Real items first; fall back to mock items if this list doesn't exist
    /// in SwiftData yet (prototype / test fixtures).
    private var items: [Item] {
        let all = itemStore.fetchAll(listId: listId, status: nil)
        return all.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }
    }

    private var activeCount: Int {
        items.filter { $0.itemStatus != .done }.count
    }

    private var isArchived: Bool {
        if let real = realList {
            return real.archivedAt != nil
        }
        return store.archivedListIds.contains(listId)
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
                            quickCapture()
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)

                            if !items.isEmpty {
                                Divider()
                                    .background(BrettColors.hairline)
                                    .padding(.horizontal, 16)
                            }

                            if items.isEmpty {
                                VStack(spacing: 6) {
                                    Text("No items yet")
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(BrettColors.textBody)
                                    Text("Capture your first one above.")
                                        .font(.system(size: 13))
                                        .foregroundStyle(BrettColors.textMeta)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 32)
                            } else {
                                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                                    TaskRow(
                                        item: item,
                                        listName: nil,
                                        allowDrag: true,
                                        dragIDs: items.map(\.id),
                                        onToggle: { toggle(item.id) },
                                        onSelect: { store.selectedTaskId = item.id },
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
                try? await Task.sleep(nanoseconds: 400_000_000)
            }
        }
        .overlay(alignment: .bottom) {
            OmnibarView(
                store: store,
                placeholder: "Add to \(listName)..."
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
        if !trimmed.isEmpty {
            if let existing = realList {
                listStore.update(
                    id: listId,
                    changes: ["name": trimmed],
                    previousValues: ["name": existing.name]
                )
            } else {
                store.renameList(listId, to: trimmed)
            }
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
        // Per-item order is not yet a first-class concept in `Item` (no
        // `sortOrder` field). Drag still gives visual + haptic feedback via
        // `DragReorderModifier`; persistence lands when we add a sort field.
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
        HStack(spacing: 6) {
            Image(systemName: "list.bullet")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(listColor.swiftUIColor.opacity(0.80))

            Text("ITEMS")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.80))

            Spacer()

            Text("\(items.count)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.50))
        }
    }

    @ViewBuilder
    private func quickCapture() -> some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BrettColors.textMeta)

            TextField("Add item...", text: $captureText)
                .font(.system(size: 15))
                .foregroundStyle(.white)
                .tint(BrettColors.gold)
                .focused($captureFocused)
                .submitLabel(.done)
                .onSubmit { commitCapture() }

            if !captureText.trimmingCharacters(in: .whitespaces).isEmpty {
                Button { commitCapture() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(BrettColors.gold, in: Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background {
            Capsule()
                .fill(Color.white.opacity(0.06))
                .overlay {
                    Capsule()
                        .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                }
        }
    }

    private func commitCapture() {
        let trimmed = captureText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        HapticManager.light()
        // Route through the real store when we have a signed-in user AND
        // the list exists in SwiftData. Otherwise fall back to the mock
        // path so prototype lists still reflect captures.
        if realList != nil, let userId = authManager.currentUser?.id {
            _ = itemStore.create(userId: userId, title: trimmed, listId: listId)
        } else {
            store.addItem(title: trimmed, dueDate: nil, listId: listId)
        }
        captureText = ""
        captureFocused = false
    }

    // Unarchive action reused by the top toolbar button and the archived
    // banner. Mirrors the listStore path when the list exists there.
    private func unarchiveCurrentList() {
        if let existing = realList {
            listStore.update(
                id: listId,
                changes: ["archivedAt": NSNull()],
                previousValues: ["archivedAt": existing.archivedAt as Any? ?? NSNull()]
            )
        } else {
            store.unarchiveList(listId)
        }
        HapticManager.success()
    }

    private func archiveCurrentList() {
        if let existing = realList {
            listStore.update(
                id: listId,
                changes: ["archivedAt": Date()],
                previousValues: ["archivedAt": existing.archivedAt as Any? ?? NSNull()]
            )
        } else {
            store.archiveList(listId)
        }
        HapticManager.success()
    }
}
