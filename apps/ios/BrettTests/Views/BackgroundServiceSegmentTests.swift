import Foundation
import Testing
@testable import Brett

/// Coverage for `BackgroundService.segment(forURL:)` — the URL→segment
/// classifier that gates the cached-URL preservation path in
/// `recompute()`.
///
/// The bug class this guards: a cached URL from a previous session
/// belonging to a different time-of-day segment than "now" being kept
/// instead of refreshed, producing the symptom from #161 — opening the
/// app at 7 AM and seeing last night's wallpaper until the 60s rotation
/// timer fires. The classifier has to recognise both `photo/` and
/// `photo-portrait/` shapes (iOS uses portrait, desktop uses landscape;
/// either could land in the cache during migrations), and has to return
/// `nil` for unrelated URL shapes so the caller falls back safely
/// rather than misclassifying.
@Suite("BackgroundServiceSegment", .tags(.views))
struct BackgroundServiceSegmentTests {

    @Test func portraitNightPathResolvesToNight() {
        let url = URL(string: "https://api.example.com/public/backgrounds/photo-portrait/night/light-2.webp")!
        #expect(BackgroundService.segment(forURL: url) == .night)
    }

    @Test func portraitMorningPathResolvesToMorning() {
        let url = URL(string: "https://api.example.com/public/backgrounds/photo-portrait/morning/light-1.webp")!
        #expect(BackgroundService.segment(forURL: url) == .morning)
    }

    @Test func landscapePhotoPathAlsoResolves() {
        // The manifest stores landscape paths (`photo/...`); the
        // service swaps to `photo-portrait/...` when building iOS URLs,
        // but cached entries from older builds — or future
        // landscape-aware code paths — should still classify correctly.
        let url = URL(string: "https://api.example.com/public/backgrounds/photo/dawn/light-1.webp")!
        #expect(BackgroundService.segment(forURL: url) == .dawn)
    }

    @Test func goldenHourFolderMapsToGoldenHourSegment() {
        // The folder is kebab-case (`golden-hour`) but the enum is
        // camelCase (`goldenHour`). The mapping has to bridge that.
        let url = URL(string: "https://api.example.com/public/backgrounds/photo-portrait/golden-hour/light-1.webp")!
        #expect(BackgroundService.segment(forURL: url) == .goldenHour)
    }

    @Test func afternoonAndEveningResolveCorrectly() {
        let afternoon = URL(string: "https://api.example.com/public/backgrounds/photo-portrait/afternoon/moderate-2.webp")!
        let evening = URL(string: "https://api.example.com/public/backgrounds/photo-portrait/evening/packed-1.webp")!
        #expect(BackgroundService.segment(forURL: afternoon) == .afternoon)
        #expect(BackgroundService.segment(forURL: evening) == .evening)
    }

    @Test func unrelatedURLReturnsNil() {
        // A URL that doesn't pass through a `photo/` or `photo-portrait/`
        // path component should not match anything — callers should
        // treat this as "can't classify, refresh from manifest"
        // rather than guessing.
        let url = URL(string: "https://api.example.com/public/something-else/night/light.webp")!
        #expect(BackgroundService.segment(forURL: url) == nil)
    }

    @Test func unknownFolderNameReturnsNil() {
        // A URL with the right prefix shape but an unrecognised
        // segment folder (e.g. a future manifest experiment that
        // hasn't shipped to this client yet) must return nil so the
        // caller refreshes rather than silently defaulting to one of
        // the known segments.
        let url = URL(string: "https://api.example.com/public/backgrounds/photo-portrait/twilight/light-1.webp")!
        #expect(BackgroundService.segment(forURL: url) == nil)
    }

    @Test func trailingPathWithoutSegmentReturnsNil() {
        // `photo/` with nothing after it can't be classified.
        let url = URL(string: "https://api.example.com/public/backgrounds/photo/")!
        #expect(BackgroundService.segment(forURL: url) == nil)
    }
}
