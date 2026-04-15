import SwiftUI

/// Manage the user's lists: rename, recolor, reorder, archive, delete.
///
/// Writes go through `ListStore` which enqueues mutations in the sync
/// engine — the server will receive them the next push cycle. Deletes
/// use the store's archive path; a full delete would require a new
/// mutation type that's outside this scope. We surface "Archive" for
/// active lists and "Unarchive" for archived ones.
struct ListsSettingsView: View {
    @Bindable var store: ListStore

    @Environment(AuthManager.self) private var authManager

    @State private var refreshTick: Int = 0
    @State private var editingListId: String?
    @State private var editBuffer: String = ""
    @State private var showingColorPickerFor: String?

    var body: some View {
        ZStack {
            BackgroundView()

            Form {
                Section {
                    ForEach(activeLists, id: \.id) { list in
                        row(list)
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
                    }
                    .listRowBackground(glassRowBackground)
                } header: {
                    sectionHeader("Active")
                }

                if !archivedLists.isEmpty {
                    Section {
                        ForEach(archivedLists, id: \.id) { list in
                            row(list)
                        }
                    } header: {
                        sectionHeader("Archived")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .environment(\.editMode, .constant(.active))
        }
        .navigationTitle("Lists")
        .navigationBarTitleDisplayMode(.inline)
        .id(refreshTick) // Force re-read after mutations
    }

    // MARK: - Row

    @ViewBuilder
    private func row(_ list: ItemList) -> some View {
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
        .listRowBackground(glassRowBackground)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if list.isArchived {
                Button {
                    store.unarchive(id: list.id)
                    bumpRefresh()
                } label: {
                    Label("Restore", systemImage: "tray.and.arrow.up")
                }
                .tint(BrettColors.success)
            } else {
                Button {
                    store.archive(id: list.id)
                    bumpRefresh()
                } label: {
                    Label("Archive", systemImage: "archivebox")
                }
                .tint(BrettColors.textMeta)
            }
        }
        .overlay(alignment: .bottom) {
            if showingColorPickerFor == list.id {
                colorPicker(for: list)
                    .padding(.top, 8)
            }
        }
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
        if token.contains("blue") { return BrettColors.cerulean }
        if token.contains("purple") { return BrettColors.purple400 }
        if token.contains("amber") || token.contains("yellow") { return BrettColors.gold }
        if token.contains("emerald") || token.contains("green") { return BrettColors.emerald }
        if token.contains("red") { return BrettColors.error }
        if token.contains("gray") { return Color.gray }
        return BrettColors.cerulean.opacity(0.8)
    }

    @ViewBuilder
    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }
}

// MARK: - Color swatches

private struct ColorSwatch: Hashable {
    let token: String
    let color: Color

    static let palette: [ColorSwatch] = [
        .init(token: "bg-gray-500", color: .gray),
        .init(token: "bg-blue-500", color: BrettColors.cerulean),
        .init(token: "bg-purple-500", color: BrettColors.purple400),
        .init(token: "bg-amber-500", color: BrettColors.gold),
        .init(token: "bg-emerald-500", color: BrettColors.emerald),
        .init(token: "bg-red-500", color: BrettColors.error),
    ]
}
