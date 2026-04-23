import GoogleSignIn
import SwiftData
import SwiftUI

@main
struct BrettApp: App {
    /// Single source of truth for auth state. Injected into the environment
    /// so SignInView (and anything else that needs sign-out) can read it.
    @State private var authManager: AuthManager

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
        #else
        let manager = AuthManager()
        self._authManager = State(wrappedValue: manager)
        UserScopedStorage.configure { [weak manager] in manager?.currentUser?.id }
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
                // GoogleSignIn-iOS finishes its OAuth dance by redirecting to
                // the reversed client-ID URL scheme. The SDK needs to see
                // that redirect to complete the pending sign-in call, so we
                // hand every inbound URL to it. Returns `true` if the SDK
                // consumed the URL; otherwise it's ours to ignore (or route
                // elsewhere in the future — deep links, magic email links).
                .onOpenURL { url in
                    _ = GIDSignIn.sharedInstance.handle(url)
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
                }
            } else {
                SignInView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: authManager.isAuthenticated)
        .animation(.easeInOut(duration: 0.25), value: lockManager.isLocked)
        // Biometric lock lifecycle only — sync/SSE are handled by AuthManager.
        .onChange(of: authManager.isAuthenticated) { _, isAuth in
            if isAuth {
                // Fresh credentials > biometric gate. Don't immediately
                // prompt the user for Face ID right after they typed
                // their password.
                lockManager.handleFreshSignIn()
            } else {
                lockManager.handleSignOut()
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
