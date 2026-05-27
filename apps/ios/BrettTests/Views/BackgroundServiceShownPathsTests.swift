import Foundation
import Testing
@testable import Brett

/// Coverage for the per-slot shown-paths persistence that makes the
/// wallpaper picker actually feel non-repeating across cold launches.
///
/// Pre-persistence, the picker reset its exclude set on every process
/// start, so every short-session app open was a uniform draw from a
/// 2–4 image pool — and `light-1` showed up roughly every fourth open,
/// which read as bias to the user. With persistence, the no-repeat
/// behaviour survives launches: the slot has to be fully exhausted
/// before any image repeats.
///
/// These tests pin the static load/save/clear helpers (the mechanism
/// the instance code is wired into). End-to-end coverage of the
/// instance-level picker behaviour lives in `BackgroundService`'s
/// `currentImageURL`, which is harder to exercise in isolation
/// because it requires a loaded manifest and storage base URL —
/// neither of which has a public test seam today.
@Suite("BackgroundServiceShownPaths", .tags(.views))
struct BackgroundServiceShownPathsTests {

    /// Each test gets its own UserDefaults suite so they don't share
    /// state with `.standard` or with each other. Returns the suite
    /// and a teardown closure that removes the persisted blob — the
    /// suite itself sticks around (Foundation doesn't expose a clean
    /// "destroy suite" API), but the key is cleared so re-runs with
    /// the same suite name start fresh.
    private func isolatedDefaults() -> (UserDefaults, () -> Void) {
        let name = "BackgroundServiceShownPathsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        let teardown = {
            BackgroundService.clearShownPaths(defaults: defaults)
        }
        return (defaults, teardown)
    }

    @Test func loadFromEmptyDefaultsReturnsEmptyDict() {
        let (defaults, teardown) = isolatedDefaults()
        defer { teardown() }

        #expect(BackgroundService.loadShownPaths(defaults: defaults).isEmpty)
    }

    @Test func roundtripPreservesPerSlotSets() {
        let (defaults, teardown) = isolatedDefaults()
        defer { teardown() }

        let original: [String: Set<String>] = [
            "photography/morning/light": ["photo/morning/light-1.webp", "photo/morning/light-3.webp"],
            "photography/evening/packed": ["photo/evening/packed-2.webp"],
        ]
        BackgroundService.persistShownPaths(original, defaults: defaults)

        let loaded = BackgroundService.loadShownPaths(defaults: defaults)
        #expect(loaded == original)
    }

    @Test func clearWipesPersistedBlob() {
        let (defaults, teardown) = isolatedDefaults()
        defer { teardown() }

        BackgroundService.persistShownPaths(
            ["photography/dawn/light": ["photo/dawn/light-1.webp"]],
            defaults: defaults
        )
        #expect(!BackgroundService.loadShownPaths(defaults: defaults).isEmpty)

        BackgroundService.clearShownPaths(defaults: defaults)
        #expect(BackgroundService.loadShownPaths(defaults: defaults).isEmpty)
    }

    @Test func malformedDataDecodesToEmptyDict() {
        // A corrupt blob (e.g. from a future format change) must not
        // crash the picker — it should degrade gracefully to "no
        // history" and resume the shuffle from a clean slate.
        let (defaults, teardown) = isolatedDefaults()
        defer { teardown() }

        defaults.set(Data([0xFF, 0xFE, 0xFD]), forKey: BackgroundService.shownPathsDefaultsKey)
        #expect(BackgroundService.loadShownPaths(defaults: defaults).isEmpty)
    }
}
