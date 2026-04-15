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
/// based on `AuthManager.isAuthenticated`.
private struct RootView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        ZStack {
            if authManager.isAuthenticated {
                MainContainer()
                    .transition(.opacity)
            } else {
                SignInView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: authManager.isAuthenticated)
    }
}
