import Foundation
import Observation

/// App-wide navigation + UI-signal state.
///
/// Wave D consolidated this from `SelectionStore` so the previous mix
/// of three navigation patterns (manual `path.append`, ad-hoc Boolean
/// sheet flags, and stack-driven push) collapses into one source of
/// truth: `currentDestination` drives every sheet-style presentation,
/// and `pendingPushDestinations` queues pushes onto `MainContainer`'s
/// `NavigationStack`. Both go through the unified `NavDestination`
/// enum, and `go(to:)` dispatches to the right slot based on the
/// destination's `isSheet` property.
///
/// Non-nav signals (`lastCreatedItemId`) stay on this store as small
/// per-app-session UI hints. They're not navigation state but they're
/// in the same blast-radius (cleared on sign-out, not persisted).
@MainActor
@Observable
final class NavStore: Clearable {
    /// Current sheet-style destination. Setting this presents a sheet
    /// in `MainContainer`; clearing it dismisses. Push-style
    /// destinations flow through `pendingPushDestinations` instead.
    var currentDestination: NavDestination?

    /// Pending push destinations queue. `MainContainer` observes the
    /// array and drains it via append-to-path on `.onChange`. A queue
    /// (rather than a single slot) so two rapid back-to-back
    /// `go(to: pushDest)` calls can't drop the first one before the
    /// observer fires — mostly theoretical today but a sharp edge for
    /// callers that don't know their write timing.
    var pendingPushDestinations: [NavDestination] = []

    /// Id of the most-recently-created item — set by the Omnibar
    /// after a successful create. Pages observe this via `.onChange`
    /// to scroll the new row into view; users adding to a long list
    /// otherwise can't tell whether the create happened.
    ///
    /// Not navigation; UI signal. Kept here because it's
    /// session-scoped state that needs the same sign-out clear that
    /// other UI state gets.
    var lastCreatedItemId: String?

    static let shared = NavStore()

    init() {
        ClearableStoreRegistry.register(self)
    }

    /// Clearable conformance — drop everything on sign-out. The
    /// next user's session starts with no pending sheet, no scroll
    /// signal, and no stale ids.
    func clearForSignOut() {
        currentDestination = nil
        pendingPushDestinations = []
        lastCreatedItemId = nil
    }

    /// Convenience: navigate to a destination. Dispatches to either
    /// `currentDestination` (sheet) or appends to
    /// `pendingPushDestinations` (push) based on `destination.isSheet`.
    /// Reads better at call sites than the manual property assignment.
    func go(to destination: NavDestination) {
        if destination.isSheet {
            currentDestination = destination
        } else {
            pendingPushDestinations.append(destination)
        }
    }

    /// Convenience: dismiss the current sheet.
    func dismiss() {
        currentDestination = nil
    }
}
