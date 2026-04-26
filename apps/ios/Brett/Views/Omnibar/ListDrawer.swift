import SwiftUI
import SwiftData

/// Half-sheet surfaced from the omnibar's ≡ button. Renders the user's
/// lists as glass pills with a colored dot + count, an inline "New list"
/// form, and an expandable "Archived" disclosure. Tap a pill → the drawer
/// dismisses and the caller pushes via `onSelectList`.
///
/// Data flows through the real `ListStore` + a `@Query` on `Item` so the
/// pill counts stay accurate without manual invalidation.
struct ListDrawer: View {
    var onSelectList: ((String) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    @State private var listStore = ListStore()

    /// Live read of all non-deleted lists. Sorted by sortOrder; archived vs
    /// active are split in Swift since `@Query` can't dynamically filter on
    /// a nil/non-nil `archivedAt`.
    @Query(
        filter: #Predicate<ItemList> { $0.deletedAt == nil },
        sort: \ItemList.sortOrder
    ) private var allLists: [ItemList]

    /// Item counts per list — computed off the live item set so pill counts
    /// refresh automatically when items are created/toggled/moved.
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil })
    private var allItems: [Item]

    @State private var isCreating = false
    @State private var draftName: String = ""
    @State private var draftColor: ListColor = .slate
    @State private var showArchived = false
    @State private var colorPickerListId: String? = nil
    @FocusState private var nameFieldFocused: Bool

    /// Lists scoped to the signed-in user. Defense-in-depth: sign-out
    /// wipes SwiftData and SyncManager is session-owned, but a late async
    /// task from a prior session could briefly land a row here, so every
    /// list-bearing surface filters by userId.
    private var userLists: [ItemList] {
        guard let uid = authManager.currentUser?.id else { return [] }
        return allLists.filter { $0.userId == uid }
    }

    private var userItems: [Item] {
        guard let uid = authManager.currentUser?.id else { return [] }
        return allItems.filter { $0.userId == uid }
    }

    private var activeLists: [PillModel] {
        pillModels(from: userLists.filter { $0.archivedAt == nil })
    }

    private var archivedLists: [PillModel] {
        pillModels(from: userLists.filter { $0.archivedAt != nil })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                sectionHeader("YOUR LISTS")

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(activeLists) { model in
                            pillButton(for: model)
                        }
                        newListControl()
                    }
                    .padding(.horizontal, 20)
                }
                .scrollClipDisabled()

                if isCreating {
                    newListForm()
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                if !archivedLists.isEmpty {
                    archivedSection()
                }

                Spacer(minLength: 20)
            }
            .padding(.top, 12)
        }
        .scrollIndicators(.hidden)
        .animation(.easeOut(duration: 0.2), value: isCreating)
        .animation(.easeOut(duration: 0.2), value: showArchived)
        .animation(.easeOut(duration: 0.2), value: archivedLists.map(\.id))
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.textMeta)
            .padding(.horizontal, 20)
    }

    @ViewBuilder
    private func pillButton(for model: PillModel) -> some View {
        Button {
            HapticManager.light()
            onSelectList?(model.id)
            dismiss()
        } label: {
            ListRow(name: model.name, color: model.color, count: model.itemCount)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                colorPickerListId = model.id
            } label: {
                Label("Change color", systemImage: "paintpalette")
            }
            Button(role: .destructive) {
                archive(model.id)
            } label: {
                Label("Archive", systemImage: "archivebox")
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                archive(model.id)
            } label: {
                Label("Archive", systemImage: "archivebox")
            }
        }
        .popover(isPresented: Binding(
            get: { colorPickerListId == model.id },
            set: { if !$0 { colorPickerListId = nil } }
        )) {
            ListColorPicker(selected: model.color) { newColor in
                recolor(model.id, to: newColor)
                colorPickerListId = nil
                HapticManager.light()
            }
            .presentationCompactAdaptation(.popover)
        }
    }

    @ViewBuilder
    private func newListControl() -> some View {
        if !isCreating {
            Button {
                HapticManager.light()
                isCreating = true
                draftName = ""
                draftColor = .slate
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    nameFieldFocused = true
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .semibold))
                    Text("New list")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundStyle(BrettColors.gold)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background {
                    Capsule()
                        .strokeBorder(BrettColors.gold.opacity(0.35), lineWidth: 1)
                }
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func newListForm() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Circle()
                    .fill(draftColor.swiftUIColor)
                    .frame(width: 10, height: 10)

                TextField("List name", text: $draftName)
                    .font(.system(size: 15))
                    .foregroundStyle(.white)
                    .tint(BrettColors.gold)
                    .focused($nameFieldFocused)
                    .submitLabel(.done)
                    .onSubmit { commitDraft() }

                Button {
                    cancelDraft()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(Color.white.opacity(0.25))
                }
                .buttonStyle(.plain)
            }

            ListColorPicker(selected: draftColor) { picked in
                draftColor = picked
            }
            .frame(maxWidth: .infinity)

            HStack {
                Spacer()
                Button {
                    commitDraft()
                } label: {
                    Text("Create")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(
                            draftName.trimmingCharacters(in: .whitespaces).isEmpty
                                ? Color.white.opacity(0.3) : .white
                        )
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background {
                            Capsule()
                                .fill(
                                    draftName.trimmingCharacters(in: .whitespaces).isEmpty
                                        ? Color.white.opacity(0.10) : BrettColors.gold
                                )
                        }
                }
                .buttonStyle(.plain)
                .disabled(draftName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.06))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
                }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func archivedSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                showArchived.toggle()
                HapticManager.light()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: showArchived ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                    Text("ARCHIVED (\(archivedLists.count))")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                }
                .foregroundStyle(BrettColors.textMeta)
                .padding(.horizontal, 20)
            }
            .buttonStyle(.plain)

            if showArchived {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(archivedLists) { model in
                            Button {
                                HapticManager.light()
                                onSelectList?(model.id)
                                dismiss()
                            } label: {
                                ListRow(
                                    name: model.name,
                                    color: model.color,
                                    count: model.itemCount,
                                    isArchived: true
                                )
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button {
                                    unarchive(model.id)
                                } label: {
                                    Label("Restore", systemImage: "tray.and.arrow.up")
                                }
                                .tint(BrettColors.gold)
                            }
                            .contextMenu {
                                Button {
                                    unarchive(model.id)
                                } label: {
                                    Label("Unarchive", systemImage: "tray.and.arrow.up")
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
    }

    private func pillModels(from lists: [ItemList]) -> [PillModel] {
        // Bucket items by listId in one pass so the per-list count is
        // O(1) lookup instead of O(items) re-filter. Prior shape was
        // `lists.map { list in userItems.filter { ... }.count }` —
        // O(lists × items) on every drawer render. With ~10 lists and
        // a few hundred active items that's a few thousand string
        // comparisons per render, enough to feel as drawer-open lag
        // for power users.
        var countsByListId: [String: Int] = [:]
        countsByListId.reserveCapacity(lists.count)
        for item in userItems where item.itemStatus != .done {
            guard let listId = item.listId else { continue }
            countsByListId[listId, default: 0] += 1
        }
        return lists.map { list in
            PillModel(
                id: list.id,
                name: list.name,
                color: ListColor(colorClass: list.colorClass) ?? .slate,
                itemCount: countsByListId[list.id] ?? 0,
                sortOrder: list.sortOrder
            )
        }
        .sorted { $0.sortOrder < $1.sortOrder }
    }

    // MARK: - Mutations

    private func archive(_ id: String) {
        listStore.archive(id: id)
        HapticManager.success()
    }

    private func unarchive(_ id: String) {
        listStore.unarchive(id: id)
        HapticManager.success()
    }

    private func recolor(_ id: String, to color: ListColor) {
        guard let list = listStore.fetchById(id) else { return }
        listStore.update(
            id: id,
            changes: ["colorClass": color.rawValue],
            previousValues: ["colorClass": list.colorClass]
        )
    }

    private func commitDraft() {
        let trimmed = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        // Require a signed-in user to create. For preview / unauthenticated
        // the drawer is still visible but "Create" is effectively a no-op.
        guard let userId = authManager.currentUser?.id else {
            cancelDraft()
            return
        }
        _ = listStore.create(
            userId: userId,
            name: trimmed,
            colorClass: draftColor.rawValue
        )
        HapticManager.success()
        isCreating = false
        draftName = ""
        draftColor = .slate
    }

    private func cancelDraft() {
        isCreating = false
        draftName = ""
        draftColor = .slate
    }

    private struct PillModel: Identifiable {
        let id: String
        let name: String
        let color: ListColor
        let itemCount: Int
        let sortOrder: Int
    }
}
