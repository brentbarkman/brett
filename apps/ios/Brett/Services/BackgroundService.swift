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
///      each fresh app launch and after `clearForSignOut()`.
///   3. `UserProfile.backgroundStyle` + `UserProfile.pinnedBackground` —
///      what the user picked. Either a relative path (e.g.
///      "photo/evening/light-2.webp") or a "solid:#RRGGBB" sentinel.
///
/// **No on-disk URL cache.** The service deliberately does not persist
/// the last-resolved URL to UserDefaults. Cold launch starts from the
/// wash bed (`defaultWashColor`) and the resolved photo fades in over
/// it via `BackgroundView.paintAnimation` once `load()` + `recompute()`
/// complete. The previous design persisted the URL to skip a blank
/// frame, but that produced a cross-user leak (the cached URL survived
/// sign-out) and a visible cached → resolved swap on every cold
/// launch. See `BackgroundView` for the rendering pipeline.
///
/// The service is a singleton on the main actor because `BackgroundView`
/// reads it from SwiftUI, and because the manifest + base URL are
/// process-wide state. Tests that need to inject a different base URL
/// can construct an instance with `init(client:)` directly.
@MainActor
@Observable
final class BackgroundService: Clearable {
    static let shared = BackgroundService()

    // MARK: - Public state

    /// Parsed manifest once loaded from the bundle. `nil` until `load()`
    /// runs — `currentImageURL(...)` returns `nil` until then, which
    /// pushes `recompute()` into the wash-only fallback branch and
    /// `BackgroundView` renders just the wash bed.
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
    ///
    /// **No UserDefaults seeding on cold launch.** An earlier version of
    /// this service persisted the last-resolved URL to `UserDefaults` and
    /// re-read it at init so the wallpaper could paint synchronously
    /// before `/config` returned. That produced two regressions: (1) the
    /// previous user's URL leaked into the next sign-in (the
    /// UserDefaults key survived sign-out and `wipeAllData()`), and (2)
    /// every cold launch painted a stale photo that visibly swapped to
    /// the freshly-resolved one when the manifest landed. Now the
    /// wallpaper starts as `BackgroundService.defaultWashColor` (the
    /// burnt-umber wash bed) and the resolved photo fades in on top
    /// once `load()` + `recompute()` complete — see
    /// `BackgroundView.paintAnimation`.
    private(set) var currentRemoteURL: URL?

    /// Current solid color when style is "solid".
    private(set) var currentSolidColor: Color?

    /// Stable identity that drives the crossfade animation. Changes
    /// whenever the rendered image changes. Empty string means "no
    /// image resolved yet" — `BackgroundView` renders only the wash bed
    /// in that state.
    private(set) var displayedKey: String = ""

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

    /// Today's task count (overdue + due today). Pushed in via
    /// `updateBusyness(...)` from the Today page's `@Query`-backed
    /// item list. Used to compute the active `BusynessTier` whenever
    /// the wallpaper resolves. 0 until the first push lands.
    private var lastMeetingCount: Int = 0
    private var lastTaskCount: Int = 0
    /// User's 14-day average busyness score, server-computed via
    /// `POST /users/busyness-sync` and synced into `UserProfile`.
    /// `nil` means "no baseline yet" — see `Self.busynessTier(...)`
    /// for the new-user fallback.
    private var lastAvgBusynessScore: Double? = nil

    /// Shuffle-without-replacement state for auto-mode image picks.
    /// `shownPaths` is the set of manifest paths we've already
    /// served in the active (style, segment, tier) slot;
    /// `lastSlotKey` is the key for that slot. When the slot key
    /// changes — either because the user crosses a time-of-day
    /// boundary, their busyness flips, or they switch style — we
    /// reset both. Mirrors the desktop `shownRef` / `categoryRef`
    /// pattern in `apps/desktop/src/hooks/useBackground.ts`.
    private var shownPaths: Set<String> = []
    private var lastSlotKey: String = ""

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

    /// Reset the in-memory renderer state — and the bootstrap
    /// (`manifest`, `storageBaseUrl`) — so a test starts from a known
    /// "first launch ever" baseline. The singleton survives between
    /// tests, so without this a test that resolved a URL leaves the
    /// next test asserting on stale state. Bootstrap state is included
    /// because the wash-only fallback only triggers when
    /// `storageBaseUrl` is `nil` — a test that asserts on the
    /// fallback path needs the bootstrap cleared, not just the
    /// renderer state.
    func debug_resetRemoteCache() {
        manifest = nil
        storageBaseUrl = nil
        currentRemoteURL = nil
        currentSolidColor = nil
        displayedKey = ""
        currentWashColor = Self.defaultWashColor
        lastProfileStyle = nil
        lastProfilePinned = nil
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
        // Register so `Session.tearDown()` (called from `AuthManager.signOut`
        // and `clearInvalidSession`) wipes the resolved wallpaper before the
        // next sign-in. Without this, user A's pinned photo paints behind
        // user B's first frame post-login, and user B's first cold launch
        // sees user A's photo swap to their own — exactly the leak this
        // service was rebuilt to prevent.
        ClearableStoreRegistry.register(self)
    }

