import SwiftUI

/// Google Sign-In button matching Google's Identity brand guidelines:
/// https://developers.google.com/identity/branding-guidelines
///
/// Uses the official 4-color "G" mark shipped as a vector asset in
/// `Assets.xcassets/GoogleG.imageset/`. Don't try to redraw it — Google's
/// brand guidelines ask partners to use the supplied logo files unmodified.
///
/// - Dark-theme surface (~`#131314`) reads against the dark glass card.
/// - 44pt height aligns with the neighbouring Apple button.
/// - Label switches between "Sign in with Google" and "Sign up with Google".
struct GoogleSignInButton: View {
    let action: () -> Void
    var title: String = "Sign in with Google"
    var isDisabled: Bool = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image("GoogleG")
                    .resizable()
                    .renderingMode(.original)   // preserve the 4 brand colors
                    .scaledToFit()
                    .frame(width: 18, height: 18)

                Text(title)
                    // Google's guidelines ask for Roboto; iOS doesn't ship
                    // Roboto, so SF Pro medium is the sanctioned fallback.
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(red: 0.90, green: 0.91, blue: 0.93))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(red: 19/255, green: 19/255, blue: 20/255))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5)
                    }
            }
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.40 : 1.0)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
    }
}

#Preview {
    ZStack {
        Color(red: 10/255, green: 10/255, blue: 10/255)
            .ignoresSafeArea()

        VStack(spacing: 24) {
            GoogleSignInButton(action: {})
            GoogleSignInButton(action: {}, isDisabled: true)
        }
        .padding(24)
    }
}
