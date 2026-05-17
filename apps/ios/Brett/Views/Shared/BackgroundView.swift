import SwiftUI
import SwiftData

/// Full-screen wallpaper that drives the app's glass aesthetic.
///
/// Three rendering paths:
///   1. **Solid** — when `backgroundStyle == "solid"` and the pinned
///      value is a `"solid:#RRGGBB"` sentinel, render the parsed color.
///   2. **Remote photo** — when the `BackgroundService` has a manifest
///      and storage URL, render via `AsyncImage`. The URL is either the
///      user's pinned selection or a random pick from the manifest for
///      the current time-of-day segment.
///   3. **Fallback** — before the service loads (cold launch, offline),
///      render the bundled asset-catalog image keyed on hour-of-day so
///      the app never boots to a blank screen.
///
/// View architecture: BackgroundView is a *pure observer* of
/// `BackgroundService.shared`. The 60s segment ticker, the resolution
/// pipeline, and the cached `displayedKey` all live in the service. Any
/// number of mounted BackgroundView instances share that single state —
/// before the hoist each instance ran its own ticker, image-decision
/// pipeline, and `@State` slots, which compounded with every pushed nav
/// destination on top of MainContainer.
///
/// Each instance still owns one tiny `@Query<UserProfile>` so it can
/// push profile changes into the service on `.onChange`. SwiftData
/// notifications are cheap to subscribe multiple times against the same
/// container, so the multi-mount cost is negligible.
struct BackgroundView: View {
    /// Optional override — callers (e.g. previews, auth screens) can
    /// pin a specific asset-catalog image and skip the service entirely.
    var imageName: String? = nil

    @State private var service = BackgroundService.shared

    /// Tracks whether the first non-empty image key has landed. The
    /// crossfade animation is suppressed until then so cold launch shows
    /// the wallpaper as "just there" — without this, the empty initial
    /// `displayedKey` swapping to its first resolved value triggers the
    /// 1.5s opacity transition, which reads as the photo animating in
    /// even though there's no Ken Burns scale anymore. Initialised from
    /// the service's current key so a warm process (cached URL already
    /// pinned) skips the gate entirely.
    @State private var hasInitialPaint: Bool = !BackgroundService.shared.displayedKey.isEmpty

    /// Live read of the user's profile. SwiftData is canonical;
    /// `UserProfileStore` is mutation-only after Wave-B Phase 5. The
    /// background view may render on the auth screen with no profile
    /// row present, AND it may render briefly during a sign-out drain
    /// where `Session.tearDown()` has started but `wipeAllData()`
    /// hasn't finished — so >1 row could be visible if a fresh sign-in
    /// races the wipe. `BackgroundView` has no `@Environment(AuthManager)`
    /// (it's used at the auth boundary too), so a userId predicate
    /// isn't available. Defensive: only consume the row when exactly
    /// one is present; multi-row → fall through to the asset fallback
    /// rather than picking up a stale user's preference.
    @Query(sort: \UserProfile.id) private var profiles: [UserProfile]
    private var currentProfile: UserProfile? {
        profiles.count == 1 ? profiles.first : nil
    }

    var body: some View {
        ZStack {
            // Photo / asset / solid layer. Service-owned `displayedKey`
            // drives the crossfade — switching it triggers the 1.5s
            // opacity transition regardless of which rendering path is
            // active.
            GeometryReader { geo in
                ZStack {
                    if let imageName {
                        // Caller pinned an asset — bypass the service
                        // entirely so previews / lock screens look the
                        // way they expect regardless of profile state.
                        assetImage(name: imageName, size: geo.size)
                            .id("asset:\(imageName)")
                            .transition(.opacity)
                    } else if let solidColor = service.currentSolidColor {
                        solidColor
                            .frame(width: geo.size.width, height: geo.size.height)
                            .id("solid:\(service.displayedKey)")
                            .transition(.opacity)
                    } else if let remoteURL = service.currentRemoteURL {
                        AsyncImage(url: remoteURL) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .clipped()
                            default:
                                fallbackImage(size: geo.size)
                            }
                        }
                        .id("remote:\(service.displayedKey)")
                        .transition(.opacity)
                    } else {
                        fallbackImage(size: geo.size)
                            .id("asset:\(service.displayedKey)")
                            .transition(.opacity)
                    }
                }
            }
            .ignoresSafeArea()
            // Cold-launch first paint gets a short 0.6s ease-in so the photo
            // "lifts in" instead of snapping into existence. Subsequent
            // rotations use the longer 2.0s crossfade for that calm,
            // unhurried transition between time segments / tier shifts.
            .animation(hasInitialPaint ? crossfadeAnimation : firstPaintAnimation, value: service.displayedKey)
            .onChange(of: service.displayedKey, initial: false) { _, newKey in
                if !hasInitialPaint && !newKey.isEmpty {
                    hasInitialPaint = true
                }
            }

