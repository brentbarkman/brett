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
    /// Seed a realistic working set into the shared (in-memory) SwiftData
    /// container so UI-test launches and design-review sessions land on
    /// a Today screen that looks like a real workday — every section
    /// populated, multiple lists, content items, a sample briefing.
    /// Anchored on `"Review design spec"` because that's the title the
    /// existing UI tests assert against; surrounding fixtures fill out
    /// the rest of the page.
    private static func seedUITestFixtures(userId: String) {
        let context = PersistenceController.shared.mainContext
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let now = Date()

        // Lists
        let workList = ItemList(userId: userId, name: "Work", colorClass: "bg-blue-500", sortOrder: 0)
        let personalList = ItemList(userId: userId, name: "Personal", colorClass: "bg-emerald-500", sortOrder: 1)
        let healthList = ItemList(userId: userId, name: "Health", colorClass: "bg-rose-500", sortOrder: 2)
        let readingList = ItemList(userId: userId, name: "Reading", colorClass: "bg-amber-500", sortOrder: 3)
        for list in [workList, personalList, healthList, readingList] { context.insert(list) }

        // Helper builders so the array below stays scannable.
        @discardableResult
        func task(
            _ title: String,
            list: ItemList? = nil,
            dueDate: Date? = nil,
            status: ItemStatus = .active,
            type: ItemType = .task,
            source: String = "uitest"
        ) -> Item {
            let item = Item(
                userId: userId,
                type: type,
                status: status,
                title: title,
                source: source,
                dueDate: dueDate,
                listId: list?.id,
                createdAt: now,
                updatedAt: now
            )
            if status == .done {
                item.completedAt = now
            }
            context.insert(item)
            return item
        }

        // Overdue (red headers in Today)
        task("Submit Q1 expense report", list: workList, dueDate: calendar.date(byAdding: .day, value: -2, to: today))
        task("Renew gym membership", list: healthList, dueDate: calendar.date(byAdding: .day, value: -1, to: today))

        // Today — relative-to-now times so the items always land in
        // the TODAY bucket regardless of when the design-review
        // session runs (a hardcoded "9 am" lands in OVERDUE if the
        // session happens after 9 am). Picks 4 future moments
        // spread across the rest of the day. Anchor item ("Review
        // design spec") MUST keep this exact title — UI-test
        // selectors key on the slug `task.row.review_design_spec`.
        // Spread today items across the remaining hours of the day,
        // ending no later than 23:30 so they never look identical
        // (the prior `min(candidate, endOfDay-60)` collapsed every
        // post-evening item to 11:59 pm).
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: today) ?? today.addingTimeInterval(86_400)
        let cutoff = calendar.date(bySettingHour: 23, minute: 30, second: 0, of: today) ?? endOfDay
        let secondsUntilCutoff = max(60, cutoff.timeIntervalSince(now))
        func slot(_ index: Int, of total: Int) -> Date {
            // Evenly divide the remaining time into `total` slots and
            // pick the `index`th. Never goes past the cutoff.
            let fraction = Double(index + 1) / Double(total + 1)
            return now.addingTimeInterval(secondsUntilCutoff * fraction)
        }
        let todayItems: [(String, ItemList?)] = [
            ("Review design spec", workList),
            ("Prep slides for Q2 board review", workList),
            ("Push mobile auth fix to staging", workList),
            ("Book physio appointment", healthList),
            ("Pick up dry cleaning", personalList),
        ]
        for (i, (title, list)) in todayItems.enumerated() {
            task(title, list: list, dueDate: slot(i, of: todayItems.count))
        }

        // This Week — mix of tasks + content items
        task("Draft technical spec for sync v2", list: workList, dueDate: calendar.date(byAdding: .day, value: 2, to: today))
        task("Quarterly 1:1s with team", list: workList, dueDate: calendar.date(byAdding: .day, value: 3, to: today))
        task("The pragmatic technologist's guide to LLMs", list: readingList, dueDate: calendar.date(byAdding: .day, value: 4, to: today), type: .content, source: "newsletter")
        task("Why Apple's design language still wins in 2026", list: readingList, dueDate: calendar.date(byAdding: .day, value: 5, to: today), type: .content, source: "article")

        // Next Week
        task("Annual performance self-review", list: workList, dueDate: calendar.date(byAdding: .day, value: 8, to: today))
        task("Renew passport", list: personalList, dueDate: calendar.date(byAdding: .day, value: 10, to: today))

        // Done Today (so the de-emphasized Done section has content)
        task("Morning standup", list: workList, dueDate: today, status: .done)
        task("Reply to investor update thread", list: workList, dueDate: today, status: .done)
        task("Walk the dog", list: personalList, dueDate: today, status: .done)

        // SyncHealth row so the empty-state gate flips from
        // "still syncing → show skeleton" to "real empty state →
        // show editorial copy". Without this every page boots
        // showing the loading skeleton because -UITEST_MOCK_API
        // never completes a real sync pull.
        let syncHealth = SyncHealth()
        syncHealth.lastSuccessfulPullAt = now
        context.insert(syncHealth)

        // Calendar event in the next 25 min so NextUp fires — gives
        // the design-review session something to look at in the
        // editorial NextUp surface.
        let nextUp = CalendarEvent(
            userId: userId,
            googleAccountId: "uitest-acct",
            calendarListId: "uitest-cal",
            googleEventId: "uitest-nextup-\(UUID().uuidString)",
            title: "Q2 board prep sync",
            startTime: now.addingTimeInterval(25 * 60),
            endTime: now.addingTimeInterval(55 * 60),
            myResponseStatus: .accepted
        )
        context.insert(nextUp)

        // Briefing — pre-populated inside `BriefingStore.init` when
        // -UITEST_FAKE_AUTH is set, so the editorial hero on Today
        // shows real copy instead of just the greeting + date.

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

