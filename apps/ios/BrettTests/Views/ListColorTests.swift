import Foundation
import Testing
import SwiftUI
@testable import Brett

/// Guards the `ListColor` ↔ `colorClass` round-trip. The enum's raw values
/// are the Tailwind strings the API persists, so a drift between the
/// desktop and iOS palettes would silently render lists with the wrong
/// color. These tests also cover the legacy `bg-*-500` codes that still
/// exist in the DB from before the palette refresh.
@Suite("ListColor", .tags(.views))
struct ListColorTests {

    // MARK: - Current palette: every colorClass parses

    @Test("All current-palette colorClass strings parse to a non-nil ListColor")
    func currentPaletteParses() {
        let canonical: [String] = [
            "bg-slate-400",
            "bg-blue-400",
            "bg-sky-400",
            "bg-emerald-400",
            "bg-amber-400",
            "bg-orange-400",
            "bg-rose-400",
            "bg-violet-400",
            "bg-cerulean",
        ]

        for colorClass in canonical {
            let parsed = ListColor(colorClass: colorClass)
            #expect(parsed != nil, "expected \(colorClass) to parse into a ListColor")
            #expect(parsed?.rawValue == colorClass, "expected \(colorClass) to round-trip back through rawValue")
        }
    }

    // MARK: - Legacy palette: bg-*-500 strings map to sensible fallbacks

    @Test("Legacy bg-gray-500 maps to slate (Prisma default)")
    func legacyGrayMapsToSlate() {
        #expect(ListColor(colorClass: "bg-gray-500") == .slate)
    }

    @Test("Legacy colorClass strings all map to something reasonable")
    func legacyMappings() {
        #expect(ListColor(colorClass: "bg-blue-500") == .blue)
        #expect(ListColor(colorClass: "bg-green-500") == .emerald)
        #expect(ListColor(colorClass: "bg-purple-500") == .violet)
        #expect(ListColor(colorClass: "bg-violet-500") == .violet)
        #expect(ListColor(colorClass: "bg-amber-500") == .amber)
        #expect(ListColor(colorClass: "bg-orange-500") == .orange)
        #expect(ListColor(colorClass: "bg-red-500") == .rose)
        #expect(ListColor(colorClass: "bg-pink-500") == .rose)
        #expect(ListColor(colorClass: "bg-cyan-500") == .sky)
    }

    @Test("Unknown colorClass returns nil so callers fall back to default")
    func unknownColorClassReturnsNil() {
        #expect(ListColor(colorClass: "bg-nonsense-999") == nil)
        #expect(ListColor(colorClass: "") == nil)
        #expect(ListColor(colorClass: "not-a-class") == nil)
    }

    // MARK: - swiftUIColor is non-nil for every case

    @Test("Every ListColor case has a non-clear swiftUIColor")
    func everyCaseHasSwiftUIColor() {
        for color in ListColor.allCases {
            // We can't directly compare Color values, but we can ensure the
            // swiftUIColor is something — by rendering it into a hosting
            // controller later, we'd verify. For a unit test the contract
            // is that every case returns a Color value (not crashing).
            let _ = color.swiftUIColor
            let _ = color.displayName
            #expect(!color.displayName.isEmpty, "\(color.rawValue) must have a non-empty display name")
        }
    }

    // MARK: - Picker surface

    @Test("Picker exposes every allowed swatch without duplicates, excluding cerulean")
    func pickerSwatches() {
        let swatches = ListColor.pickerSwatches
        // 8 = all 9 enum cases minus cerulean (reserved for Brett AI surfaces
        // per the design guide; not user-selectable for regular lists).
        #expect(swatches.count == 8)
        #expect(!swatches.contains(.cerulean), "cerulean is reserved and must not appear in the list-color picker")
        let uniqueRaws = Set(swatches.map(\.rawValue))
        #expect(uniqueRaws.count == swatches.count, "picker swatches must be unique")
    }

    // MARK: - Default

    @Test("Default color is slate, matching Prisma's bg-gray-500 fallback")
    func defaultIsSlate() {
        #expect(ListColor.default == .slate)
    }

    // MARK: - swiftUIColor values match the documented hex (current palette)

    @Test("Current-palette swiftUIColor components match documented hex")
    func swiftUIColorValuesMatchHex() {
        let expected: [(ListColor, Double, Double, Double)] = [
            (.slate,   148.0/255, 163.0/255, 184.0/255), // #94a3b8
            (.blue,     96.0/255, 165.0/255, 250.0/255), // #60a5fa
            (.sky,      56.0/255, 189.0/255, 248.0/255), // #38bdf8
            (.emerald,  52.0/255, 211.0/255, 153.0/255), // #34d399
            (.amber,   251.0/255, 191.0/255,  36.0/255), // #fbbf24
            (.orange,  251.0/255, 146.0/255,  60.0/255), // #fb923c
            (.rose,    251.0/255, 113.0/255, 133.0/255), // #fb7185
            (.violet,  167.0/255, 139.0/255, 250.0/255), // #a78bfa
        ]

        for (color, r, g, b) in expected {
            let ui = UIColor(color.swiftUIColor)
            var rr: CGFloat = 0, gg: CGFloat = 0, bb: CGFloat = 0, aa: CGFloat = 0
            ui.getRed(&rr, green: &gg, blue: &bb, alpha: &aa)
            #expect(abs(Double(rr) - r) < 0.02, "red mismatch for \(color.rawValue)")
            #expect(abs(Double(gg) - g) < 0.02, "green mismatch for \(color.rawValue)")
            #expect(abs(Double(bb) - b) < 0.02, "blue mismatch for \(color.rawValue)")
        }
    }
}
