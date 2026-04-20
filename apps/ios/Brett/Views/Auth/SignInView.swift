import AuthenticationServices
import SwiftUI

struct SignInView: View {
    @Environment(AuthManager.self) private var authManager

    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var isSignUp = false

    var body: some View {
        ZStack {
            BackgroundView()

            // Frosted glass card — mirrors the desktop's
            // `bg-black/40 backdrop-blur-2xl border-white/10 rounded-xl p-8`
            // container. Keeps the fields together as one surface rather
            // than letting them float over the background individually.
            VStack(spacing: 22) {
                header

                // Placeholders use `NeutralPlaceholder` instead of
                // `TextField`'s built-in `prompt:` — see that file for
                // why (short version: iOS renders prompt in system blue).
                if isSignUp {
                    labeledField("NAME") {
                        NeutralPlaceholder("Your name", isEmpty: name.isEmpty) {
                            TextField("", text: $name)
                                .textFieldStyle(.plain)
                                .foregroundStyle(.white)
                                .textContentType(.name)
                                .autocapitalization(.words)
                        }
                    }
                }

                labeledField("EMAIL") {
                    NeutralPlaceholder("you@example.com", isEmpty: email.isEmpty) {
                        TextField("", text: $email)
                            .textFieldStyle(.plain)
                            .foregroundStyle(.white)
                            .textContentType(.emailAddress)
                            .autocapitalization(.none)
                            .keyboardType(.emailAddress)
                            .accessibilityIdentifier("signin.email")
                    }
                }

                labeledField("PASSWORD") {
                    NeutralPlaceholder("••••••••", isEmpty: password.isEmpty) {
                        SecureField("", text: $password)
                            .textFieldStyle(.plain)
                            .foregroundStyle(.white)
                            .textContentType(isSignUp ? .newPassword : .password)
                            .accessibilityIdentifier("signin.password")
                    }
                }

                if authManager.errorIsNoAccount {
                    noAccountBanner
                        .transition(.opacity.combined(with: .move(edge: .top)))
                } else if let error = authManager.errorMessage {
                    errorBanner(error)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                primaryButton

                toggleLink

                divider

                googleButton

                appleButton
            }
            .padding(24)
            .frame(maxWidth: 360)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.black.opacity(0.40))
                    .background {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(.ultraThinMaterial)
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                    }
            }
            .padding(.horizontal, 24)
            .animation(.easeInOut(duration: 0.2), value: authManager.errorMessage)
            .animation(.easeInOut(duration: 0.2), value: isSignUp)
        }
    }

    // MARK: - Composable bits

    /// Stacked brand mark + wordmark + one-line tagline. The mark is the
    /// gold three-row brief per the brand system (BrandMark.swift) — same
    /// asset as the app icon and the launch splash.
    private var header: some View {
        VStack(spacing: 14) {
            BrandMark()
                .frame(width: 52, height: 52)
                .shadow(color: BrettColors.gold.opacity(0.25), radius: 18, y: 2)

            VStack(spacing: 3) {
                Text("Brett")
                    .font(.system(size: 26, weight: .semibold, design: .default))
                    .foregroundStyle(.white)
                    .tracking(-0.4)
                Text(isSignUp ? "Create your account" : "Sign in to continue")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.55))
            }
        }
        .padding(.bottom, 2)
    }

    /// Input with an uppercase tracked label — matches the desktop's
    /// `text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40`
    /// treatment on field labels.
    @ViewBuilder
    private func labeledField(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Color.white.opacity(0.40))

            content()
                .font(.system(size: 15))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                        }
                }
                .tint(BrettColors.gold)  // caret + selection use brand gold
        }
    }

    private func errorBanner(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(Color(red: 0.95, green: 0.45, blue: 0.40))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(BrettColors.error.opacity(0.12))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(BrettColors.error.opacity(0.25), lineWidth: 0.5)
                    }
            }
    }

    /// Shown when the sign-in attempt failed because there's no account
    /// matching the email. Replaces the generic error banner with an
    /// explainer + gold "Create account" CTA that flips the form into
    /// sign-up mode (keeping the email/password the user already typed).
    private var noAccountBanner: some View {
        VStack(spacing: 10) {
            Text("No account matches that email.")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)

            Text("Create one with these details?")
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.60))
                .multilineTextAlignment(.center)

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isSignUp = true
                    authManager.clearError()
                }
            } label: {
                Text("Create account")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(BrettColors.gold)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("signin.no_account.create")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.06))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(BrettColors.gold.opacity(0.30), lineWidth: 0.5)
                }
        }
    }

    /// Primary CTA. Matches desktop: solid gold background + **white** text.
    /// (Black text on gold reads as a consumer-coupon aesthetic — white is
    /// the editorial-premium treatment.)
    private var primaryButton: some View {
        Button {
            Task { await submitEmailPassword() }
        } label: {
            Group {
                if authManager.isLoading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                } else {
                    Text(isSignUp ? "Sign Up" : "Sign In")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(BrettColors.gold)
            }
            .opacity(isEmailFormValid && !authManager.isLoading ? 1.0 : 0.35)
        }
        .disabled(authManager.isLoading || !isEmailFormValid)
        .accessibilityIdentifier("signin.submit")
    }

    /// "Need an account? Sign up" — follows desktop pattern of muted prose
    /// with a gold inline action word.
    private var toggleLink: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                isSignUp.toggle()
                authManager.clearError()
            }
        } label: {
            HStack(spacing: 4) {
                Text(isSignUp ? "Already have an account?" : "Need an account?")
                    .foregroundStyle(Color.white.opacity(0.40))
                Text(isSignUp ? "Sign in" : "Sign up")
                    .foregroundStyle(BrettColors.gold)
            }
            .font(.system(size: 13))
        }
    }

    /// Horizontal "OR" separator — matches desktop's rule + tracked label.
    private var divider: some View {
        HStack(spacing: 12) {
            Rectangle()
                .fill(Color.white.opacity(0.10))
                .frame(height: 1)
            Text("OR")
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Color.white.opacity(0.40))
            Rectangle()
                .fill(Color.white.opacity(0.10))
                .frame(height: 1)
        }
    }

    /// Official Google Sign-In button per Google's Identity brand guidelines —
    /// 4-color G mark on a dark-theme surface. See
    /// `Views/Shared/GoogleSignInButton.swift` for the mark geometry.
    private var googleButton: some View {
        GoogleSignInButton(
            action: { Task { await authManager.signInGoogle() } },
            title: isSignUp ? "Sign up with Google" : "Sign in with Google",
            isDisabled: authManager.isLoading
        )
    }

    private var appleButton: some View {
        SignInWithAppleButton(.signIn, onRequest: { request in
            request.requestedScopes = [.fullName, .email]
        }, onCompletion: { _ in
            Task { await authManager.signInApple() }
        })
        .signInWithAppleButtonStyle(.white)
        .frame(height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .disabled(authManager.isLoading)
    }

    // MARK: - Helpers

    private var isEmailFormValid: Bool {
        let hasCredentials = !email.isEmpty && !password.isEmpty
        let hasName = !isSignUp || !name.trimmingCharacters(in: .whitespaces).isEmpty
        return hasCredentials && hasName
    }

    private func submitEmailPassword() async {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if isSignUp {
            await authManager.signUpEmail(
                email: trimmedEmail,
                password: password,
                name: name.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        } else {
            await authManager.signInEmail(email: trimmedEmail, password: password)
        }
    }
}
