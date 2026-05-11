import Foundation
import SwiftUI
import UIKit

/// Samples the dominant color of the 50–65% vertical band of a photo —
/// the "wash" color used as the bed for non-Today pages and the
/// section bed beneath the Today hero.
///
/// Why the middle band: most photos in the manifest are landscape
/// photography where the middle is the photo's core mood (sand,
/// foliage, water surface) and the top is sky / bottom is foreground.
/// Averaging the middle band gives a wash that reads as "from this
/// photo" without being dominated by either extreme.
///
/// Cost: ~60–120ms per photo end-to-end on iPhone hardware (decode +
/// average). Runs async on a background queue; the result lands on
/// `BackgroundService` via the `MainActor` setter and SwiftUI re-paints
/// any subscribed view automatically.
///
/// Cache: results persist to `UserDefaults` keyed by the source URL or
/// asset name, so a cold launch with a previously-sampled photo paints
/// the correct wash in the first frame instead of flashing the default
/// neutral. The cache is small (~24 bytes per entry, ~36 entries for
/// the bundled manifest) — orders of magnitude under any UserDefaults
/// concern. Cache invalidation is implicit: a photo URL change orphans
/// the old entry, which is harmless waste.
enum WashColorSampler {

    // MARK: - Public API

    /// Sample the wash color for a remote photo URL. Resolves from the
    /// cache when present, otherwise downloads + samples + writes back.
    /// Pure, throwing — caller decides what to do on failure (typically
    /// keep the existing wash).
    static func sampledWash(for url: URL) async throws -> Color {
        let key = url.absoluteString
        if let cached = readCache(key: key) {
            return cached.color
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        guard let image = UIImage(data: data) else {
            throw SamplerError.decodeFailed
        }
        let rgb = averageRGB(of: image)
        writeCache(key: key, rgb: rgb)
        return rgb.color
    }

    /// Sample the wash color for a bundled asset name (e.g.
    /// "bg-morning"). Same cache shape as the remote variant —
    /// asset names live in the same key space because they don't
    /// collide with URLs.
    static func sampledWash(forAssetNamed name: String) -> Color? {
        if let cached = readCache(key: name) {
            return cached.color
        }
        guard let image = UIImage(named: name) else { return nil }
        let rgb = averageRGB(of: image)
        writeCache(key: name, rgb: rgb)
        return rgb.color
    }

    /// Synchronous cache read for a remote photo URL — lets callers
    /// (e.g. `BackgroundService.recompute`) paint a previously-sampled
    /// wash on the very first frame of a cold launch without awaiting
    /// the download. Returns nil for first-sight photos.
    static func cachedWash(forURL url: URL) -> Color? {
        readCache(key: url.absoluteString)?.color
    }

    /// WCAG relative luminance (0..1) of the un-darkened photo band
    /// behind the URL, derived from the cached darkened RGB. Returns
    /// nil for first-sight photos. Used to decide light- vs dark-text
    /// for content that sits directly on the photo (Today hero on iOS,
    /// briefing prose on desktop's photo-direct layout).
    ///
    /// We invert the 0.85 darkening to recover the raw photo RGB before
    /// running the WCAG formula, because the text sits on the *photo*,
    /// not on the (darkened) wash bed.
    static func cachedPhotoLuminance(forURL url: URL) -> Double? {
        readCache(key: url.absoluteString).map(Self.luminance(fromDarkenedRGB:))
    }

    /// Same as `cachedPhotoLuminance(forURL:)` but for the bundled
    /// asset path used during cold-launch fallback. The bundled photo
    /// is sampled synchronously, so a non-nil here is essentially
    /// guaranteed the moment the matching `sampledWash(forAssetNamed:)`
    /// has run.
    static func cachedPhotoLuminance(forAssetNamed name: String) -> Double? {
        readCache(key: name).map(Self.luminance(fromDarkenedRGB:))
    }

    enum SamplerError: Error {
        case decodeFailed
    }

    // MARK: - Sampling

    /// Internal RGB triplet we serialise to disk. Convertible to a
    /// SwiftUI `Color` via `.color` — sidesteps `Color.resolve(in:)`,
    /// which needs an `EnvironmentValues` we don't have in a
    /// non-View context.
    struct RGB {
        let r: Double
        let g: Double
        let b: Double
        var color: Color { Color(red: r, green: g, blue: b) }
        var array: [Double] { [r, g, b] }
    }

    /// Average RGB across the 50–65% vertical band of the image, then
    /// nudge brightness down ~15% so the wash is dark enough for cards
    /// + text to sit on without an extra vignette.
    ///
    /// Implementation note: rendering the band into a 1×1 CGContext lets
    /// CoreGraphics do the average for us — significantly faster than a
    /// hand-rolled pixel loop and avoids Swift `[UInt8]` allocations.
    static func averageRGB(of image: UIImage) -> RGB {
        guard let cgImage = image.cgImage else {
            return defaultRGB
        }

        // Crop to the 50–65% vertical band.
        let height = CGFloat(cgImage.height)
        let bandTop = Int(height * 0.50)
        let bandHeight = max(1, Int(height * 0.15))
        let bandRect = CGRect(
            x: 0,
            y: bandTop,
            width: cgImage.width,
            height: bandHeight
        )
        guard let band = cgImage.cropping(to: bandRect) else {
            return defaultRGB
        }

        // Render the band into a 1×1 RGBA8 context — CoreGraphics
        // averages the pixels for us during the down-sample.
        var pixel: [UInt8] = [0, 0, 0, 0]
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo: CGBitmapInfo = [
            CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
        ]
        guard let context = CGContext(
            data: &pixel,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        ) else {
            return defaultRGB
        }
        context.interpolationQuality = .medium
        context.draw(band, in: CGRect(x: 0, y: 0, width: 1, height: 1))

        // Convert to 0–1, then knock brightness down so the wash is
        // calmer than the photo's literal middle. Without this nudge,
        // sun-lit photos produce a wash bright enough to wash out
        // glass-card text.
        let darken = 0.85
        return RGB(
            r: Double(pixel[0]) / 255.0 * darken,
            g: Double(pixel[1]) / 255.0 * darken,
            b: Double(pixel[2]) / 255.0 * darken
        )
    }

    /// Burnt-umber fallback as `RGB`. Mirrors `BackgroundService.defaultWashColor`
    /// but kept here so the sampler is self-contained and testable
    /// without the service.
    private static let defaultRGB = RGB(
        r: 26/255.0,
        g: 22/255.0,
        b: 18/255.0
    )

    // MARK: - Luminance

    /// Multiplier applied in `averageRGB` to darken the wash. Kept as
    /// a named constant so the inverse-darken in luminance derivation
    /// stays in lock-step — change one, change the other.
    static let washDarken: Double = 0.85

    /// WCAG relative luminance (0..1) for a single sRGB channel. The
    /// gamma piece-wise: linear below ~3.9% to match the standard
    /// formula, then the 2.4 curve above. Public-but-internal-ish so
    /// `luminance(fromDarkenedRGB:)` can call it and tests can pin
    /// the math.
    static func linearize(_ c: Double) -> Double {
        let clamped = max(0, min(1, c))
        if clamped <= 0.03928 {
            return clamped / 12.92
        }
        return pow((clamped + 0.055) / 1.055, 2.4)
    }

    /// Relative luminance of the *raw* photo band recovered from a
    /// cached darkened `RGB`. Inverts the 0.85 darken first, then
    /// applies the WCAG weighted sum. Returns 0..1.
    static func luminance(fromDarkenedRGB rgb: RGB) -> Double {
        let rawR = min(1.0, rgb.r / washDarken)
        let rawG = min(1.0, rgb.g / washDarken)
        let rawB = min(1.0, rgb.b / washDarken)
        let linR = linearize(rawR)
        let linG = linearize(rawG)
        let linB = linearize(rawB)
        return 0.2126 * linR + 0.7152 * linG + 0.0722 * linB
    }

    // MARK: - Cache

    /// Stored as a `[String: [Double]]` — `[r, g, b]` triplets keyed by
    /// the photo URL or asset name. UserDefaults handles the JSON
    /// serialisation transparently. Bounded by manifest size (~36
    /// entries, ~24 bytes each) so growth is a non-issue.
    private static let cacheKey = "background.washColors.v1"

    private static func readCache(key: String) -> RGB? {
        guard let dict = UserDefaults.standard.dictionary(forKey: cacheKey) as? [String: [Double]],
              let triplet = dict[key],
              triplet.count == 3 else { return nil }
        return RGB(r: triplet[0], g: triplet[1], b: triplet[2])
    }

    private static func writeCache(key: String, rgb: RGB) {
        var dict = (UserDefaults.standard.dictionary(forKey: cacheKey) as? [String: [Double]]) ?? [:]
        dict[key] = rgb.array
        UserDefaults.standard.set(dict, forKey: cacheKey)
    }
}
