import SwiftUI

enum BrettTypography {
    // Headers
    static let dateHeader: Font = .system(size: 28, weight: .bold)
    static let sectionTitle: Font = .system(size: 18, weight: .semibold)

    // Section labels — signature pattern: 10pt uppercase tracked semibold at white/40
    // NEVER deviate from this. Use with .tracking(2.4) and .foregroundStyle(white/40)
    static let sectionLabel: Font = .system(size: 10, weight: .semibold)

    // Content
    static let taskTitle: Font = .system(size: 15, weight: .medium)       // Card titles at white/90
    static let taskMeta: Font = .system(size: 12, weight: .regular)       // Metadata at white/40
    static let body: Font = .system(size: 14, weight: .regular)           // Body text at white/80
    static let stats: Font = .system(size: 13, weight: .regular)          // Page subtitles at white/50

    // Omnibar
    static let omnibarPlaceholder: Font = .system(size: 15, weight: .regular)

    // Empty states
    static let emptyHeading: Font = .system(size: 26, weight: .bold)
    static let emptyCopy: Font = .system(size: 15, weight: .regular)

    // Detail
    static let detailTitle: Font = .system(size: 22, weight: .semibold)

    // Badge/pill
    static let badge: Font = .system(size: 12, weight: .medium)
    static let badgeSmall: Font = .system(size: 10, weight: .bold)
}
