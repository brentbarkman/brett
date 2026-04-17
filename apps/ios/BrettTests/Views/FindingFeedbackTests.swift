import Testing
import Foundation
@testable import Brett

/// Tests for the feedback state-machine used by FindingCard.
///
/// The three-state model:
/// - nil     → no feedback (ignored)
/// - true    → useful
/// - false   → not useful
///
/// UI invariant: tapping the same state again clears feedback (→ nil).
/// Tapping the opposite state flips directly.
///
/// We can't easily test SwiftUI tap handlers in isolation, so we model the
/// transition function as a pure helper and assert on it.
@Suite("FindingFeedback", .tags(.views))
@MainActor
struct FindingFeedbackTests {

    /// Pure transition function. Given the current feedback state and the
    /// user's intended new value (what button they tapped), returns the next
    /// state. Used to validate the tap semantics of `FindingCard`.
    static func next(current: Bool?, tapped: Bool?) -> Bool? {
        // Tapping "ignore" always clears.
        if tapped == nil { return nil }
        // Tapping the same thumb again clears.
        if current == tapped { return nil }
        // Otherwise set.
        return tapped
    }

    // MARK: - Transitions

    @Test func nilToUseful() {
        #expect(Self.next(current: nil, tapped: true) == true)
    }

    @Test func usefulTappedAgainClears() {
        #expect(Self.next(current: true, tapped: true) == nil)
    }

    @Test func usefulFlipsToNotUseful() {
        #expect(Self.next(current: true, tapped: false) == false)
    }

    @Test func notUsefulTappedAgainClears() {
        #expect(Self.next(current: false, tapped: false) == nil)
    }

    @Test func ignoreAlwaysClears() {
        #expect(Self.next(current: true, tapped: nil) == nil)
        #expect(Self.next(current: false, tapped: nil) == nil)
        #expect(Self.next(current: nil, tapped: nil) == nil)
    }

    // MARK: - Sequence: null → true → null → false → null → false → null

    @Test func cycleThroughAllStates() {
        var state: Bool? = nil
        state = Self.next(current: state, tapped: true)
        #expect(state == true)

        state = Self.next(current: state, tapped: true)
        #expect(state == nil)

        state = Self.next(current: state, tapped: false)
        #expect(state == false)

        state = Self.next(current: state, tapped: false)
        #expect(state == nil)

        state = Self.next(current: state, tapped: false)
        #expect(state == false)

        state = Self.next(current: state, tapped: nil)
        #expect(state == nil)
    }

    // MARK: - DTO decoding sanity

    @Test func findingFeedbackResponseDecodesTrue() throws {
        let json = """
        {"id":"f1","feedbackUseful":true,"feedbackAt":"2026-04-14T10:00:00.000Z"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(APIClient.FindingFeedbackResponse.self, from: Data(json.utf8))
        #expect(decoded.id == "f1")
        #expect(decoded.feedbackUseful == true)
        #expect(decoded.feedbackAt != nil)
    }

    @Test func findingFeedbackResponseDecodesNull() throws {
        let json = """
        {"id":"f1","feedbackUseful":null,"feedbackAt":null}
        """
        let decoded = try JSONDecoder().decode(APIClient.FindingFeedbackResponse.self, from: Data(json.utf8))
        #expect(decoded.feedbackUseful == nil)
        #expect(decoded.feedbackAt == nil)
    }
}
