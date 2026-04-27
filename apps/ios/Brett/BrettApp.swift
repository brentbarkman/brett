import GoogleSignIn
import SwiftData
import SwiftUI

@main
struct BrettApp: App {
    /// Single source of truth for auth state. Injected into the environment
    /// so SignInView (and anything else that needs sign-out) can read it.
    @State private var authManager: AuthManager

    /// Bridges iOS's UIApplicationDelegate callbacks into SwiftUI. Today
    /// its only job is `handleEventsForBackgroundURLSession` so the
    /// `BackgroundUploadService` can finish attachment transfers that
    /// completed while the app was suspended.
    @UIApplicationDelegateAdaptor(BrettAppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        // UI-test launch-arg interception: run BEFORE AuthManager/APIClient
        // singletons are touched so `PersistenceController.configureForTesting`
        // has a chance to install the in-memory container first.
        let args = ProcessInfo.processInfo.arguments

        if args.contains("-UITEST_IN_MEMORY_DATA") {
            PersistenceController.configureForTesting(inMemory: true)
        }

        let manager = AuthManager()
        if args.contains("-UITEST_FAKE_AUTH") {
            manager.injectFakeSession(user: .testUser, token: "uitest-token")
            // Seed a predictable task into SwiftData so tests that don't
            // rely on Omnibar→SwiftData wiring still see content on
            // TodayPage. Safe: the container is in-memory when this path
            // is exercised.
            Self.seedUITestFixtures(userId: AuthUser.testUser.id)
        }
        self._authManager = State(wrappedValue: manager)
        // Route user-scoped UserDefaults reads through the live AuthManager.
        UserScopedStorage.configure { [weak manager] in manager?.currentUser?.id }
        // Shake-to-report runs at the UIWindow level so it can present
        // over any active sheet (TaskDetailView, SearchSheet, etc.). See
        // FeedbackPresenter for why this isn't a SwiftUI .onShake.
        FeedbackPresenter.shared.install(authManager: manager)
        #else
        let manager = AuthManager()
        self._authManager = State(wrappedValue: manager)
        UserScopedStorage.configure { [weak manager] in manager?.currentUser?.id }
        FeedbackPresenter.shared.install(authManager: manager)
        #endif
    }

    #if DEBUG
    /// Inserts a known-good active task + a default list into the shared
    /// (in-memory) SwiftData container. Called once at UI-test launch.
    private static func seedUITestFixtures(userId: String) {
        let context = PersistenceController.shared.mainContext

        let list = ItemList(
            userId: userId,
            name: "Work",
            colorClass: "bg-blue-500",
            sortOrder: 0
        )
        context.insert(list)

        let seededItem = Item(
            userId: userId,
            type: .task,
            status: .active,
            title: "Review design spec",
            source: "uitest",
            dueDate: Calendar.current.startOfDay(for: Date()),
            listId: list.id,
            createdAt: Date(),
            updatedAt: Date()
        )
        context.insert(seededItem)

        try? context.save()
    }
    #endif

    /// Route an inbound URL to the right handler. Scheme whitelist
    /// prevents a crafted `malicious://...` URL from reaching GIDSignIn
    /// (which takes every URL it's handed and tries to parse it as an
    /// OAuth callback — low risk today but a liability for any future
    /// deep-link work that reuses the handler). Unknown schemes are
    /// silently dropped.
    private func handleOpenURL(_ url: URL) {
        guard let scheme = url.scheme?.lowercased() else { return }

        // Google OAuth callback scheme is `com.googleusercontent.apps.<id>`,
        // injected into Info.plist via `GOOGLE_IOS_URL_SCHEME` at build time.
        // Compare against the exact expected value (read from the bundle) so
        // a malicious app registering `com.googleusercontent.apps.evil://`
        // doesn't reach GIDSignIn.handle(). The prefix-match approach is
        // permissive by accident — this one fails closed for anything but
        // the Google SDK's actual callback.
        if let expected = Bundle.main.object(forInfoDictionaryKey: "GOOGLE_IOS_URL_SCHEME") as? String,
           scheme == expected.lowercased() {
            _ = GIDSignIn.sharedInstance.handle(url)
            return
        }

        // Reserved for future first-party deep links (magic email links,
        // invitations, reminder reopens). No-op today; incoming `brett://`
        // URLs we don't understand are dropped rather than routed blindly.
        if scheme == "brett" {
            BrettLog.app.info("Dropped unsupported brett:// URL — no handler registered")
            return
        }

        // Anything else is out-of-bounds. Fail closed.
        BrettLog.app.info("Dropped inbound URL with unrecognized scheme")
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authManager)
                .environment(APIClient.shared)
                .preferredColorScheme(.dark)
                // Global accent = gold. Without this, iOS system chrome
                // (TextField `prompt:` text, autofill suggestions, focus
                // rings, picker accents, Link tint) renders in system
                // blue — visually identical to cerulean. Cerulean is
                // reserved for Brett AI surfaces, which opt in via
                // explicit `foregroundStyle(BrettColors.cerulean)` or
                // `StickyCardSection(tint: ...)` overrides — those aren't
                // affected by this modifier.
                .tint(BrettColors.gold)
                // Inbound URL handler. Whitelisted to schemes we declare in
                // Info.plist (`brett://` and the Google reversed-client-id)
                // so a malicious URL with some other scheme can't even
                // reach `GIDSignIn.handle`. Returning without consuming is
                // the fail-closed default.
                .onOpenURL { url in
                    handleOpenURL(url)
                }
        }
        // Single shared ModelContainer owned by `PersistenceController` —
        // registers every @Model type (domain + sync infra) in one place
        // and lets tests/previews swap in in-memory containers.
        .modelContainer(PersistenceController.shared.container)
    }
}

