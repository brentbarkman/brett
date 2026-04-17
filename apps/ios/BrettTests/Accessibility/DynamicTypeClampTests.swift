import Testing
import Foundation
import SwiftUI
@testable import Brett

/// The clamp modifier itself is just a wrapper around
/// `.dynamicTypeSize(range:)` — what we actually care about is the range
/// constant: `.xSmall ... .accessibility2`. These tests lock those bounds so
/// an accidental widening (e.g. to `.accessibility5`) doesn't break layouts
/// silently.
@Suite("Dynamic type clamp", .tags(.accessibility))
struct DynamicTypeClampTests {
    // The clamp constant lives on `ClosedRange<DynamicTypeSize>`, not on
    // `DynamicTypeSize` itself — it's a value of the range type, not a static
    // member on the enum. Use a local typealias to keep the assertions
    // readable without repeating the generic bound.
    private typealias Range = ClosedRange<DynamicTypeSize>

    @Test func clampLowerBoundIsXSmall() {
        #expect(Range.brettClamp.lowerBound == .xSmall)
    }

    @Test func clampUpperBoundIsAccessibility2() {
        #expect(Range.brettClamp.upperBound == .accessibility2)
    }

    @Test func clampContainsEverydaySizes() {
        // Everyday sizes must sit inside the clamp.
        #expect(Range.brettClamp.contains(.large))
        #expect(Range.brettClamp.contains(.xxLarge))
        // Accessibility1 and Accessibility2 are allowed.
        #expect(Range.brettClamp.contains(.accessibility1))
        #expect(Range.brettClamp.contains(.accessibility2))
    }

    @Test func clampExcludesExtremes() {
        // We intentionally clamp out the top 3 accessibility sizes because
        // the task row collapses visually at those sizes.
        #expect(!Range.brettClamp.contains(.accessibility3))
        #expect(!Range.brettClamp.contains(.accessibility4))
        #expect(!Range.brettClamp.contains(.accessibility5))
    }
}
