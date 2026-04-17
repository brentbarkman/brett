import SwiftUI

/// A single row inside the search results list.
///
/// Layout (left → right):
///   [entity icon]  [title + snippet stacked]  [metadata badge]
///
/// Visuals follow the design guide: 16pt medium for titles, 13pt white/60
/// for snippets, gold for matched query terms. Low-score rows (< 0.5)
/// fade to 60% opacity so the stronger matches pop.
struct SearchResultRow: View {
    let result: SearchResult
    let query: String

    // MARK: - Body

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            icon
            content
            Spacer(minLength: 8)
            trailing
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .contentShape(Rectangle())
        .opacity(opacityForScore(result.score))
    }

    // MARK: - Columns

    private var icon: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(iconTint.opacity(0.15))
                .frame(width: 32, height: 32)
            Image(systemName: result.entityType.iconName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(iconTint)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 3) {
            // Title — query terms highlighted in gold.
            Text(QueryHighlighter.attributed(text: result.title, query: query))
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(BrettColors.textCardTitle)
                .lineLimit(1)

            if let snippet = result.snippet, !snippet.isEmpty {
                Text(QueryHighlighter.attributed(text: snippet, query: query))
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.textSecondary)
                    .lineLimit(2)
            }

            if let line = metadataLine {
                HStack(spacing: 6) {
                    matchIndicator
                    Text(line)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(BrettColors.textMeta)
                        .lineLimit(1)
                }
                .padding(.top, 2)
            } else {
                HStack(spacing: 6) {
                    matchIndicator
                }
                .padding(.top, 2)
            }
        }
    }

    @ViewBuilder
    private var trailing: some View {
        if let badge = trailingBadgeText {
            Text(badge)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    Capsule().fill(Color.white.opacity(0.08))
                )
        }
    }

    // MARK: - Derived values

    /// Icon tint per entity type — cerulean for anything event-/finding-
    /// related, gold for tasks, muted for notes. Keeps the row scannable.
    private var iconTint: Color {
        switch result.entityType {
        case .item: return BrettColors.gold
        case .calendarEvent: return BrettColors.cerulean
        case .meetingNote: return BrettColors.textSecondary
        case .scoutFinding: return BrettColors.emerald
        }
    }

    /// Short metadata line under the snippet — combines list, due date,
    /// and item type when available.
    private var metadataLine: String? {
        var parts: [String] = []
        if let listName = result.metadata?.listName, !listName.isEmpty {
            parts.append(listName)
        }
        if let type = result.metadata?.type, !type.isEmpty {
            parts.append(type.capitalized)
        }
        if let status = result.metadata?.status, !status.isEmpty {
            parts.append(status.capitalized)
        }
        return parts.isEmpty ? nil : parts.joined(separator: "  \u{00B7}  ")
    }

    /// The right-side badge — prefers a short due-date token if available,
    /// otherwise the entity type label.
    private var trailingBadgeText: String? {
        if let iso = result.metadata?.dueDate, let pretty = formatDueDate(iso) {
            return pretty
        }
        return result.entityType.label
    }

    /// Tiny dot + label indicator — cerulean/gold/purple per match type.
    private var matchIndicator: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(matchTypeColor)
                .frame(width: 5, height: 5)
            Text(matchTypeLabel)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(BrettColors.textGhost)
        }
    }

    private var matchTypeColor: Color {
        switch result.matchType {
        case .keyword: return BrettColors.gold
        case .semantic: return BrettColors.cerulean
        case .hybrid: return BrettColors.purple400
        case .unknown: return BrettColors.textGhost
        }
    }

    private var matchTypeLabel: String {
        switch result.matchType {
        case .keyword: return "keyword"
        case .semantic: return "semantic"
        case .hybrid: return "hybrid"
        case .unknown: return "match"
        }
    }

    /// Score → opacity mapping: ≥0.5 is fully opaque, below fades linearly to
    /// 0.6 so weak matches visually recede without becoming unreadable.
    private func opacityForScore(_ score: Double) -> Double {
        if score >= 0.5 { return 1.0 }
        // Map [0, 0.5) → [0.6, 1.0)
        let clamped = max(0, score)
        return 0.6 + (clamped / 0.5) * 0.4
    }

    /// Very lightweight ISO-date → "Apr 20" formatter. Lives here (not in
    /// a shared helper) because the server sends raw ISO strings and we
    /// only need a display string — no calendar math required.
    private func formatDueDate(_ iso: String) -> String? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        if let d = formatter.date(from: iso) {
            return Self.shortDateFormatter.string(from: d)
        }
        // Fallback: the server sometimes returns bare YYYY-MM-DD.
        let dateOnly = ISO8601DateFormatter()
        dateOnly.formatOptions = [.withFullDate]
        if let d = dateOnly.date(from: iso) {
            return Self.shortDateFormatter.string(from: d)
        }
        return nil
    }

    private static let shortDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        return f
    }()
}
