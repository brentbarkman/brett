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

    // MARK: - Renderer state
    //
    // Hoisted from `BackgroundView` so multiple mounted instances share one
    // ticker, one resolution pass, and one set of `@State` slots. Before the
    // hoist, every BackgroundView in the hierarchy (MainContainer + pushed
    // ListView + pushed ScoutsRosterView, etc.) ran its own 60s timer and
    // its own image-decision pipeline — most of the work redundant because
    // they all converge on the same image. Now BackgroundView is a thin
    // observer of these properties.

    /// Current remote image URL (nil for solid backgrounds or before
    /// `/config` resolves).
    private(set) var currentRemoteURL: URL? = BackgroundService.cachedRemoteURL

    /// Current solid color when style is "solid".
    private(set) var currentSolidColor: Color?

    /// Fallback asset-catalog name when neither remote nor solid applies.
    /// Empty string means "not yet resolved" — callers fall back to
    /// `assetNameForHour(...)` directly.
    private(set) var currentFallbackAsset: String = ""

    /// Stable identity that drives the crossfade animation. Changes
    /// whenever the rendered image changes.
    private(set) var displayedKey: String = BackgroundService.cachedRemoteURL?.absoluteString ?? ""

    /// Solid "wash" color used as the bed for non-Today pages and below
    /// the hero on Today. Calm-hero design (2026-05-04) uses the same
    /// wash everywhere except the Today hero so the photo lives only at
    /// the home screen.
    ///
    /// **Stored** (not computed) so the `@Observable` machinery emits a
    /// change notification when the v2 photo-sampling work writes a new
    /// value here. A computed property would render the v2 hand-off
    /// silent — SwiftUI only tracks reads of stored `@Observable`
    /// properties — and `WashBackground` consumers wouldn't re-paint
    /// when the sampled wash arrives.
    ///
    /// v1: defaults to a fixed warm-dark neutral that complements every
    /// photo in the manifest. v2: sample average color of the 50–65%
    /// vertical band of the current photo (UIImage average) and write
    /// the sampled color here, cached by `displayedKey`, falling back
    /// to the v1 default until the sample lands.
    private(set) var currentWashColor: Color = BackgroundService.defaultWashColor

    /// The v1 fixed wash. Burnt-umber neutral — looks like the deep warm
    /// color found in the bottom band of the most common photography
    /// assets without shouting any one of them. Tuned dark enough for
    /// cards + text to sit on without a vignette.
    static let defaultWashColor = Color(red: 26/255, green: 22/255, blue: 18/255)

    /// Reference count of mounted `BackgroundView` instances. When it
    /// transitions 0 → 1 we start the 60s segment ticker; 1 → 0 stops it.
    /// Multiple mounts (e.g. while a pushed view sits on top of the
    /// MainContainer wallpaper) share the single tick.
    private var rendererCount: Int = 0

    /// The 60s segment ticker. Owned by the service rather than each
    /// BackgroundView so we run exactly one timer regardless of how many
    /// renderers are alive.
    private var tickTask: Task<Void, Never>?

    #if DEBUG
    /// Test inspectors. Exposed only in DEBUG so tests can verify the
    /// ref-count + tick-task invariants without forcing the production
    /// type to leak internals.
    var debug_rendererCount: Int { rendererCount }
    var debug_hasTickTask: Bool { tickTask != nil }

    /// Reset the cached remote URL state so a test starts from a known
    /// "first launch ever" baseline. Necessary because the singleton
    /// caches `currentRemoteURL` from `UserDefaults` at init, and tests
    /// asserting on the no-cache fallback path would otherwise be
    /// non-deterministic across simulator runs that have ever opened
    /// the app.
    func debug_resetRemoteCache() {
        currentRemoteURL = nil
        currentFallbackAsset = ""
        currentSolidColor = nil
        displayedKey = ""
        Self.cachedRemoteURL = nil
    }
    #endif

    /// Profile values last pushed by a renderer. All renderers see the
    /// same SwiftData row, so last-writer-wins is safe — any `nil` here
    /// means we either have no profile yet or the user is signed out.
    private var lastProfileStyle: String?
    private var lastProfilePinned: String?

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
            BrettLog.app.error("BackgroundService: missing background-manifest.json in bundle")
            return
        }
        do {
            let data = try Data(contentsOf: url)
            self.manifest = try JSONDecoder().decode(BackgroundManifest.self, from: data)
        } catch {
            BrettLog.app.error("BackgroundService: failed to decode manifest: \(String(describing: error), privacy: .public)")
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
            BrettLog.app.error("BackgroundService: failed to load /config: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Renderer lifecycle

    /// Called by `BackgroundView` on mount. The first registration also
    /// kicks off the 60s tick task so the wallpaper swaps as time-of-day
    /// segments cross. Idempotent in the "already running" sense — a
    /// second registration just bumps the ref count.
    func registerRenderer() {
        rendererCount += 1
        if tickTask == nil {
            startTick()
        }
    }

    /// Called by `BackgroundView` on disappear. The last unregister
    /// stops the ticker so a backgrounded process isn't holding a Task
    /// that will never fire usefully.
    func unregisterRenderer() {
        rendererCount = max(0, rendererCount - 1)
        if rendererCount == 0 {
            tickTask?.cancel()
            tickTask = nil
        }
    }

    /// Pause the 60s rotation timer. Called from the scene-phase
    /// `.background` handler so a backgrounded process isn't holding a
    /// `Task.sleep` that will count wall-time toward the next rotation
    /// during suspension. Without this, a >60s background period causes
    /// the tick to fire immediately on resume — crossfading the
    /// wallpaper to a different random photo from the same tier *while*
    /// `MainContainer.replayAwakening()` is playing the warm-launch
    /// reveal. Idempotent.
    func pauseRotation() {
        tickTask?.cancel()
        tickTask = nil
    }

    /// Restart the 60s rotation timer with a fresh window. Called from
    /// the scene-phase `.active` handler so the user gets a full 60
    /// seconds of viewing the same wallpaper after foregrounding before
    /// the next rotation. No-op if no renderer is currently mounted —
    /// the next `registerRenderer()` will start the tick on its own.
    /// Idempotent.
    func resumeRotation() {
        guard rendererCount > 0, tickTask == nil else { return }
        startTick()
    }

    /// Push the latest user profile values from a renderer. Recomputes
    /// the rendered state immediately so user-driven changes (picking a
    /// new wallpaper in Settings) reflect without waiting for the next
    /// 60s tick. Multiple renderers all push the same profile (they all
    /// observe the same SwiftData row), so last-writer-wins is correct.
    func updateProfile(style: String?, pinned: String?, initial: Bool = false) {
        // `initial:` is no longer consulted — recompute now preserves
        // the cached auto-mode URL by default and a separate `rotate()`
        // handles explicit fresh picks. The parameter is kept for
        // call-site compatibility (BackgroundView, tests) but ignored.
        _ = initial
        lastProfileStyle = style
        lastProfilePinned = pinned
        recompute()
    }

    /// One tick of the 60s loop. Picks a fresh photo from the current
    /// time-of-day tier (auto mode only) so the wallpaper rotates
    /// while the app is open. `recompute()` preserves the cached URL
    /// instead of repicking, so the tick is the ONLY path that
    /// deliberately rotates the auto-mode photo.
    private func startTick() {
        tickTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                if Task.isCancelled { return }
                self?.rotate()
            }
        }
    }

    /// Resolve `currentSolidColor` / `currentRemoteURL` / `currentFallbackAsset`
    /// from the last-known profile values.
    ///
    /// **Auto mode preserves the cached URL.** Cold launch jank used to
    /// look like: cached photo paints → BackgroundView.onAppear runs
    /// updateProfile → recompute downgrades to a bundled asset (manifest
    /// not loaded yet) → BackgroundView.task awaits load() → updateProfile
    /// runs again → currentImageURL picks a *different* random photo
    /// from the same tier → crossfade. Two visible swaps every launch.
    ///
    /// Now: in auto mode (no pinned image), if `currentRemoteURL`
    /// already has a value (either from the UserDefaults cache at init
    /// or from a prior tick this process), recompute keeps it.
    /// Explicit settings changes (pinned image, solid style, style
    /// switch) still reroute through the appropriate branches below;
    /// the 60s ticker calls `rotate()` for fresh picks.
    private func recompute() {
        let style = lastProfileStyle ?? Style.photography.rawValue
        let pinned = lastProfilePinned

        // Solid path — parse the hex from the pinned sentinel.
        if style == Style.solid.rawValue,
           let pinned,
           pinned.hasPrefix("solid:") {
            let hex = String(pinned.dropFirst("solid:".count))
            if let color = Self.color(forHex: hex) {
                currentRemoteURL = nil
                currentSolidColor = color
                currentFallbackAsset = ""
                // Wash matches the user's solid pick. Without this,
                // non-Today pages would render in the default warm-dark
                // while Today shows the user's solid — the two surfaces
                // would visibly disagree on what color the app is.
                currentWashColor = color
                let key = "solid:\(hex)"
                if displayedKey != key { displayedKey = key }
                return
            }
        }

        // Remote / auto path. Map any non-photography style that isn't
        // solid back onto the photography manifest — abstract + gradient
        // currently render as photography on iOS until the manifest grows
        // distinct sets.
        let effectiveStyle: String = {
            if style == Style.solid.rawValue { return Style.photography.rawValue }
            return style
        }()

        // Pinned-image path: user picked a specific photo, honor it.
        // (`solid:` sentinels are handled in the solid branch above.)
        if let pinned, !pinned.hasPrefix("solid:") {
            if let url = currentImageURL(style: effectiveStyle, pinned: pinned) {
                applyRemote(url: url)
                return
            }
            // currentImageURL needs `storageBaseUrl`; if it isn't loaded
            // yet (cold launch, before /config returns), keep the cached
            // URL rather than downgrading to a bundled asset. The
            // post-load `updateProfile` call will rerun this branch with
            // the URL resolvable — usually the same URL the cache held,
            // so no crossfade fires.
            if currentRemoteURL != nil { return }
        } else if let cached = currentRemoteURL {
            // Auto mode + we already have a cached URL painted (either
            // from UserDefaults at init or set by a prior `rotate()`
            // tick this process). Keep it — refreshing the wash sample
            // along the way — instead of picking a fresh random URL
            // that would trigger a crossfade to a different photo
            // from the same tier.
            currentSolidColor = nil
            currentFallbackAsset = ""
            currentWashColor = WashColorSampler.cachedWash(forURL: cached)
                ?? Self.defaultWashColor
            kickWashSample(url: cached)
            return
        } else if let url = currentImageURL(style: effectiveStyle, pinned: nil) {
            // Auto mode, first launch ever (no cached URL). Pick fresh
            // from the manifest. Subsequent launches enter the cached
            // branch above and skip this.
            applyRemote(url: url)
            return
        }

        // Service hasn't loaded yet (cold launch, offline) AND no
        // cached URL to fall back to — paint the bundled asset for
        // the current hour so the user never sees a blank screen.
        // Renderer paints this without a crossfade.
        let asset = Self.assetNameForHour(Calendar.current.component(.hour, from: Date()))
        currentSolidColor = nil
        currentRemoteURL = nil
        currentFallbackAsset = asset
        // Bundled assets sample synchronously — UIImage(named:) hits
        // the asset catalog with no I/O wait, and the average is
        // CoreGraphics-fast. Cache result on first sight.
        currentWashColor = WashColorSampler.sampledWash(forAssetNamed: asset)
            ?? Self.defaultWashColor
        if displayedKey != asset { displayedKey = asset }
    }

    /// Force a fresh random pick from the manifest in auto mode. Called
    /// by the 60s ticker so the wallpaper rotates while the app is open.
    /// In pinned/solid modes this just routes through `recompute()` to
    /// pick up any setting changes — there's nothing to "rotate" in
    /// those modes.
    private func rotate() {
        let style = lastProfileStyle ?? Style.photography.rawValue
        let pinned = lastProfilePinned

        // Pinned image or solid color: nothing to rotate, just sync any
        // setting changes through the normal recompute path.
        if style == Style.solid.rawValue
            || (pinned != nil && !(pinned?.hasPrefix("solid:") ?? false)) {
            recompute()
            return
        }

        let effectiveStyle: String = {
            if style == Style.solid.rawValue { return Style.photography.rawValue }
            return style
        }()

        // Auto mode — explicit fresh pick. If currentImageURL can't
        // resolve (manifest not loaded), fall back to recompute which
        // will preserve cached state or render the bundled asset.
        if let url = currentImageURL(style: effectiveStyle, pinned: nil) {
            applyRemote(url: url)
        } else {
            recompute()
        }
    }

    /// Apply a remote URL: set state, sample wash, persist to cache,
    /// bump displayedKey. Shared by `recompute()` and `rotate()` so the
    /// "set up state for a remote photo" sequence is consistent.
    private func applyRemote(url: URL) {
        currentSolidColor = nil
        currentRemoteURL = url
        currentFallbackAsset = ""
        // Set wash from the disk cache synchronously when we have
        // it (avoids a default-color flash on cold launch). When we
        // don't, ride the default until `kickWashSample(...)` resolves
        // the download + sample on a background task and writes the
        // real value back. SwiftUI re-paints any subscribed view
        // automatically because `currentWashColor` is a stored
        // `@Observable` property.
        currentWashColor = WashColorSampler.cachedWash(forURL: url)
            ?? Self.defaultWashColor
        kickWashSample(url: url)
        Self.cachedRemoteURL = url
        let key = url.absoluteString
        if displayedKey != key { displayedKey = key }
    }

    /// Async sample for a remote photo — kicks off only when the cache
    /// doesn't already have a value. The sampler writes through to the
    /// disk cache on success and we publish the result to
    /// `currentWashColor` on the main actor. Fire-and-forget; failure
    /// (network, decode) leaves the default wash in place.
    private func kickWashSample(url: URL) {
        // Skip if we already have a cached entry — `recompute` has
        // already published it synchronously above.
        if WashColorSampler.cachedWash(forURL: url) != nil { return }
        Task.detached(priority: .utility) { [weak self] in
            guard let sampled = try? await WashColorSampler.sampledWash(for: url) else { return }
            await MainActor.run {
                guard let self else { return }
                // Only adopt the sampled color if the user is still on
                // this same photo by the time the sample lands —
                // otherwise the sample belongs to a stale photo and
                // would briefly mismatch the current wallpaper.
                if self.currentRemoteURL == url {
                    self.currentWashColor = sampled
                }
            }
        }
    }

    /// Bundled asset for the current hour. Mirrors the prior
    /// `BackgroundView.assetNameForHour` so the fallback path picks
    /// the same image the view used to compute itself. Public for
    /// `BackgroundView` to use when the caller pinned an `imageName`
    /// override (previews, auth screens with a specific look).
    static func assetNameForHour(_ hour: Int) -> String {
        switch hour {
        case 5..<8: return "bg-morning"
        case 8..<12: return "bg-morning"
        case 12..<17: return "bg-golden"
        case 17..<20: return "bg-evening"
        default: return "bg-night"
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
