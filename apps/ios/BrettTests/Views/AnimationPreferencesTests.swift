import Foundation
import Testing
import SwiftUI
@testable import Brett

/// Guards the contract of ``BrettAnimation`` — the centralized motion
/// tokens that every screen reads from. When we break Reduce Motion support
/// or lose a named preset, the visual regression is subtle enough that
/// unit tests are our first line of defense.
@Suite("Animation preferences", .tags(.views))
@MainActor
struct AnimationPreferencesTests {

    // MARK: - Reduce motion gating

    @Test("respectingReduceMotion returns nil when Reduce Motion is enabled")
    func respectsReduceMotionWhenEnabled() {
        // We can't easily flip the real UIAccessibility flag from a unit
        // test, but we can assert the branch that matters: if the getter
        // reports `true`, callers must receive `nil`.
        //
        // The logic is small enough that we re-check it here inline against
        // the public getter. On a test host where Reduce Motion is off we
        // confirm the animation is passed through; when on, we confirm nil.
        let animation = BrettAnimation.springBouncy

        if BrettAnimation.isReduceMotionEnabled {
            #expect(BrettAnimation.respectingReduceMotion(animation) == nil)
        } else {
            // Passing through should not return nil — we got back some
            // animation value. SwiftUI `Animation` doesn't conform to
            // Equatable, so we check for non-nil only.
            #expect(BrettAnimation.respectingReduceMotion(animation) != nil)
        }
    }

    @Test("respectingReduceMotion is pure — repeated calls return nil/non-nil consistently")
    func respectsReduceMotionIsStable() {
        let animation = BrettAnimation.standard
        let first = BrettAnimation.respectingReduceMotion(animation)
        let second = BrettAnimation.respectingReduceMotion(animation)
        // Both should be simultaneously nil or simultaneously non-nil.
        #expect((first == nil) == (second == nil))
    }

    // MARK: - Token presence

    @Test("All named motion tokens are present and non-nil")
    func allTokensPresent() {
        // These are value-type constants, so existence is all we verify.
        // The compiler already protects us from typos at the call site —
        // this suite exists to document the contract.
        _ = BrettAnimation.quick
        _ = BrettAnimation.standard
        _ = BrettAnimation.slow
        _ = BrettAnimation.springBouncy
        _ = BrettAnimation.springCalm
        _ = BrettAnimation.springFirm
        _ = BrettAnimation.pageTransition
        _ = BrettAnimation.completionCascade
    }

    @Test("isReduceMotionEnabled reflects a Bool")
    func isReduceMotionEnabledIsBool() {
        // Just confirm the accessor compiles as Bool and can be read from
        // the test target (i.e. it isn't gated behind UIKit-only visibility).
        let value: Bool = BrettAnimation.isReduceMotionEnabled
        #expect(value == true || value == false)
    }
}
