import SwiftUI

/// Single scout finding card. Renders the finding's type badge, title,
/// snippet, source link, AI reasoning (cerulean italic quote) and a feedback
/// action row.
///
/// Feedback UX: inline three-state toggle (useful / not useful / ignore).
/// Tapping the already-active state clears feedback (back to null). We use
/// optimistic local state so taps feel instant — the caller is responsible
/// for reverting `feedback` if the network call throws.
struct FindingCard: View {
    let finding: APIClient.FindingDTO
    let feedback: Bool?
    let onFeedback: (Bool?) -> Void
    let onOpen: (() -> Void)?

    init(
        finding: APIClient.FindingDTO,
        feedback: Bool? = nil,
        onFeedback: @escaping (Bool?) -> Void = { _ in },
        onOpen: (() -> Void)? = nil
    ) {
        self.finding = finding
        self.feedback = feedback
        self.onFeedback = onFeedback
        self.onOpen = onOpen
    }

    var body: some View {
        GlassCard(tint: tintColor) {
            VStack(alignment: .leading, spacing: 10) {
                // Header
                HStack(spacing: 8) {
                    typeBadge
                    Spacer()
                    Text(FindingCard.relative(finding.createdAt))
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }

                // Title + body
                VStack(alignment: .leading, spacing: 6) {
                    Text(finding.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(BrettColors.textCardTitle)

                    Text(finding.description)
                        .font(.system(size: 14))
                        .foregroundStyle(BrettColors.textBody)
                        .lineLimit(4)

                    if let sourceUrl = finding.sourceUrl {
                        Link(destination: urlOrFallback(sourceUrl)) {
                            HStack(spacing: 4) {
                                Image(systemName: "link")
                                    .font(.system(size: 10))
                                Text(finding.sourceName)
                                    .font(.system(size: 12))
                                    .lineLimit(1)
                            }
                            .foregroundStyle(BrettColors.cerulean)
                        }
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "link")
                                .font(.system(size: 10))
                            Text(finding.sourceName)
                                .font(.system(size: 12))
                        }
                        .foregroundStyle(BrettColors.textMeta)
                    }
                }

                // Reasoning — italic cerulean quote
                if !finding.reasoning.isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Rectangle()
                            .fill(BrettColors.cerulean.opacity(0.5))
                            .frame(width: 2)
                        Text(finding.reasoning)
                            .font(.system(size: 12, weight: .regular).italic())
                            .foregroundStyle(BrettColors.cerulean.opacity(0.8))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 4)
                }

                // Feedback row
                feedbackRow
            }
            .contentShape(Rectangle())
            .onTapGesture {
                onOpen?()
            }
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var typeBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: iconName)
                .font(.system(size: 10, weight: .semibold))
            Text(finding.type.capitalized)
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(tintColor)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tintColor.opacity(0.15), in: Capsule())
    }

    @ViewBuilder
    private var feedbackRow: some View {
        HStack(spacing: 8) {
            feedbackButton(
                icon: "hand.thumbsup.fill",
                label: "Useful",
                active: feedback == true,
                activeColor: BrettColors.emerald,
                action: { onFeedback(feedback == true ? nil : true) }
            )

            feedbackButton(
                icon: "hand.thumbsdown.fill",
                label: "Not useful",
                active: feedback == false,
                activeColor: BrettColors.error,
                action: { onFeedback(feedback == false ? nil : false) }
            )

            Spacer()

            Button {
                onFeedback(nil)
            } label: {
                Text("Ignore")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(BrettColors.textMeta)
            }
            .buttonStyle(.plain)
        }
    }

    private func feedbackButton(
        icon: String,
        label: String,
        active: Bool,
        activeColor: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                Text(label)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(active ? activeColor : BrettColors.textMeta)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                (active ? activeColor.opacity(0.15) : Color.white.opacity(0.05)),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private var tintColor: Color {
        switch finding.type {
        case "insight": return BrettColors.purple400
        case "article": return BrettColors.gold
        case "task": return BrettColors.amber400
        default: return BrettColors.textMeta
        }
    }

    private var iconName: String {
        switch finding.type {
        case "insight": return "bolt.fill"
        case "article": return "doc.text"
        case "task": return "checkmark.circle"
        default: return "sparkle"
        }
    }

    private func urlOrFallback(_ raw: String) -> URL {
        URL(string: raw) ?? URL(string: "about:blank")!
    }

    /// "3m", "2h", "4d" — short relative formatting. Pure, exposed for tests.
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let interval = now.timeIntervalSince(date)
        let minutes = Int(interval / 60)
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 30 { return "\(days)d" }
        let months = days / 30
        return "\(months)mo"
    }
}
