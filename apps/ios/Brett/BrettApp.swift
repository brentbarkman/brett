import SwiftData
import SwiftUI

@main
struct BrettApp: App {
    /// Single source of truth for auth state. Injected into the environment
    /// so SignInView (and anything else that needs sign-out) can read it.
    @State private var authManager = AuthManager()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authManager)
                .environment(APIClient.shared)
                .preferredColorScheme(.dark)
        }
        // Single shared ModelContainer owned by `PersistenceController` —
        // registers every @Model type (domain + sync infra) in one place
        // and lets tests/previews swap in in-memory containers.
        .modelContainer(PersistenceController.shared.container)
    }
}

/// Top-level auth gate. Cross-fades between SignInView and MainContainer
/// based on `AuthManager.isAuthenticated`. Also drives the `SyncManager`
/// lifecycle — we only start sync once the user is signed in so we're never
/// pushing mutations without an auth token.
private struct RootView: View {
    @Environment(AuthManager.self) private var authManager

    /// Event handler kept alive for the lifetime of the authenticated session.
    /// Holds a strong ref so its consumer task doesn't get collected.
    @State private var sseHandler: SSEEventHandler? = nil

    var body: some View {
        ZStack {
            if authManager.isAuthenticated {
                MainContainer()
                    .transition(.opacity)
                    .task {
                        // Fires once per authenticated mount — covers the
                        // "already signed in at launch" path.
                        SyncManager.shared.start()
                        startSSE()
                    }
            } else {
                SignInView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: authManager.isAuthenticated)
        // Also handle the live transition case (sign-in during session).
        .onChange(of: authManager.isAuthenticated) { _, isAuth in
            if isAuth {
                SyncManager.shared.start()
                startSSE()
            } else {
                SyncManager.shared.stop()
                stopSSE()
            }
        }
    }

    /// Open the SSE stream and wire its events into SyncManager. We create the
    /// handler lazily here (not at app launch) so the bearer token is already
    /// available by the time the first ticket request fires.
    private func startSSE() {
        if sseHandler == nil {
            let handler = SSEEventHandler(
                sseClient: SSEClient.shared,
                syncTrigger: SyncManager.shared
            )
            handler.start()
            sseHandler = handler
        }
        SSEClient.shared.connect()
    }

    private func stopSSE() {
        SSEClient.shared.disconnect()
        sseHandler?.stop()
        sseHandler = nil
    }
}
