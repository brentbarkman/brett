import SwiftUI

/// Glass card used on the scout roster. Self-contained renderer for a single
/// `Scout` — no store dependencies so it's cheap to preview and drop into a
/// grid. Reads the SwiftData row directly so the roster reactively reflects
/// upsertLocal writes from the API refresh path.
struct ScoutCard: View {
    let scout: Scout

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                // Row 1: avatar + name + status dot
                HStack(spacing: 10) {
                    ScoutAvatar(
                        letter: scout.avatarLetter,
                        gradient: scout.avatarGradient,
                        diameter: 32,
                        showGlow: scout.status == "active"
                    )

                    VStack(alignment: .leading, spacing: 2) {
                        Text(scout.name)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(.white)
                            .lineLimit(1)

                        Text(scout.sensitivity.capitalized)
                            .font(.system(size: 10, weight: .regular))
                            .foregroundStyle(BrettColors.textMeta)
                    }

                    Spacer(minLength: 4)

                    StatusDot(status: scout.status)
                }

                // Row 2: statusLine + findings badge
                HStack(spacing: 8) {
                    Text(scout.statusLine ?? "Watching...")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.white.opacity(0.40))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    findingsBadge
                }

                // Budget progress bar
                budgetBar
            }
        }
    }

    @ViewBuilder
    private var findingsBadge: some View {
        let count = scout.findingsCount
        if count > 0 {
            HStack(spacing: 3) {
                Image(systemName: "sparkle")
                    .font(.system(size: 9, weight: .semibold))
                Text("\(count)")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(BrettColors.gold)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(BrettColors.gold.opacity(0.15), in: Capsule())
        }
    }

    @ViewBuilder
    private var budgetBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 2)

                RoundedRectangle(cornerRadius: 1)
                    .fill(BrettColors.gold)
                    .frame(
                        width: geo.size.width * ScoutCard.budgetFraction(
                            used: scout.budgetUsed,
                            total: scout.budgetTotal
                        ),
                        height: 2
                    )
            }
        }
        .frame(height: 2)
    }

    /// Pure helper — exposed for tests.
    static func budgetFraction(used: Int, total: Int) -> CGFloat {
        guard total > 0 else { return 0 }
        let raw = CGFloat(used) / CGFloat(total)
        return max(0, min(1, raw))
    }
}

// MARK: - Supporting views

/// Gradient circle with a letter — used at multiple sizes across the scouts UI.
struct ScoutAvatar: View {
    let letter: String
    let gradient: [String]
    var diameter: CGFloat = 32
    var showGlow: Bool = false

    var body: some View {
        ZStack {
            if showGlow {
                Circle()
                    .fill(BrettColors.gold.opacity(0.15))
                    .frame(width: diameter * 1.35, height: diameter * 1.35)
                    .blur(radius: 10)
            }
            Circle()
                .fill(
                    LinearGradient(
                        colors: resolvedColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: diameter, height: diameter)

            Text(letter.isEmpty ? "?" : letter.uppercased())
                .font(.system(size: diameter * 0.45, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private var resolvedColors: [Color] {
        let parsed = gradient.compactMap { BrettColors.fromHex($0) }
        if parsed.count >= 2 { return parsed }
        if parsed.count == 1 { return [parsed[0], parsed[0].opacity(0.6)] }
        return [BrettColors.gold.opacity(0.6), BrettColors.cerulean.opacity(0.4)]
    }
}

/// Small colored dot representing scout status. Pure color mapping.
struct StatusDot: View {
    let status: String

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
    }

    private var color: Color {
        switch status {
        case "active": return BrettColors.emerald
        case "paused": return BrettColors.textInactive
        case "completed", "expired", "archived": return BrettColors.textMeta
        default: return BrettColors.textMeta
        }
    }
}
