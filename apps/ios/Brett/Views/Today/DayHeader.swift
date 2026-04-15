import SwiftUI

/// Page header for Today — 28pt date, 13pt stats line.
///
/// Stats pulse briefly in gold when a task is completed (driven by the parent
/// flipping `pulse` on/off). Meeting info is only rendered when the caller
/// actually has calendar data to show.
struct DayHeader: View {
    let completedCount: Int
    let totalCount: Int
    let meetingCount: Int
    let meetingDuration: String
    let hasCalendarData: Bool
    var pulse: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(DateHelpers.formatDayHeader(Date()))
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)

            Text(statsLine)
                .font(BrettTypography.stats)
                .foregroundStyle(pulse ? BrettColors.gold : BrettColors.textInactive)
                .animation(.spring(response: 0.4, dampingFraction: 0.7), value: pulse)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
    }

    private var statsLine: String {
        let base = "\(completedCount) of \(totalCount) done"
        guard hasCalendarData else { return base }
        let meetingSuffix = meetingCount == 1 ? "meeting" : "meetings"
        return "\(base) · \(meetingCount) \(meetingSuffix) (\(meetingDuration))"
    }
}
