import SwiftUI

/// Single memory entry. Type badge + markdown-ish content text with a swipe
/// action that invokes `onDelete`. Kept tiny — memories are a list component.
struct MemoryCard: View {
    let memory: APIClient.MemoryDTO
    let onDelete: (() -> Void)?

    init(memory: APIClient.MemoryDTO, onDelete: (() -> Void)? = nil) {
        self.memory = memory
        self.onDelete = onDelete
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            typeBadge

            VStack(alignment: .leading, spacing: 4) {
                Text(LocalizedStringKey(memory.content))
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.textBody)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    Text("\(Int((memory.confidence * 100).rounded()))% confident")
                        .font(.system(size: 10))
                        .foregroundStyle(BrettColors.textMeta)

                    Text(MemoryCard.relative(memory.updatedAt))
                        .font(.system(size: 10))
                        .foregroundStyle(BrettColors.textMeta)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .swipeActions(edge: .trailing) {
            if let onDelete {
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    @ViewBuilder
    private var typeBadge: some View {
        Text(memory.type.prefix(1).uppercased())
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(badgeForeground)
            .frame(width: 20, height: 20)
            .background(badgeBackground.opacity(0.2), in: Circle())
    }

    private var badgeForeground: Color {
        switch memory.type {
        case "factual": return BrettColors.cerulean
        case "judgment": return BrettColors.gold
        case "pattern": return BrettColors.purple400
        default: return BrettColors.textMeta
        }
    }

    private var badgeBackground: Color { badgeForeground }

    static func relative(_ date: Date, now: Date = Date()) -> String {
        let interval = now.timeIntervalSince(date)
        let days = Int(interval / 86400)
        if days < 1 { return "today" }
        if days == 1 { return "1d ago" }
        if days < 30 { return "\(days)d ago" }
        return "\(days / 30)mo ago"
    }
}
