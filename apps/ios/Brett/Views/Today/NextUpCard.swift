import SwiftUI

/// "Next up" card — surfaces the very next calendar event so the user never
/// walks into a meeting cold. Sits above the Daily Briefing when the event
/// is less than 10 minutes out; compact pre-10-minute form when further away.
///
/// Uses a cerulean tint (Brett AI surface) rather than pure glass so it pulls
/// the eye when it matters.
struct NextUpCard: View {
    let event: CalendarEvent?

    /// Driven by a Timer in the parent so the "in N min" copy stays fresh
    /// without us having to create our own timer here.
    let now: Date

    var body: some View {
        guard let event, shouldRender(event: event) else {
            return AnyView(EmptyView())
        }

        let minutesUntil = Self.minutesUntil(event: event, now: now)
        let isImminent = minutesUntil <= 10

        return AnyView(
            StickyCardSection(tint: BrettColors.cerulean) {
                // Same treatment as DailyBriefing: drop the icon, use
                // neutral white for the label. The card's cerulean rim
                // (from `tint`) carries the AI-surface signal. Time-til
                // copy on the right stays cerulean to flag urgency on
                // the imminent path.
                HStack(spacing: 6) {
                    Text("NEXT UP")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(Color.white.opacity(0.60))

                    Spacer()

                    Text(relativeCopy(minutesUntil: minutesUntil))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(isImminent ? BrettColors.cerulean : BrettColors.cerulean.opacity(0.70))
                }
            } content: {
                VStack(alignment: .leading, spacing: isImminent ? 8 : 4) {
                    Text(event.title)
                        .font(isImminent ? .system(size: 18, weight: .semibold) : BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(2)

                    HStack(spacing: 8) {
                        Text(DateHelpers.formatTime(event.startTime))
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)

                        if let location = event.location, !location.isEmpty {
                            Text("·")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textGhost)
                            Text(location)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                                .lineLimit(1)
                        } else if let link = event.meetingLink, !link.isEmpty {
                            Text("·")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textGhost)
                            Text("Video call")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.cerulean.opacity(0.60))
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
        )
    }

    // MARK: - Helpers

    /// Only render when the event is in the future (or currently starting
    /// within the next minute) — once it's rolling we hand off to the
    /// calendar page.
    private func shouldRender(event: CalendarEvent) -> Bool {
        event.startTime > now.addingTimeInterval(-60)
    }

    private static func minutesUntil(event: CalendarEvent, now: Date) -> Int {
        let interval = event.startTime.timeIntervalSince(now)
        return max(0, Int(interval / 60))
    }

    private func relativeCopy(minutesUntil: Int) -> String {
        if minutesUntil <= 0 { return "NOW" }
        if minutesUntil == 1 { return "IN 1 MIN" }
        if minutesUntil < 60 { return "IN \(minutesUntil) MIN" }
        let hours = minutesUntil / 60
        let mins = minutesUntil % 60
        if mins == 0 { return "IN \(hours)H" }
        return "IN \(hours)H \(mins)M"
    }
}
