import SwiftUI

/// Task row — compact 48pt height line with checkbox + title + metadata whisper.
///
/// Takes the list name as a separate parameter to avoid reaching into
/// `ListStore` from a leaf view — keeps the row cheap to render.
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

    // Multi-select mode (Inbox). When `isSelectMode` is true the leading
    // glyph becomes a selection circle (gold check when isSelected, outline
    // otherwise) and `onToggle` is interpreted as "toggle selection" by the
    // caller. Defaults match single-select behaviour so existing call
    // sites keep working unchanged.
    private let isSelectMode: Bool
    private let isSelected: Bool

    // Gesture handlers — called when swipe actions fire. Caller wires them
    // to their store (ItemStore.update/delete) so this leaf view stays free
    // of environment lookups.
    /// Fires when a swipe-action or sheet picks a due date. `precision`
    /// is `.day` for Today/Tomorrow/This Weekend/Next Month/raw calendar
    /// picks and `.week` for This Week / Next Week — pass it through to
    /// the mutation so week-precision picks don't bucketize as weekend.
    private let onSchedule: (_ dueDate: Date?, _ precision: DueDatePrecision) -> Void
    private let onArchive: () -> Void
    private let onDelete: () -> Void

    // Drag-to-reorder wiring (only read when allowDrag == true).
    private let dragIDs: [String]
    private let onReorder: (_ newOrder: [String]) -> Void

    // MARK: - Pulse + sheet state

    @State private var pulseTrigger: Int = 0
    @State private var showsScheduleSheet: Bool = false

    // MARK: - Initialisers


    init(
        item: Item,
        listName: String? = nil,
        allowSwipeRight: Bool = true,
        allowSwipeLeft: Bool = true,
        allowDrag: Bool = true,
        isSelectMode: Bool = false,
        isSelected: Bool = false,
        dragIDs: [String] = [],
        onToggle: @escaping () -> Void,
        onSelect: @escaping () -> Void,
        onSchedule: @escaping (_ dueDate: Date?, _ precision: DueDatePrecision) -> Void = { _, _ in },
        onArchive: @escaping () -> Void = {},
        onDelete: @escaping () -> Void = {},
        onReorder: @escaping (_ newOrder: [String]) -> Void = { _ in }
    ) {
        self.viewModel = ViewModel(
            id: item.id,
            title: item.title,
            isCompleted: item.isCompleted,
            itemType: item.itemType,
            timeLabel: Self.timeLabel(for: item),
            capturedLabel: Self.capturedLabel(for: item),
            listName: listName,
            contentDomain: item.contentDomain,
            relinkTask: RelinkTask.parse(source: item.source, sourceId: item.sourceId),
            isOverdue: Self.isOverdue(item)
        )
        self.onToggle = onToggle
        self.onSelect = onSelect
        self.allowSwipeRight = allowSwipeRight
        self.allowSwipeLeft = allowSwipeLeft
        self.allowDrag = allowDrag
        self.isSelectMode = isSelectMode
        self.isSelected = isSelected
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
            .accessibilityHint(isSelectMode
                ? "Double-tap to toggle selection."
                : "Double-tap to open details.")
            .accessibilityAddTraits(isSelectMode && isSelected ? .isSelected : [])
            // Stable identifier for XCUITest: title-based because UI tests
            // can't easily construct the random UUID at assertion time.
            // Sanitised (lowercase, spaces → underscores) so predicates like
            // `.matching(identifier:)` stay deterministic.
            .accessibilityIdentifier("task.row.\(Self.identifierToken(for: viewModel.title))")
            .dynamicTypeClamp()
            .goldPulse(trigger: pulseTrigger)
            .applyIf(allowSwipeRight) { view in
                view.swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button {
                        apply(dueDate: QuickScheduleOption.today.resolvedDate(), precision: .day)
                    } label: {
                        Label("Today", systemImage: "sun.max.fill")
                    }
                    .tint(BrettColors.gold)

                    Button {
                        apply(dueDate: QuickScheduleOption.tomorrow.resolvedDate(), precision: .day)
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
                QuickScheduleSheet { date, precision in
                    apply(dueDate: date, precision: precision)
                }
            }
    }

    // MARK: - Row chrome

    private var rowButton: some View {
        Button {
            onSelect()
        } label: {
            // Naked-row density: bare glyph (no gold-tinted circle chrome),
            // tighter vertical padding. Tap target stays HIG-safe via the
            // 30×30 contentShape around the smaller glyph.
            HStack(spacing: 10) {
                leadingGlyph
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
                    .highPriorityGesture(
                        TapGesture().onEnded {
                            if isSelectMode {
                                HapticManager.light()
                            } else {
                                HapticManager.success()
                                pulseTrigger &+= 1
                            }
                            onToggle()
                        }
                    )

                VStack(alignment: .leading, spacing: 3) {
                    // Title — bumped from the mockup's 13pt to 15pt
                    // weight medium so the row reads at a comfortable
                    // distance on a real iPhone. The mockup is rendered
                    // inside a 320px desktop preview frame where 13px
                    // is fine; on the device, that translated to text
                    // that felt small next to the editorial 38pt
                    // serif header. Weight stays medium so the row
                    // doesn't shout.
                    Text(viewModel.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(viewModel.isCompleted ? Color.white.opacity(0.45) : Color.white)
                        .strikethrough(viewModel.isCompleted, color: Color.white.opacity(0.30))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        // Meta — bumped to 12.5pt for the same
                        // device-readability reason as the title.
                        // Overdue items render the day-of-week
                        // ("Friday", "Wednesday") in a muted warm
                        // red (`.task-meta.overdue-meta`).
                        if let time = viewModel.timeLabel {
                            Text(time)
                                .font(.system(size: 12.5))
                                .foregroundStyle(metaColor)
                        } else if let captured = viewModel.capturedLabel {
                            Text("Captured \(captured)")
                                .font(.system(size: 12.5))
                                .foregroundStyle(metaColor)
                        }

                        if let listName = viewModel.listName {
                            if viewModel.timeLabel != nil || viewModel.capturedLabel != nil {
                                Text("·")
                                    .font(.system(size: 12.5))
                                    .foregroundStyle(Color.white.opacity(0.30))
                            }
                            Text(listName)
                                .font(.system(size: 12.5))
                                .foregroundStyle(Color.white.opacity(0.55))
                        }

                        if let domain = viewModel.contentDomain {
                            Text(domain)
                                .font(.system(size: 12.5))
                                .foregroundStyle(BrettColors.gold.opacity(0.65))
                        }
                    }
                }

                Spacer()

                // Reconnect pill — only rendered on re-link tasks from broken
                // integrations. Mirrors desktop's gold pill in
                // `packages/ui/src/ThingCard.tsx`. Tap deep-links to the
                // matching Settings tab via `NavStore.go(to: .settingsTab(...))`.
                if !viewModel.isCompleted, let relink = viewModel.relinkTask {
                    reconnectPill(for: relink.type)
                }
            }
            // Naked-row density: tighter row padding (~44pt total height
            // vs the prior ~54pt). Parent containers (TaskSection,
            // InboxPage, ListView) should be eyeballed for hollow feel.
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    /// Leading glyph, branched by mode. Order of precedence:
    ///   1. Select mode → gold selection circle (with checkmark when chosen)
    ///   2. Completed    → green checkmark (Today's "Done today" bucket)
    ///   3. Content item → cerulean document glyph (newsletters, articles)
    ///   4. Otherwise    → gold bolt (the default task icon)
    ///
    /// Merged from the old `InboxItemRow` which had its own `selectionCircle`
    /// + content-type branches. Centralising the rules here keeps Today /
    /// Inbox / Lists rows visually consistent per the CLAUDE.md rule and
    /// means a future icon tweak is a one-place change.
    @ViewBuilder
    private var leadingGlyph: some View {
        if isSelectMode {
            selectionCircleGlyph
        } else if viewModel.itemType == .content {
            contentGlyph
        } else {
            taskGlyph
        }
        // No completion-state branch: the existing title fade +
        // strikethrough (in `rowButton`) is what signals "done." The
        // earlier swap to a green checkmark added visual chatter and
        // diverged from the calmer editorial direction — now the
        // type icon stays put on completion, just dimmer alongside
        // the faded title.
    }

    private var selectionCircleGlyph: some View {
        ZStack {
            Circle()
                .strokeBorder(
                    isSelected ? BrettColors.gold : Color.white.opacity(0.25),
                    lineWidth: 1.5
                )
                .background {
                    Circle().fill(
                        isSelected ? BrettColors.gold.opacity(0.25) : Color.clear
                    )
                }
                .frame(width: 22, height: 22)

            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(BrettColors.gold)
            }
        }
        .transition(.scale.combined(with: .opacity))
    }

    /// Bare document glyph for content items (newsletters, articles).
    /// No tile chrome — the glyph stands on its own at full gold
    /// saturation, matching desktop's naked-row pattern. Dims to 30%
    /// on completion alongside the title strikethrough.
    private var contentGlyph: some View {
        Image(systemName: "doc.text")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(BrettColors.gold.opacity(viewModel.isCompleted ? 0.30 : 1.0))
    }

    /// Bare bolt glyph for task items. Mirrors `contentGlyph` — type
    /// is signalled by glyph shape alone, not by tile color.
    private var taskGlyph: some View {
        Image(systemName: "bolt.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(BrettColors.gold.opacity(viewModel.isCompleted ? 0.30 : 1.0))
    }

    @ViewBuilder
    private func reconnectPill(for type: RelinkType) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text("Reconnect")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(BrettColors.gold)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule().fill(BrettColors.gold.opacity(0.15))
        )
        .contentShape(Capsule())
        .highPriorityGesture(
            TapGesture().onEnded {
                HapticManager.light()
                NavStore.shared.go(to: .settingsTab(type.settingsTab))
            }
        )
        .accessibilityLabel("Reconnect \(accessibleName(for: type))")
        .accessibilityHint("Opens Settings to re-link this integration.")
    }

    private func accessibleName(for type: RelinkType) -> String {
        switch type {
        case .googleCalendar: return "Google Calendar"
        case .granola: return "Granola"
        case .ai: return "AI provider"
        }
    }

    /// Central landing for "a schedule action fired." Drives the haptic,
    /// trigger the gold pulse, and dispatch to the caller. `precision` is
    /// always supplied — week-precision picks (This Week / Next Week)
    /// must round-trip as `.week` or they bucketize as the weekend.
    private func apply(dueDate: Date?, precision: DueDatePrecision) {
        HapticManager.medium()
        pulseTrigger &+= 1
        onSchedule(dueDate, precision)
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
        let itemType: ItemType
        let timeLabel: String?
        let capturedLabel: String?
        let listName: String?
        let contentDomain: String?
        let relinkTask: RelinkTask?
        /// True when the item's due date is before the start of today.
        /// Drives the v18 mockup's `.task-meta.overdue-meta` red tint
        /// — the meta whisper renders in muted warm red so the row
        /// reads as "you're late" without needing a separate "X days
        /// overdue" suffix (the section header already says OVERDUE).
        let isOverdue: Bool
    }

    /// True when the item is active and due before today started.
    /// Mirrors `TodaySections.bucket`'s overdue test so the row's
    /// visual matches what the section bucketing decided.
    private static func isOverdue(_ item: Item) -> Bool {
        guard item.itemStatus == .active, let due = item.dueDate else { return false }
        return due < Calendar.current.startOfDay(for: Date())
    }

    /// Meta whisper color — `BrettColors.overdueRed` for overdue rows
    /// (calm-hero red, see `BrettColors.swift`), white/0.55 otherwise.
    /// Done items keep the normal meta color; the title strikethrough
    /// already carries the done signal.
    private var metaColor: Color {
        guard !viewModel.isCompleted, viewModel.isOverdue else {
            return Color.white.opacity(0.55)
        }
        return BrettColors.overdueRed.opacity(0.90)
    }

    /// Convert a task title into a stable, predictable accessibility-id token.
    /// Lowercase, alnum-only, spaces → underscores, clamped to 40 chars so the
    /// id stays short enough for XCUITest predicates.
    private static func identifierToken(for title: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
        let lowered = title.lowercased().replacingOccurrences(of: " ", with: "_")
        let filtered = lowered.unicodeScalars.filter { allowed.contains($0) }
        let result = String(String.UnicodeScalarView(filtered))
        return String(result.prefix(40))
    }

    // MARK: - Real-Item formatters

    /// Overdue whisper — render the weekday name ("Friday",
    /// "Wednesday") for items whose due date has slipped, so the row
    /// tells the user *when* it slipped without resorting to "X days
    /// overdue" math (the section header already says OVERDUE). We
    /// don't render time-of-day; there's no UI to set a time on a
    /// task and desktop's `ThingCard` doesn't display one either.
    /// `nil` means "no whisper, skip the segment."
    private static func timeLabel(for item: Item) -> String? {
        guard let due = item.dueDate else { return nil }
        if due < Calendar.current.startOfDay(for: Date()) {
            return weekdayFormatter.string(from: due)
        }
        return nil
    }

    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE"
        return formatter
    }()

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
