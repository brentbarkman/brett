import Foundation
import LocalAuthentication
import Observation
import SwiftUI

/// Owns the "app is waiting for Face ID before it can be used" state.
///
/// Rules:
///  - `isLocked` is the only state external callers care about. While `true`
///    the UI should render `BiometricLockView` instead of `MainContainer`.
///  - On the first launch within a session the lock is active when the user
///    has `security.faceid.enabled` turned on. Successful biometric auth
///    flips `isLocked` → `false` and stays unlocked for the rest of the
///    foreground session.
///  - Re-locks when the app goes to the background. The next foreground
///    transition forces re-auth. Kept simple — no "allow 30s grace" timer;
///    matches iOS banking-app expectations.
///
/// The LAContext is held as an instance so cancellation on background does
/// something sensible (invalidate, drop the pending prompt).
@MainActor
@Observable
final class BiometricLockManager {
    static let shared = BiometricLockManager()

    private(set) var isLocked: Bool = false
    private(set) var isEvaluating: Bool = false
    private(set) var lastError: String?

    /// Mirrors `@AppStorage("security.faceid.enabled")`. Read via UserDefaults
    /// because the manager isn't a View. When the toggle flips off in
    /// Settings we eagerly unlock — no point holding the user behind a
    /// prompt they just disabled.
    private var isEnabledInSettings: Bool {
        UserDefaults.standard.bool(forKey: "security.faceid.enabled")
    }

    private var context: LAContext?

    private init() {
        // If the user has Face ID turned on and the app is starting, begin
        // in the locked state. If they haven't, stay unlocked.
        isLocked = isEnabledInSettings
    }

    // MARK: - Lifecycle hooks

    /// Called by the app scene when it transitions to the background. We
    /// use this moment to set the "needs unlock next time" flag so
    /// returning to the app requires Face ID.
    func handleDidEnterBackground() {
        context?.invalidate()
        context = nil
        if isEnabledInSettings {
            isLocked = true
        }
    }

    /// Called when the scene becomes active. Fires a fresh biometric prompt
    /// if we're locked. No-op otherwise.
    func handleWillEnterForeground() {
        if isEnabledInSettings, isLocked {
            Task { await authenticate() }
        } else {
            isLocked = false
        }
    }

    /// Called from the settings toggle when the user enables/disables the
    /// feature. Disabling immediately unlocks so the user can use the app
    /// without a gate.
    func settingsDidChange() {
        if !isEnabledInSettings {
            isLocked = false
            lastError = nil
        }
    }

    /// Called when the user has just completed sign-in. Credentials they
    /// just typed are a stronger signal than Face ID, so don't gate on
    /// top of them — otherwise every fresh sign-in is immediately
    /// followed by a redundant biometric prompt.
    func handleFreshSignIn() {
        isLocked = false
        lastError = nil
    }

    /// Called on sign-out so the next session starts from a clean state
    /// (no stale lastError, no pending context).
    func handleSignOut() {
        context?.invalidate()
        context = nil
        isLocked = false
        lastError = nil
    }

    // MARK: - Evaluate

    /// Runs the `LAContext.evaluatePolicy` prompt and flips `isLocked` on
    /// success. On failure, records the message but keeps the lock active
    /// so the user can retry via the view's "Unlock" button.
    func authenticate() async {
        guard !isEvaluating else { return }

        // `.deviceOwnerAuthentication` (not `…WithBiometrics`) includes the
        // device passcode as a fallback when biometry fails 3x — matches
        // the "I'm locked out of my own app" ergonomics people expect
        // from banking apps.
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Use passcode"
        self.context = ctx

        var policyError: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            // No biometry AND no passcode set (possible on jailbroken or
            // freshly-wiped devices). Don't leave the user permanently
            // locked out — unlock and let them use the app.
            isLocked = false
            lastError = nil
            return
        }

        isEvaluating = true
        lastError = nil
        defer { isEvaluating = false }

        do {
            let success = try await ctx.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock Brett"
            )
            if success {
                isLocked = false
            }
        } catch {
            let laError = error as? LAError
            switch laError?.code {
            case .userCancel, .appCancel, .systemCancel:
                // User bailed — keep the lock but clear any old error.
                lastError = nil
            case .userFallback:
                // The user asked for the passcode but then dismissed. Offer
                // another try via the "Unlock" button in the view.
                lastError = nil
            case .biometryLockout:
                lastError = "Too many failed attempts. Use your device passcode to retry."
            case .passcodeNotSet:
                // No passcode = no biometry gate. Unlock rather than
                // strand the user.
                isLocked = false
                lastError = nil
            default:
                lastError = "Couldn't verify. Tap to try again."
            }
        }
    }
}
