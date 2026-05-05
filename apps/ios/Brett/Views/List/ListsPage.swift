import SwiftData
import SwiftUI

/// Lists tab — the leftmost page in the main TabView. Replaces the old
/// list-drawer-from-omnibar pattern, which the user pushed back on as
/// awkward (a horizontal pill row inside a half-sheet wasted space).
///
/// Each row is a tappable card showing the list's color dot, name, and
/// active-item count. Tapping pushes ListView. A floating "+" FAB at
/// the bottom right creates an Untitled list (renamed inline in
/// ListView). Management actions (rename / recolor / archive / reorder)
/// still live in Settings → Lists. This page is for SELECTING a list
/// to work in.
///
/// Auth gate around `ListsPageBody`. The body is the work-doer; this
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
/// `ListsPage` is a thin auth gate — when the user is authenticated it
/// renders `ListsPageBody(userId:)` modified with `.id(userId)`. The
/// `.id(...)` is the load-bearing piece: SwiftUI uses view identity to
/// decide whether to reuse a view's storage or remount fresh, and
/// pinning identity to `userId` guarantees that any future user-swap
/// (multi-account, server-side reassignment, refresh-returning-different-id)
/// triggers a full re-init of `ListsPageBody`'s `@Query` predicates,
/// `@State` stores, and any cached state. Sign-out is also covered for
/// free: `RootView`'s auth gate unmounts `MainContainer` entirely, which
/// destroys the body via the structural path. The `.id` makes that
/// invariant local instead of relying on a multi-component dance.
struct ListsPage: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            ListsPageBody(userId: userId)
                .id(userId)
        } else {
            // Signed-out fallback. The auth gate upstream
            // (`MainContainer`) usually prevents this branch, but render
            // an empty state defensively rather than nil-fallback so the
            // type system doesn't have to model a missing user here.
            EmptyView()
        }
    }
}

/// Lists data + UI. Owned by `ListsPage`'s auth gate, so `userId` is
/// guaranteed non-optional for this view's lifetime. Re-instantiated on
/// account switch because the parent applies `.id(userId)` — SwiftUI
/// treats a changed `id` as a new view identity and remounts this body
/// from scratch, which gives us a fresh `@Query` with the new user's
/// predicate (plus a clean slate for `@State` stores and caches).
private struct ListsPageBody: View {
    let userId: String

