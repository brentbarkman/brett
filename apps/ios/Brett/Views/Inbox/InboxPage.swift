import SwiftUI

struct InboxPage: View {
    @Bindable var store: MockStore

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    Text("Inbox")
                        .font(BrettTypography.dateHeader)
                        .foregroundStyle(.white)

                    Text("\(store.inboxItems.count) items to triage")
                        .font(BrettTypography.stats)
                        .foregroundStyle(BrettColors.textInactive)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 8)

                if store.inboxItems.isEmpty {
                    EmptyState(heading: "Your inbox", copy: "Everything worth doing starts here.")
                } else {
                    StickyCardSection {
                        HStack(spacing: 6) {
                            Image(systemName: "tray")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.80))

                            Text("TO TRIAGE")
                                .font(BrettTypography.sectionLabel)
                                .tracking(2.4)
                                .foregroundStyle(Color.white.opacity(0.80))

                            Spacer()

                            Text("\(store.inboxItems.count)")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.50))
                        }
                    } content: {
                        VStack(spacing: 0) {
                            ForEach(Array(store.inboxItems.enumerated()), id: \.element.id) { index, item in
                                HStack(spacing: 0) {
                                    if item.type == .content {
                                        Rectangle()
                                            .fill(BrettColors.cerulean)
                                            .frame(width: 3)
                                            .clipShape(RoundedRectangle(cornerRadius: 1.5))
                                            .padding(.vertical, 4)
                                    }

                                    TaskRow(item: item, onToggle: { }, onSelect: { store.selectedTaskId = item.id })
                                        .padding(.leading, item.type == .content ? 8 : 0)
                                }

                                if index < store.inboxItems.count - 1 {
                                    Divider().background(BrettColors.hairline)
                                        .padding(.horizontal, 16)
                                }
                            }
                        }
                        .padding(.bottom, 8)
                    }
                }
            }
            .padding(.bottom, 70)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .coordinateSpace(name: "scroll")
    }
}
