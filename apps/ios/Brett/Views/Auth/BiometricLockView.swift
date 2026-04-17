import SwiftUI

/// Full-screen lock shown between sign-in and the app when the user has
/// biometric unlock enabled. Sits in the RootView cascade: when
/// `authManager.isAuthenticated && lockManager.isLocked`, this view
/// replaces `MainContainer`.
///
/// Auto-prompts on appear. If the user cancels the system prompt, a gold
/// "Unlock" button retries.
struct BiometricLockView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var lockManager = BiometricLockManager.shared
    @State private var showSignOutConfirm = false

    var body: some View {
        ZStack {
            BackgroundView()
                .overlay(Color.black.opacity(0.35))

            VStack(spacing: 18) {
                // Brand mark to echo the sign-in screen — same visual
                // anchor so the transition doesn't feel like a different
                // app took over.
                BrandMark()
                    .frame(width: 48, height: 48)
                    .shadow(color: BrettColors.gold.opacity(0.25), radius: 14, y: 2)

                VStack(spacing: 6) {
                    Text("Brett is locked")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)

                    Text("Unlock with Face ID to continue")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.white.opacity(0.55))
                }

                if let error = lockManager.lastError {
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.error)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 8)
                        .background {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(BrettColors.error.opacity(0.10))
                        }
                }

                Button {
                    Task { await lockManager.authenticate() }
                } label: {
                    HStack(spacing: 8) {
                        if lockManager.isEvaluating {
                            ProgressView().tint(.white).scaleEffect(0.85)
                        } else {
                            Image(systemName: "faceid")
                                .font(.system(size: 15, weight: .semibold))
                        }
                        Text(lockManager.isEvaluating ? "Authenticating…" : "Unlock")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(width: 180, height: 48)
                    .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(lockManager.isEvaluating)
                .padding(.top, 8)

                // Escape hatch: if the user can't authenticate for any
                // reason (changed face, biometry disabled system-wide,
                // etc.) they can always sign out. Signing out clears the
                // session + keychain and returns them to SignInView.
                Button("Sign out") {
                    showSignOutConfirm = true
                }
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.45))
                .padding(.top, 4)
            }
            .padding(.horizontal, 32)
        }
        .task {
            // Auto-prompt on first appear. `authenticate` is a no-op while
            // another prompt is in-flight, so this is safe even if the
            // view re-renders during the evaluation.
            await lockManager.authenticate()
        }
        .confirmationDialog("Sign out?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                Task { await authManager.signOut() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to access your tasks.")
        }
    }
}