    @State private var listStore = ListStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.mainContext
    )

    /// Live reactive reads. @Query broadcasts SwiftData mutations so the
    /// view rebuilds automatically on create/update/archive without any
    /// manual re-render nudge. Both predicates capture `userId` from
    /// init, so the user-scope is enforced inside SQLite rather than as
    /// a Swift post-filter.
    @Query private var lists: [ItemList]
    @Query private var items: [Item]

    /// Used by the empty-vs-skeleton gate, same pattern as the other
    /// pages. NOT user-scoped — `SyncHealth` is a sync-internal row
    /// count that doesn't need cross-user isolation.
    @Query private var syncHealthRows: [SyncHealth]

    init(userId: String) {
        self.userId = userId

        let listPredicate = #Predicate<ItemList> { list in
            list.deletedAt == nil && list.archivedAt == nil && list.userId == userId
        }
        _lists = Query(filter: listPredicate, sort: \ItemList.sortOrder)

        let itemPredicate = #Predicate<Item> { item in
            item.deletedAt == nil && item.userId == userId
        }
        _items = Query(filter: itemPredicate, sort: \Item.createdAt, order: .reverse)

        // Explicit reassignment to keep parallel structure with the
        // user-scoped queries above. Functionally redundant — the
        // property declaration's default `Query()` is identical — but
        // keeping it makes the init read as a complete inventory of
        // every `@Query` this view owns.
        _syncHealthRows = Query()
    }

    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    /// Counts bucketed by `listId` in a single pass. Rendering N list
    /// cards triggers one pass over `items` instead of N SwiftData
    /// fetches (the prior imperative pattern). The `userId` filter is
    /// already applied at the `@Query` level, so this just groups.
    private var countsByList: [String: ListCounts.Entry] {
        ListCounts.groupByListId(items)
    }

    var body: some View {
        ZStack {
            // Wash backdrop — Lists wears the same solid wash as every
            // non-Today page per the calm-hero design.
            WashBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.bottom, 12)

                    if lists.isEmpty {
                        if hasCompletedInitialSync {
                            emptyState
                        } else {
                            TaskListPlaceholder()
                                .padding(.top, 12)
                        }
                    } else {
                        listCards
                    }
                }
                // Reserve only enough room for the omnibar — the FAB
                // was retired with the calm-hero design (the gold "+"
                // bottom-right competed visually with the gold "B"
                // chip in `ViewPillsBar`, and the omnibar is the
                // canonical capture surface). New lists land via the
                // header `+` (added below) or via the omnibar's
                // intent-routing (Phase 4 follow-up).
                .padding(.bottom, 90)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                try? await ActiveSession.syncManager?.pullToRefresh()
            }
        }
    }

    // MARK: - Header

    /// Editorial 38pt serif header per the calm-hero design — parity
    /// with every other top-level page so swipes don't shift the
    /// header silhouette. A discrete trailing "+" button replaces the
    /// gold FAB the page used to have at the bottom-right; the FAB
    /// was visually competing with the B menu chip in `ViewPillsBar`
    /// (two gold circles stacked at the bottom), so the create
    /// affordance moved up here where it doesn't crowd the chrome.
    private var header: some View {
        ZStack(alignment: .trailing) {
            EditorialPageHeader(
                title: "Lists",
                subtitle: subtitle
            )

            Button {
                createList()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background {
                        Circle()
                            .fill(BrettColors.gold)
                            .overlay {
                                Circle().strokeBorder(Color.white.opacity(0.20), lineWidth: 0.5)
                            }
                    }
            }
            .buttonStyle(.plain)
            .padding(.trailing, 24)
            .accessibilityLabel("New list")
            .accessibilityIdentifier("lists.create")
        }
        .padding(.top, 12)
    }

    private var subtitle: String {
        switch lists.count {
        case 0: return "No lists yet"
        case 1: return "1 list"
        default: return "\(lists.count) lists"
        }
    }

    // MARK: - Cards

    private var listCards: some View {
        let counts = countsByList
        return VStack(spacing: 8) {
            ForEach(lists, id: \.id) { list in
                NavigationLink(value: NavDestination.listView(id: list.id)) {
                    listCard(list, counts: counts[list.id] ?? .empty)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
    }

    private func listCard(_ list: ItemList, counts: ListCounts.Entry) -> some View {
        let color = ListColor(colorClass: list.colorClass)?.swiftUIColor ?? ListColor.slate.swiftUIColor

        return HStack(spacing: 14) {
            // Progress ring fills clockwise as items are completed —
            // matches Electron's ProgressDot in `LeftNav.tsx`. Empty
            // lists show a solid dot, fully-done lists show a filled
            // circle.
            ListProgressDot(
                color: color,
                completedCount: counts.completed,
                totalCount: counts.total
            )

            VStack(alignment: .leading, spacing: 2) {
                Text(list.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineLimit(1)

                Text(counts.active == 1 ? "1 item" : "\(counts.active) items")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(BrettColors.textGhost)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
                }
        }
        .contentShape(Rectangle())
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("No lists yet")
                .font(BrettTypography.emptyHeading)
                .foregroundStyle(Color.white.opacity(0.90))

            Text("Lists are how you group related items. Add one to get started.")
                .font(BrettTypography.emptyCopy)
                .foregroundStyle(Color.white.opacity(0.40))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.top, 48)
    }

    // MARK: - Actions

    private func createList() {
        HapticManager.light()
        do {
            _ = try listStore.create(userId: userId, name: "Untitled")
        } catch {
            // Atomic create failed (SwiftData save threw). Surface a haptic
            // so the user knows nothing happened rather than silently
            // swallowing the error.
            BrettLog.store.error("ListsPage createList failed: \(String(describing: error), privacy: .public)")
            HapticManager.error()
        }
    }

}

/// Tiny progress ring that fills clockwise as items in a list are
/// completed. Mirrors Electron's `ProgressDot` from
/// `packages/ui/src/LeftNav.tsx` so the two clients render lists the
/// same way at a glance.
///
/// Three states:
///  - empty list (`totalCount == 0`) → solid dot in the list's color
///  - partial progress → background ring + clockwise progress arc
///  - all done → filled circle (signals "you cleared this list")
private struct ListProgressDot: View {
    let color: Color
    let completedCount: Int
    let totalCount: Int

    private let size: CGFloat = 20
    private let strokeWidth: CGFloat = 3

    private var progress: Double {
        guard totalCount > 0 else { return 0 }
        return Double(completedCount) / Double(totalCount)
    }

    var body: some View {
        if totalCount == 0 {
            // Empty list — small filled dot in the list's tint.
            Circle()
                .fill(color.opacity(0.60))
                .frame(width: 10, height: 10)
                .frame(width: size, height: size)
        } else if progress >= 1.0 {
            // All done — full circle, slightly muted so it doesn't
            // shout louder than active lists with partial progress.
            Circle()
                .fill(color.opacity(0.80))
                .frame(width: size, height: size)
        } else {
            ZStack {
                // Background ring — the unfilled portion.
                Circle()
                    .stroke(Color.white.opacity(0.15), lineWidth: strokeWidth)

                // Progress arc — fills clockwise from 12 o'clock.
                // `.rotation(-90°)` puts the start of `trim` at the
                // top instead of 3 o'clock.
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(color, style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: size, height: size)
        }
    }
}