/// Owns one in-flight `Task` at a time. Replaces the fire-and-forget
/// `Task { ... }` pattern in scenePhase / isAuthenticated handlers. When a
/// new task is started, the previous one is cancelled — so a rapid
/// background↔active flap can't leave a stale "clear badge" coexisting
/// with a "request authorization."
@MainActor
final class ScenePhaseTaskTracker {
    private var current: Task<Void, Never>?

    func start(_ work: @escaping () async -> Void) {
        current?.cancel()
        current = Task { await work() }
    }

    func cancel() {
        current?.cancel()
        current = nil
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

    @State private var badgeTracker = ScenePhaseTaskTracker()
    @State private var sessionRefreshTracker = ScenePhaseTaskTracker()
    @State private var shareDrainTracker = ScenePhaseTaskTracker()
    /// Owns the foreground sync kick. Wrapped in a tracker so a rapid
    /// background↔active flap can't pile up two `sync()` calls — the
    /// previous one is cancelled before a new one starts. SyncManager's
    /// own re-entry guard would protect us against parallel runs anyway,
    /// but cancelling is cheaper than letting both Tasks live to discover
    /// the mutex.
    @State private var foregroundSyncTracker = ScenePhaseTaskTracker()

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
                            //
                            // Skip the prompt under `-UITEST_FAKE_AUTH` so
                            // automated runs (and live design-review
                            // sessions) don't get blocked by the system
                            // notifications dialog before they can see
                            // the screen they're trying to inspect.
                            #if DEBUG
                            if ProcessInfo.processInfo.arguments.contains("-UITEST_FAKE_AUTH") {
                                return
                            }
                            #endif
                            await BadgeManager.shared.requestAuthorization()
                        }
                }
            } else if authManager.isHydratingFromKeychain {
                // Face-ID-ON cold launch: keychain hasn't been read yet (token gated
                // behind biometric). BiometricLockView prompts for unlock; once
                // authenticated, AuthManager.hydrateFromKeychain runs and isAuthenticated
                // flips, this branch yields to MainContainer.
                //
                // Edge case: if the user removed their device passcode (canEvaluatePolicy
                // fails), authenticatedContext never becomes non-nil, isHydratingFromKeychain
                // stays true, and this branch keeps showing BiometricLockView with the
                // "Set a device passcode" error. Intentional fail-closed behavior.
                BiometricLockView()
                    .transition(.opacity)
            } else {
                SignInView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: authManager.isAuthenticated)
        .animation(.easeInOut(duration: 0.35), value: authManager.isHydratingFromKeychain)
        .animation(.easeInOut(duration: 0.25), value: lockManager.isLocked)
        // Biometric lock lifecycle only — sync/SSE are handled by AuthManager.
        .onChange(of: authManager.isAuthenticated) { _, isAuth in
            if isAuth {
                // Fresh credentials > biometric gate. Don't immediately
                // prompt the user for Face ID right after they typed
                // their password.
                lockManager.handleFreshSignIn()
                #if DEBUG
                if !ProcessInfo.processInfo.arguments.contains("-UITEST_FAKE_AUTH") {
                    badgeTracker.start { await BadgeManager.shared.requestAuthorization() }
                }
                #else
                badgeTracker.start { await BadgeManager.shared.requestAuthorization() }
                #endif
            } else {
                lockManager.handleSignOut()
                // Fire-and-forget: sign-out is always a foreground action,
                // so setBadgeCount(0) lands before the process suspends.
                // Worst case on drop: stale badge until next launch, which
                // the cold-launch refresh in MainContainer will overwrite.
                badgeTracker.start { await BadgeManager.shared.clear() }
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
                // Disconnect SSE so we're not holding a TLS connection
                // (or sitting in a backoff sleep against a connection
                // iOS NAT-killed) while suspended. `Task.sleep` would
                // pause naturally at process suspend, but proactively
                // disconnecting also stops any in-flight heartbeat I/O
                // during the brief window before iOS suspends, and
                // guarantees a clean reconnect attempt on foreground
                // instead of waiting for the watchdog timeout to fire.
                // Idempotent + cheap when already disconnected.
                if authManager.isAuthenticated {
                    SSEClient.shared.disconnect()
                }
                // Cancel any in-flight foreground sync task so its
                // continuation doesn't fire mid-suspend; SyncManager's
                // poll loop suspends naturally with the process.
                foregroundSyncTracker.cancel()
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
                shareDrainTracker.start { await ShareIngestor.shared.drain() }
                // Foreground keepalive: re-validate the session in case
                // it was revoked server-side while we were backgrounded.
                // Throttled to one call per 5 minutes inside AuthManager so
                // rapid app-switches don't hammer /users/me.
                sessionRefreshTracker.start { [authManager] in
                    await authManager.refreshIfStale()
                }
                // Re-establish realtime + force a fresh sync. The SSE
                // connection from the previous foreground was either
                // suspended-and-likely-NAT-killed or explicitly
                // disconnected by the .background branch above; either
                // way the user expects live state the moment the app
                // foregrounds, not after the next 30s poll cycle. Both
                // calls are gated on auth so we don't spin a doomed
                // ticket-fetch loop on the sign-in screen.
                if authManager.isAuthenticated {
                    SSEClient.shared.connect()
                    foregroundSyncTracker.start {
                        await ActiveSession.syncManager?.sync()
                    }
                }
            default:
                break
            }
        }
        .onChange(of: lockManager.authenticatedContext) { _, newContext in
            // Biometric unlock succeeded → hydrate keychain with the
            // authenticated LAContext so the gated read doesn't trigger
            // a second Face ID prompt. Idempotent: hydrateFromKeychain
            // returns early if the token is already set (e.g. Face ID OFF
            // path), so repeat calls are safe.
            if let ctx = newContext {
                Task { [authManager] in await authManager.hydrateFromKeychain(authContext: ctx) }
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
            shareDrainTracker.start { await ShareIngestor.shared.drain() }
        }
    }

    // UI-test isolation: `AuthManager.injectFakeSession` deliberately sets
    // `token` + `currentUser` directly without calling `installSession`, so
    // UI-test launches keep `ActiveSession.syncManager` nil and every store
    // mutation silently no-ops the network side. Tests that need a real
    // sync path stub `APIClient` via `MockURLProtocol` instead.
}
