import Foundation

/// Configuration values shared between the main app and the share extension
/// via an App Group `UserDefaults` suite.
///
/// The main app writes into this suite on startup (see `APIClient`). The
/// extension reads at share time. If the main app has never launched since
/// install, the suite is empty — we fall back to the extension's own
/// `Info.plist` `BrettAPIURL` (same key name as the main app uses).
enum SharedConfig {
    /// App Group identifier. Must match the entitlement declared in both
    /// targets. If this goes stale (group renamed, not declared), every
    /// call below silently falls back to defaults — which in dev means
    /// the extension silently talks to production. Worth checking in DEBUG.
    static let appGroup: String = "group.com.brett.app"

    /// UserDefaults suite name matches the App Group — UserDefaults(suiteName:)
    /// returns nil if the app isn't entitled for the group, so we surface
    /// that as a DEBUG assert to make misconfiguration visible quickly.
    static var sharedDefaults: UserDefaults? {
        let defaults = UserDefaults(suiteName: appGroup)
        #if DEBUG
        assert(defaults != nil, "App Group '\(appGroup)' not available — check entitlements")
        #endif
        return defaults
    }

    // MARK: - API URL

    private static let apiURLKey = "brett.apiURL"

    /// Production hostname suffix. `resolveAPIURL()` REQUIRES a URL whose
    /// host matches this suffix in Release builds — any other host means
    /// the shared-defaults value has been tampered with (by another app
    /// sharing our team ID, say) and we fall through to the hardcoded
    /// baked-in fallback. In DEBUG we accept any host so LAN dev URLs
    /// (http://192.168.x.x, http://localhost) work.
    private static let productionHostSuffix = "brett.brentbarkman.com"
    private static let productionFallbackURL = URL(string: "https://api.\(productionHostSuffix)")!

    /// Called by the main app at startup so the extension sees the same
    /// resolved API URL (critical for dev where the LAN IP changes).
    static func writeAPIURL(_ url: URL) {
        sharedDefaults?.set(url.absoluteString, forKey: apiURLKey)
    }

    /// Reads the API URL written by the main app. Falls back to the
    /// extension's own `Info.plist` `BrettAPIURL`, then to production.
    /// Release builds reject any URL that doesn't match the production
    /// host suffix to defend against an attacker who shares our App Group
    /// (i.e., an unrelated app signed by our same Apple Team) writing a
    /// malicious URL to the shared defaults.
    static func resolveAPIURL() -> URL {
        // 1. App Group — populated by the main app on last launch.
        if let raw = sharedDefaults?.string(forKey: apiURLKey),
           let url = URL(string: raw),
           isAllowedAPIURL(url) {
            return url
        }

        // 2. Extension bundle's Info.plist — a ship-safe default that
        // works even if the main app hasn't launched since install.
        if let raw = Bundle.main.object(forInfoDictionaryKey: "BrettAPIURL") as? String,
           !raw.isEmpty,
           let url = URL(string: raw),
           isAllowedAPIURL(url) {
            return url
        }

        // 3. Last-ditch production fallback — always allowed.
        return productionFallbackURL
    }

    private static func isAllowedAPIURL(_ url: URL) -> Bool {
        #if DEBUG
        // Dev: accept any http/https URL so LAN IPs work.
        return url.scheme == "http" || url.scheme == "https"
        #else
        // Release: require https AND the production host suffix. Forces
        // any tampered shared-defaults value back to the baked-in URL.
        guard url.scheme == "https" else { return false }
        guard let host = url.host else { return false }
        return host == productionHostSuffix || host.hasSuffix(".\(productionHostSuffix)")
        #endif
    }

    // MARK: - Current user mirror

    private static let userIdKey = "brett.currentUserId"

    /// Main app calls this whenever auth state changes so the extension
    /// can stamp shares with the correct user-id and prevent cross-user
    /// contamination on account switches. `nil` means signed-out.
    static func writeCurrentUserId(_ userId: String?) {
        if let userId {
            sharedDefaults?.set(userId, forKey: userIdKey)
        } else {
            sharedDefaults?.removeObject(forKey: userIdKey)
        }
    }

    /// Extension reads at share time so `SharePayload.userId` reflects the
    /// user who was signed in when the share happened, not the user who
    /// happens to be signed in when the main app drains the queue.
    static func resolveCurrentUserId() -> String? {
        sharedDefaults?.string(forKey: userIdKey)
    }

    // MARK: - Share queue directory

    /// Absolute URL of the App Group directory where the extension writes
    /// pending/posted share payloads. Created on first access. Returns nil
    /// if the App Group isn't entitled (misconfiguration).
    static func shareQueueDirectory() -> URL? {
        guard let base = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroup
        ) else {
            return nil
        }
        let dir = base.appendingPathComponent("ShareQueue", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: dir,
            withIntermediateDirectories: true,
            attributes: [
                // `completeUntilFirstUserAuthentication` — files are encrypted
                // at rest before first unlock after reboot, but become
                // readable and writable afterward (even if the user locks
                // the phone again). Switched from `.complete` because the
                // extension may run mid-lock: the share sheet can be
                // summoned from the control center on a locked device that
                // was previously unlocked, and a `.complete`-protected
                // directory would make the extension's write fail silently.
                FileAttributeKey.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
            ]
        )
        return dir
    }

    /// Subdirectory for files that failed to reconcile (malformed JSON,
    /// stale beyond the retry window). Kept for debug triage.
    static func failedShareDirectory() -> URL? {
        guard let queue = shareQueueDirectory() else { return nil }
        let dir = queue.appendingPathComponent("failed", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
