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
                .overlay(Color.black.opacity(0.45))

            VStack(spacing: 0) {
                Spacer()

                // Brand mark — quiet visual anchor matching the sign-in screen.
                BrandMark()
                    .frame(width: 44, height: 44)
                    .shadow(color: BrettColors.gold.opacity(0.25), radius: 14, y: 2)

                VStack(spacing: 6) {
                    Text("Brett is locked")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)

                    Text("Tap to unlock with Face ID")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.white.opacity(0.45))
                }
                .padding(.top, 20)

                // Primary affordance is the Face ID glyph itself — a single
                // circular target, no label. Tap to re-prompt.
                Button {
                    Task { await lockManager.authenticate() }
                } label: {
                    ZStack {
                        Circle()
                            .fill(Color.white.opacity(0.06))
                            .overlay {
                                Circle().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                            }
                            .frame(width: 96, height: 96)

                        if lockManager.isEvaluating {
                            ProgressView().tint(.white).scaleEffect(1.1)
                        } else {
                            Image(systemName: "faceid")
                                .font(.system(size: 40, weight: .regular))
                                .foregroundStyle(BrettColors.gold)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(lockManager.isEvaluating)
                .accessibilityLabel("Unlock with Face ID")
                .padding(.top, 40)

                if let error = lockManager.lastError {
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.top, 20)
                        .transition(.opacity)
                }

                Spacer()

                // Escape hatch: changed face, biometry disabled system-wide,
                // etc. Signing out clears the session + keychain and returns
                // to SignInView.
                Button("Sign out") {
                    showSignOutConfirm = true
                }
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.35))
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 32)
        }
        .task {
            // Auto-prompt on first appear. `authenticate` is a no-op while
            // another prompt is in-flight.
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
