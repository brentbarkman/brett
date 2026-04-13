import SwiftUI

struct ScoutsRosterView: View {
    @Bindable var store: MockStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            BackgroundView()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Scouts")
                            .font(BrettTypography.dateHeader)
                            .foregroundStyle(.white)

                        Text("\(store.scouts.filter { $0.status == .active }.count) active · \(store.scouts.reduce(0) { $0 + $1.findingsCount }) findings")
                            .font(BrettTypography.stats)
                            .foregroundStyle(BrettColors.textInactive)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)

                    // Scout cards
                    VStack(spacing: 12) {
                        ForEach(store.scouts) { scout in
                            NavigationLink(value: ScoutNav(id: scout.id)) {
                                ScoutCard(scout: scout)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)

                    Spacer(minLength: 20)
                }
            }
            .scrollIndicators(.hidden)
        }
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Back")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }
        }
        .navigationDestination(for: ScoutNav.self) { nav in
            ScoutDetailView(store: store, scoutId: nav.id)
        }
    }
}

// Navigation value type for scouts
struct ScoutNav: Hashable {
    let id: String
}

// MARK: - Scout Card

struct ScoutCard: View {
    let scout: MockScout

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                // Top: avatar + name + status
                HStack(spacing: 12) {
                    // Avatar — gradient circle with first letter
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: avatarGradient,
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 40, height: 40)

                        Text(String(scout.name.prefix(1)))
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(scout.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)

                        statusBadge
                    }

                    Spacer()

                    // Chevron
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrettColors.textGhost)
                }

                // Goal preview
                Text(scout.goal)
                    .font(BrettTypography.body)
                    .foregroundStyle(BrettColors.textBody)
                    .lineLimit(2)

                // Metadata row
                HStack(spacing: 12) {
                    metaItem(text: scout.lastRunAgo, icon: "clock")
                    metaItem(text: "\(scout.findingsCount) findings", icon: "sparkle")
                    metaItem(text: scout.cadence, icon: "repeat")
                }
            }
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
            Text(scout.status.rawValue.capitalized)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(statusColor)
        }
    }

    private var statusColor: Color {
        switch scout.status {
        case .active: return Color(red: 52/255, green: 211/255, blue: 153/255) // emerald
        case .paused: return BrettColors.textMeta
        case .completed: return BrettColors.textMeta
        case .expired: return BrettColors.textMeta
        }
    }

    private var avatarGradient: [Color] {
        switch scout.status {
        case .active: return [BrettColors.gold.opacity(0.6), BrettColors.cerulean.opacity(0.4)]
        case .paused: return [Color.white.opacity(0.15), Color.white.opacity(0.08)]
        default: return [Color.white.opacity(0.1), Color.white.opacity(0.05)]
        }
    }

    private func metaItem(text: String, icon: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
            Text(text)
                .font(BrettTypography.taskMeta)
        }
        .foregroundStyle(BrettColors.textMeta)
    }
}
