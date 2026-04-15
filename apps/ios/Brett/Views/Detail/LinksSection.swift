import SwiftUI

/// Simple DTO representing a linked item. Normalised from the mixed
/// forward/reverse payload the server returns under `GET /things/:id` so
/// the UI only ever sees one shape.
struct LinkedItemSummary: Identifiable, Hashable {
    let linkId: String        // the ItemLink row id — needed for DELETE
    let itemId: String        // the target Item id — used for navigation
    let title: String
    let type: String          // "task" | "content"
    let source: String        // "manual" | "embedding" | ...

    var id: String { linkId }
}

/// Glass-carded list of linked items with a "+ Add" search sheet.
///
/// Tap a link → parent uses `onOpenLink(id)` to push a new detail on top of
/// this one. Delete via swipe or menu → DELETE the link and refetch.
struct LinksSection: View {
    let itemId: String
    let links: [LinkedItemSummary]

    let onAddLink: (String) async -> Void
    let onRemoveLink: (LinkedItemSummary) async -> Void
    let onOpenLink: (LinkedItemSummary) -> Void

    @State private var showingSearch = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("LINKS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Spacer()

                Button {
                    HapticManager.light()
                    showingSearch = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Add link")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.textInactive)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(0.10), in: Capsule())
                }
            }

            if links.isEmpty {
                emptyState
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(links.enumerated()), id: \.element.id) { index, link in
                        linkRow(link)
                        if index < links.count - 1 {
                            Rectangle()
                                .fill(BrettColors.hairline)
                                .frame(height: 0.5)
                        }
                    }
                }
            }
        }
        .glassCard()
        .sheet(isPresented: $showingSearch) {
            SearchAndLinkSheet(
                currentItemId: itemId,
                onSelect: { selectedId in
                    showingSearch = false
                    Task { await onAddLink(selectedId) }
                },
                onCancel: { showingSearch = false }
            )
            .presentationDetents([.large])
            .presentationBackground(Color.black.opacity(0.92))
            .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder
    private func linkRow(_ link: LinkedItemSummary) -> some View {
        Button {
            HapticManager.light()
            onOpenLink(link)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: link.type == "task" ? "bolt.fill" : "book")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(link.type == "task" ? BrettColors.gold : BrettColors.amber400.opacity(0.80))

                Text(link.title)
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.textBody)
                    .lineLimit(1)

                Spacer()

                if link.source != "manual" {
                    Image(systemName: "sparkles")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(BrettColors.amber400.opacity(0.50))
                }

                Menu {
                    Button(role: .destructive) {
                        Task { await onRemoveLink(link) }
                    } label: {
                        Label("Remove link", systemImage: "link.badge.minus")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(BrettColors.textGhost)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
            }
            .contentShape(Rectangle())
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var emptyState: some View {
        HStack(spacing: 6) {
            Image(systemName: "link")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BrettColors.textGhost)
            Text("No links")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textPlaceholder)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 6)
    }
}
