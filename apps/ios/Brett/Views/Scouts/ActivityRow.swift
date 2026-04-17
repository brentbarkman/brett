import SwiftUI

/// Single activity / run entry rendered as a compact row.
struct ActivityRow: View {
    let entry: APIClient.ActivityEntryDTO

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(iconColor)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 1) {
                Text(descriptionText)
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.textBody)
                    .lineLimit(2)

                Text(ActivityRow.timestamp(entry.createdAt))
                    .font(.system(size: 11))
                    .foregroundStyle(BrettColors.textMeta)
            }

            Spacer()

            if let count = entry.findingsCount, count > 0 {
                Text("\(count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BrettColors.gold)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(BrettColors.gold.opacity(0.15), in: Capsule())
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Helpers

    private var iconName: String {
        if entry.entryType == "run" {
            switch entry.status {
            case "success": return "checkmark.circle"
            case "failed": return "exclamationmark.triangle"
            case "running": return "arrow.triangle.2.circlepath"
            case "skipped": return "arrow.right.circle"
            default: return "circle"
            }
        }
        switch entry.type {
        case "created": return "sparkle"
        case "paused": return "pause.circle"
        case "resumed": return "play.circle"
        case "completed": return "checkmark.circle"
        case "config_changed": return "slider.horizontal.3"
        case "cadence_adapted": return "clock.arrow.2.circlepath"
        case "budget_alert": return "exclamationmark.circle"
        case "bootstrap_completed": return "sparkle.magnifyingglass"
        default: return "circle.fill"
        }
    }

    private var iconColor: Color {
        if entry.entryType == "run" {
            switch entry.status {
            case "success": return BrettColors.emerald
            case "failed": return BrettColors.error
            case "running": return BrettColors.cerulean
            case "skipped": return BrettColors.textMeta
            default: return BrettColors.textMeta
            }
        }
        return BrettColors.textSecondary
    }

    private var descriptionText: String {
        if entry.entryType == "run" {
            let findings = entry.findingsCount ?? 0
            switch entry.status {
            case "success":
                if findings == 0 { return "Scanned — no findings" }
                return "Scanned — \(findings) finding\(findings == 1 ? "" : "s")"
            case "failed":
                return "Run failed" + (entry.error.map { ": \($0)" } ?? "")
            case "running":
                return "Run in progress..."
            case "skipped":
                return "Run skipped"
            default:
                return "Run"
            }
        }
        return entry.description ?? "Activity"
    }

    /// Short "Apr 14, 2:15 PM" formatter — pure, exposed for tests.
    static func timestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: date)
    }
}
