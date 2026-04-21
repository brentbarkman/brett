import Foundation
import Observation
import SwiftUI

/// Resolves the current Brett wallpaper for the iOS app. Three sources of
/// truth:
///   1. `background-manifest.json` (bundled) — the canonical catalogue of
///      photography + abstract image paths, grouped by time-of-day and
///      "busyness" tier.
///   2. `/config` (network) — gives us the `storageBaseUrl` where images
///      actually live. Cached in-memory for the session; re-fetched on
///      each fresh app launch.
///   3. `UserProfile.backgroundStyle` + `UserProfile.pinnedBackground` —
///      what the user picked. Either a relative path (e.g.
///      "photo/evening/light-2.webp") or a "solid:#RRGGBB" sentinel.
///
/// The service is a singleton on the main actor because `BackgroundView`
/// reads it from SwiftUI, and because the manifest + base URL are
/// process-wide state. Tests that need to inject a different base URL
/// can construct an instance with `init(client:)` directly.
@MainActor
@Observable
final class BackgroundService {
    static let shared = BackgroundService()

    // MARK: - Public state

    /// Parsed manifest once loaded from the bundle. `nil` until `load()`
    /// runs — callers should fall back to the asset-catalog images in
    /// that window.
    private(set) var manifest: BackgroundManifest?

    /// Base URL of the storage server (e.g.
    /// `https://api.brett.brentbarkman.com/public`). Images are served
    /// under `{storageBaseUrl}/backgrounds/{path}`. `nil` until `/config`
    /// returns.
    private(set) var storageBaseUrl: URL?

    /// True once both the manifest and base URL have resolved.
    var isReady: Bool { manifest != nil && storageBaseUrl != nil }

    // MARK: - Init

    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    // MARK: - Manifest

    /// Mirrors `apps/desktop/src/data/background-manifest.json`.
    /// Decodable; every leaf is a bundle-relative image path.
    struct BackgroundManifest: Decodable {
        let version: Int?
        let sets: Sets

        struct Sets: Decodable {
            let photography: Segments
            let abstract: Segments
        }

        struct Segments: Decodable {
            let dawn: BusynessTiers
            let morning: BusynessTiers
            let afternoon: BusynessTiers
            let goldenHour: BusynessTiers
            let evening: BusynessTiers
            let night: BusynessTiers
        }

        struct BusynessTiers: Decodable {
            let light: [String]
            let moderate: [String]
            let packed: [String]
        }
    }

    /// Canonical time-of-day segments. Order matters for UI rendering.
    enum Segment: String, CaseIterable, Identifiable {
        case dawn, morning, afternoon, goldenHour, evening, night
        var id: String { rawValue }

        var label: String {
            switch self {
            case .dawn: return "Dawn"
            case .morning: return "Morning"
            case .afternoon: return "Afternoon"
            case .goldenHour: return "Golden Hour"
            case .evening: return "Evening"
            case .night: return "Night"
            }
        }
    }

    /// Style that applies a complete visual set (photography, abstract,
    /// or solid color). Mirrors the API's `backgroundStyle` enum.
    enum Style: String, CaseIterable {
        case photography
        case abstract
        case solid

        var display: String {
            switch self {
            case .photography: return "Photography"
            case .abstract: return "Abstract"
            case .solid: return "Solid"
            }
        }
    }

    // MARK: - Solid colors
    //
    // Ported verbatim from `apps/desktop/src/data/solid-colors.ts` so the
    // picker renders the same 16 swatches on both clients. IDs match the
    // desktop — the persisted value is `"solid:#RRGGBB"` using `hex`.

    struct SolidColor: Identifiable, Hashable {
        let id: String // desktop slug, e.g. "stone"
        let label: String
        let hex: String // "#RRGGBB"

        /// Sentinel written to `pinnedBackground` when the user picks
        /// this color.
        var pinnedValue: String { "solid:\(hex)" }

        var color: Color {
            BackgroundService.color(forHex: hex) ?? .black
        }
    }

