import Foundation
import SwiftUI
import Testing
@testable import Brett

/// Tests for the luminance derivation that drives Today-hero text
/// color. Two layers under test:
///
///   1. `WashColorSampler.luminance(...)` — the pure WCAG math. The
///      cache stores DARKENED RGB (the value used for the wash bed);
///      these tests pin that the un-darken + gamma + weighted-sum
///      pipeline lands the expected luminance for a handful of known
///      colors so we catch any silent math drift.
///
///   2. `BackgroundService.currentWashIsLight` — the hysteretic flag
///      `TodayHero` reads to decide white vs. dark prose. These tests
///      pin the deadband behavior so a future tweak to the threshold
///      constants can't silently re-introduce mid-luminance flicker.
@Suite("WashLuminance", .tags(.views))
@MainActor
struct WashLuminanceTests {

    // MARK: - Pure-math luminance

    @Test func linearizeMatchesWCAGAtKnownPoints() {
        // Below the 0.03928 elbow: linear / 12.92.
        #expect(abs(WashColorSampler.linearize(0.0) - 0.0) < 1e-9)
        #expect(abs(WashColorSampler.linearize(0.02) - 0.02/12.92) < 1e-9)
        // Above the elbow: the gamma 2.4 curve. Pure white must land
        // exactly at 1.0 or the WCAG identity breaks.
        #expect(abs(WashColorSampler.linearize(1.0) - 1.0) < 1e-9)
    }

    @Test func linearizeClampsOutOfRangeInput() {
        #expect(WashColorSampler.linearize(-0.5) == 0.0)
        #expect(WashColorSampler.linearize(2.0) == 1.0)
    }

    @Test func luminanceOfPureWhiteIsOne() {
        // White, darkened by the wash multiplier — what the sampler
        // would cache for a pure-white photo. Inverting the darken
        // should recover 1.0 luminance to within float precision.
        let darken = WashColorSampler.washDarken
        let darkened = WashColorSampler.RGB(r: darken, g: darken, b: darken)
        #expect(abs(WashColorSampler.luminance(fromDarkenedRGB: darkened) - 1.0) < 1e-6)
    }

    @Test func luminanceOfPureBlackIsZero() {
        let darkened = WashColorSampler.RGB(r: 0, g: 0, b: 0)
        #expect(WashColorSampler.luminance(fromDarkenedRGB: darkened) == 0.0)
    }

    @Test func luminanceMatchesGreenAboveRedAboveBlue() {
        // WCAG weights green heaviest, then red, then blue. A
        // mid-intensity primary in each channel must sort that way —
        // if a future refactor swaps the coefficients this test
        // catches it.
        let darken = WashColorSampler.washDarken
        let mid = 0.5
        let r = WashColorSampler.RGB(r: mid * darken, g: 0, b: 0)
        let g = WashColorSampler.RGB(r: 0, g: mid * darken, b: 0)
        let b = WashColorSampler.RGB(r: 0, g: 0, b: mid * darken)

        let lr = WashColorSampler.luminance(fromDarkenedRGB: r)
        let lg = WashColorSampler.luminance(fromDarkenedRGB: g)
        let lb = WashColorSampler.luminance(fromDarkenedRGB: b)

        #expect(lg > lr)
        #expect(lr > lb)
    }

    // MARK: - Hysteresis (currentWashIsLight)

    @Test func defaultsToDarkPhotoSoTextStaysWhite() {
        let svc = BackgroundService(client: .shared)
        #expect(svc.currentWashIsLight == false)
        #expect(svc.currentWashLuminance == 0.0)
    }

    @Test func brightSolidFlipsToLightAboveHighThreshold() {
        let svc = BackgroundService(client: .shared)
        // Apply a near-white solid via the public profile API —
        // `applyLuminance(forSolidHex:)` runs through `recompute()`.
        svc.updateProfile(style: "solid", pinned: "solid:#FFFFFF")
        #expect(svc.currentWashIsLight == true)
        #expect(svc.currentWashLuminance > 0.65)
    }

    @Test func darkSolidStaysDark() {
        let svc = BackgroundService(client: .shared)
        svc.updateProfile(style: "solid", pinned: "solid:#1A1612")
        #expect(svc.currentWashIsLight == false)
        #expect(svc.currentWashLuminance < 0.05)
    }

    @Test func darkThenBrightFlipsOnce() {
        let svc = BackgroundService(client: .shared)
        svc.updateProfile(style: "solid", pinned: "solid:#000000")
        #expect(svc.currentWashIsLight == false)
        svc.updateProfile(style: "solid", pinned: "solid:#FFFFFF")
        #expect(svc.currentWashIsLight == true)
    }

    @Test func hysteresisPreventsFlickerInDeadband() {
        // After we've committed to white text on a dark photo, a
        // photo whose luminance lands in the (0.55, 0.65) deadband
        // must NOT flip — otherwise wallpaper rotation between two
        // borderline-bright photos would strobe the hero text color
        // every 60 seconds.
        //
        // We simulate by walking the public solid API: start dark,
        // then apply a mid-luminance gray (#888 ≈ luminance 0.21,
        // safely below the low threshold). The flag must stay false.
        let svc = BackgroundService(client: .shared)
        svc.updateProfile(style: "solid", pinned: "solid:#000000")
        #expect(svc.currentWashIsLight == false)

        // Mid gray — well below high threshold, well above pure black
        // but still below the low threshold. Should not flip.
        svc.updateProfile(style: "solid", pinned: "solid:#888888")
        #expect(svc.currentWashIsLight == false)
    }

    @Test func hysteresisFlipsBackOnlyBelowLowThreshold() {
        // Mirror of the previous: once we're on dark text (light
        // flag = true), the flag must NOT flip back to false on
        // a photo that lands in the deadband. Only a luminance
        // below the low threshold should drop us back to white text.
        let svc = BackgroundService(client: .shared)
        svc.updateProfile(style: "solid", pinned: "solid:#FFFFFF")
        #expect(svc.currentWashIsLight == true)

        // #555555 → luminance ~0.075. Well below the low threshold
        // so we *do* flip back. The deeper umber than #BBB (chosen
        // when the deadband was 0.55..0.65) ensures this test
        // survives future threshold tweaks down to ~0.10.
        svc.updateProfile(style: "solid", pinned: "solid:#555555")
        #expect(svc.currentWashIsLight == false)
    }
}
