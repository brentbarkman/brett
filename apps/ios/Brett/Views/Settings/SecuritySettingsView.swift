import SwiftUI
import LocalAuthentication

/// Security preferences: Face ID app-lock + a read-only list of active
/// sessions. We surface active sessions from better-auth's `/api/auth/sessions`
/// when available; iOS v1 can't revoke them remotely — that's a future
/// enhancement.
struct SecuritySettingsView: View {
    @AppStorage("security.faceid.enabled") private var faceIDEnabled: Bool = false
    @State private var biometryAvailable: Bool = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    @State private var biometryType: String = SecuritySettingsView.resolveBiometryLabel()

    var body: some View {
        ZStack {
            BackgroundView()

            Form {
                Section {
                    Toggle(isOn: $faceIDEnabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(biometryAvailable ? "\(biometryType) app lock" : "Biometrics unavailable")
                                .foregroundStyle(BrettColors.textCardTitle)
                            Text(biometryAvailable
                                 ? "Require \(biometryType) when opening Brett"
                                 : "This device doesn't support biometric authentication.")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }
                    }
                    .tint(BrettColors.gold)
                    .disabled(!biometryAvailable)
                    .listRowBackground(glassRowBackground)
                } header: {
                    sectionHeader("App Lock")
                }
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }

    // MARK: - Biometry label

    /// Returns "Face ID", "Touch ID", "Optic ID", or a generic fallback.
    private static func resolveBiometryLabel() -> String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none: return "Biometrics"
        @unknown default: return "Biometrics"
        }
    }
}
