import SwiftUI

enum BrettColors {
    // Brand
    static let gold = Color(red: 232/255, green: 185/255, blue: 49/255)       // #E8B931
    static let cerulean = Color(red: 70/255, green: 130/255, blue: 195/255)   // #4682C3

    // Semantic
    static let success = Color(red: 72/255, green: 187/255, blue: 160/255)    // #48BBA0 (teal)
    static let error = Color(red: 230/255, green: 85/255, blue: 75/255)       // #E6554B

    // Text opacity scale — matches design guide exactly
    // Only use standard stops: /20, /30, /40, /50, /60, /80, /90, white
    static let textHeading = Color.white                    // Primary headings, active nav
    static let textCardTitle = Color.white.opacity(0.90)    // Card titles, emphasized
    static let textBody = Color.white.opacity(0.80)         // Standard body text
    static let textSecondary = Color.white.opacity(0.60)    // Metadata values
    static let textInactive = Color.white.opacity(0.50)     // Unselected nav, page subtitles
    static let textMeta = Color.white.opacity(0.40)         // Section labels, timestamps, list+source
    static let textPlaceholder = Color.white.opacity(0.30)  // Input placeholders
    static let textGhost = Color.white.opacity(0.20)        // Unfocused icons, decorative

    // Legacy aliases (for existing code — migrate to above)
    static let textPrimary = textCardTitle
    static let textTertiary = textMeta

    // Borders — design guide standard stops
    static let cardBorder = Color.white.opacity(0.10)       // Default card/divider borders
    static let hairline = Color.white.opacity(0.05)         // Very subtle grid lines

    // Section label color — always white/40
    static let sectionLabelColor = Color.white.opacity(0.40)

    // Emerald (scout active status, positive feedback) — matches Tailwind emerald-400
    static let emerald = Color(red: 52/255, green: 211/255, blue: 153/255)     // #34D399

    // Finding type colors — match desktop exactly
    static let purple400 = Color(red: 192/255, green: 132/255, blue: 252/255)  // #C084FC
    static let amber400 = Color(red: 251/255, green: 191/255, blue: 36/255)    // #FBBF24

    // Brett AI surfaces — cerulean tints
    static let ceruleanLabel = cerulean.opacity(0.60)

    // Background opacity stops for tints — standard stops only
    // bg-{color}/5, /10, /15, /20, /30
    // Never use non-standard values like /8, /12, /25

    /// Initialize Color from hex string (e.g. "#3B82F6" or "3B82F6")
    static func fromHex(_ hex: String) -> Color? {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        switch hex.count {
        case 6:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            return nil
        }
        return Color(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }
}
