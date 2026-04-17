import XCTest

/// End-to-end launch tests. Uses XCUITest (not Swift Testing) because UI
/// tests run in a separate process and Swift Testing support for UI tests is
/// still uncommon.
///
/// Tag tests by feature with a comment:
/// - // @testAuth
/// - // @testToday
/// so they're grep-able until we add proper test plans.
final class AppLaunchTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// @testSmoke
    /// Bare sanity: the app launches and some visible element exists. If this
    /// regresses, everything else is broken downstream.
    func testAppLaunches() throws {
        let app = XCUIApplication()
        app.launchWithArgs(signedOut: true)

        // The app should be reachable (foreground).
        XCTAssertTrue(
            app.waitForExistence(timeout: 10),
            "App did not launch within 10s"
        )
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// @testAuth
    /// When launched in signed-out mode, the user should see the sign-in
    /// screen — not a blank or crashed state.
    func testSignInScreenShowsWhenUnauthenticated() throws {
        let app = XCUIApplication()
        app.launchWithArgs(signedOut: true)

        XCTAssertTrue(
            app.waitForExistence(timeout: 10),
            "App did not launch"
        )

        // Look for an email input — the sign-in screen's most load-bearing
        // element. We accept either an email textField or a secureTextField
        // labelled/placeheld for email or password, because exact labels may
        // evolve with design.
        let emailField = app.textFields
            .matching(NSPredicate(format: "placeholderValue CONTAINS[c] 'email' OR label CONTAINS[c] 'email'"))
            .firstMatch
        let anyTextField = app.textFields.firstMatch
        let anySecureField = app.secureTextFields.firstMatch

        let sawAuthInput = emailField.waitForExistence(timeout: 8)
            || anyTextField.waitForExistence(timeout: 2)
            || anySecureField.waitForExistence(timeout: 2)

        XCTAssertTrue(
            sawAuthInput,
            "Expected a sign-in input field on launch in signed-out mode"
        )
    }
}
