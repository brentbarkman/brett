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

            VStack(spacing: 24) {
                Spacer()

                // Logo
                Text("Brett")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(BrettColors.gold)

                Spacer()

                // Optional name field when signing up
                if isSignUp {
                    TextField("Name", text: $name)
                        .textFieldStyle(.plain)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(.white)
                        .padding(14)
                        .background {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(.ultraThinMaterial)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
                                }
                        }
                        .textContentType(.name)
                        .autocapitalization(.words)
                }

                // Email
                TextField("Email", text: $email)
                    .textFieldStyle(.plain)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(.white)
                    .padding(14)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
                            }
                    }
                    .textContentType(.emailAddress)
                    .autocapitalization(.none)

                // Password
                SecureField("Password", text: $password)
                    .textFieldStyle(.plain)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(.white)
                    .padding(14)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
                            }
                    }
                    .textContentType(isSignUp ? .newPassword : .password)

                // Error banner — shown when AuthManager surfaces an error
                if let error = authManager.errorMessage {
                    Text(error)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        .background {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(BrettColors.error.opacity(0.20))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(BrettColors.error.opacity(0.40), lineWidth: 1)
                                }
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                // Primary action button (Sign In / Sign Up)
                Button {
                    Task { await submitEmailPassword() }
                } label: {
                    Group {
                        if authManager.isLoading {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(.black)
                        } else {
                            Text(isSignUp ? "Sign Up" : "Sign In")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.black)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .disabled(authManager.isLoading || !isEmailFormValid)

                // Toggle between sign-in / sign-up
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isSignUp.toggle()
                        authManager.clearError()
                    }
                } label: {
                    Text(isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textSecondary)
                }

                Text("or")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textSecondary)

                // Sign in with Google
                Button {
                    Task { await authManager.signInGoogle() }
                } label: {
                    Group {
                        if authManager.isLoading {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(.white)
                        } else {
                            Text("Sign in with Google")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                            }
                    }
                }
                .disabled(authManager.isLoading)

                // Sign in with Apple — uses Apple's native button which
                // handles its own chrome. We intercept the request to hand
                // off to AuthManager.signInApple().
                SignInWithAppleButton(.signIn, onRequest: { request in
                    request.requestedScopes = [.fullName, .email]
                }, onCompletion: { _ in
                    // The ASAuthorizationController driven by AuthManager's
                    // provider is what actually posts the identity token to
                    // the backend. SignInWithAppleButton completes its own
                    // flow independently, so we trigger the provider here to
                    // keep all logic flowing through AuthManager.
                    Task { await authManager.signInApple() }
                })
                .signInWithAppleButtonStyle(.white)
                .frame(height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .disabled(authManager.isLoading)

                Spacer()
            }
            .padding(.horizontal, 32)
            .animation(.easeInOut(duration: 0.2), value: authManager.errorMessage)
            .animation(.easeInOut(duration: 0.2), value: isSignUp)
        }
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
