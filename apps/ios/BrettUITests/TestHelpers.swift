import XCTest

/// Shared UI-test helpers. Add small, widely-used utilities here; anything
/// feature-specific belongs in a `Helpers+Feature.swift` alongside its tests.
extension XCUIApplication {
    /// Launch args pass through to `ProcessInfo.processInfo.arguments`.
    /// Production code checks these flags at startup to force deterministic
    /// states in UI tests (DEBUG-only):
    ///
    /// - `-UITEST_SIGNED_OUT` — ensure we boot on the sign-in screen. Today
    ///   this is a convention; any caller wanting it must also make sure
    ///   `-UITEST_FAKE_AUTH` is absent.
    /// - `-UITEST_RESET_STATE` — clear SwiftData before boot.
    /// - `-UITEST_FAKE_AUTH` — inject `AuthUser.testUser` into AuthManager
    ///   so the app boots straight into `MainContainer`.
    /// - `-UITEST_IN_MEMORY_DATA` — swap `PersistenceController.shared` to
    ///   an in-memory container so tests don't share state with each other
    ///   or with the on-disk dev data.
    /// - `-UITEST_MOCK_API` — reserved for future APIClient stubbing; safe
    ///   to pass today, has no effect yet.
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

    /// Canonical "authenticated session, fresh in-memory data" launch used
    /// by the core-flow tests. Starts the app past sign-in so tests can
    /// focus on the journey under test.
    func launchWithMockData() {
        launchArguments = [
            "-UITEST_FAKE_AUTH",
            "-UITEST_IN_MEMORY_DATA",
            "-UITEST_MOCK_API",
            "-UITEST_RESET_STATE",
        ]
        launch()
    }

    // MARK: - Accessibility accessors
    //
    // Identifier-based accessors — always prefer these over text/label
    // matching. Copy changes shouldn't break tests, but identifiers are
    // stable until someone explicitly renames them.

    var todayPage: XCUIElement {
        // Wildcard descendant lookup — `waitForExistence` will keep polling
        // until SwiftUI flushes the accessibility tree. Using `.any` avoids
        // guessing whether the identifier surfaces on a ScrollView, Other,
        // or Element wrapper.
        descendants(matching: .any).matching(identifier: "today.page").firstMatch
    }

    var omnibarTextField: XCUIElement {
        // TextField inside a SwiftUI pill doesn't always land as a
        // `.textField` — fall back through common element types.
        let byIdentifier = descendants(matching: .any).matching(identifier: "omnibar.input").firstMatch
        if byIdentifier.exists { return byIdentifier }
        return textFields["omnibar.input"]
    }

    var omnibarSendButton: XCUIElement {
        buttons["omnibar.send"]
    }

    var signInEmailField: XCUIElement {
        textFields["signin.email"]
    }

    var signInPasswordField: XCUIElement {
        secureTextFields["signin.password"]
    }

    var signInSubmitButton: XCUIElement {
        buttons["signin.submit"]
    }

    var settingsNavButton: XCUIElement {
        buttons["nav.settings"]
    }

    var settingsSignOutButton: XCUIElement {
        buttons["settings.signout"]
    }

    var detailTitleField: XCUIElement {
        // Can surface as either a textField (single-line) or textView
        // (multi-line, axis: .vertical). Try both.
        let textField = textFields["detail.titleField"]
        if textField.exists { return textField }
        return textViews["detail.titleField"]
    }

    var detailCheckbox: XCUIElement {
        buttons["detail.checkbox"]
    }

    var detailClose: XCUIElement {
        buttons["detail.close"]
    }

    /// Locate a task row by its visible title using the deterministic id
    /// tokeniser `TaskRow.identifierToken(for:)` — lowercased, spaces →
    /// underscores, alnum-only, clamped to 40 chars.
    func taskRow(withTitle title: String) -> XCUIElement {
        let token = Self.identifierToken(for: title)
        return descendants(matching: .any)
            .matching(identifier: "task.row.\(token)")
            .firstMatch
    }

    /// Mirror of `TaskRow.identifierToken(for:)` — kept in lock-step with
    /// production so tests stay deterministic.
    private static func identifierToken(for title: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
        let lowered = title.lowercased().replacingOccurrences(of: " ", with: "_")
        let filtered = lowered.unicodeScalars.filter { allowed.contains($0) }
        let result = String(String.UnicodeScalarView(filtered))
        return String(result.prefix(40))
    }
}
