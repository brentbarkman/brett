import SwiftUI

/// The set of quick-schedule presets exposed on the sheet.
///
/// Kept as a plain enum so `QuickScheduleTests` can exercise the date math
/// without instantiating a SwiftUI view. Each case produces either a
/// concrete `Date` (UTC midnight of the user's local calendar date) or
/// `nil` for "Someday" (which clears `dueDate`).
///
/// Parity contract: the case set mirrors the desktop chip picker
/// (`packages/ui/src/quickPicker/letters.ts` → `DATE_PRESET_ORDER`) so
/// every preset lands in the same bucket on both clients. iOS keeps
/// `inAMonth` / `someday` / `pickDate` as iOS-only affordances; they
/// don't have desktop equivalents and don't need parity.
enum QuickScheduleOption: String, CaseIterable, Identifiable {
    case today
    case tonight
    case tomorrow
    case thisWeekend
    case thisWeek
    case nextWeek
    case nextMonth
    case inAMonth
    case someday
    case pickDate

    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: return "Today"
        case .tonight: return "Tonight"
        case .tomorrow: return "Tomorrow"
        case .thisWeekend: return "This Weekend"
        case .thisWeek: return "This Week"
        case .nextWeek: return "Next Week"
        case .nextMonth: return "Next Month"
        case .inAMonth: return "In a Month"
        case .someday: return "Someday"
        case .pickDate: return "Pick Date"
        }
    }

    var icon: String {
        switch self {
        case .today: return "sun.max.fill"
        case .tonight: return "moon.stars.fill"
        case .tomorrow: return "sunrise.fill"
        case .thisWeekend: return "calendar"
        case .thisWeek: return "calendar.badge.clock"
        case .nextWeek: return "forward.fill"
        case .nextMonth: return "calendar"
        case .inAMonth: return "calendar.badge.clock"
        case .someday: return "moon.stars.fill"
        case .pickDate: return "calendar.badge.plus"
        }
    }

    /// True if picking this option should set `tonight=true` on the item.
    /// Every other option implicitly clears the flag — see `handle(_:)`.
    var setsTonight: Bool {
        self == .tonight
    }

    /// True if this option should render with the muted (non-gold) tint.
    var isMuted: Bool {
        self == .someday
    }

    /// Every preset is day-precision after the normalize migration. The
    /// previous `.week` value for thisWeek / nextWeek was dropped along with
    /// the week branch of `DateHelpers.computeUrgency` — both presets now
    /// store a Friday and read as a day-precision item.
    var precision: DueDatePrecision { .day }

    /// Resolve this option into a concrete date (or `nil` to clear).
    /// `nil` for `.pickDate` signals "caller must supply a date" — that
    /// path uses the inline `DatePicker` instead.
    ///
    /// Every non-nil return is at **UTC midnight of the user's local
    /// calendar date**, matching the storage convention enforced across
    /// both clients. Anchoring to local midnight (the old behaviour)
    /// stored `06:00Z` in MDT and `15:00Z-prev-day` in Tokyo — both
    /// broke bucketing and cross-platform round-trips.
    func resolvedDate(now: Date = Date(), calendar: Calendar = .current) -> Date? {
        // Anchor for "today" in the user's local calendar.
        let localToday = calendar.startOfDay(for: now)
        let localWeekday = calendar.component(.weekday, from: localToday) // Sun=1..Sat=7

        func anchorAt(_ daysFromToday: Int) -> Date {
            let target = calendar.date(byAdding: .day, value: daysFromToday, to: localToday) ?? localToday
            return DateHelpers.utcMidnightOfLocalDate(target, in: calendar)
        }

        switch self {
        case .today:
            return anchorAt(0)
        case .tonight:
            // Same calendar day as today — `tonight` is a presentation hint
            // (Tonight section, 6pm auto-expand on desktop). The dueDate
            // matches `today` exactly so existing date-based logic (urgency,
            // bucketing) continues to behave correctly.
            return anchorAt(0)
        case .tomorrow:
            return anchorAt(1)
        case .thisWeekend:
            // If today is already Saturday (7) or Sunday (1), use today;
            // otherwise jump to the upcoming Saturday.
            if localWeekday == 7 || localWeekday == 1 { return anchorAt(0) }
            return anchorAt(7 - localWeekday)
        case .thisWeek:
            // End of this workweek = Friday (day-precision). Mirrors desktop
            // `computeTriageResult("this_week", ...)`. On Fri the result IS
            // today; on Sat/Sun it jumps to the upcoming Friday since the
            // current workweek has ended.
            return anchorAt(daysUntilUpcomingFriday(weekday: localWeekday))
        case .nextWeek:
            // The Friday after this_week's Friday. By construction this stays
            // exactly one week ahead of thisWeek so the chips read together.
            return anchorAt(daysUntilUpcomingFriday(weekday: localWeekday) + 7)
        case .nextMonth:
            // 1st of next month, anchored in the user's local calendar.
            var comps = calendar.dateComponents([.year, .month], from: localToday)
            comps.month = (comps.month ?? 1) + 1
            comps.day = 1
            let firstOfNext = calendar.date(from: comps) ?? localToday
            return DateHelpers.utcMidnightOfLocalDate(firstOfNext, in: calendar)
        case .inAMonth:
            return anchorAt(30)
        case .someday, .pickDate:
            return nil
        }
    }
}

