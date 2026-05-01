import SwiftUI
import SwiftData

/// Half-sheet surfaced from the omnibar's ≡ button. Renders the user's
/// lists as glass pills with a colored dot + count, an inline "New list"
/// form, and an expandable "Archived" disclosure. Tap a pill → the drawer
/// dismisses and the caller pushes via `onSelectList`.
///
/// Data flows through the real `ListStore` + a `@Query` on `Item` so the
/// pill counts stay accurate without manual invalidation.
///
/// Auth gate around `ListDrawerBody`. The body is the work-doer; this
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
/// `ListDrawer` is a thin auth gate — when the user is authenticated it
/// renders `ListDrawerBody(userId:)` modified with `.id(userId)`. The
/// `.id(...)` is the load-bearing piece: SwiftUI uses view identity to
/// decide whether to reuse a view's storage or remount fresh, and
/// pinning identity to `userId` guarantees that any future user-swap
/// triggers a full re-init of `ListDrawerBody`'s `@Query` predicates,
/// `@State` stores, and any cached state. `userId` doesn't change while
/// the drawer is on-screen, so the `.id` keeps stable identity for the
/// sheet's lifetime — no accidental remount on parent re-renders.
struct ListDrawer: View {
    var onSelectList: ((String) -> Void)? = nil
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            ListDrawerBody(userId: userId, onSelectList: onSelectList)
                .id(userId)
        } else {
            // Signed-out fallback. The omnibar that hosts this drawer is
            // gated upstream, but render an empty state defensively
            // rather than nil-fallback so the type system doesn't have
            // to model a missing user here.
            EmptyView()
        }
    }
}

/// List-drawer data + UI. Owned by `ListDrawer`'s auth gate, so
/// `userId` is guaranteed non-optional for this view's lifetime.
/// Re-instantiated on account switch because the parent applies
/// `.id(userId)` — SwiftUI treats a changed `id` as a new view identity
/// and remounts this body from scratch, which gives us a fresh `@Query`
/// with the new user's predicate (plus a clean slate for `@State`
/// stores and caches).
private struct ListDrawerBody: View {
    let userId: String
    var onSelectList: ((String) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    @State private var listStore = ListStore()

    /// Live read of the signed-in user's non-deleted lists. Sorted by
    /// sortOrder; archived vs active are split in Swift since `@Query`
    /// can't dynamically filter on a nil/non-nil `archivedAt`. The user
    /// filter is captured at init and pushed into SQLite via the
    /// predicate, so cross-user rows never enter the working set.
    @Query private var lists: [ItemList]

    /// Item counts per list — computed off the live, user-scoped item
    /// set so pill counts refresh automatically when items are
    /// created/toggled/moved.
    @Query private var items: [Item]

    @State private var isCreating = false
    @State private var draftName: String = ""
    @State private var draftColor: ListColor = .slate
    @State private var showArchived = false
    @State private var colorPickerListId: String? = nil
    @FocusState private var nameFieldFocused: Bool

    init(userId: String, onSelectList: ((String) -> Void)? = nil) {
        self.userId = userId
        self.onSelectList = onSelectList

        let listPredicate = #Predicate<ItemList> { list in
            list.deletedAt == nil && list.userId == userId
        }
        _lists = Query(filter: listPredicate, sort: \ItemList.sortOrder)

        let itemPredicate = #Predicate<Item> { item in
            item.deletedAt == nil && item.userId == userId
        }
        _items = Query(filter: itemPredicate)
    }

    private var activeLists: [PillModel] {
        pillModels(from: lists.filter { $0.archivedAt == nil })
    }

    private var archivedLists: [PillModel] {
        pillModels(from: lists.filter { $0.archivedAt != nil })
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
        // `lists.map { list in items.filter { ... }.count }` —
        // O(lists × items) on every drawer render. With ~10 lists and
        // a few hundred active items that's a few thousand string
        // comparisons per render, enough to feel as drawer-open lag
        // for power users. The user filter is already applied at the
        // `@Query` level, so this pass just groups.
        var countsByListId: [String: Int] = [:]
        countsByListId.reserveCapacity(lists.count)
        for item in items where item.itemStatus != .done {
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
        listStore.archive(id: id, userId: userId)
        HapticManager.success()
    }

    private func unarchive(_ id: String) {
        listStore.unarchive(id: id, userId: userId)
        HapticManager.success()
    }

    /// Pre-edit list row comes from this view's `@Query`-backed `lists`
    /// array, already user-scoped — no need for a separate store fetch
    /// (those public read methods were removed in Wave B).
    private func recolor(_ id: String, to color: ListColor) {
        guard let list = lists.first(where: { $0.id == id }) else { return }
        listStore.update(
            id: id,
            changes: ["colorClass": color.rawValue],
            previousValues: ["colorClass": list.colorClass],
            userId: userId
        )
    }

    private func commitDraft() {
        let trimmed = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            _ = try listStore.create(
                userId: userId,
                name: trimmed,
                colorClass: draftColor.rawValue
            )
        } catch {
            // Atomic create failed — keep the draft open so the user can
            // retry rather than silently dropping the input.
            BrettLog.store.error("ListDrawer commitDraft failed: \(String(describing: error), privacy: .public)")
            HapticManager.error()
            return
        }
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
