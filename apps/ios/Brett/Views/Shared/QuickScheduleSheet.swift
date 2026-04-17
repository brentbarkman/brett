import SwiftUI

/// The set of quick-schedule presets exposed on the sheet.
///
/// Kept as a plain enum so `QuickScheduleTests` can exercise the date math
/// without instantiating a SwiftUI view. Each case produces either a
/// concrete `Date` (start-of-day where meaningful) or `nil` for "Someday"
/// (which clears `dueDate`).
enum QuickScheduleOption: String, CaseIterable, Identifiable {
    case today
    case tomorrow
    case thisWeekend
    case nextWeek
    case inAMonth
    case someday
    case pickDate

    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: return "Today"
        case .tomorrow: return "Tomorrow"
        case .thisWeekend: return "This Weekend"
        case .nextWeek: return "Next Week"
        case .inAMonth: return "In a Month"
        case .someday: return "Someday"
        case .pickDate: return "Pick Date"
        }
    }

    var icon: String {
        switch self {
        case .today: return "sun.max.fill"
        case .tomorrow: return "sunrise.fill"
        case .thisWeekend: return "calendar"
        case .nextWeek: return "forward.fill"
        case .inAMonth: return "calendar.badge.clock"
        case .someday: return "moon.stars.fill"
        case .pickDate: return "calendar.badge.plus"
        }
    }

    /// True if this option should render with the muted (non-gold) tint.
    var isMuted: Bool {
        self == .someday
    }

    /// Resolve this option into a concrete date (or `nil` to clear).
    /// `nil` for `.pickDate` signals "caller must supply a date" — that
    /// path uses the inline `DatePicker` instead.
    func resolvedDate(now: Date = Date(), calendar: Calendar = .current) -> Date? {
        switch self {
        case .today:
            return calendar.startOfDay(for: now)
        case .tomorrow:
            return calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: now) ?? now)
        case .thisWeekend:
            // Next Saturday (weekday 7 in Gregorian). If today *is* Saturday,
            // prefer the upcoming one — users interpret "this weekend" as
            // "the weekend ahead of me."
            let today = calendar.startOfDay(for: now)
            let weekday = calendar.component(.weekday, from: today) // Sun=1..Sat=7
            let daysUntilSaturday: Int
            if weekday == 7 {
                daysUntilSaturday = 7 // today is Saturday — jump to next one
            } else {
                daysUntilSaturday = 7 - weekday
            }
            return calendar.date(byAdding: .day, value: daysUntilSaturday, to: today)
        case .nextWeek:
            return calendar.startOfDay(for: calendar.date(byAdding: .day, value: 7, to: now) ?? now)
        case .inAMonth:
            return calendar.startOfDay(for: calendar.date(byAdding: .day, value: 30, to: now) ?? now)
        case .someday:
            return nil
        case .pickDate:
            return nil
        }
    }
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
    let onConfirm: (_ date: Date?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showsDatePicker: Bool = false
    @State private var pickedDate: Date = Calendar.current.startOfDay(for: Date())

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
                        ForEach(QuickScheduleOption.allCases) { option in
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
                                onConfirm(Calendar.current.startOfDay(for: pickedDate))
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
        onConfirm(option.resolvedDate())
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