    // MARK: - Clearable

    /// Wipe in-memory wallpaper state on sign-out. Called from
    /// `ClearableStoreRegistry.clearAll()` immediately before
    /// `PersistenceController.wipeAllData()` removes the SwiftData
    /// `UserProfile` row that drove the resolution. Resetting here
    /// ensures the next render — whether it's the sign-in screen, an
    /// in-process user switch, or the first frame of a fresh sign-in
    /// — starts from the wash bed, not the prior session's photo.
    ///
    /// **Why we also wipe `manifest` + `storageBaseUrl`:** there's a
    /// brief render-batching window between this method running and
    /// `wipeAllData()` finishing, in which SignInView's BackgroundView
    /// can mount, observe the still-present prior-user UserProfile row
    /// via `@Query`, and call `updateProfile(...)` with stale values.
    /// If `storageBaseUrl` is still cached, `currentImageURL(...)`
    /// happily resolves the prior user's pinned URL → leaked photo.
    /// Clearing the bootstrap forces `currentImageURL(...)` to return
    /// `nil` for that intervening call, so the worst case stays at
    /// "wash bed for an extra ~100ms on the next sign-in" instead of
    /// "prior user's photo flashes on the sign-in screen." SwiftUI's
    /// render batching usually hides the race in practice, but
    /// `Clearable` is expected to be defensive about exactly this
    /// kind of cross-session leak.
    func clearForSignOut() {
        manifest = nil
        storageBaseUrl = nil
        currentRemoteURL = nil
        currentSolidColor = nil
        displayedKey = ""
        currentWashColor = Self.defaultWashColor
        lastProfileStyle = nil
        lastProfilePinned = nil
    }

    // MARK: - Manifest

    /// Mirrors `packages/business/src/data/background-manifest.json`.
    /// Codable — we both decode from bundle / network AND encode to
    /// disk for the next cold launch (see `refreshManifestFromAPI`).
    struct BackgroundManifest: Codable {
        let version: Int?
        let sets: Sets

        struct Sets: Codable {
            let photography: Segments
            let abstract: Segments
        }

        struct Segments: Codable {
            let dawn: BusynessTiers
            let morning: BusynessTiers
            let afternoon: BusynessTiers
            let goldenHour: BusynessTiers
            let evening: BusynessTiers
            let night: BusynessTiers
        }

        struct BusynessTiers: Codable {
            let light: [String]
            let moderate: [String]
            let packed: [String]
        }
    }

    /// Busyness tier — light / moderate / packed. Drives which slot
    /// of the manifest we pick from. Mirrors `BusynessTier` in
    /// `@brett/business/background.ts`.
    enum BusynessTier: String {
        case light, moderate, packed
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
    /// the bundled fallback is only decoded once, the network manifest is
    /// re-fetched each call (cheap; the server caches at the edge for 5
    /// minutes), and the config fetch is retried on each call so a dev
    /// flipping between networks gets the fresh value.
    func load() async {
        loadManifestIfNeeded()
        await loadConfigIfNeeded()
        // Fire the network manifest fetch AFTER the config call has
        // landed `storageBaseUrl` — clients won't be able to resolve
        // any URLs without a base anyway, so there's no point trying
        // to publish a fresh manifest before that's resolved. This
        // also keeps a single load() call deterministic for tests.
        await refreshManifestFromAPI()
    }

