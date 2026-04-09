import SwiftUI

struct InboxPage: View {
    @Bindable var store: MockStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    Text("Inbox")
                        .font(BrettTypography.dateHeader)
                        .foregroundStyle(.white)

                    Text("\(store.inboxItems.count) items to triage")
                        .font(BrettTypography.stats)
                        .foregroundStyle(Color.white.opacity(0.35))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 60)

                if store.inboxItems.isEmpty {
                    EmptyState(heading: "Your inbox", copy: "Everything worth doing starts here.")
                } else {
                    // One glass card for all inbox items
                    GlassCard {
                        VStack(spacing: 0) {
                            ForEach(Array(store.inboxItems.enumerated()), id: \.element.id) { index, item in
                                HStack(spacing: 0) {
                                    // Cerulean accent for content items
                                    if item.type == .content {
                                        Rectangle()
                                            .fill(BrettColors.cerulean)
                                            .frame(width: 3)
                                            .clipShape(RoundedRectangle(cornerRadius: 1.5))
                                            .padding(.vertical, 4)
                                    }

                                    TaskRow(
                                        item: item,
                                        onToggle: { },
                                        onTap: { }
                                    )
                                    .padding(.leading, item.type == .content ? 8 : 0)
                                }

                                if index < store.inboxItems.count - 1 {
                                    Divider()
                                        .background(BrettColors.hairline)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }

                Spacer(minLength: 100)
            }
        }
        .scrollIndicators(.hidden)
    }
}
