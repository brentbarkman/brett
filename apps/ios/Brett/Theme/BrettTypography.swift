import SwiftUI

enum BrettTypography {
    // Headers
    static let dateHeader: Font = .system(size: 28, weight: .bold)
    static let sectionTitle: Font = .system(size: 18, weight: .semibold)

    // Labels
    static let sectionLabel: Font = .system(size: 11, weight: .semibold).uppercaseSmallCaps()

    // Content
    static let taskTitle: Font = .system(size: 16, weight: .medium)
    static let taskMeta: Font = .system(size: 12, weight: .regular)
    static let body: Font = .system(size: 14, weight: .regular)
    static let stats: Font = .system(size: 13, weight: .regular)

    // Omnibar
    static let omnibarPlaceholder: Font = .system(size: 16, weight: .regular)

    // Empty states
    static let emptyHeading: Font = .system(size: 26, weight: .bold)
    static let emptyCopy: Font = .system(size: 15, weight: .regular)

    // Detail
    static let detailTitle: Font = .system(size: 22, weight: .semibold)
}
