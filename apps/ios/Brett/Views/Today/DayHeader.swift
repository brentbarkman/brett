import SwiftUI

struct DayHeader: View {
    let completedCount: Int
    let totalCount: Int
    let meetingCount: Int
    let meetingDuration: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(DateHelpers.formatDayHeader(Date()))
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)

            Text("\(completedCount) of \(totalCount) done · \(meetingCount) meeting\(meetingCount == 1 ? "" : "s") (\(meetingDuration))")
                .font(BrettTypography.stats)
                .foregroundStyle(Color.white.opacity(0.35))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
    }
}
