import SwiftUI

/// Dynamic Type utilities.
///
/// Brett embraces Dynamic Type — every text style scales with the user's
/// preferred content size. Some dense surfaces (task rows, calendar cells)
/// break down visually at the largest accessibility sizes because lines wrap
/// into columns and the checkbox gets pushed off-screen. The `dynamicTypeClamp`
/// modifier caps the upper bound at `.accessibility2`, which still honours the
/// user's preference while keeping the layout recognisable.

extension DynamicTypeSize {
    /// Default clamp range for rows and dense composite views.
    /// Covers `.xSmall` through `.accessibility2` — the last size where we
    /// are confident the single-line task row still reads correctly.
    static let brettClamp: ClosedRange<DynamicTypeSize> = .xSmall ... .accessibility2
}

extension ClosedRange where Bound == DynamicTypeSize {
    /// Mirror of `DynamicTypeSize.brettClamp` on the range type, so call
    /// sites where the expected type is `ClosedRange<DynamicTypeSize>`
    /// (e.g. `DynamicTypeClamp(range: .brettClamp)`) resolve the leading-dot
    /// lookup. Keeping both on purpose.
    static let brettClamp: ClosedRange<DynamicTypeSize> = DynamicTypeSize.brettClamp
}

/// Clamps `dynamicTypeSize` on its subtree to the supplied range.
/// Use this on dense rows/cards — avoid it on headlines or standalone text
/// where the full range should be honoured.
struct DynamicTypeClamp: ViewModifier {
    var range: ClosedRange<DynamicTypeSize>

    func body(content: Content) -> some View {
        content.dynamicTypeSize(range)
    }
}

extension View {
    /// Clamps dynamic type to the Brett default row range
    /// (`.xSmall ... .accessibility2`) to protect dense layouts from the
    /// largest accessibility sizes while still honouring the user's scale
    /// preference.
    func dynamicTypeClamp() -> some View {
        modifier(DynamicTypeClamp(range: .brettClamp))
    }

    /// Escape hatch for custom clamp bounds (e.g. a page header that can
    /// tolerate slightly more growth).
    func dynamicTypeClamp(_ range: ClosedRange<DynamicTypeSize>) -> some View {
        modifier(DynamicTypeClamp(range: range))
    }
}

// MARK: - Font helpers

extension Font {
    /// Body text scaled via `UIFontMetrics` but starting from the Brett base
    /// 15pt size. Most existing Brett typography is custom (`BrettTypography`)
    /// and already Dynamic-Type-aware; this is a convenience for new surfaces.
    static var brettBody: Font {
        .system(.body, design: .default)
    }

    /// Footnote text that participates in Dynamic Type while keeping a
    /// slightly tighter baseline than `.body`.
    static var brettFootnote: Font {
        .system(.footnote, design: .default)
    }
}
