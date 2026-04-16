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
        BrettSettingsScroll {
            BrettSettingsSection("App Lock") {
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
                // Notify the lock manager when the toggle flips so it
                // can unlock immediately on turn-off (otherwise the
                // user would be stuck behind a prompt they just
                // disabled until next app launch).
                .onChange(of: faceIDEnabled) { _, _ in
                    BiometricLockManager.shared.settingsDidChange()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
        }
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
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
