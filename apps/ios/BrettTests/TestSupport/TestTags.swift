import Testing

/// Tag namespace used for filtering test runs by feature area.
///
/// Usage:
/// ```swift
/// @Test(.tags(.sync)) func pullCursorAdvances() { ... }
/// @Test(.tags(.auth, .smoke)) func signedOutByDefault() { ... }
/// ```
///
/// Run a single tag group from the command line:
/// ```
/// xcodebuild test ... -only-testing-tag sync
/// ```
extension Tag {
    @Tag static var auth: Self
    @Tag static var sync: Self
    @Tag static var parser: Self
    @Tag static var dates: Self
    @Tag static var models: Self
    @Tag static var smoke: Self
    @Tag static var views: Self
    @Tag static var accessibility: Self
}