    static let solidColors: [SolidColor] = [
        .init(id: "stone",      label: "Stone",      hex: "#636366"),
        .init(id: "space-gray", label: "Space Gray", hex: "#48484a"),
        .init(id: "graphite",   label: "Graphite",   hex: "#2c2c2e"),
        .init(id: "black",      label: "Black",      hex: "#1c1c1e"),
        .init(id: "blue",       label: "Blue",       hex: "#0040dd"),
        .init(id: "indigo",     label: "Indigo",     hex: "#3634a3"),
        .init(id: "purple",     label: "Purple",     hex: "#8944ab"),
        .init(id: "pink",       label: "Pink",       hex: "#d63384"),
        .init(id: "red",        label: "Red",        hex: "#c41e3a"),
        .init(id: "orange",     label: "Orange",     hex: "#c45800"),
        .init(id: "yellow",     label: "Yellow",     hex: "#9e7700"),
        .init(id: "green",      label: "Green",      hex: "#248a3d"),
        .init(id: "mint",       label: "Mint",       hex: "#0db39e"),
        .init(id: "cyan",       label: "Cyan",       hex: "#0077c8"),
        .init(id: "dark-blue",  label: "Dark Blue",  hex: "#1a237e"),
        .init(id: "dark-green", label: "Dark Green", hex: "#1b5e20"),
    ]

    // MARK: - Bootstrap

    /// Populate `manifest` and `storageBaseUrl`. Safe to call repeatedly —
    /// the manifest is only re-decoded once, and the config fetch is
    /// retried on each call so a dev flipping between networks gets the
    /// fresh value.
    func load() async {
        loadManifestIfNeeded()
        await loadConfigIfNeeded()
    }

    private func loadManifestIfNeeded() {
        guard manifest == nil else { return }
        guard let url = Bundle.main.url(forResource: "background-manifest", withExtension: "json") else {
            #if DEBUG
            print("[BackgroundService] Missing background-manifest.json in bundle")
            #endif
            return
        }
        do {
            let data = try Data(contentsOf: url)
            self.manifest = try JSONDecoder().decode(BackgroundManifest.self, from: data)
        } catch {
            #if DEBUG
            print("[BackgroundService] Failed to decode manifest: \(error)")
            #endif
        }
    }

    private func loadConfigIfNeeded() async {
        // Re-fetch each call — storageBaseUrl is cheap and shifts between
        // dev and prod. We don't cache aggressively because the manifest
        // is the expensive part and already memoized.
        struct ConfigResponse: Decodable {
            let storageBaseUrl: String
            let videoBaseUrl: String?
        }

        do {
            let response: ConfigResponse = try await client.request(
                ConfigResponse.self,
                path: "/config",
                method: "GET"
            )
            if let parsed = URL(string: response.storageBaseUrl) {
                self.storageBaseUrl = parsed
            }
        } catch {
            #if DEBUG
            print("[BackgroundService] Failed to load /config: \(error)")
            #endif
        }
    }

    // MARK: - Resolution

    /// Resolve the current image URL for the given style + pinned value.
    /// Returns `nil` when the caller should render a solid color instead,
    /// or when the manifest / base URL aren't loaded yet (caller falls
    /// back to the asset-catalog).
    ///
    /// - Parameters:
    ///   - style: The viewing style ("photography" or "abstract").
    ///             Ignored for "solid".
    ///   - pinned: The user's pinned selection, if any.
    ///   - now: Overridable for tests.
    func currentImageURL(
        style: String,
        pinned: String?,
        now: Date = Date()
    ) -> URL? {
        // Without a base URL we can't build an image URL at all —
        // callers will fall back to the asset catalog.
        guard storageBaseUrl != nil else { return nil }

        // Solid backgrounds are rendered as a Color by the caller — no
        // image URL to return.
        if style == Style.solid.rawValue { return nil }

        // A pinned image that isn't a solid sentinel is a direct path.
        // Use the portrait crop for full-screen display.
        if let pinned, !pinned.hasPrefix("solid:") {
            return url(for: pinned, portrait: true)
        }

        // Auto mode: pick a path from the manifest for the current
        // segment. We default to the "light" busyness tier — the iOS
        // client doesn't yet compute a live busyness score, so picking
        // tiers other than light would require a UX that doesn't exist
        // on the phone.
        guard let manifest else { return nil }

        let segment = Self.segment(forHour: Calendar.current.component(.hour, from: now))
        let effectiveStyle = Style(rawValue: style) ?? .photography
        let segments = Self.segments(for: effectiveStyle, in: manifest)
        let tier = Self.tier(for: segment, in: segments).light

        guard let path = tier.randomElement() else { return nil }
        return url(for: path, portrait: true)
    }

