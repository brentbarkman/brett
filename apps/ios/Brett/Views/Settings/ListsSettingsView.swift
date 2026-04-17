import SwiftUI

/// Manage the user's lists: rename, recolor, reorder, archive, delete.
///
/// Writes go through `ListStore` which enqueues mutations in the sync
/// engine — the server will receive them the next push cycle. Deletes
/// use the store's archive path; a full delete would require a new
/// mutation type that's outside this scope. We surface "Archive" for
/// active lists and "Unarchive" for archived ones.
///
/// The "Active" section keeps a `List` for drag-to-reorder (`onMove`)
/// wrapped in a `BrettSettingsCard` for visual consistency with the
/// rest of the settings screens.
struct ListsSettingsView: View {
    @Bindable var store: ListStore

    @Environment(AuthManager.self) private var authManager

    @State private var refreshTick: Int = 0
    @State private var editingListId: String?
    @State private var editBuffer: String = ""
    @State private var showingColorPickerFor: String?

    var body: some View {
        BrettSettingsScroll {
            // Active lists — uses a List inside the card for onMove support
            VStack(alignment: .leading, spacing: 8) {
                BrettSectionHeader("Active")

                BrettSettingsCard {
                    List {
                        ForEach(activeLists, id: \.id) { list in
                            row(list)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets())
                        }
                        .onMove(perform: move)

                        Button {
                            addNewList()
                        } label: {
                            HStack {
                                Image(systemName: "plus.circle.fill")
                                    .foregroundStyle(BrettColors.gold)
                                Text("New list")
                                    .foregroundStyle(BrettColors.textCardTitle)
                                Spacer()
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets())
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .scrollDisabled(true)
                    .environment(\.editMode, .constant(.active))
                    .frame(minHeight: CGFloat(activeLists.count + 1) * 52)
                }
            }

            if !archivedLists.isEmpty {
                BrettSettingsSection("Archived") {
                    ForEach(Array(archivedLists.enumerated()), id: \.element.id) { index, list in
                        if index > 0 {
                            BrettSettingsDivider()
                        }
                        archivedRow(list)
                    }
                }
            }
        }
        .navigationTitle("Lists")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .id(refreshTick) // Force re-read after mutations
    }

    // MARK: - Row (active, inside List for reorder)

    @ViewBuilder
    private func row(_ list: ItemList) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    showingColorPickerFor = (showingColorPickerFor == list.id) ? nil : list.id
                } label: {
                    Circle()
                        .fill(swatchColor(list.colorClass))
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.plain)

                if editingListId == list.id {
                    TextField("List name", text: $editBuffer, onCommit: {
                        commitEdit(for: list)
                    })
                    .foregroundStyle(.white)
                    .submitLabel(.done)
                } else {
                    Text(list.name)
                        .foregroundStyle(BrettColors.textCardTitle)
                        .onTapGesture(count: 2) {
                            beginEdit(list)
                        }
                }

                Spacer()

                if editingListId != list.id {
                    Button {
                        beginEdit(list)
                    } label: {
                        Image(systemName: "pencil")
                            .foregroundStyle(BrettColors.textMeta)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            if showingColorPickerFor == list.id {
                colorPicker(for: list)
                    .padding(.bottom, 8)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button {
                store.archive(id: list.id)
                bumpRefresh()
            } label: {
                Label("Archive", systemImage: "archivebox")
            }
            .tint(BrettColors.textMeta)
        }
    }

    // MARK: - Row (archived, static — no reorder needed)

    @ViewBuilder
    private func archivedRow(_ list: ItemList) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(swatchColor(list.colorClass))
                .frame(width: 18, height: 18)

            Text(list.name)
                .foregroundStyle(BrettColors.textCardTitle)

            Spacer()

            Button {
                store.unarchive(id: list.id)
                bumpRefresh()
            } label: {
                Text("Restore")
                    .font(BrettTypography.badge)
                    .foregroundStyle(BrettColors.success)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func colorPicker(for list: ItemList) -> some View {
        HStack(spacing: 10) {
            ForEach(ColorSwatch.palette, id: \.self) { swatch in
                Button {
                    store.update(
                        id: list.id,
                        changes: ["colorClass": swatch.token],
                        previousValues: ["colorClass": list.colorClass]
                    )
                    showingColorPickerFor = nil
                    bumpRefresh()
                } label: {
                    Circle()
                        .fill(swatch.color)
                        .frame(width: 22, height: 22)
                        .overlay(
                            Circle().strokeBorder(
                                list.colorClass == swatch.token ? .white : .clear,
                                lineWidth: 2
                            )
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 10).fill(.black.opacity(0.6))
        )
    }

    // MARK: - Data

    private var activeLists: [ItemList] {
        store.fetchAll(includeArchived: false)
    }

    private var archivedLists: [ItemList] {
        store.fetchAll(includeArchived: true).filter { $0.isArchived }
    }

    // MARK: - Actions

    private func beginEdit(_ list: ItemList) {
        editingListId = list.id
        editBuffer = list.name
    }

    private func commitEdit(for list: ItemList) {
        let trimmed = editBuffer.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != list.name else {
            editingListId = nil
            return
        }
        store.update(
            id: list.id,
            changes: ["name": trimmed],
            previousValues: ["name": list.name]
        )
        editingListId = nil
        bumpRefresh()
    }

    private func addNewList() {
        guard let userId = authManager.currentUser?.id else { return }
        _ = store.create(userId: userId, name: "Untitled")
        bumpRefresh()
    }

    private func move(from source: IndexSet, to destination: Int) {
        var ids = activeLists.map(\.id)
        ids.move(fromOffsets: source, toOffset: destination)
        store.reorder(ids: ids)
        bumpRefresh()
    }

    private func bumpRefresh() {
        refreshTick &+= 1
    }

    private func swatchColor(_ token: String) -> Color {
        // Resolve via the canonical `ListColor` enum so swatch rendering
        // matches every other list-color surface in the app. Falls back to
        // slate (neutral) rather than cerulean — cerulean is Brett AI only,
        // never a fallback.
        if let color = ListColor(colorClass: token) {
            return color.swiftUIColor
        }
        return ListColor.slate.swiftUIColor
    }

}

// MARK: - Color swatches

private struct ColorSwatch: Hashable {
    let token: String
    let color: Color

    /// Palette shown in the list-color picker. Sourced from
    /// `ListColor.pickerSwatches` so this one list is the canonical palette
    /// — adding a new color or removing cerulean happens in one place, not
    /// here too. Cerulean is intentionally excluded (Brett AI only).
    static let palette: [ColorSwatch] = ListColor.pickerSwatches.map { color in
        ColorSwatch(token: color.rawValue, color: color.swiftUIColor)
    }
}
