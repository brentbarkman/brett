import SwiftUI

/// Task row — compact 48pt height line with checkbox + title + metadata whisper.
///
/// Two initialisers:
///  - `init(item: MockItem, ...)` — legacy mock path, still used by Inbox and
///    anywhere else we haven't migrated off `MockStore` yet. Kept until every
///    caller flips to the real sync-backed `Item`.
///  - `init(item: Item, listName:, onToggle:, onSelect:)` — real SwiftData
///    Item. Taking the list name as a separate parameter avoids reaching into
///    `ListStore` from a leaf view and keeps the row cheap to render.
///
/// ### Gestures
///
/// Rich per-row gestures (swipe-to-schedule leading, swipe-to-delete/archive
/// trailing, drag-to-reorder long-press) are opt-in via init flags. Callers
/// that already have their own swipe behaviour (e.g. Inbox's `TriagePopup`)
/// pass `allowSwipe* = false` to opt out. Behaviour is identical across all
/// list views by default — per the "list behavior consistency" project rule.
struct TaskRow: View {
    private let viewModel: ViewModel
    private let onToggle: () -> Void
    private let onSelect: () -> Void

    // Gesture feature flags — each defaults to on so Today + custom lists
    // pick them up with no plumbing. Inbox passes false.
    private let allowSwipeRight: Bool
    private let allowSwipeLeft: Bool
    private let allowDrag: Bool

    // Gesture handlers — called when swipe actions fire. Caller wires them
    // to their store (ItemStore.update/delete) so this leaf view stays free
    // of environment lookups.
    private let onSchedule: (_ dueDate: Date?) -> Void
    private let onArchive: () -> Void
    private let onDelete: () -> Void

    // Drag-to-reorder wiring (only read when allowDrag == true).
    private let dragIDs: [String]
    private let onReorder: (_ newOrder: [String]) -> Void

    // MARK: - Pulse + sheet state

    @State private var pulseTrigger: Int = 0
    @State private var showsScheduleSheet: Bool = false

    // MARK: - Initialisers

    init(item: MockItem, onToggle: @escaping () -> Void, onSelect: @escaping () -> Void) {
        self.viewModel = ViewModel(
            id: item.id,
            title: item.title,
            isCompleted: item.isCompleted,
            timeLabel: item.time,
            capturedLabel: item.capturedAgo,
            listName: item.listName,
            contentDomain: item.contentDomain
        )
        self.onToggle = onToggle
        self.onSelect = onSelect
        // Legacy mock path can't mutate the store — keep gestures off.
        self.allowSwipeRight = false
        self.allowSwipeLeft = false
        self.allowDrag = false
        self.onSchedule = { _ in }
        self.onArchive = {}
        self.onDelete = {}
        self.dragIDs = []
        self.onReorder = { _ in }
    }

    init(
        item: Item,
        listName: String? = nil,
        allowSwipeRight: Bool = true,
        allowSwipeLeft: Bool = true,
        allowDrag: Bool = true,
        dragIDs: [String] = [],
        onToggle: @escaping () -> Void,
        onSelect: @escaping () -> Void,
        onSchedule: @escaping (_ dueDate: Date?) -> Void = { _ in },
        onArchive: @escaping () -> Void = {},
        onDelete: @escaping () -> Void = {},
        onReorder: @escaping (_ newOrder: [String]) -> Void = { _ in }
    ) {
        self.viewModel = ViewModel(
            id: item.id,
            title: item.title,
            isCompleted: item.isCompleted,
            timeLabel: Self.timeLabel(for: item),
            capturedLabel: Self.capturedLabel(for: item),
            listName: listName,
            contentDomain: item.contentDomain
        )
        self.onToggle = onToggle
        self.onSelect = onSelect
        self.allowSwipeRight = allowSwipeRight
        self.allowSwipeLeft = allowSwipeLeft
        self.allowDrag = allowDrag
        self.onSchedule = onSchedule
        self.onArchive = onArchive
        self.onDelete = onDelete
        self.dragIDs = dragIDs
        self.onReorder = onReorder
    }

    // MARK: - Body