/// Day offset (0..6) from the given local weekday (1=Sun..7=Sat) to the
/// upcoming Friday. Returns 0 on Friday itself, 6 on Saturday (next Fri),
/// 5 on Sunday (the upcoming Fri). Matches the TS `daysUntilUpcomingFriday`
/// in `packages/business/src/index.ts` exactly.
private func daysUntilUpcomingFriday(weekday: Int) -> Int {
    // Convert Apple's 1=Sun..7=Sat to JS-style 0=Sun..6=Sat first.
    let dow = weekday - 1
    return ((5 - dow) % 7 + 7) % 7
}

/// Bottom sheet for scheduling a task. Presents a 2-column grid of
/// presets plus an inline date picker. Usable from swipe actions,
/// detail pane, or bulk-select toolbar — the caller just hands in an
/// `onConfirm` closure.
///
/// On confirm:
///   1. `onConfirm(date)` fires with the resolved `Date?`
///   2. A medium haptic lands on the caller's side via their store mutation
///   3. The sheet dismisses itself via `@Environment(\.dismiss)`
struct QuickScheduleSheet: View {
    /// Both `date` and `precision` are required so the caller can persist
    /// the picker's intent exactly. Week-precision presets stored as
    /// `.day` silently bucketize into the weekend.
    ///
    /// `tonight` is `true` only when the user picked the Tonight chip.
    /// Every other commit path (other presets, raw calendar pick, Someday)
    /// passes `false`, which is the correct behavior — it clears any
    /// previously set tonight flag when the user retriages the item.
    let onConfirm: (_ date: Date?, _ precision: DueDatePrecision, _ tonight: Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showsDatePicker: Bool = false
    @State private var pickedDate: Date = Calendar.current.startOfDay(for: Date())

    /// Presets shown in the sheet, in display order. The first six match
    /// the desktop chip picker exactly so the two clients feel like the
    /// same product. iOS-only options come last.
    private static let presets: [QuickScheduleOption] = [
        .today, .tonight, .tomorrow, .thisWeekend, .thisWeek, .nextWeek, .nextMonth,
        .inAMonth, .someday, .pickDate,
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), spacing: 12),
                            GridItem(.flexible(), spacing: 12),
                        ],
                        spacing: 12
                    ) {
                        ForEach(Self.presets) { option in
                            Button {
                                handle(option)
                            } label: {
                                optionChip(for: option)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                    if showsDatePicker {
                        VStack(alignment: .leading, spacing: 8) {
                            DatePicker(
                                "Pick a date",
                                selection: $pickedDate,
                                in: Date()...,
                                displayedComponents: [.date]
                            )
                            .datePickerStyle(.graphical)
                            .tint(BrettColors.gold)
                            .padding(.horizontal, 16)
                            .onChange(of: pickedDate) { _, _ in
                                HapticManager.selectionChanged()
                            }

                            Button {
                                HapticManager.medium()
                                // Anchor the calendar-grid pick at UTC midnight
                                // of the user's local date — see the storage
                                // convention in `DateHelpers.utcMidnightOfLocalDate`.
                                let stored = DateHelpers.utcMidnightOfLocalDate(pickedDate, in: .current)
                                // Raw calendar picks always clear tonight — the
                                // chip is the only Tonight entry point. Re-triaging
                                // via the calendar drops the evening hint.
                                onConfirm(stored, .day, false)
                                dismiss()
                            } label: {
                                Text("Confirm")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color.black.opacity(0.90))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12)
                                            .fill(BrettColors.gold)
                                    )
                            }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 16)
                        }
                    }
                }
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .background(Color.clear)
            .navigationTitle("Schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(BrettColors.textSecondary)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Interactions

    private func handle(_ option: QuickScheduleOption) {
        if option == .pickDate {
            HapticManager.light()
            withAnimation(.easeInOut(duration: 0.25)) {
                showsDatePicker.toggle()
            }
            return
        }
        HapticManager.medium()
        onConfirm(option.resolvedDate(), option.precision, option.setsTonight)
        dismiss()
    }

    // MARK: - Option chip

    @ViewBuilder
    private func optionChip(for option: QuickScheduleOption) -> some View {
        let tint = option.isMuted ? BrettColors.textSecondary : BrettColors.gold
        HStack(spacing: 10) {
            Image(systemName: option.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
            Text(option.label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrettColors.textCardTitle)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(tint.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(tint.opacity(0.30), lineWidth: 1)
                )
        )
    }
}
