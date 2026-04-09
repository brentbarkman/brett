import SwiftUI

enum BrettColors {
    // Brand
    static let gold = Color(red: 232/255, green: 185/255, blue: 49/255)       // #E8B931
    static let cerulean = Color(red: 70/255, green: 130/255, blue: 195/255)   // #4682C3

    // Semantic
    static let success = Color(red: 72/255, green: 187/255, blue: 160/255)    // #48BBA0
    static let error = Color(red: 230/255, green: 85/255, blue: 75/255)       // #E6554B

    // Text (white at varying opacity)
    static let textPrimary = Color.white.opacity(0.85)
    static let textSecondary = Color.white.opacity(0.40)
    static let textTertiary = Color.white.opacity(0.25)
    static let textGhost = Color.white.opacity(0.15)

    // Surfaces
    static let hairline = Color.white.opacity(0.05)
    static let cardBorder = Color.white.opacity(0.08)

    // Section label variants
    static let goldLabel = gold.opacity(0.50)
    static let ceruleanLabel = cerulean.opacity(0.60)

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
