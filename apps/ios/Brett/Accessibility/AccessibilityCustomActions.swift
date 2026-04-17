import SwiftUI

/// Exposes task row swipe gestures as VoiceOver custom actions, so users who
/// can't swipe can still perform them via the rotor.
///
/// Swipe-right surfaces "Schedule for today" + "Schedule for tomorrow".
/// Swipe-left surfaces "Archive" + "Delete".
/// All four are exposed as `.accessibilityAction(named:)` so the rotor reads
/// them in order.
///
/// Two flavours:
///  - `taskAccessibilityActions(on:store:)` — for callers that have a real
///    `Item` + `ItemStore` available and want the actions to mutate the
///    store directly.
///  - `taskAccessibilityActions(allowSwipeRight:allowSwipeLeft:onSchedule:onArchive:onDelete:)`
///    — for callers that already own bespoke schedule/archive/delete logic
///    (e.g. a view that hands handlers to `TaskRow`). Mirrors the swipe
///    gestures' callback shape so wiring is symmetric.
extension View {
    /// Store-driven variant — the helper performs the mutation directly.
    /// Use when the caller has easy access to `Item` + `ItemStore`.
    func taskAccessibilityActions(
        on item: Item,
        store: ItemStore?
    ) -> some View {
        modifier(
            TaskAccessibilityStoreActionsModifier(item: item, store: store)
        )
    }

    /// Callback-driven variant — the helper invokes the supplied handler
    /// instead of talking to a store. Matches the swipe-gesture callback
    /// shape so rotor + swipe fire the same code path.
    func taskAccessibilityActions(
        allowSwipeRight: Bool = true,
        allowSwipeLeft: Bool = true,
        onSchedule: @escaping (_ dueDate: Date?) -> Void,
        onArchive: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) -> some View {
        modifier(
            TaskAccessibilityHandlerActionsModifier(
                allowSwipeRight: allowSwipeRight,
                allowSwipeLeft: allowSwipeLeft,
                onSchedule: onSchedule,
                onArchive: onArchive,
                onDelete: onDelete
            )
        )
    }
}

// MARK: - Store-driven variant

private struct TaskAccessibilityStoreActionsModifier: ViewModifier {
    let item: Item
    let store: ItemStore?

    func body(content: Content) -> some View {
        content
            .accessibilityAction(named: Text("Schedule for today")) {
                guard let store else { return }
                let today = Calendar.current.startOfDay(for: Date())
                store.update(
                    id: item.id,
                    changes: ["dueDate": today],
                    previousValues: ["dueDate": item.dueDate as Any]
                )
            }
            .accessibilityAction(named: Text("Schedule for tomorrow")) {
                guard let store else { return }
                let tomorrow = Calendar.current.date(
                    byAdding: .day,
                    value: 1,
                    to: Calendar.current.startOfDay(for: Date())
                ) ?? Date()
                store.update(
                    id: item.id,
                    changes: ["dueDate": tomorrow],
                    previousValues: ["dueDate": item.dueDate as Any]
                )
            }
            .accessibilityAction(named: Text("Archive")) {
                guard let store else { return }
                store.update(
                    id: item.id,
                    changes: ["status": ItemStatus.archived.rawValue],
                    previousValues: ["status": item.status]
                )
            }
            .accessibilityAction(named: Text("Delete")) {
                guard let store else { return }
                store.delete(id: item.id)
            }
    }
}

// MARK: - Handler-driven variant

private struct TaskAccessibilityHandlerActionsModifier: ViewModifier {
    let allowSwipeRight: Bool
    let allowSwipeLeft: Bool
    let onSchedule: (_ dueDate: Date?) -> Void
    let onArchive: () -> Void
    let onDelete: () -> Void

    func body(content: Content) -> some View {
        content
            .accessibilityActionIf(allowSwipeRight, named: "Schedule for today") {
                let today = Calendar.current.startOfDay(for: Date())
                onSchedule(today)
            }
            .accessibilityActionIf(allowSwipeRight, named: "Schedule for tomorrow") {
                let tomorrow = Calendar.current.date(
                    byAdding: .day,
                    value: 1,
                    to: Calendar.current.startOfDay(for: Date())
                ) ?? Date()
                onSchedule(tomorrow)
            }
            .accessibilityActionIf(allowSwipeLeft, named: "Archive") {
                onArchive()
            }
            .accessibilityActionIf(allowSwipeLeft, named: "Delete") {
                onDelete()
            }
    }
}

private extension View {
    /// Conditionally adds an `.accessibilityAction(named:)` — keeps the
    /// modifier chain readable when wiring a fixed set of rotor actions.
    @ViewBuilder
    func accessibilityActionIf(
        _ condition: Bool,
        named name: String,
        _ action: @escaping () -> Void
    ) -> some View {
        if condition {
            self.accessibilityAction(named: Text(name), action)
        } else {
            self
        }
    }
}
