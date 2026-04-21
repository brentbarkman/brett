import SwiftUI

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
/// The 1.5s crossfade + vignettes + 15% dark overlay from the earlier
/// prototype are preserved — those are the visual primitives every
/// screen in the app layers glass cards on top of.
struct BackgroundView: View {
    /// Optional override — callers (e.g. previews, auth screens) can
    /// pin a specific asset-catalog image and skip the service entirely.
    var imageName: String? = nil

    @State private var profileStore = UserProfileStore()
    @State private var service = BackgroundService.shared

    /// Image key currently being rendered. Drives the crossfade via
    /// `.animation(_, value:)`. For remote images the key is the URL
    /// string; for assets it's the image name; for solids it's the hex.
    /// Seeded from the last-wallpaper cache so cold-launch paints the
    /// previous image immediately from URLCache — no asset→remote swap.
    @State private var displayedKey: String = BackgroundService.cachedRemoteURL?.absoluteString ?? ""

    /// URL of the current remote image, if any. Held alongside the key
    /// so we don't rebuild the URL on every render. Seeded from the
    /// last-URL cache — see `displayedKey`.
    @State private var remoteURL: URL? = BackgroundService.cachedRemoteURL

    /// Parsed color for the solid-style path. `nil` unless the user
    /// picked a solid.
    @State private var solidColor: Color?

    /// Fallback asset name used when neither remote image nor solid
    /// applies. Keyed on hour-of-day.
    @State private var fallbackAsset: String = ""

    /// Poll every 60s so the background swaps as segments tick over
    /// (dawn -> morning, etc.). Cheap — the remote image is cached by
    /// URLSession and SwiftUI skips renders when `displayedKey` is
    /// unchanged.
    private let tick = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            // Photo / asset / solid layer. `displayedKey` drives the
            // crossfade — switching it triggers the 1.5s opacity
            // transition regardless of which rendering path is active.
            GeometryReader { geo in
                ZStack {
                    if let solidColor {
                        solidColor
                            .frame(width: geo.size.width, height: geo.size.height)
                            .id("solid:\(displayedKey)")
                            .transition(.opacity)
                    } else if let remoteURL {
                        AsyncImage(url: remoteURL) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .clipped()
                            default:
                                // While loading, hold the previous
                                // crossfade target so we don't flash
                                // black between manifest ticks. The
                                // fallback asset renders underneath
                                // this branch anyway — see the else
                                // clause below for details.
                                fallbackImage(size: geo.size)
                            }
                        }
                        .id("remote:\(displayedKey)")
                        .transition(.opacity)
                    } else {
                        fallbackImage(size: geo.size)
                            .id("asset:\(displayedKey)")
                            .transition(.opacity)
                    }
                }
            }
            .ignoresSafeArea()
            .animation(crossfadeAnimation, value: displayedKey)

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
        .task {
            await service.load()
            refresh(initial: true)
        }
        .onReceive(tick) { _ in
            refresh(initial: false)
        }
        .onChange(of: profileStore.current?.backgroundStyle) { _, _ in
            refresh(initial: false)
        }
        .onChange(of: profileStore.current?.pinnedBackground) { _, _ in
            refresh(initial: false)
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

    /// Name of the asset-catalog fallback image for the current hour.
    /// Kept in sync with the pre-service behavior so the app never
    /// boots to a blank screen.
    private var assetName: String {
        if let imageName { return imageName }
        if !fallbackAsset.isEmpty { return fallbackAsset }
        return Self.assetNameForHour(Calendar.current.component(.hour, from: Date()))
    }

    private static func assetNameForHour(_ hour: Int) -> String {
        switch hour {
        case 5..<8: return "bg-morning"
        case 8..<12: return "bg-morning"
        case 12..<17: return "bg-golden"
        case 17..<20: return "bg-evening"
        default: return "bg-night"
        }
    }

    /// Set `displayedKey` without the view-level crossfade animation.
    /// Used on the first resolution after launch so cold-launch never
    /// fades from one image to another — the user sees one image settle
    /// in under the awakening cover.
    private func setDisplayedKeyWithoutAnimation(_ newKey: String) {
        var tx = Transaction(animation: nil)
        withTransaction(tx) { displayedKey = newKey }
    }

    /// Recompute `solidColor`, `remoteURL`, and `displayedKey` from
    /// whatever the profile currently says. `initial` suppresses the
    /// crossfade on the first call so the app doesn't fade in from
    /// nothing at launch.
    private func refresh(initial: Bool) {
        // If the caller pinned a specific asset, honor that and stop.
        if let imageName {
            if initial {
                fallbackAsset = imageName
                setDisplayedKeyWithoutAnimation(imageName)
            } else if displayedKey != imageName {
                displayedKey = imageName
            }
            return
        }

        let profile = profileStore.current
        let style = profile?.backgroundStyle ?? BackgroundStyle.photography.rawValue
        let pinned = profile?.pinnedBackground

        // Solid path — parse the hex from the pinned sentinel. If the
        // profile says "solid" but pinned is nil / malformed, fall
        // through to the photography path so the user still sees
        // something.
        if style == BackgroundStyle.solid.rawValue,
           let pinned,
           pinned.hasPrefix("solid:") {
            let hex = String(pinned.dropFirst("solid:".count))
            if let color = BackgroundService.color(forHex: hex) {
                remoteURL = nil
                solidColor = color
                let key = "solid:\(hex)"
                if initial {
                    setDisplayedKeyWithoutAnimation(key)
                } else if displayedKey != key {
                    displayedKey = key
                }
                return
            }
        }

        // Remote / auto path. Delegate to the service which picks a
        // manifest image based on hour-of-day (auto) or the pinned
        // path.
        let effectiveStyle: String = {
            if style == BackgroundStyle.solid.rawValue { return BackgroundStyle.photography.rawValue }
            if style == BackgroundStyle.gradient.rawValue { return BackgroundStyle.photography.rawValue }
            return style
        }()

        if let url = service.currentImageURL(style: effectiveStyle, pinned: pinned) {
            solidColor = nil
            remoteURL = url
            BackgroundService.cachedRemoteURL = url
            let key = url.absoluteString
            if initial {
                setDisplayedKeyWithoutAnimation(key)
            } else if displayedKey != key {
                displayedKey = key
            }
            return
        }

        // Fallback — service not ready or manifest empty. Asset
        // catalog image keyed on hour-of-day.
        let asset = Self.assetNameForHour(Calendar.current.component(.hour, from: Date()))
        fallbackAsset = asset
        solidColor = nil
        remoteURL = nil
        if initial {
            setDisplayedKeyWithoutAnimation(asset)
        } else if displayedKey != asset {
            displayedKey = asset
        }
    }

    /// 1.5s ease-in-out crossfade, or `nil` when Reduce Motion is on so
    /// the image swap is instant.
    private var crossfadeAnimation: Animation? {
        BrettAnimation.isReduceMotionEnabled
            ? nil
            : .easeInOut(duration: 1.5)
    }
}
