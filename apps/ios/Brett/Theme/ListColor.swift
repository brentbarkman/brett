import SwiftUI

/// The canonical palette of list accent colors.
///
/// Raw values mirror the Tailwind `colorClass` strings the API stores
/// (see `packages/business/src/index.ts` → `COLOR_MAP` / `COLOR_SWATCHES`).
/// Keeping the raw value in sync means a list created on desktop and a list
/// created on iOS round-trip through the server with the same identifier.
///
/// `Cerulean` is Brett-branded and reserved for AI-related lists.
enum ListColor: String, CaseIterable, Identifiable {
    case slate = "bg-slate-400"
    case blue = "bg-blue-400"
    case sky = "bg-sky-400"
    case emerald = "bg-emerald-400"
    case amber = "bg-amber-400"
    case orange = "bg-orange-400"
    case rose = "bg-rose-400"
    case violet = "bg-violet-400"
    case cerulean = "bg-cerulean"

    var id: String { rawValue }

    /// The SwiftUI `Color` used for the dot/swatch rendering. Values match the
    /// hex codes in `COLOR_MAP` from the business package.
    var swiftUIColor: Color {
        switch self {
        case .slate:    return Color(red: 148/255, green: 163/255, blue: 184/255) // #94a3b8
        case .blue:     return Color(red: 96/255,  green: 165/255, blue: 250/255) // #60a5fa
        case .sky:      return Color(red: 56/255,  green: 189/255, blue: 248/255) // #38bdf8
        case .emerald:  return Color(red: 52/255,  green: 211/255, blue: 153/255) // #34d399
        case .amber:    return Color(red: 251/255, green: 191/255, blue: 36/255)  // #fbbf24
        case .orange:   return Color(red: 251/255, green: 146/255, blue: 60/255)  // #fb923c
        case .rose:     return Color(red: 251/255, green: 113/255, blue: 133/255) // #fb7185
        case .violet:   return Color(red: 167/255, green: 139/255, blue: 250/255) // #a78bfa
        case .cerulean: return BrettColors.cerulean
        }
    }

    /// Accessible display name shown in pickers and VoiceOver.
    var displayName: String {
        switch self {
        case .slate:    return "Slate"
        case .blue:     return "Blue"
        case .sky:      return "Sky"
        case .emerald:  return "Emerald"
        case .amber:    return "Amber"
        case .orange:   return "Orange"
        case .rose:     return "Rose"
        case .violet:   return "Violet"
        case .cerulean: return "Cerulean"
        }
    }

    /// Parses a `colorClass` string. Accepts current-palette values plus a
    /// few legacy codes still in the DB so older lists render with a
    /// reasonable dot instead of falling back to gray.
    init?(colorClass: String) {
        if let direct = ListColor(rawValue: colorClass) {
            self = direct
            return
        }

        switch colorClass {
        case "bg-gray-500":   self = .slate
        case "bg-blue-500":   self = .blue
        case "bg-green-500":  self = .emerald
        case "bg-purple-500", "bg-violet-500": self = .violet
        case "bg-amber-500":  self = .amber
        case "bg-orange-500": self = .orange
        case "bg-red-500":    self = .rose
        case "bg-pink-500":   self = .rose
        case "bg-cyan-500":   self = .sky
        case "bg-brett-teal", "bg-cerulean-400": self = .cerulean
        default: return nil
        }
    }

    /// Default choice used when a list is created without a color (matches
    /// the Prisma default `bg-gray-500` coerced to slate).
    static var `default`: ListColor { .slate }

    /// Swatches exposed in the color picker UI (no duplicates).
    static var pickerSwatches: [ListColor] {
        [.slate, .blue, .sky, .emerald, .amber, .orange, .rose, .violet, .cerulean]
    }
}
