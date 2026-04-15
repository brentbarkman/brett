import XCTest

/// Shared UI-test helpers. Add small, widely-used utilities here; anything
/// feature-specific belongs in a `Helpers+Feature.swift` alongside its tests.
extension XCUIApplication {
    /// Launch args pass through to `ProcessInfo.processInfo.arguments`.
    /// Production code can check for these flags at startup to force
    /// deterministic states in UI tests.
    ///
    /// AGENT COORDINATION TODO:
    /// `BrettApp.swift` does not yet inspect launch args. When auth wiring
    /// lands, it should honor:
    ///   - `-UITEST_SIGNED_OUT` — force a clean, unauthenticated start
    ///   - `-UITEST_RESET_STATE` — clear SwiftData before boot
    /// Until then, these flags are no-ops and UI tests will see whatever
    /// state the previous run left behind.
    func launchWithArgs(signedOut: Bool = false, resetState: Bool = true) {
        var args: [String] = []
        if signedOut {
            args.append("-UITEST_SIGNED_OUT")
        }
        if resetState {
            args.append("-UITEST_RESET_STATE")
        }
        launchArguments = args
        launch()
    }
}