    /// Resolve a full image URL for a manifest-relative path (e.g.
    /// `"photo/evening/light-2.webp"`). Returns `nil` if the base URL
    /// isn't loaded yet.
    ///
    /// - Parameter portrait: When `true`, swaps `photo/` → `photo-portrait/`
    ///   so the URL points at the 1290×2796 portrait crop optimized for
    ///   iPhone screens. Pass `false` (default) for settings gallery
    ///   thumbnails where landscape is fine.
    func url(for path: String, portrait: Bool = false) -> URL? {
        guard let storageBaseUrl else { return nil }
        let effectivePath = portrait ? Self.portraitPath(for: path) : path
        return storageBaseUrl
            .appendingPathComponent("backgrounds")
            .appendingPathComponent(effectivePath)
    }

    /// Convert a landscape manifest path to its portrait variant.
    /// Only `photo/` slots have portrait counterparts — abstract and
    /// other sets pass through unchanged.
    private static func portraitPath(for path: String) -> String {
        guard path.hasPrefix("photo/") else { return path }
        return "photo-portrait/" + String(path.dropFirst("photo/".count))
    }

    // MARK: - Segment helpers

    /// Map an hour (0-23) to a time-of-day segment. Mirrors the desktop
    /// `app-config` bucketing so auto backgrounds line up across clients.
    static func segment(forHour hour: Int) -> Segment {
        switch hour {
        case 5...6: return .dawn
        case 7...10: return .morning
        case 11...16: return .afternoon
        case 17...18: return .goldenHour
        case 19...20: return .evening
        default: return .night // 21-4
        }
    }

    static func segments(for style: Style, in manifest: BackgroundManifest) -> BackgroundManifest.Segments {
        switch style {
        case .photography, .solid: return manifest.sets.photography
        case .abstract: return manifest.sets.abstract
        }
    }

    static func tier(for segment: Segment, in segments: BackgroundManifest.Segments) -> BackgroundManifest.BusynessTiers {
        switch segment {
        case .dawn: return segments.dawn
        case .morning: return segments.morning
        case .afternoon: return segments.afternoon
        case .goldenHour: return segments.goldenHour
        case .evening: return segments.evening
        case .night: return segments.night
        }
    }

    // MARK: - Last URL cache
    //
    // Persisted in UserDefaults so a cold launch can paint the user's last
    // wallpaper immediately from URLCache, while `/config` + manifest
    // resolve in the background. This is what kills the "asset → remote"
    // crossfade jank at startup: when the cache is seeded, BackgroundView
    // starts directly in the remote branch and the first service resolution
    // is usually a no-op (same URL) or at worst a deliberate segment
    // crossfade. `nonisolated` so View property initializers can read it.

    nonisolated private static let lastRemoteURLKey = "brett.background.lastRemoteURL"

    nonisolated static var cachedRemoteURL: URL? {
        get {
            guard let raw = UserDefaults.standard.string(forKey: lastRemoteURLKey) else { return nil }
            return URL(string: raw)
        }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue.absoluteString, forKey: lastRemoteURLKey)
            } else {
                UserDefaults.standard.removeObject(forKey: lastRemoteURLKey)
            }
        }
    }

    // MARK: - Hex parsing

    /// Parse `"#RRGGBB"` (or `"RRGGBB"`) into a SwiftUI `Color`. Returns
    /// `nil` for malformed strings so callers can fall back gracefully.
    ///
    /// `nonisolated` so the nested `SolidColor` struct (which is not
    /// main-actor scoped) can call it, and so `BackgroundView` can use
    /// it from its view builder without hopping actors.
    nonisolated static func color(forHex raw: String) -> Color? {
        var cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") { cleaned.removeFirst() }

        guard cleaned.count == 6 else { return nil }

        var value: UInt64 = 0
        guard Scanner(string: cleaned).scanHexInt64(&value) else { return nil }

        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        return Color(red: r, green: g, blue: b)
    }
}