            // Top vignette for status bar readability
            VStack {
                LinearGradient(
                    colors: [Color.black.opacity(0.55), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 140)
                Spacer()
            }

            // Bottom vignette for omnibar readability
            VStack {
                Spacer()
                LinearGradient(
                    colors: [Color.clear, Color.black.opacity(0.55)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 160)
            }

            // Subtle overall darkening to help glass cards pop
            Color.black.opacity(0.15)
        }
        .ignoresSafeArea()
        // `onAppear` / `onDisappear` are paired synchronous lifecycle
        // hooks — register/unregister the renderer here so the
        // ref-count can't drift if the view is dismissed during the
        // async `.task` below. (Earlier draft put `registerRenderer()`
        // inside the .task after `await service.load()`; if the user
        // dismissed a sheet-mounted BackgroundView during the network
        // round-trip, `onDisappear` would unregister with count == 0
        // — clamped to 0 — and then the resumed task would register
        // anyway, leaking a permanent +1 each cycle.)
        .onAppear {
            guard imageName == nil else { return }
            service.registerRenderer()
            // Push initial profile so the service can render whatever's
            // available right now (cached fallback or the previous
            // session's resolved key) without waiting on `.task`.
            service.updateProfile(
                style: currentProfile?.backgroundStyle,
                pinned: currentProfile?.pinnedBackground,
                initial: true
            )
        }
        .task {
            // Manifest + storageBaseUrl come from a network call, so the
            // load lives in `.task` (cancelled with view lifecycle).
            // After load completes, push the profile again so the
            // service recomputes against the now-resolved manifest.
            guard imageName == nil else { return }
            await service.load()
            service.updateProfile(
                style: currentProfile?.backgroundStyle,
                pinned: currentProfile?.pinnedBackground
            )
        }
        .onDisappear {
            guard imageName == nil else { return }
            service.unregisterRenderer()
        }
        .onChange(of: currentProfile?.backgroundStyle) { _, _ in
            guard imageName == nil else { return }
            service.updateProfile(
                style: currentProfile?.backgroundStyle,
                pinned: currentProfile?.pinnedBackground
            )
        }
        .onChange(of: currentProfile?.pinnedBackground) { _, _ in
            guard imageName == nil else { return }
            service.updateProfile(
                style: currentProfile?.backgroundStyle,
                pinned: currentProfile?.pinnedBackground
            )
        }
    }

    @ViewBuilder
    private func fallbackImage(size: CGSize) -> some View {
        Image(assetName)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: size.width, height: size.height)
            .clipped()
    }

    @ViewBuilder
    private func assetImage(name: String, size: CGSize) -> some View {
        Image(name)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: size.width, height: size.height)
            .clipped()
    }

    /// Asset name for the fallback path. Prefers the service's
    /// `currentFallbackAsset` (set during a successful recompute), falls
    /// back to the hour-keyed default for the cold-launch window where
    /// the service hasn't run yet.
    private var assetName: String {
        if let imageName { return imageName }
        let serviceFallback = service.currentFallbackAsset
        if !serviceFallback.isEmpty { return serviceFallback }
        return BackgroundService.assetNameForHour(Calendar.current.component(.hour, from: Date()))
    }

    /// 2.0s ease-in-out crossfade between wallpapers (rotation, segment
    /// boundary, busyness tier change, settings pin swap). Matches the
    /// desktop CROSSFADE_MS constant — keeps platforms feeling identical.
    /// `nil` under Reduce Motion so the swap is instant.
    private var crossfadeAnimation: Animation? {
        BrettAnimation.isReduceMotionEnabled
            ? nil
            : .easeInOut(duration: 2.0)
    }

    /// Cold-launch first paint — 0.6s ease-in so the wallpaper lifts in
    /// gently instead of snapping. Shorter than the rotation crossfade so
    /// the user isn't waiting on a long fade just to see their app.
    private var firstPaintAnimation: Animation? {
        BrettAnimation.isReduceMotionEnabled
            ? nil
            : .easeIn(duration: 0.6)
    }
}