/// Top-level auth gate. Cross-fades between SignInView and MainContainer
/// based on `AuthManager.isAuthenticated`.
///
/// Sync + SSE lifecycle used to live here — RootView observed
/// `isAuthenticated` and called `SyncManager.shared.start/stop`. That meant
/// the engines were still a process-wide singleton that could leak a
/// half-flight push across account switches. Ownership moved to
/// `AuthManager.persist(session:)` + `signOut()`, which install and tear
/// down a `Session` (see `ActiveSession.swift`). RootView now only drives
/// biometric gate + share-extension drain + shake monitoring.
private struct RootView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var lockManager = BiometricLockManager.shared

    var body: some View {
        ZStack {
            if authManager.isAuthenticated {
                // Biometric gate: sits between sign-in and the real app.
                // When the user has Face ID enabled, `BiometricLockView`
                // auto-prompts and only yields to `MainContainer` on
                // successful authentication.
                if lockManager.isLocked {
                    BiometricLockView()
                        .transition(.opacity)
                } else {
                    MainContainer()
                        .transition(.opacity)
                        .task {
                            // Fires once per authenticated mount — covers the
                            // cold-launch "already signed in at launch" path
                            // where `.onChange(of: isAuthenticated)` never
                            // transitions and therefore never prompts.
                            //
                            // Sync / SSE lifecycle is deliberately NOT started
                            // here — `AuthManager.persist(session:)` already
                            // installs an `ActiveSession` which owns both.
                            // Only the badge-permission prompt is view-level.
                            await BadgeManager.shared.requestAuthorization()
                        }
                }
            } else {
                SignInView()
                    .transition(.opacity)
            }

            // App-switcher privacy cover. When iOS transitions the scene
            // to `.inactive` it snapshots the window for the task-switcher
            // thumbnail. Without this overlay, that snapshot shows whatever
            // the user had open — inbox contents, calendar events, chat
            // threads — to anyone who swipes to the app switcher while the
            // phone is unlocked. Opaque BackgroundView matches our brand
            // atmospheric chrome and avoids a flash of black.
            //
            // Intentionally outside the auth/lock switch so it covers
            // SignInView too (email field) and BiometricLockView (less
            // sensitive, but we may add recent-activity glances later).
            if scenePhase != .active {
                BackgroundView()
                    .ignoresSafeArea()
                    .transition(.opacity)
                    .zIndex(1000)
                    .accessibilityHidden(true)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: authManager.isAuthenticated)
        .animation(.easeInOut(duration: 0.25), value: lockManager.isLocked)
        .animation(.easeInOut(duration: 0.15), value: scenePhase)
        // Biometric lock lifecycle only — sync/SSE are handled by AuthManager.
        .onChange(of: authManager.isAuthenticated) { _, isAuth in
            if isAuth {
                // Fresh credentials > biometric gate. Don't immediately
                // prompt the user for Face ID right after they typed
                // their password.
                lockManager.handleFreshSignIn()
                Task { await BadgeManager.shared.requestAuthorization() }
            } else {
                lockManager.handleSignOut()
                // Fire-and-forget: sign-out is always a foreground action,
                // so setBadgeCount(0) lands before the process suspends.
                // Worst case on drop: stale badge until next launch, which
                // the cold-launch refresh in MainContainer will overwrite.
                Task { await BadgeManager.shared.clear() }
            }
        }
        // Scene-phase drives the biometric re-lock. Backgrounding the
        // app flips `isLocked` on (when enabled); returning to
        // foreground triggers a fresh prompt. We also invalidate any
        // pending auth context on background so the prompt doesn't
        // re-appear stale.
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                lockManager.handleDidEnterBackground()
                // Stop accelerometer polling while backgrounded — no
                // shake gestures matter when we're not visible, and
                // stopping saves a small but real amount of battery.
                ShakeMonitor.shared.stop()
            case .active:
                lockManager.handleWillEnterForeground()
                // Resume shake-to-report. Idempotent — no-op if already
                // running (covers the cold-launch path too where the
                // .task below also calls start()).
                ShakeMonitor.shared.start()
                // Drain any payloads the share extension left in the
                // App Group queue. Runs every time the app becomes
                // active so in-foreground shares reconcile quickly too.
                ShareIngestor.shared.configure(auth: authManager)
                Task { await ShareIngestor.shared.drain() }
                // Foreground keepalive: re-validate the session in case
                // it was revoked server-side while we were backgrounded.
                // Throttled to one call per 5 minutes inside AuthManager so
                // rapid app-switches don't hammer /users/me.
                Task { await authManager.refreshIfStale() }
            default:
                break
            }
        }
        .task {
            // Cold launch — kick off shake detection. The scenePhase
            // hook above keeps it in sync afterward.
            ShakeMonitor.shared.start()
            // Also drain on cold launch — the .active scenePhase change
            // fires on first render, but belt-and-braces covers any case
            // where the user opens the app directly after a share and
            // the hook hasn't wired yet.
            ShareIngestor.shared.configure(auth: authManager)
            Task { await ShareIngestor.shared.drain() }
        }
    }

    // UI-test isolation: `AuthManager.injectFakeSession` deliberately sets
    // `token` + `currentUser` directly without calling `installSession`, so
    // UI-test launches keep `ActiveSession.syncManager` nil and every store
    // mutation silently no-ops the network side. Tests that need a real
    // sync path stub `APIClient` via `MockURLProtocol` instead.
}
