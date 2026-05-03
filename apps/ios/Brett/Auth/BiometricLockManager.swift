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

    /// The LAContext that successfully passed `evaluatePolicy`. Stays valid
    /// for the lifetime of the unlocked session — code that needs to read
    /// the biometric-gated keychain entry passes this via
    /// `kSecUseAuthenticationContext` so a single Face ID prompt covers
    /// both app unlock AND keychain decrypt. Nil while locked or before
    /// the first successful evaluation.
    ///
    /// Cleared on background (the next foreground requires a fresh prompt
    /// and a fresh context — Apple invalidates re-used contexts after a
    /// timeout anyway).
    private(set) var authenticatedContext: LAContext?

    /// Device-scoped Face ID toggle. Read via UserDefaults because the
    /// manager isn't a View. When the toggle flips off in Settings we
    /// eagerly unlock — no point holding the user behind a prompt they
    /// just disabled.
    ///
    /// Deliberately NOT `UserScopedStorage.key`-scoped. Biometric lock is
    /// a device-owner policy — whoever holds the phone has to pass Face
    /// ID to use the app, regardless of which account is signed in. The
    /// earlier scoped version had a latent bug: `BiometricLockManager`
    /// runs before `AuthManager.refreshCurrentUser` populates
    /// `currentUser?.id`, so the scoped lookup always hit `"anon"` and
    /// reported false → `isLocked = false` → the app flashed its main
    /// UI during cold launch for any user who had previously enabled
    /// Face ID. Device scoping closes the window.
    static let faceIDEnabledKey = "security.faceid.enabled"

    private var isEnabledInSettings: Bool {
        UserDefaults.standard.bool(forKey: Self.faceIDEnabledKey)
    }

    private var context: LAContext?

    private init() {
        // One-shot migration from the previous user-scoped key. Before
        // device-scoping, the toggle lived at
        // `security.faceid.enabled.user=<id>` so every signed-in account
        // had its own preference. Users who had FaceID on under that
        // scheme would silently lose the protection after the device-
        // scoping change if we didn't forward it. Runs once per install
        // (the UserDefaults flag is wiped on uninstall, so reinstall also
        // runs it again — harmless, since it only sets a bool).
        Self.migrateFaceIDPreferenceIfNeeded()

        // Face ID policy is known synchronously at init (device-scoped key)
        // so cold launch locks immediately — no gap between first render
        // and the scene-phase hook where the main UI would otherwise be
        // visible in the app switcher.
        isLocked = isEnabledInSettings
    }

    /// UserDefaults sentinel so the migration only runs once per install.
    private static let migrationSentinelKey = "security.faceid.enabled.migratedFromUserScope.v1"

    private static func migrateFaceIDPreferenceIfNeeded() {
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: migrationSentinelKey) {
            return
        }
        // The legacy key format was `security.faceid.enabled.user=<id>`.
        // Scan UserDefaults for any matching key and OR its value — if
        // ANY user had FaceID enabled on this device, carry that forward
        // as the device-level default. Users who don't want it can flip
        // the toggle off in Settings.
        let legacyPrefix = "security.faceid.enabled.user="
        var anyEnabled = false
        for (key, value) in defaults.dictionaryRepresentation()
            where key.hasPrefix(legacyPrefix) {
            if let boolValue = value as? Bool, boolValue {
                anyEnabled = true
                break
            }
        }

        if anyEnabled {
            defaults.set(true, forKey: faceIDEnabledKey)
        }
        defaults.set(true, forKey: migrationSentinelKey)
    }

    // MARK: - Lifecycle hooks

    /// Called by the app scene when it transitions to the background. We
    /// use this moment to set the "needs unlock next time" flag so
    /// returning to the app requires Face ID.
    func handleDidEnterBackground() {
        context?.invalidate()
        context = nil
        authenticatedContext = nil
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
    /// without a gate. In both directions, re-writes the keychain entry
    /// so the next cold launch reads a token with the correct gating state.
    func settingsDidChange() {
        if !isEnabledInSettings {
            // User just disabled Face ID. Re-write the keychain token without the
            // biometric gate so the next cold launch can read it without a Face ID
            // prompt the user has explicitly opted out of.
            //
            // Edge case: if `authenticatedContext` is nil here (e.g., app was
            // backgrounded between the last unlock and this toggle), the keychain
            // read against the gated entry will trigger an OS Face ID prompt. This
            // is acceptable UX — the user is in Settings actively changing a security
            // preference, and verifying they're the device owner before removing the
            // gate is expected.
            if let token = try? KeychainStore.readToken(authContext: authenticatedContext) {
                try? KeychainStore.writeToken(token, biometricGated: false)
            }
            isLocked = false
            lastError = nil
        } else {
            // User just enabled Face ID. Re-write the keychain token WITH the
            // biometric gate so the next cold launch requires Face ID before
            // the token is readable. The current token is non-gated so we can
            // read it without a context.
            if let token = try? KeychainStore.readToken(authContext: nil) {
                try? KeychainStore.writeToken(token, biometricGated: true)
            }
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
        authenticatedContext = nil
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
            // FAIL CLOSED. The user explicitly enabled the app lock — if
            // the system can no longer evaluate device-owner auth (no
            // biometry AND no device passcode), we must NOT silently
            // disengage that protection. The most common cause is the
            // user removing their device passcode after enabling the
            // app lock; biometry is removed as a side effect, and the
            // previous fail-open behaviour would have left the app
            // unlocked to anyone holding the device.
            //
            // The user can disable the app lock explicitly via Settings
            // → Security; until they do, we keep `isLocked = true` and
            // surface a clear message telling them what to fix.
            isLocked = true
            lastError = "Set a device passcode in Settings to unlock Brett. The app lock stays on until then."
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
                authenticatedContext = ctx
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
                // FAIL CLOSED — same rationale as the canEvaluatePolicy
                // branch above. A user-enabled security control must
                // not silently disengage when the system removes the
                // backing capability. The user can disable the app lock
                // explicitly in Settings → Security.
                isLocked = true
                lastError = "Set a device passcode in Settings to unlock Brett. The app lock stays on until then."
            default:
                lastError = "Couldn't verify. Tap to try again."
            }
        }
    }
}
