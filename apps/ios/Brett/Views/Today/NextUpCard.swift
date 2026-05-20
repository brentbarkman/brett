import SwiftUI

/// "Next up" surface — surfaces the very next calendar event so the user
/// never walks into a meeting cold.
///
/// Calm-hero "editorial moment" treatment (option B from the v18-NextUp
/// brainstorm): no card chrome, no glass, no border, no section label.
/// Pure typography on the photo — italic serif countdown headline,
/// title in 17pt white, time/duration whisper. The "NEXT UP" label is
/// implicit from the editorial countdown ("In 24 minutes."), so an
/// explicit section header would be redundant.
///
/// Tappable: the editorial block wraps a `NavigationLink` to
/// `NavDestination.eventDetail(id:)`, the same destination
/// `DayTimeline` uses for its event rows.
struct NextUpCard: View {
    let event: CalendarEvent?

    /// Captured at the parent's body-eval time — see `TodayPage.swift`
    /// for the rationale (we removed the periodic ticker for battery).
    let now: Date

    var body: some View {
        guard let event, shouldRender(event: event) else {
            return AnyView(EmptyView())
        }
        let minutesUntil = Self.minutesUntil(event: event, now: now)

        return AnyView(
            NavigationLink(value: NavDestination.eventDetail(id: event.id)) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(countdownPhrase(minutesUntil: minutesUntil))
                        .font(.system(size: 22, weight: .regular, design: .serif))
                        .italic()
                        .foregroundStyle(Color(red: 1.0, green: 0.90, blue: 0.78).opacity(0.95))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .modifier(NextUpLegibilityShadow())

                    Text(event.title)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .modifier(NextUpLegibilityShadow())

                    Text(metaCopy(for: event))
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color.white.opacity(0.75))
                        .modifier(NextUpLegibilityShadow())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // Vertical rhythm tuned by hand: ~16pt of breathing room
            // from the brief above so the editorial moment lands as a
            // separate beat, with a tight 4pt gap below so OVERDUE
            // pulls right up under it. Horizontal matches the hero +
            // section-header text edge — `BrettSpacing.pagePaddingX`.
            .padding(.horizontal, BrettSpacing.pagePaddingX)
            .padding(.top, 16)
            .padding(.bottom, 4)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Next up: \(event.title), \(countdownPhrase(minutesUntil: minutesUntil))")
            .accessibilityHint("Double-tap to open event details.")
            .accessibilityIdentifier("today.nextup")
        )
    }

    // MARK: - Helpers

    /// Only render when the event is in the future (or currently starting
    /// within the last minute) — once it's well underway we hand off to
    /// the calendar page.
    private func shouldRender(event: CalendarEvent) -> Bool {
        event.startTime > now.addingTimeInterval(-60)
    }

    private static func minutesUntil(event: CalendarEvent, now: Date) -> Int {
        let interval = event.startTime.timeIntervalSince(now)
        return max(0, Int(interval / 60))
    }

    /// Editorial countdown — serif italic phrase that doubles as the
    /// urgency signal. Reads naturally ("In 24 minutes." / "In 1 hour.")
    /// instead of an abbreviated count-pill ("IN 24 MIN").
    private func countdownPhrase(minutesUntil: Int) -> String {
        if minutesUntil <= 0 { return "Starting now." }
        if minutesUntil == 1 { return "In 1 minute." }
        if minutesUntil < 60 { return "In \(minutesUntil) minutes." }
        let hours = minutesUntil / 60
        let mins = minutesUntil % 60
        if mins == 0 {
            return hours == 1 ? "In 1 hour." : "In \(hours) hours."
        }
        return "In \(hours)h \(mins)m."
    }

    /// Whisper line — `9:00 AM · 30 min` / `9:00 AM · Conference Rm B` /
    /// `9:00 AM · Video call`. Duration takes precedence when known so
    /// the user can mentally reserve the time block at a glance.
    private func metaCopy(for event: CalendarEvent) -> String {
        let time = DateHelpers.formatTime(event.startTime)
        let durationMins = Int(event.endTime.timeIntervalSince(event.startTime) / 60)
        if durationMins > 0 {
            return "\(time) · \(durationMins) min"
        }
        if let location = event.location, !location.isEmpty {
            return "\(time) · \(location)"
        }
        if let link = event.meetingLink, !link.isEmpty {
            return "\(time) · Video call"
        }
        return time
    }
}

/// Layered shadow to keep NextUp text legible against any photo. Same
/// recipe as `HeroLegibilityShadow` in `TodayHero` — tight 1pt outline
/// + a soft 8pt halo. NextUp sits above the wash bed, directly over
/// the photo.
private struct NextUpLegibilityShadow: ViewModifier {
    func body(content: Content) -> some View {
        content
            .shadow(color: Color.black.opacity(0.40), radius: 1, x: 0, y: 0)
            .shadow(color: Color.black.opacity(0.30), radius: 8, x: 0, y: 2)
    }
}
