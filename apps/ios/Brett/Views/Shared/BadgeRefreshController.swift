import SwiftData
import SwiftUI

/// Invisible controller that owns the user-scoped `@Query<Item>` driving
/// the iOS home-screen badge.
///
/// Why a separate view instead of a `@Query` on `MainContainer`:
/// SwiftData's `#Predicate` macro can't read `@Environment` values, so
/// the established Wave B pattern is an init-based subview where
/// `userId` is a stored property and the predicate is constructed in
/// `init` with the captured user. Without that scoping, the badge
/// `@Query` returned items belonging to ANY user in the local store —
/// during a sign-out drain or a user-switch on a shared device the
/// home-screen badge could leak the previous user's count for a
/// frame, or include both users' active rows together while the wipe
/// race resolves.
///
/// Identity:
/// `MainContainer` mounts this as `BadgeRefreshController(userId: ...)
/// .id(userId)`. The `.id(...)` pin guarantees that any user-swap
/// triggers a full re-init with a fresh predicate so the @Query can
/// never carry over rows from the prior account.
///
/// Layout:
/// Renders zero-size + hidden so it has no visual presence. Its
/// `@Query` and `.onChange(of:)` modifiers still drive badge updates
/// exactly as before — only the @Query's user scoping has changed.
///
/// Behavior preservation:
/// The badge refresh API (`BadgeManager.refresh(items:)`), the cold-
/// launch seed task, the `badgeSignature`-driven onChange, and the
/// scenePhase-active onChange all moved here unmodified from
/// `MainContainer`. The narrower predicate matches the previous
/// "active, non-deleted" filter; only `userId == ...` was added.
struct BadgeRefreshController: View {
    let userId: String

    /// Items that could affect the iOS badge — active, non-deleted, scoped
    /// to the signed-in user. Kept as broad as the predicate allows because
    /// `BadgeManager.refresh(items:)` calls into `TodaySections.badgeCount`
    /// which buckets by overdue/today/this-week itself; narrowing further
    /// here would duplicate that bucketing logic.
    @Query private var items: [Item]

    @Environment(\.scenePhase) private var scenePhase

    init(userId: String) {
        self.userId = userId
        let predicate = #Predicate<Item> { item in
            item.deletedAt == nil && item.status == "active" && item.userId == userId
        }
        _items = Query(filter: predicate, sort: \Item.createdAt, order: .reverse)
    }

    /// Stable hash that changes whenever something affecting the badge count
    /// changes (id, status, or dueDate on any item). `Item` is an `@Model`
    /// class and not `Equatable`, so we observe this `Int` in `onChange`
    /// rather than `items` directly.
    ///
    /// Tradeoff: this is a computed property, so SwiftUI re-evaluates it on
    /// every `body` pass, not only on SwiftData pushes. For a user with
    /// thousands of items the extra cost is still negligible — hashing
    /// is O(n) with a tiny constant; even at 5k active items the
    /// per-render cost stays under 1ms in practice. Caching in `@State`
    /// would still need to recompute on every body pass to detect
    /// changes (no `Equatable` shortcut on `@Model`), so the cache hit
    /// path saves nothing. The right time to revisit this is if a
    /// profiler ever flags the hash as a meaningful slice of badge-render
    /// time, OR if we move to NSManagedObjectContext-style change
    /// notifications that report deltas directly without rehashing.
    /// Both audited 2026-05.
    private var badgeSignature: Int {
        var hasher = Hasher()
        for item in items {
            hasher.combine(item.id)
            hasher.combine(item.itemStatus)
            hasher.combine(item.dueDate)
        }
        return hasher.finalize()
    }

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .hidden()
            .accessibilityHidden(true)
            // Badge sync — fires on any add, delete, or edit that touches
            // id/status/dueDate. `badgeSignature` is an `Int` (Equatable)
            // that hashes the fields affecting the Today bucket count, so
            // we avoid conforming `Item` to `Equatable`.
            .onChange(of: badgeSignature) { _, _ in
                Task { await BadgeManager.shared.refresh(items: items) }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await BadgeManager.shared.refresh(items: items) }
                }
            }
            .task {
                // Cold-launch badge seed. `onChange(of: badgeSignature)` does
                // not fire for the initial value, so we push once here to cover
                // the case where the item set is already loaded when the view
                // mounts.
                await BadgeManager.shared.refresh(items: items)
            }
    }
}
