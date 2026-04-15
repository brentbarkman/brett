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
final class SelectionStore {
    /// The currently-selected task id. Non-nil triggers the task detail
    /// sheet in `MainContainer`.
    var selectedTaskId: String?

    /// The currently-selected calendar event id. Not used for sheet
    /// presentation (Events use push navigation) but kept here so other
    /// surfaces can inspect "what's focused right now".
    var selectedEventId: String?

    static let shared = SelectionStore()

    init() {}

    /// Convenience: clear all selections. Called on sign-out.
    func clear() {
        selectedTaskId = nil
        selectedEventId = nil
    }
}
