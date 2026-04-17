# BrettTests

Unit tests for the native iOS app.

## Layout

```
BrettTests/
  DateHelpersTests.swift      # Existing — keep as-is (Swift Testing already)
  SmokeTests.swift            # Model container + schema sanity
  Models/
    EnumsTests.swift          # Raw-value round-trip + stability
  TestSupport/
    InMemoryPersistenceController.swift   # @Model fixtures, no disk
    TestFixtures.swift                    # makeItem / makeList / makeEvent / etc.
    TestClock.swift                       # Controllable "now"
    KeychainTestDouble.swift              # In-memory Keychain (see TODO below)
    MockURLProtocol.swift                 # URLSession stub registry
    TestTags.swift                        # @Tag.auth, .sync, .parser, etc.
  README.md
```

## Which framework?

**Use Swift Testing (`import Testing`, `@Test`, `#expect`, `#require`) for all new tests.**
The existing `DateHelpersTests.swift` is already Swift Testing; leave it alone.

XCTest is only acceptable for cases Swift Testing genuinely can't handle
(e.g. some legacy assertion patterns). So far we haven't needed it.

## Adding a test

1. Put it under a folder that matches the production source path
   (`Models/`, `Networking/`, `Sync/`, etc.).
2. Import `Testing` and `@testable import Brett`.
3. Pick a tag (or tags) from `TestSupport/TestTags.swift`:
   ```swift
   @Suite("Sync engine", .tags(.sync))
   struct SyncEngineTests {
       @Test func pullCursorAdvances() async throws { ... }
   }
   ```
4. Prefer fixtures over hand-rolled model instances:
   ```swift
   let item = TestFixtures.makeItem(title: "Test", dueDate: .now)
   ```
5. For `@Model` data, use `InMemoryPersistenceController.makeContext()` —
   it's fresh per call and never touches disk.

## Mocking patterns

### Network calls (`URLSession`)

Use `MockURLProtocol`. Register on an ephemeral session, never `.default`:

```swift
let config = URLSessionConfiguration.ephemeral
config.protocolClasses = [MockURLProtocol.self]
let session = URLSession(configuration: config)

MockURLProtocol.stub(
    url: URL(string: "https://api.example.com/sync/pull")!,
    statusCode: 200,
    body: Data(#"{"items":[]}"#.utf8)
)
defer { MockURLProtocol.reset() }

// ... exercise APIClient(session: session) ...
```

### Clocks / dates

Inject `TestClock` wherever production takes `() -> Date`. If production
currently hard-codes `Date()`, leave a TODO in the test and file a
refactor — don't mock by swizzling.

### Keychain

Use `KeychainTestDouble`. **Caveat:** `KeychainStore` is currently a static-
method enum, so it can't be substituted yet. Until W1-A extracts a
`KeychainStoring` protocol, mark auth tests
`@Test(.disabled("Wave 2 — needs KeychainStoring protocol"))`.

## Testing principles

1. **Sync engine tests are mandatory** before Wave 2 merges — mutation queue
   behavior, compaction rules, field-level merge, push-result handling, pull
   cursor advancement, conflict logging.
2. **Auth tests are mandatory** — token storage, 401 handling, session
   restoration.
3. **Smart parser tests are mandatory** — e.g. `"buy milk tomorrow at 5pm"`
   → task with `dueDate` + reminder.
4. **Don't test layout.** Snapshot tests are the exception, used sparingly
   for critical visual components (e.g. sticky headers).
5. **Fixtures over mocks.** Prefer real `@Model` instances with realistic
   data; only mock at process boundaries (network, keychain, clock).
6. **Keep existing XCTest-style tests untouched.** Upgrading them to Swift
   Testing is a separate task and risks regression.

## Running

```bash
cd apps/ios
xcodegen generate
xcodebuild -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

Filter by tag:

```bash
xcodebuild test ... -only-testing:BrettTests/SmokeTests
```
