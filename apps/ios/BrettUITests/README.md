# BrettUITests

End-to-end UI tests that drive the app through `XCUIApplication`.

## Framework choice

**XCUITest.** Swift Testing works great for unit tests (see `BrettTests/`),
but UI tests still run in a separate process and the `XCUITest` runner is
the norm. Mixing the two in UI tests adds friction without much benefit.

## Conventions

- Keep UI tests coarse — one behavior per test. They're slow and flaky-
  prone; don't chain 10 assertions.
- Never rely on exact copy. Prefer accessibility identifiers, or predicates
  like `label CONTAINS[c] 'email'`.
- Always pass `-UITEST_SIGNED_OUT` / `-UITEST_RESET_STATE` via
  `app.launchWithArgs(...)` so tests start in a known state.

## Tagging tests

Swift Testing tags aren't available in XCUITest. Use comments for grep:

```swift
/// @testAuth
func testSignInScreenShowsWhenUnauthenticated() throws { ... }

/// @testToday
func testTodayViewShowsTodaysTasks() throws { ... }
```

Conventions:

- `@testSmoke` — bare launch / boot checks
- `@testAuth` — sign-in, sign-out, account flows
- `@testToday` — Today view interactions
- `@testOmnibar` — quick-add and spotlight
- `@testSync` — sync-related flows observable from the UI
- `@testCalendar`, `@testScouts`, `@testInbox` — feature-specific

Filter with:

```bash
grep -rn '@testAuth' BrettUITests/
```

## Agent coordination

`BrettApp.swift` does not currently read `launchArguments`. UI tests that
depend on `-UITEST_SIGNED_OUT` or `-UITEST_RESET_STATE` will pass in their
current form (they only check that *something* renders), but once auth is
wired, production code needs to honor those flags. See the TODO in
`TestHelpers.swift`.
