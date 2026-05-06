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
        onSchedule: @escaping (_ dueDate: Date?) -> Void = { _ in },
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
            // Mockup `.task { padding: 12px 14px; gap: 10px }` —
            // icon flush with the card's left padding (no 44pt
            // tap-target frame around it). Was previously a 44pt
            // tap-target frame around a 28pt icon, which pushed the
            // title another 8pt right and made the icon look
            // floating-in-padding. The icon glyph itself is 28pt
            // which is just under HIG's recommended 44pt minimum;
            // expanded `.contentShape` brings the tap area to the
            // full 28×40 (icon + extra vertical padding from the
            // row's vertical padding above + below).
            HStack(spacing: 10) {
                leadingGlyph
                    .frame(width: 28, height: 28)
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

                VStack(alignment: .leading, spacing: 2) {
                    // Title — 13pt weight 500 white per the v18 mockup
                    // (`.task-title { font-size: 13px; font-weight: 500;
                    // color: #fff; line-height: 1.35 }`). The legacy
                    // `BrettTypography.taskTitle` is 15pt, sized for
                    // Settings rows; calm-hero task rows want tighter,
                    // editorial-print proportions.
                    Text(viewModel.title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(viewModel.isCompleted ? Color.white.opacity(0.45) : Color.white)
                        .strikethrough(viewModel.isCompleted, color: Color.white.opacity(0.30))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        // Meta — 11pt white/0.55 per the mockup
                        // (`.task-meta`). Overdue items render the
                        // day-of-week ("Friday", "Wednesday") in a
                        // muted warm red (`.task-meta.overdue-meta`)
                        // — `viewModel.isOverdue` carries the bucket
                        // membership upstream.
                        if let time = viewModel.timeLabel {
                            Text(time)
                                .font(.system(size: 11))
                                .foregroundStyle(metaColor)
                        } else if let captured = viewModel.capturedLabel {
                            Text("Captured \(captured)")
                                .font(.system(size: 11))
                                .foregroundStyle(metaColor)
                        }

                        if let listName = viewModel.listName {
                            if viewModel.timeLabel != nil || viewModel.capturedLabel != nil {
                                Text("·")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Color.white.opacity(0.30))
                            }
                            Text(listName)
                                .font(.system(size: 11))
                                .foregroundStyle(Color.white.opacity(0.55))
                        }

                        if let domain = viewModel.contentDomain {
                            Text(domain)
                                .font(.system(size: 11))
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
            // Mockup `.task { padding: 12px 14px }` — icon flush
            // with the 14pt inset from the card's leading edge.
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
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

    /// 28pt gold-tinted glass circle per the v18 calm-hero mockup
    /// (`.type-icon`). All user-content rows (task + content) wear
    /// the same chrome — type is signalled by the glyph shape, not
    /// the tile color. Cerulean is reserved for Brett-generated
    /// surfaces and never appears on row icons.
    ///
    /// Mockup CSS:
    ///   width: 28; background: rgba(199,154,77,0.18);
    ///   border: 1px solid rgba(199,154,77,0.40);
    ///   color: rgba(255,230,200,0.95); inset highlight at top.
    private var contentGlyph: some View {
        typeIconCircle {
            Image(systemName: "doc.text")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.90, blue: 0.78).opacity(0.95))
        }
    }

    private var taskGlyph: some View {
        typeIconCircle {
            Image(systemName: "bolt.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.90, blue: 0.78).opacity(0.95))
        }
    }

    /// Shared circle chrome for task + content type icons. Matches
    /// the v18 mockup's `.type-icon` exactly so a row in the iOS
    /// app reads the same as the mockup at-a-glance.
    @ViewBuilder
    private func typeIconCircle<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ZStack {
            Circle()
                .fill(BrettColors.gold.opacity(0.18))
                .overlay {
                    Circle().strokeBorder(BrettColors.gold.opacity(0.40), lineWidth: 1)
                }
                .overlay(alignment: .top) {
                    // Inset top highlight (mockup `box-shadow:
                    // inset 0 1px 0 rgba(255,255,255,0.06)`).
                    Circle()
                        .trim(from: 0, to: 0.5)
                        .stroke(Color.white.opacity(0.08), lineWidth: 0.5)
                        .frame(width: 26, height: 26)
                        .rotationEffect(.degrees(180))
                }
                .frame(width: 28, height: 28)
            content()
        }
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

    /// Meta whisper color — muted warm red for overdue rows
    /// (`rgba(232, 138, 138, 0.85)` from the v18 mockup), white/0.55
    /// otherwise. Done items keep the normal meta color; the title
    /// strikethrough already carries the done signal.
    private var metaColor: Color {
        guard !viewModel.isCompleted, viewModel.isOverdue else {
            return Color.white.opacity(0.55)
        }
        return Color(red: 232/255, green: 138/255, blue: 138/255).opacity(0.85)
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

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    /// Time whisper — render the time-of-day when the due date
    /// carries one ("9:00 am"); for overdue items without a time-of-
    /// day fall back to the weekday name ("Friday", "Wednesday") so
    /// the row tells the user *when* it slipped without resorting to
    /// "X days overdue" math (the section header already says
    /// OVERDUE). Items in any non-overdue bucket without a time
    /// stay quiet — `nil` means "no time whisper, skip the segment."
    private static func timeLabel(for item: Item) -> String? {
        guard let due = item.dueDate else { return nil }
        let comps = Calendar.current.dateComponents([.hour, .minute], from: due)
        let hasTimeOfDay = (comps.hour ?? 0) != 0 || (comps.minute ?? 0) != 0
        if hasTimeOfDay {
            return timeFormatter.string(from: due).lowercased()
        }
        // Overdue + midnight-only date → weekday whisper.
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