    private func loadManifestIfNeeded() {
        guard manifest == nil else { return }
        // Prefer the cached network manifest written by a prior
        // `refreshManifestFromAPI()` — that's the user's most recently
        // seen catalog. Bundled fallback is the cold-launch /
        // offline / first-ever-launch path.
        if let cached = loadCachedManifest() {
            self.manifest = cached
            return
        }
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

    // MARK: - Network manifest

    /// Location of the cached server-fetched manifest. App-support
    /// rather than caches so iOS doesn't reclaim it under memory
    /// pressure — losing this would silently downgrade the user to
    /// the bundled (potentially stale) manifest on next launch.
    private static let cachedManifestURL: URL? = {
        let fm = FileManager.default
        guard let dir = try? fm.url(for: .applicationSupportDirectory,
                                    in: .userDomainMask,
                                    appropriateFor: nil,
                                    create: true) else { return nil }
        return dir.appendingPathComponent("background-manifest.json")
    }()

    private func loadCachedManifest() -> BackgroundManifest? {
        guard let url = Self.cachedManifestURL,
              FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(BackgroundManifest.self, from: data)
    }

    /// Pull the live manifest from `/config/background-manifest` and
    /// adopt it if it differs from what we currently have loaded.
    /// Fire-and-forget — failures leave the bundled or previously-cached
    /// manifest in place. Writes through to disk so the next cold
    /// launch reads the network version before the bundled one.
    ///
    /// Mirrors desktop's "manifest comes from the monorepo build" —
    /// just shifted from build-time to runtime so iOS gets new
    /// wallpaper picks on the next foreground rather than the next
    /// App Store release.
    private func refreshManifestFromAPI() async {
        do {
            let fetched: BackgroundManifest = try await client.request(
                BackgroundManifest.self,
                path: "/config/background-manifest",
                method: "GET"
            )
            // Skip the write + recompute when the fetched manifest is
            // byte-identical to what we already have. Cheap to check
            // (server sends version + tier counts; we compare counts).
            if let current = manifest, manifestsEquivalent(current, fetched) { return }
            self.manifest = fetched
            // Reset the shuffle bookkeeping — the slot composition
            // may have changed, so prior shownPaths are no longer a
            // valid exclude list against the new pool.
            shownPaths.removeAll()
            lastSlotKey = ""
            // Persist for next cold launch. Failures here (disk full,
            // missing app-support dir) are non-fatal — the in-memory
            // manifest is in effect for this session and the next
            // foreground will re-fetch from the network anyway — but
            // log them so a degenerate device shows up in diagnostics
            // instead of silently falling back to the bundled v2
            // forever.
            if let url = Self.cachedManifestURL {
                do {
                    let data = try JSONEncoder().encode(fetched)
                    try data.write(to: url, options: .atomic)
                } catch {
                    BrettLog.app.error("BackgroundService: manifest cache write failed: \(String(describing: error), privacy: .public)")
                }
            }
            // Republish so the new pool is in effect immediately.
            recompute()
        } catch {
            BrettLog.app.error("BackgroundService: manifest refresh failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Cheap structural equivalence — same version + same tier sizes
    /// across all slots of BOTH the photography and abstract sets.
    /// Avoids re-publishing the manifest when the network fetch
    /// returns content equivalent to what we already have.
    ///
    /// Note: this is a count-based check, not a deep URL comparison.
    /// A manifest that keeps the same tier sizes but swaps URLs
    /// in-place (e.g. replacing a single photo with a new one of
    /// the same tier) would compare equal — we'd stick with the
    /// loaded manifest until the next cold launch picks up the
    /// network version from disk. That's an acceptable trade for
    /// the simplicity; in practice tier sizes change whenever the
    /// catalog meaningfully changes.
    private func manifestsEquivalent(_ a: BackgroundManifest, _ b: BackgroundManifest) -> Bool {
        guard a.version == b.version else { return false }
        for style: Style in [.photography, .abstract] {
            let aSegments = Self.segments(for: style, in: a)
            let bSegments = Self.segments(for: style, in: b)
            for segment in Segment.allCases {
                let aTiers = Self.tier(for: segment, in: aSegments)
                let bTiers = Self.tier(for: segment, in: bSegments)
                if aTiers.light.count != bTiers.light.count ||
                   aTiers.moderate.count != bTiers.moderate.count ||
                   aTiers.packed.count != bTiers.packed.count {
                    return false
                }
            }
        }
        return true
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
        // Re-run recompute so a stale-segment cached URL (long
        // background period crossing a time-of-day boundary, e.g.
        // overnight) is refreshed on foreground. Same-segment caches
        // are preserved by `recompute()`, so the original "no
        // spurious crossfade on resume" intent is unchanged for the
        // common short-background case. See #161.
        recompute()
        startTick()
    }

    /// Push today's busyness inputs so the next `recompute()` /
    /// `rotate()` picks from the correct (segment, tier) slot. Caller
    /// is expected to be `TodayPage` (which has the `@Query`-backed
    /// item + event lists plus the `UserProfile` row in scope). The
    /// 14-day average is server-computed and synced via
    /// `POST /users/busyness-sync` → `UserProfile.avgBusynessScore`;
    /// pass `nil` when no baseline exists yet (the tier function
    /// falls back to fixed thresholds in that case).
    ///
    /// Re-runs `recompute()` so the wallpaper reflects the new tier
    /// without waiting for the 60s tick — analogous to how
    /// `updateProfile` re-resolves when style/pinned changes.
    func updateBusyness(meetingCount: Int, taskCount: Int, avgBusynessScore: Double?) {
        let changed =
            lastMeetingCount != meetingCount ||
            lastTaskCount != taskCount ||
            lastAvgBusynessScore != avgBusynessScore
        lastMeetingCount = meetingCount
        lastTaskCount = taskCount
        lastAvgBusynessScore = avgBusynessScore
        // Only recompute when something actually changed. The Today
        // page can call this on every `body` eval (cheap to dedupe
        // here vs. wrapping every consumer in a memo).
        if changed { recompute() }
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

    /// Resolve `currentSolidColor` / `currentRemoteURL` from the
    /// last-known profile values.
    ///
    /// **Auto mode preserves the in-memory URL across reruns within a
    /// session.** Once `applyRemote(url:)` has populated
    /// `currentRemoteURL`, subsequent recomputes (foreground resume,
    /// re-pushed profile, manifest reload) keep it as long as the
    /// segment still matches the current hour — otherwise they pick a
    /// fresh URL from the right segment. Cold launch starts with
    /// `currentRemoteURL == nil` (no UserDefaults seeding by design)
    /// and falls into the wash-only branch at the bottom until the
    /// first successful resolve. The 60s ticker calls `rotate()` for
    /// the deliberate in-session photo rotation.
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
        } else if let cached = currentRemoteURL,
                  Self.segment(forURL: cached)
                      == Self.segment(forHour: Calendar.current.component(.hour, from: Date())) {
            // Auto mode + the cached URL's photo belongs to the
            // current time-of-day segment. Keep it — refreshing the
            // wash sample along the way — instead of picking a fresh
            // random URL that would trigger a crossfade to a
            // different photo from the same tier.
            //
            // The segment check guards #161: a long-background period
            // crossing a time-of-day boundary (foregrounding the app at
            // 7 AM after closing it the night before) would otherwise
            // keep the stale night photo until the 60s rotation timer
            // fired. Falling through to the fresh-pick branch below
            // resolves the right segment immediately on resume. (No
            // cold-launch implication anymore — we never seed
            // `currentRemoteURL` from disk; this only matters once
            // `applyRemote` has populated it during a live session.)
            currentSolidColor = nil
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

        // Cold launch, offline, or signed-out — nothing to resolve. Hold
        // the wash bed and clear any prior image state. `BackgroundView`
        // renders the wash alone in this state, and the photo (or solid)
        // fades in on top once `recompute()` is called again with a
        // resolvable profile + loaded `/config`.
        //
        // We deliberately do NOT paint the bundled hour-keyed asset
        // here. That used to be the cold-launch fallback, but it created
        // the exact jank this rewrite removes: paint bundled asset →
        // load completes → swap to remote photo, a visible crossfade
        // the user reads as "old image, then real image."
        currentSolidColor = nil
        currentRemoteURL = nil
        currentWashColor = Self.defaultWashColor
        if !displayedKey.isEmpty { displayedKey = "" }
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
        // Set wash from the in-memory cache synchronously when we have
        // it (avoids a default-color flash on rotation). When we don't,
        // ride the default until `kickWashSample(...)` resolves the
        // download + sample on a background task and writes the real
        // value back. SwiftUI re-paints any subscribed view
        // automatically because `currentWashColor` is a stored
        // `@Observable` property.
        currentWashColor = WashColorSampler.cachedWash(forURL: url)
            ?? Self.defaultWashColor
        kickWashSample(url: url)
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
        // (segment, tier) slot. Busyness inputs come from
        // `updateBusyness(...)` (caller: TodayPage); when the Today
        // page hasn't mounted yet the inputs are 0 and the tier
        // resolves via the new-user fallback (always "light" at
        // score 0). Once items + events land, the tier reflects
        // today's actual workload — same contract as desktop's
        // `useBackground` hook.
        guard let manifest else { return nil }

        let segment = Self.segment(forHour: Calendar.current.component(.hour, from: now))
        let effectiveStyle = Style(rawValue: style) ?? .photography
        let segments = Self.segments(for: effectiveStyle, in: manifest)
        let tiers = Self.tier(for: segment, in: segments)
        let busynessTier = Self.busynessTier(
            meetingCount: lastMeetingCount,
            taskCount: lastTaskCount,
            avgScore: lastAvgBusynessScore
        )
        let paths = Self.paths(forTier: busynessTier, in: tiers)

        // Shuffle-without-replacement bookkeeping. Reset the shown
        // set whenever the slot identity changes (style + segment +
        // tier triple) — otherwise we'd carry over yesterday's
        // already-shown paths into today's morning rotation.
        let slotKey = "\(effectiveStyle.rawValue)/\(segment.rawValue)/\(busynessTier.rawValue)"
        if slotKey != lastSlotKey {
            shownPaths.removeAll()
            lastSlotKey = slotKey
        }

        // Filter to paths we haven't shown yet in this slot. If we've
        // exhausted the slot (e.g. small `dawn/packed` tier with two
        // images, both already shown), reset and re-pick from the
        // full set so the cycle resumes cleanly.
        var available = paths.filter { !shownPaths.contains($0) }
        if available.isEmpty {
            shownPaths.removeAll()
            available = paths
        }
        guard let path = available.randomElement() else { return nil }
        shownPaths.insert(path)
        return url(for: path, portrait: true)
    }

    /// Mirror of `getBusynessTier` in `@brett/business/background.ts`.
    /// Kept private to this service so the only difference between
    /// the two clients is the inputs — never the math. See the TS
    /// source for the rationale on the thresholds (0.7 / 1.3 ratio
    /// when a baseline exists, ≤4 / ≤10 fixed when it doesn't).
    static func busynessTier(meetingCount: Int, taskCount: Int, avgScore: Double?) -> BusynessTier {
        let score = Double(meetingCount * 2 + taskCount)
        if let avg = avgScore, avg > 0 {
            let ratio = score / avg
            if ratio < 0.7 { return .light }
            if ratio <= 1.3 { return .moderate }
            return .packed
        }
        if score <= 4 { return .light }
        if score <= 10 { return .moderate }
        return .packed
    }

    /// Extract the URL list for a single tier out of a Segments
    /// instance. Mirrors the `tiers.light` / `.moderate` / `.packed`
    /// access that the old `currentImageURL` did inline.
    private static func paths(forTier tier: BusynessTier, in tiers: BackgroundManifest.BusynessTiers) -> [String] {
        switch tier {
        case .light: return tiers.light
        case .moderate: return tiers.moderate
        case .packed: return tiers.packed
        }
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

    /// Map an hour (0-23) to a time-of-day segment. Mirrors the
    /// `getTimeSegment` boundaries in `@brett/business/background.ts`
    /// EXACTLY so the desktop and iOS clients land on the same slot
    /// when both look at the local hour: dawn 5–6, morning 7–11,
    /// afternoon 12–16, goldenHour 17–18, evening 19–20, night 21–4.
    ///
    /// (Pre-May-2026 versions of this function used a shifted
    /// boundary set — morning 7–10, afternoon 11–16, etc. — which
    /// pushed iOS into a different segment than desktop for a chunk
    /// of every weekday around 11 AM and at the goldenHour shoulder.
    /// The shifted version was a copy-paste drift from an earlier
    /// spec; this matches desktop's canonical implementation.)
    static func segment(forHour hour: Int) -> Segment {
        switch hour {
        case 5...6: return .dawn
        case 7...11: return .morning
        case 12...16: return .afternoon
        case 17...18: return .goldenHour
        case 19...20: return .evening
        default: return .night // 21-4
        }
    }

    /// Extract a `Segment` from a manifest-shaped URL whose path encodes
    /// the segment as a directory name — e.g. `photo/night/light-2.webp`
    /// or `photo-portrait/golden-hour/light-1.webp`. Returns `nil` for
    /// URLs that don't fit the shape so callers can fall back rather
    /// than misclassify.
    ///
    /// Used by `recompute()` to detect when a cached URL from a prior
    /// session belongs to a different time-of-day segment than "now"
    /// — the cold-launch path that produced #161 (cached night photo
    /// persisting into a morning launch).
    nonisolated static func segment(forURL url: URL) -> Segment? {
        let components = url.pathComponents
        for (idx, comp) in components.enumerated() {
            guard comp == "photo" || comp == "photo-portrait" else { continue }
            let next = idx + 1
            guard next < components.count else { return nil }
            return segment(forFolderName: components[next])
        }
        return nil
    }

    nonisolated private static func segment(forFolderName folder: String) -> Segment? {
        switch folder {
        case "dawn": return .dawn
        case "morning": return .morning
        case "afternoon": return .afternoon
        case "golden-hour": return .goldenHour
        case "evening": return .evening
        case "night": return .night
        default: return nil
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
