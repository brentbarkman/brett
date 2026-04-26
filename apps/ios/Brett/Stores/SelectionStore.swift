import Foundation
import Observation

/// App-wide UI selection state. Replaces the `selectedTaskId` (and future
/// sibling) bindings that previously lived on `MockStore`.
///
/// Kept intentionally small — this is a coordinator for sheet / push
/// presentation, not a store for data. Data lives in `ItemStore`, `ListStore`,
/// etc. UI state lives here.
///
/// `@Observable` so SwiftUI views re-render automatically when the selection
/// changes. Main-actor because every consumer is a view.
@MainActor
@Observable
final class SelectionStore: Clearable {
    /// The currently-selected task id. Non-nil triggers the task detail
    /// sheet in `MainContainer`.
    var selectedTaskId: String?

    /// The currently-selected calendar event id. Not used for sheet
    /// presentation (Events use push navigation) but kept here so other
    /// surfaces can inspect "what's focused right now".
    var selectedEventId: String?

    /// Id of the most-recently-created item — set by the Omnibar after a
    /// successful `itemStore.create()`. Pages observe this via `.onChange`
    /// to scroll the new row into view; users adding to a long list
    /// otherwise can't tell whether the create happened.
    var lastCreatedItemId: String?

    /// Pending Settings deep-link. `MainContainer` observes this and pushes
    /// `NavDestination.settings` followed by the tab onto its nav path, then
    /// clears it. Used by the TaskRow "Reconnect" pill on re-link tasks.
    var pendingSettingsTab: SettingsTab?

    static let shared = SelectionStore()

    init() {
        ClearableStoreRegistry.register(self)
    }

    /// Convenience: clear all selections. Called on sign-out.
    func clear() {
        selectedTaskId = nil
        selectedEventId = nil
        lastCreatedItemId = nil
        pendingSettingsTab = nil
    }

    // MARK: - Clearable

    /// Sign-out hook. Delegates to the existing `clear()` so any direct
    /// callers continue to work unchanged.
    func clearForSignOut() {
        clear()
    }
}