    var body: some View {
        rowButton
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabelText)
            .accessibilityHint("Double-tap to open details.")
            .dynamicTypeClamp()
            .goldPulse(trigger: pulseTrigger)
            .applyIf(allowSwipeRight) { view in
                view.swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button {
                        apply(dueDate: Calendar.current.startOfDay(for: Date()))
                    } label: {
                        Label("Today", systemImage: "sun.max.fill")
                    }
                    .tint(BrettColors.gold)

                    Button {
                        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
                        apply(dueDate: Calendar.current.startOfDay(for: tomorrow))
                    } label: {
                        Label("Tomorrow", systemImage: "sunrise.fill")
                    }
                    .tint(BrettColors.gold.opacity(0.70))

                    Button {
                        HapticManager.light()
                        showsScheduleSheet = true
                    } label: {
                        Label("Later", systemImage: "calendar")
                    }
                    .tint(BrettColors.gold.opacity(0.50))
                }
            }
            .applyIf(allowSwipeLeft) { view in
                view.swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        HapticManager.heavy()
                        onDelete()
                    } label: {
                        Label("Delete", systemImage: "trash.fill")
                    }

                    Button {
                        HapticManager.medium()
                        onArchive()
                    } label: {
                        Label("Archive", systemImage: "archivebox.fill")
                    }
                    .tint(BrettColors.textSecondary)
                }
            }
            .applyIf(allowDrag && !dragIDs.isEmpty) { view in
                view.reorderable(
                    id: viewModel.id,
                    ids: dragIDs,
                    onReorder: onReorder
                )
            }
            .sheet(isPresented: $showsScheduleSheet) {
                QuickScheduleSheet { date in
                    apply(dueDate: date)
                }
            }
    }

    // MARK: - Row chrome

    private var rowButton: some View {
        Button {
            onSelect()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(
                            viewModel.isCompleted
                                ? BrettColors.success.opacity(0.15)
                                : Color.black.opacity(0.20)
                        )
                        .overlay {
                            Circle()
                                .strokeBorder(
                                    viewModel.isCompleted
                                        ? BrettColors.success.opacity(0.4)
                                        : Color.white.opacity(0.10),
                                    lineWidth: 1
                                )
                        }
                        .frame(width: 30, height: 30)

                    if viewModel.isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(BrettColors.success)
                    } else {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(BrettColors.gold.opacity(0.7))
                    }
                }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
                .highPriorityGesture(
                    TapGesture().onEnded {
                        HapticManager.success()
                        pulseTrigger &+= 1
                        onToggle()
                    }
                )

                VStack(alignment: .leading, spacing: 3) {
                    Text(viewModel.title)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(viewModel.isCompleted ? BrettColors.textMeta : BrettColors.textCardTitle)
                        .strikethrough(viewModel.isCompleted, color: BrettColors.textGhost)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        if let time = viewModel.timeLabel {
                            Text(time)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        } else if let captured = viewModel.capturedLabel {
                            Text("Captured \(captured)")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }

                        if let listName = viewModel.listName {
                            if viewModel.timeLabel != nil || viewModel.capturedLabel != nil {
                                Text("·")
                                    .font(BrettTypography.taskMeta)
                                    .foregroundStyle(BrettColors.textGhost)
                            }
                            Text(listName)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }

                        if let domain = viewModel.contentDomain {
                            Text(domain)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.cerulean.opacity(0.6))
                        }
                    }
                }

                Spacer()
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    /// Central landing for "a schedule action fired." Drives the haptic,
    /// trigger the gold pulse, and dispatch to the caller.
    private func apply(dueDate: Date?) {
        HapticManager.medium()
        pulseTrigger &+= 1
        onSchedule(dueDate)
    }

    /// VoiceOver label — built from the `ViewModel` so the announced whisper
    /// tracks the visual one (time, captured-ago, list, completion). Kept
    /// inside the row rather than in `AccessibilityLabels` because the row
    /// supports both the mock-item path and the real-Item path; routing both
    /// through the shared helper would require threading the raw `Item` in
    /// through the mock initialiser as well.
    private var accessibilityLabelText: String {
        var parts: [String] = [viewModel.title]
        if let time = viewModel.timeLabel {
            parts.append("due \(time)")
        } else if let captured = viewModel.capturedLabel {
            parts.append("captured \(captured)")
        }
        if let listName = viewModel.listName, !listName.isEmpty {
            parts.append("in \(listName) list")
        }
        parts.append(viewModel.isCompleted ? "Completed" : "Pending")
        return parts.joined(separator: ", ")
    }

    // MARK: - View model

    private struct ViewModel {
        let id: String
        let title: String
        let isCompleted: Bool
        let timeLabel: String?
        let capturedLabel: String?
        let listName: String?
        let contentDomain: String?
    }

    // MARK: - Real-Item formatters

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    /// Time whisper — only render when the due date carries a time-of-day
    /// (we skip midnight-only dates so the row doesn't read "12:00 AM" for
    /// every item without a precise time).
    private static func timeLabel(for item: Item) -> String? {
        guard let due = item.dueDate else { return nil }
        let comps = Calendar.current.dateComponents([.hour, .minute], from: due)
        if (comps.hour ?? 0) == 0 && (comps.minute ?? 0) == 0 { return nil }
        return timeFormatter.string(from: due).lowercased() // "9:00 am" style
    }

    private static func capturedLabel(for item: Item) -> String? {
        // "Captured {relative}" for undated content/inbox items
        guard item.dueDate == nil else { return nil }
        let elapsed = Date().timeIntervalSince(item.createdAt)
        let days = Int(elapsed / 86_400)
        if days == 0 { return "today" }
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days)d ago" }
        let weeks = days / 7
        return "\(weeks)w ago"
    }
}

/// Tiny conditional view modifier — lets us chain `.swipeActions` + `.reorderable`
/// behind opt-in flags without writing a dozen overloads. Both branches return
/// the same `some View` via SwiftUI's `ViewBuilder`.
private extension View {
    @ViewBuilder
    func applyIf<Transform: View>(
        _ condition: Bool,
        transform: (Self) -> Transform
    ) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }
}
