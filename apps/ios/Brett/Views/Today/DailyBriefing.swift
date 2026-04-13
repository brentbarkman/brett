import SwiftUI

struct DailyBriefing: View {
    let text: String
    @Binding var isCollapsed: Bool
    @Binding var isDismissed: Bool

    @ViewBuilder
    var body: some View {
        if !isDismissed {
            GlassCard(tint: BrettColors.cerulean) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("DAILY BRIEFING")
                            .font(BrettTypography.sectionLabel)
                            .tracking(2.4)
                            .foregroundStyle(BrettColors.ceruleanLabel)

                        Spacer()

                        Button {
                            withAnimation(.easeOut(duration: 0.25)) {
                                isCollapsed.toggle()
                            }
                        } label: {
                            Image(systemName: isCollapsed ? "chevron.down" : "chevron.up")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.3))
                        }
                        .buttonStyle(.plain)
                    }

                    if !isCollapsed {
                        Text(text)
                            .font(BrettTypography.body)
                            .foregroundStyle(BrettColors.textBody) // white/80 for body text
                            .lineSpacing(4)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }
}
