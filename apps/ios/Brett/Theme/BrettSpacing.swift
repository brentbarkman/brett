import Foundation
import SwiftUI

/// Shared spacing + sizing scale for the Brett iOS app.
///
/// Before this existed, pages used scattered literals like
/// `.padding(.horizontal, 20)` / `.padding(.bottom, 70)` / `spacing: 12`
/// without a common vocabulary. Changing a visual rhythm across the app
/// required finding all the magic numbers manually. `BrettColors` and
/// `BrettTypography` already centralise colour + text scales; this file
/// closes the loop for layout values.
///
/// Usage:
/// ```swift
/// .padding(.horizontal, BrettSpacing.pagePaddingX)
/// .padding(.bottom, BrettSpacing.omnibarClearance)
/// VStack(spacing: BrettSpacing.md) { … }
/// ```
///
/// Adoption is being rolled out incrementally — older files still use
/// literals; new or actively-edited files should convert. A later pass
/// can find-and-replace the remaining call sites.
enum BrettSpacing {
    // MARK: - Generic scale

    /// 4pt — hairline vertical gap inside a single-line row.
    static let xs: CGFloat = 4
    /// 8pt — baseline gap between closely-related elements.
    static let sm: CGFloat = 8
    /// 12pt — default inter-element spacing inside a card.
    static let md: CGFloat = 12
    /// 16pt — default page horizontal padding; ships as the card margin.
    static let lg: CGFloat = 16
    /// 20pt — header-level horizontal padding (date label, section copy).
    static let xl: CGFloat = 20
    /// 24pt — inter-section spacing on a long scroll page.
    static let xxl: CGFloat = 24
    /// 32pt — hero spacing around empty-state copy.
    static let xxxl: CGFloat = 32

    // MARK: - Purpose-specific

    /// Horizontal padding for page headers (Today/Inbox/Calendar date + subtitle).
    static let pagePaddingX: CGFloat = xl

    /// Horizontal padding for card content (inboxCard, TaskSection).
    static let cardPaddingX: CGFloat = lg

    /// Minimum bottom padding on every page's scroll content so the pinned
    /// omnibar doesn't cover the last row. Matches the omnibar's intrinsic
    /// height + a breathing gap; update here if the omnibar chrome changes.
    static let omnibarClearance: CGFloat = 70

    /// When a page also has a floating "+" FAB (ListsPage, ScoutsRoster),
    /// we need more room so neither the omnibar nor the FAB covers content.
    static let fabClearance: CGFloat = 140

    /// Default corner radius on glass cards / rows.
    static let cornerRadiusCard: CGFloat = 12

    /// StickyCardSection's header height — exported so callers that
    /// offset above/below the sticky header can use the canonical value
    /// instead of re-measuring.
    static let stickyHeaderHeight: CGFloat = 38

    /// Minimum hit target per Apple HIG (also the baseline for our own
    /// touch targets: checkboxes, pill buttons, etc.).
    static let minTapTarget: CGFloat = 44
}
