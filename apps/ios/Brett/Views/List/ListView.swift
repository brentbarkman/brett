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

    @State private var draftName: String = ""
    @State private var isEditingName = false
    @State private var captureText: String = ""
    @FocusState private var nameFocused: Bool
    @FocusState private var captureFocused: Bool

    private var list: MockList? {
        store.lists.first(where: { $0.id == listId })
    }

    private var listName: String {
        store.displayName(forList: listId) ?? list?.name ?? "List"
    }

    private var listColor: ListColor {
        store.displayColor(forList: listId)
    }

    private var items: [MockItem] {
        store.items
            .filter { $0.listId == listId }
            .sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }
    }

    private var activeCount: Int {
        items.filter { !$0.isCompleted }.count
    }

    private var isArchived: Bool {
        store.archivedListIds.contains(listId)
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
                                        onToggle: { store.toggleItem(item.id) },
                                        onSelect: { store.selectedTaskId = item.id }
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
                        store.unarchiveList(listId)
                    } else {
                        store.archiveList(listId)
                    }
                    HapticManager.success()
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
            store.renameList(listId, to: trimmed)
        }
        isEditingName = false
        nameFocused = false
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
                store.unarchiveList(listId)
                HapticManager.success()
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
        store.addItem(title: trimmed, dueDate: nil, listId: listId)
        captureText = ""
        captureFocused = false
    }
}
