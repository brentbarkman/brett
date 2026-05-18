import SwiftUI
import SwiftData

/// Full-screen wallpaper that drives the app's glass aesthetic.
///
/// Three rendering paths, layered bottom-to-top in the ZStack:
///   1. **Wash bed** — always painted. `BackgroundService.currentWashColor`
///      (the burnt-umber default, or a sampled color from the resolved
///      photo). This is what the user sees on cold launch / offline /
///      signed-out states. Photo and solid layers fade in over it.
///   2. **Solid** — when `backgroundStyle == "solid"` and the pinned
///      value is a `"solid:#RRGGBB"` sentinel, render the parsed color
///      over the wash.
///   3. **Remote photo** — when the `BackgroundService` has a manifest
///      and storage URL, render via `AsyncImage` over the wash. The
///      URL is either the user's pinned selection or a random pick
///      from the manifest for the current time-of-day segment.
///
/// **Cold-launch behavior (2026-05-17 rewrite).** The previous design
/// painted a UserDefaults-cached URL synchronously to skip a blank
/// frame, then crossfaded to the resolved URL when `load()` finished.
/// That produced two problems: (1) cross-user leak — the cached URL
/// survived sign-out, so user B's first frame was user A's photo, and
/// (2) a visible "old image then new image" swap on every cold launch
/// when the resolved URL differed from the cached one. Both were fixed
/// by deleting the UserDefaults cache entirely and starting from the
/// wash bed; the resolved photo now fades in over the wash on first
/// paint, and there's no stale URL to leak.
///
/// View architecture: BackgroundView is a *pure observer* of
/// `BackgroundService.shared`. The 60s segment ticker, the resolution
/// pipeline, and `displayedKey` all live in the service. Any number of
/// mounted BackgroundView instances share that single state — before
/// the hoist each instance ran its own ticker, image-decision pipeline,
/// and `@State` slots, which compounded with every pushed nav
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

    /// Tracks whether this view instance has rendered its first
    /// successful image. Drives two distinct animation choices:
    ///
    /// 1. **`paintAnimation`** — the outer `.animation(value: displayedKey)`
    ///    uses the fast 800ms easeOut bloom on cold launch
    ///    (`hasInitialPaint == false`) and the slower 1.5s easeInOut
    ///    rotation crossfade once a photo has been seen.
    /// 2. **`asyncImageTransaction`** — when `hasInitialPaint == false`,
    ///    the `.empty → .success` phase change is animated so the photo
    ///    blooms in over the wash. Once `hasInitialPaint` is true the
    ///    transaction is empty, so a pushed nav destination's new
    ///    BackgroundView (whose URL is already in URLCache and reaches
    ///    `.success` in milliseconds) doesn't get a separate
    ///    wash-bleed-through fade every time the user pushes into a
    ///    list. The outer crossfade still handles in-session rotations.
    ///
    /// Initialised from the service's current key so a view created
    /// during a warm session (`displayedKey` already non-empty) starts
    /// in the post-first-paint state. Latched true → false the first
    /// time `.success` actually renders, NOT when `displayedKey`
    /// becomes non-empty — the distinction matters because bytes can
    /// arrive after the key has changed and we want the bloom
    /// animation to be in effect when they do.
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
    /// one is present; multi-row → fall through to the wash bed
    /// rather than picking up a stale user's preference.
    @Query(sort: \UserProfile.id) private var profiles: [UserProfile]
    private var currentProfile: UserProfile? {
        profiles.count == 1 ? profiles.first : nil
    }

    var body: some View {
        ZStack {
            // Wash bed — always present as the deepest layer. Cold
            // launch and offline states render this alone; resolved
            // images fade in on top via the .transition(.opacity) +
            // AsyncImage transaction below.
            service.currentWashColor
                .ignoresSafeArea()

            // Image / solid layer over the wash. `displayedKey` drives
            // the .id() so SwiftUI swaps the inserted view (and fires
            // the opacity transition) when the resolved photo changes.
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
                        // On cold launch (hasInitialPaint=false) the
                        // transaction animates the `.empty → .success`
                        // phase change, so the photo blooms over the
                        // wash when bytes arrive. After first paint
                        // (and on pushed-view remounts whose URL is
                        // already in URLCache) the transaction is
                        // empty — the outer `.animation(value:)` and
                        // `.transition(.opacity)` handle in-session
                        // rotations, and a pushed view's near-instant
                        // `.empty → .success` snap is invisible at one
                        // frame rather than a 1.5s wash-bleed fade.
                        AsyncImage(
                            url: remoteURL,
                            transaction: asyncImageTransaction
                        ) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .clipped()
                                    // Latch out of the cold-launch
                                    // animation mode now that we've
                                    // actually rendered a photo. We
                                    // wait for `.success` rather than
                                    // the key change because bytes can
                                    // arrive long after the key — and
                                    // the bloom animation needs to
                                    // still be live when they do.
                                    .onAppear {
                                        if !hasInitialPaint { hasInitialPaint = true }
                                    }
                            default:
                                // Loading or failure: render nothing,
                                // wash bed shows through. Never flash
                                // a bundled fallback — that was the
                                // jarring swap this rewrite removes.
                                Color.clear
                            }
                        }
                        .id("remote:\(service.displayedKey)")
                        .transition(.opacity)
                    }
                    // else: no image layer — wash bed alone. No
                    // .id-bearing view inserted, so no transition
                    // fires; the wash is just visible.
                }
            }
            .ignoresSafeArea()
            // `paintAnimation` chooses between the fast first-paint
            // bloom (800ms ease-out, hasInitialPaint=false) and the
            // slower in-session rotation crossfade (1.5s ease-in-out,
            // hasInitialPaint=true). Both honour Reduce Motion. The
            // `hasInitialPaint` latch flips inside the AsyncImage's
            // .success closure, NOT here on the key change — see the
            // doc comment on `hasInitialPaint` for why.
            .animation(paintAnimation, value: service.displayedKey)

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
    private func assetImage(name: String, size: CGSize) -> some View {
        Image(name)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: size.width, height: size.height)
            .clipped()
    }

    /// Per-instance paint animation. First paint of a freshly-mounted
    /// view (cold launch, or any mount before the service resolved a
    /// URL) blooms over the wash with a fast `easeOut` — the photo is
    /// appearing, not transitioning between two photos. Once a key has
    /// landed, subsequent swaps (60s rotation tick, settings change)
    /// use the slower `easeInOut` so the crossfade reads as a smooth
    /// dissolve between two equally-resolved photos. `nil` under
    /// Reduce Motion so the swap is instant.
    private var paintAnimation: Animation? {
        if BrettAnimation.isReduceMotionEnabled { return nil }
        return hasInitialPaint
            ? .easeInOut(duration: 1.5)
            : .easeOut(duration: 0.8)
    }

    /// Transaction passed to `AsyncImage` for its internal
    /// `.empty → .success` phase change. See `hasInitialPaint`'s doc
    /// for the design rationale: animate the phase change ONLY on
    /// this view's first paint, never on subsequent re-mounts or
    /// rotations (where it would compound into a 1.5s
    /// wash-bleed-fade on every push into a list view).
    private var asyncImageTransaction: Transaction {
        if hasInitialPaint {
            return Transaction()
        }
        return Transaction(animation: paintAnimation)
    }
}
