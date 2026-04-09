import SwiftUI

struct SignInView: View {
    @State private var email = ""
    @State private var password = ""

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
                                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
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
                                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                            }
                    }
                    .textContentType(.password)

                // Sign In button
                Button {
                    // Auth — wired later
                } label: {
                    Text("Sign In")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                Text("or")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textSecondary)

                // Sign in with Google
                Button {
                } label: {
                    Text("Sign in with Google")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white)
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

                // Sign in with Apple
                Button {
                } label: {
                    Text("Sign in with Apple")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                Spacer()
            }
            .padding(.horizontal, 32)
        }
    }
}
