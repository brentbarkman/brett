import SwiftUI

struct TodayPage: View {
    @Bindable var store: MockStore

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Collapsing header
                GeometryReader { geo in
                    let minY = geo.frame(in: .named("scroll")).minY
                    let progress = min(max(minY / 60, 0), 1)

                    VStack(alignment: .leading, spacing: 4 * progress) {
                        Text(DateHelpers.formatDayHeader(Date()))
                            .font(.system(size: 18 + (10 * progress), weight: .bold))
                            .foregroundStyle(.white)

                        if progress > 0.3 {
                            Text("\(store.completedTasks) of \(store.totalTasks) done · \(store.meetingCount) meeting\(store.meetingCount == 1 ? "" : "s") (\(store.meetingDuration))")
                                .font(BrettTypography.stats)
                                .foregroundStyle(BrettColors.textInactive)
                                .opacity(Double(progress))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                }
                .frame(height: 56)
                .padding(.top, 8)
                .padding(.bottom, 8)

                // Briefing card
                if !store.briefingDismissed {
                    briefingCard()
                }

                // Task sections
                taskCardSection(
                    label: "Overdue",
                    icon: "exclamationmark.triangle",
                    items: store.overdueItems,
                    labelColor: BrettColors.error,
                    accentColor: BrettColors.error
                )

                taskCardSection(
                    label: "Today",
                    icon: "sun.max",
                    items: store.todayItems,
                    labelColor: .white,
                    accentColor: nil
                )

                taskCardSection(
                    label: "This Week",
                    icon: "calendar",
                    items: store.thisWeekItems,
                    labelColor: .white,
                    accentColor: nil
                )

                taskCardSection(
                    label: "Next Week",
                    icon: "arrow.right.circle",
                    items: store.nextWeekItems,
                    labelColor: .white,
                    accentColor: nil
                )

                taskCardSection(
                    label: "Done Today",
                    icon: "checkmark.circle",
                    items: store.doneItems,
                    labelColor: BrettColors.success,
                    accentColor: nil
                )
            }
            .padding(.bottom, 70)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .coordinateSpace(name: "scroll")
    }

    // MARK: - Briefing card

    @ViewBuilder
    private func briefingCard() -> some View {
        StickyCardSection(tint: BrettColors.cerulean) {
            // Header
            HStack(spacing: 6) {
                Image(systemName: "text.quote")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BrettColors.cerulean.opacity(0.80))

                Text("DAILY BRIEFING")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.cerulean.opacity(0.80))

                Spacer()

                Button {
                    withAnimation(.easeOut(duration: 0.25)) {
                        store.briefingCollapsed.toggle()
                    }
                } label: {
                    Image(systemName: store.briefingCollapsed ? "chevron.down" : "chevron.up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.3))
                }
                .buttonStyle(.plain)
            }
        } content: {
            if !store.briefingCollapsed {
                Text(store.briefing)
                    .font(BrettTypography.body)
                    .foregroundStyle(BrettColors.textBody)
                    .lineSpacing(4)
                    .padding(16)
            }
        }
    }

    // MARK: - Task card section

    @ViewBuilder
    private func taskCardSection(
        label: String,
        icon: String,
        items: [MockItem],
        labelColor: Color,
        accentColor: Color?
    ) -> some View {
        if !items.isEmpty {
            StickyCardSection {
                // Header content
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(labelColor.opacity(0.80))

                    Text(label.uppercased())
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(labelColor.opacity(0.80))

                    Spacer()

                    Text("\(items.count)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(labelColor.opacity(0.50))
                }
            } content: {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if let accent = accentColor {
                            HStack(spacing: 0) {
                                Rectangle()
                                    .fill(accent)
                                    .frame(width: 3)
                                    .clipShape(RoundedRectangle(cornerRadius: 1.5))
                                    .padding(.vertical, 4)

                                TaskRow(item: item, onToggle: { store.toggleItem(item.id) }, onSelect: { store.selectedTaskId = item.id })
                                    .padding(.leading, 8)
                            }
                        } else {
                            TaskRow(item: item, onToggle: { store.toggleItem(item.id) }, onSelect: { store.selectedTaskId = item.id })
                        }

                        if index < items.count - 1 {
                            Divider().background(BrettColors.hairline)
                                .padding(.horizontal, 16)
                        }
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }
}
