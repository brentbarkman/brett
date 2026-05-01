# iOS Simplification — Wave A: Concurrency & Lifecycle Hygiene

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iOS app's concurrency and lifecycle behavior boring and observable: explicit Task ownership, no retain cycles, no silent error swallowing in sync paths, sign-out cleanly clears every store's in-memory state.

**Architecture:** Add a `Clearable` protocol + `ClearableStoreRegistry` (mirrors the existing `ChatStoreRegistry` pattern). All `@Observable` stores register themselves at init; `Session.tearDown()` fans clearing out before SwiftData is wiped. Replace fire-and-forget `Task { ... }` calls in `BrettApp` scenePhase handlers, `AuthManager`, and `AttachmentUploader.queueTask` with weakly-captured, cancellable variants. Replace silent `try?` calls in sync/auth paths with `do/catch` that logs via `BrettLog`. Two regression-guard tests prevent future drift.

**Tech Stack:** Swift 6 / SwiftUI / SwiftData / Swift Testing. Existing test infra: `InMemoryPersistenceController`, `MockURLProtocol`, `TestFixtures`, `BrettLog`. New stores conform via a one-line empty default; existing tests stay green.

**Spec:** [`docs/superpowers/specs/2026-04-26-ios-simplification-design.md`](../specs/2026-04-26-ios-simplification-design.md)

---

## Spec reconciliation

The spec listed `RelinkTask`, `ConflictLogEntry`, and `SyncHealth` as candidates for "delete dead scaffolding." Verification before writing this plan showed they are all live:

- `RelinkTask.parse` is called by [TaskRow.swift:78](../../../apps/ios/Brett/Views/Shared/TaskRow.swift:78) for connection-health re-link rows.
- `ConflictLogEntry` and `SyncHealth` are surfaced in [SyncHealthSettingsView.swift](../../../apps/ios/Brett/Views/Settings/SyncHealthSettingsView.swift) and consumed by [TodayPage.swift:76](../../../apps/ios/Brett/Views/Today/TodayPage.swift:76), [InboxPage.swift:34](../../../apps/ios/Brett/Views/Inbox/InboxPage.swift:34), [ListView.swift:30](../../../apps/ios/Brett/Views/List/ListView.swift:30).

All three stay. The "delete dead scaffolding" subtask is dropped from Wave A. Wave C may revisit if any of them remain unsurfaced after Wave B's view rework.

---

## File structure

**New files:**

- `apps/ios/Brett/Stores/ClearableStoreRegistry.swift` — `Clearable` protocol + `ClearableStoreRegistry` enum.
- `apps/ios/BrettTests/Stores/ClearableStoreRegistryTests.swift` — registry behavior unit tests.
- `apps/ios/BrettTests/Stores/ClearableConformanceTests.swift` — regression guard: every `@Observable final class` under `Stores/` conforms.
- `apps/ios/BrettTests/Sync/SilentTrySaveGuardTests.swift` — regression guard: no `try? context.save()` in `Sync/` outside an allowlist.
- `apps/ios/BrettTests/Sync/SSEClientLifecycleTests.swift` — connect/disconnect/cancel race coverage (extends the existing SSE suite).

**Modified files (read each before editing):**

- `apps/ios/Brett/Auth/ActiveSession.swift` — `Session.tearDown()` calls `ClearableStoreRegistry.clearAll()`.
- `apps/ios/Brett/Auth/AuthManager.swift` — `[weak self]` on the keychain-hydrate Task at line 84; log server-side sign-out errors at lines 222 and 252.
- `apps/ios/Brett/BrettApp.swift` — track scenePhase Tasks, cancel on phase change.
- `apps/ios/Brett/Stores/ScoutStore.swift` — conform + register + clear.
- `apps/ios/Brett/Stores/UserProfileStore.swift` — conform + register + clear.
- `apps/ios/Brett/Stores/BriefingStore.swift` — conform + register + clear.
- `apps/ios/Brett/Stores/SearchStore.swift` — conform + register + clear.
- `apps/ios/Brett/Stores/NewsletterStore.swift` — conform + register + clear.
- `apps/ios/Brett/Stores/CalendarAccountsStore.swift` — conform + register + clear.
- `apps/ios/Brett/Stores/AIProviderStore.swift` — conform + register + clear.
- `apps/ios/Brett/Stores/ChatStore.swift` — migrate `ChatStoreRegistry` users to the new registry; keep chat-specific behavior (cancel streams) inside `clear()`.
- `apps/ios/Brett/Stores/SelectionStore.swift` — conform + register + delegate `clear()` to existing impl.
- `apps/ios/Brett/Stores/ItemStore.swift` — conform with no-op `clear()` (Wave B will fill it in).
- `apps/ios/Brett/Stores/ListStore.swift` — conform with no-op `clear()`.
- `apps/ios/Brett/Stores/MessageStore.swift` — conform with no-op `clear()`.
- `apps/ios/Brett/Stores/CalendarStore.swift` — conform with no-op `clear()`.
- `apps/ios/Brett/Stores/AttachmentStore.swift` — conform with no-op `clear()`.
- `apps/ios/Brett/Sync/AttachmentUploader.swift` — break retain cycle in `processQueue`; replace `try? persistence.mainContext.save()` calls with logged saves.
- `apps/ios/Brett/Sync/SyncManager.swift` — log line-381 save failure.
- `apps/ios/Brett/Sync/ConflictResolver.swift` — log line-105 save failure.
- `apps/ios/Brett/Sync/ShareIngestor.swift` — log line-161 save failure.
- `apps/ios/Brett/Sync/SSEClient.swift` — make the loop sleep cancellable.
- `apps/ios/Brett/Services/BackgroundService.swift` — replace `#if DEBUG print` with `BrettLog`.

**Total: 5 new files, ~17 modified files.**

---

## Phase 1 — `ClearableStoreRegistry` foundation

### Task 1: Define `Clearable` and `ClearableStoreRegistry`

**Files:**
- Create: `apps/ios/Brett/Stores/ClearableStoreRegistry.swift`
- Create: `apps/ios/BrettTests/Stores/ClearableStoreRegistryTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `apps/ios/BrettTests/Stores/ClearableStoreRegistryTests.swift`:

```swift
import Testing
import Foundation
@testable import Brett

@Suite("ClearableStoreRegistry", .tags(.smoke))
@MainActor
struct ClearableStoreRegistryTests {
    /// Test double — counts how many times clearForSignOut was called.
    @MainActor
    private final class CountingStore: Clearable {
        var clears: Int = 0
        func clearForSignOut() { clears += 1 }
    }

    @Test func clearAllInvokesEveryRegisteredStore() {
        ClearableStoreRegistry.resetForTesting()
        let a = CountingStore()
        let b = CountingStore()
        ClearableStoreRegistry.register(a)
        ClearableStoreRegistry.register(b)

        ClearableStoreRegistry.clearAll()

        #expect(a.clears == 1)
        #expect(b.clears == 1)
    }

    @Test func releasedStoresAreSilentlySkipped() {
        ClearableStoreRegistry.resetForTesting()
        var a: CountingStore? = CountingStore()
        ClearableStoreRegistry.register(a!)

        // Drop the store. The registry holds a weak reference, so the next
        // clearAll should silently skip the entry rather than crash.
        a = nil

        ClearableStoreRegistry.clearAll()
        // No assertion — the test passes if no crash occurred.
    }

    @Test func registrationIsIdempotentForSameInstance() {
        ClearableStoreRegistry.resetForTesting()
        let store = CountingStore()
        ClearableStoreRegistry.register(store)
        ClearableStoreRegistry.register(store)

        ClearableStoreRegistry.clearAll()

        // Even if registered twice, clear is invoked once per identity.
        #expect(store.clears == 1)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/ClearableStoreRegistryTests 2>&1 | tail -20`
Expected: Compile failure — `Cannot find 'Clearable' in scope` and `Cannot find 'ClearableStoreRegistry' in scope`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/ios/Brett/Stores/ClearableStoreRegistry.swift`:

```swift
import Foundation

/// Stores adopt this so `Session.tearDown()` (called from sign-out) can wipe
/// their in-memory caches before SwiftData rows are deleted. Clearing
/// in-memory state is a separate concern from clearing the on-disk
/// SwiftData mirror — `wipeAllData()` handles the latter; this protocol
/// handles the former.
///
/// Default impl is a no-op so stores that hold no in-memory state (or only
/// state derived from `@Query`) opt in trivially and the conformance
/// regression test in `ClearableConformanceTests` covers the whole layer.
@MainActor
protocol Clearable: AnyObject {
    /// Drop any in-memory state that should not survive a sign-out. Called
    /// from `ClearableStoreRegistry.clearAll()` immediately before
    /// `PersistenceController.wipeAllData()` runs.
    func clearForSignOut()
}

extension Clearable {
    func clearForSignOut() {}
}

/// Weak-reference registry of every `Clearable` store the process has
/// instantiated. Modeled on `ChatStoreRegistry` (which is now a thin wrapper
/// over this) so we have one cancellation/clear primitive to maintain.
///
/// Why a registry instead of a singleton list passed to `Session.tearDown`:
/// stores live at different layers — some are app-scoped singletons
/// (`AIProviderStore.shared`), some are page-scoped (`@State private var
/// chatStore = ChatStore()` inside a detail view), some are environment-
/// injected. The registry hides that variance behind a uniform fan-out.
@MainActor
enum ClearableStoreRegistry {
    /// Weak-box wrapper so registration doesn't pin stores in memory past
    /// their natural lifetime. The registry is itself main-actor isolated,
    /// so no locking is required.
    private final class WeakRef {
        weak var store: Clearable?
        init(_ store: Clearable) { self.store = store }
    }

    private static var refs: [WeakRef] = []

    /// Register a store. Idempotent for the same instance — a store
    /// registered twice clears once. Drops any empty weak boxes opportunistically.
    static func register(_ store: Clearable) {
        refs.removeAll { $0.store == nil }
        if refs.contains(where: { $0.store === store }) { return }
        refs.append(WeakRef(store))
    }

    /// Fan out `clearForSignOut()` across every live registered store.
    /// Called from `Session.tearDown()` before SwiftData is wiped.
    static func clearAll() {
        for ref in refs {
            ref.store?.clearForSignOut()
        }
    }

    /// Test-only: drop every registration so test-double stores from a
    /// prior test don't leak into the next case. Crash if called outside
    /// XCTest to keep production code from accidentally relying on it.
    static func resetForTesting() {
        #if DEBUG
        refs.removeAll()
        #else
        fatalError("ClearableStoreRegistry.resetForTesting called outside DEBUG")
        #endif
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/ClearableStoreRegistryTests 2>&1 | tail -20`
Expected: All three tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/ClearableStoreRegistry.swift apps/ios/BrettTests/Stores/ClearableStoreRegistryTests.swift
git commit -m "feat(ios): add Clearable protocol + ClearableStoreRegistry"
```

---

### Task 2: Wire registry into `Session.tearDown()`

**Files:**
- Modify: `apps/ios/Brett/Auth/ActiveSession.swift:93-104`

- [ ] **Step 1: Write the failing test**

Append to `apps/ios/BrettTests/Stores/ClearableStoreRegistryTests.swift`:

```swift
@Suite("ClearableStoreRegistry session integration", .tags(.auth, .smoke))
@MainActor
struct ClearableStoreRegistrySessionIntegrationTests {
    @MainActor
    private final class CountingStore: Clearable {
        var clears: Int = 0
        func clearForSignOut() { clears += 1 }
    }

    @Test func sessionTearDownClearsRegisteredStores() throws {
        ClearableStoreRegistry.resetForTesting()
        let store = CountingStore()
        ClearableStoreRegistry.register(store)

        let container = try InMemoryPersistenceController.makeContainer()
        let persistence = PersistenceController.makePreview()
        let session = Session(userId: "user-A", persistence: persistence)
        session.start()
        session.tearDown()

        #expect(store.clears == 1)
        _ = container // keep alive
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/ClearableStoreRegistrySessionIntegrationTests 2>&1 | tail -20`
Expected: `store.clears == 0` (the registry exists but `Session.tearDown` doesn't call it yet).

- [ ] **Step 3: Modify `Session.tearDown()`**

In `apps/ios/Brett/Auth/ActiveSession.swift`, find:

```swift
    func tearDown() {
        ChatStoreRegistry.cancelAllActive()
        sseClient.disconnect()
```

Replace with:

```swift
    func tearDown() {
        // Clear in-memory store caches first. SwiftData rows still exist at
        // this point — `wipeAllData()` runs in `AuthManager.signOut` *after*
        // we return — but stores that cache derived state in memory must
        // drop it now so a stream/network completion arriving in the next
        // few ms can't repopulate them with the prior user's data.
        ClearableStoreRegistry.clearAll()
        // Legacy chat-specific cancellation. Wave A keeps it; once every
        // ChatStore is registered as Clearable in Task 10, this becomes
        // redundant and gets removed.
        ChatStoreRegistry.cancelAllActive()
        sseClient.disconnect()
```

- [ ] **Step 4: Run tests to verify pass**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/ClearableStoreRegistrySessionIntegrationTests 2>&1 | tail -20`
Expected: PASS.

Also re-run the full sync + auth suites to make sure nothing else broke:

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing-tag sync -only-testing-tag auth 2>&1 | tail -30`
Expected: All green.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Auth/ActiveSession.swift apps/ios/BrettTests/Stores/ClearableStoreRegistryTests.swift
git commit -m "feat(ios): fan out ClearableStoreRegistry from Session.tearDown"
```

---

## Phase 2 — Make stores `Clearable`

Tasks 3–13 follow the same pattern. Each store gets one commit. The pattern:

1. Add a `@Test` that registers the store, populates state, calls `ClearableStoreRegistry.clearAll()`, asserts state is gone.
2. Add `Clearable` conformance + `ClearableStoreRegistry.register(self)` in init + a `clearForSignOut()` body.
3. Verify tests pass.
4. Commit.

Use this template for each task and substitute the store-specific body.

### Task 3: `ScoutStore`

**Files:**
- Modify: `apps/ios/Brett/Stores/ScoutStore.swift`
- Modify: `apps/ios/BrettTests/Stores/` (new test file or extend existing)

- [ ] **Step 1: Write the failing test**

Create `apps/ios/BrettTests/Stores/ScoutStoreClearTests.swift`:

```swift
import Testing
import Foundation
@testable import Brett

@Suite("ScoutStore clear", .tags(.smoke))
@MainActor
struct ScoutStoreClearTests {
    @Test func clearForSignOutDropsInMemoryScouts() {
        ClearableStoreRegistry.resetForTesting()
        let store = ScoutStore(client: APIClient.shared, context: nil)
        // Inject canned in-memory state — bypasses the network so the test
        // doesn't need URL stubs. The state is what users would see after
        // a successful refresh().
        store.injectForTesting(scouts: [TestFixtures.makeScoutDTO(name: "S1")])
        #expect(store.scouts.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.scouts.isEmpty)
    }
}
```

This requires a `TestFixtures.makeScoutDTO(name:)` helper and a DEBUG-only `ScoutStore.injectForTesting(scouts:)`. Add the fixture if missing — see existing `TestFixtures.makeScout` for shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/ScoutStoreClearTests 2>&1 | tail -20`
Expected: Compile failure or `scouts.isEmpty == false` — the store doesn't conform yet.

- [ ] **Step 3: Modify `ScoutStore`**

In `apps/ios/Brett/Stores/ScoutStore.swift`, change the class declaration to conform and add registration in init:

```swift
@MainActor
@Observable
final class ScoutStore: Clearable {
    // ... existing properties ...

    init(client: APIClient = .shared, context: ModelContext? = nil) {
        self.client = client
        self.context = context
        ClearableStoreRegistry.register(self)
    }

    // ... existing methods ...

    /// Clearable conformance — drop any in-memory DTO cache. The SwiftData
    /// `Scout` rows are wiped separately by `PersistenceController.wipeAllData`.
    func clearForSignOut() {
        scouts = []
        isLoading = false
        errorMessage = nil
    }

    #if DEBUG
    func injectForTesting(scouts: [APIClient.ScoutDTO]) {
        self.scouts = scouts
    }
    #endif
}
```

If `TestFixtures.makeScoutDTO` doesn't exist, add it to `apps/ios/BrettTests/TestSupport/TestFixtures.swift` mirroring the existing `makeScout` shape but returning the DTO type used in `ScoutStore.scouts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/ScoutStoreClearTests 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/ScoutStore.swift apps/ios/BrettTests/Stores/ScoutStoreClearTests.swift apps/ios/BrettTests/TestSupport/TestFixtures.swift
git commit -m "feat(ios): ScoutStore conforms to Clearable"
```

---

### Task 4: `UserProfileStore`

**Files:**
- Modify: `apps/ios/Brett/Stores/UserProfileStore.swift`
- Create: `apps/ios/BrettTests/Stores/UserProfileStoreClearTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import Testing
import SwiftData
@testable import Brett

@Suite("UserProfileStore clear", .tags(.smoke))
@MainActor
struct UserProfileStoreClearTests {
    @Test func clearForSignOutDropsCachedProfile() throws {
        ClearableStoreRegistry.resetForTesting()
        let context = try InMemoryPersistenceController.makeContext()
        let store = UserProfileStore(context: context)

        // Hydrate by inserting a row, fetching once, then verifying the
        // private cache is populated.
        let profile = TestFixtures.makeUserProfile(email: "test@brett.app")
        context.insert(profile)
        try context.save()
        _ = store.current
        // Delete from SwiftData — the cache would still hold a reference.
        context.delete(profile)
        try context.save()
        // current is now stale (refers to deleted row) until we clear.
        // Note: SwiftData semantics around deleted-but-cached rows can vary;
        // the assertion that matters is that after clearForSignOut, the
        // store re-fetches and gets nothing.

        ClearableStoreRegistry.clearAll()

        #expect(store.current == nil)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/UserProfileStoreClearTests 2>&1 | tail -20`
Expected: Compile failure — `UserProfileStore` is not `Clearable`.

- [ ] **Step 3: Modify `UserProfileStore`**

In `apps/ios/Brett/Stores/UserProfileStore.swift`:

Change class declaration to `final class UserProfileStore: Clearable {`.

In `init(context:)`, append: `ClearableStoreRegistry.register(self)`.

Add the method:

```swift
    /// Clearable conformance — drop the cached profile so a sign-in for a
    /// different user starts with no stale row. The SwiftData `UserProfile`
    /// row is wiped separately by `PersistenceController.wipeAllData`.
    func clearForSignOut() {
        cachedProfile = nil
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/UserProfileStoreClearTests 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/UserProfileStore.swift apps/ios/BrettTests/Stores/UserProfileStoreClearTests.swift
git commit -m "feat(ios): UserProfileStore conforms to Clearable"
```

---

### Task 5: `BriefingStore`

**Files:**
- Modify: `apps/ios/Brett/Stores/BriefingStore.swift`
- Create: `apps/ios/BrettTests/Stores/BriefingStoreClearTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import Brett

@Suite("BriefingStore clear", .tags(.smoke))
@MainActor
struct BriefingStoreClearTests {
    @Test func clearForSignOutDropsBriefingAndError() {
        ClearableStoreRegistry.resetForTesting()
        let store = BriefingStore()
        store.injectForTesting(briefing: "## Today's plan", error: "stale error")
        #expect(store.briefing != nil)

        ClearableStoreRegistry.clearAll()

        #expect(store.briefing == nil)
        #expect(store.lastError == nil)
        #expect(store.generatedAt == nil)
    }
}
```

Add `injectForTesting` to BriefingStore (DEBUG-only) so the test doesn't need network.

- [ ] **Step 2: Run test to verify it fails**

Run as above. Expected: compile failure.

- [ ] **Step 3: Modify `BriefingStore`**

```swift
final class BriefingStore: Clearable {
    // ... existing ...

    init(api: APIClient = APIClient.shared) {
        self.api = api
        ClearableStoreRegistry.register(self)
    }

    func clearForSignOut() {
        briefing = nil
        generatedAt = nil
        lastError = nil
        isGenerating = false
    }

    #if DEBUG
    func injectForTesting(briefing: String?, error: String? = nil) {
        self.briefing = briefing
        self.lastError = error
    }
    #endif
}
```

- [ ] **Step 4: Run test to verify pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/BriefingStore.swift apps/ios/BrettTests/Stores/BriefingStoreClearTests.swift
git commit -m "feat(ios): BriefingStore conforms to Clearable"
```

---

### Task 6: `SearchStore`

**Files:**
- Modify: `apps/ios/Brett/Stores/SearchStore.swift`
- Create: `apps/ios/BrettTests/Stores/SearchStoreClearTests.swift`

`SearchStore` matters more than the others because it owns a `currentTask` that, if not cancelled on sign-out, can land late results into the new user's session. The test asserts both state-clearing AND task cancellation.

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import Brett

@Suite("SearchStore clear", .tags(.smoke))
@MainActor
struct SearchStoreClearTests {
    @Test func clearForSignOutDropsResultsAndCancelsInFlightSearch() {
        ClearableStoreRegistry.resetForTesting()
        let store = SearchStore()
        store.injectForTesting(results: [TestFixtures.makeSearchResult(title: "Stale")])
        #expect(store.results.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.results.isEmpty)
        #expect(store.query.isEmpty)
        #expect(store.isLoading == false)
        // currentTask must be nil so a late response can't land.
        #expect(store.hasInFlightTask == false)
    }
}
```

Add `injectForTesting(results:)`, `hasInFlightTask`, and a `TestFixtures.makeSearchResult(title:)` helper as needed.

- [ ] **Step 2: Run failing.** Expected: compile failure.

- [ ] **Step 3: Modify `SearchStore`**

In `apps/ios/Brett/Stores/SearchStore.swift`:

```swift
final class SearchStore: Clearable {
    // ...

    init(api: APIClient = .shared) {
        // ... existing init body ...
        ClearableStoreRegistry.register(self)
    }

    func clearForSignOut() {
        currentTask?.cancel()
        currentTask = nil
        results = []
        query = ""
        isLoading = false
        errorMessage = nil
    }

    #if DEBUG
    var hasInFlightTask: Bool { currentTask != nil }
    func injectForTesting(results: [SearchResult]) { self.results = results }
    #endif
}
```

Look up `currentTask` and `query` field names in the existing file and substitute correctly — they may be private. If they are, the test asserts via the public API instead (`#expect(store.results.isEmpty)`).

- [ ] **Step 4: Run pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/SearchStore.swift apps/ios/BrettTests/Stores/SearchStoreClearTests.swift apps/ios/BrettTests/TestSupport/TestFixtures.swift
git commit -m "feat(ios): SearchStore conforms to Clearable; cancels in-flight task"
```

---

### Task 7: `NewsletterStore`

**Files:**
- Modify: `apps/ios/Brett/Stores/NewsletterStore.swift`
- Create: `apps/ios/BrettTests/Stores/NewsletterStoreClearTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import Brett

@Suite("NewsletterStore clear", .tags(.smoke))
@MainActor
struct NewsletterStoreClearTests {
    @Test func clearForSignOutDropsAllSenderState() {
        ClearableStoreRegistry.resetForTesting()
        let store = NewsletterStore()
        store.injectForTesting(
            ingestAddress: "stale@brett.app",
            senders: [.init(id: "s1", email: "from@a.com", isActive: true)],
            pending: [.init(id: "p1", email: "p@a.com")]
        )
        #expect(store.senders.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.ingestAddress == nil)
        #expect(store.senders.isEmpty)
        #expect(store.pending.isEmpty)
        #expect(store.errorMessage == nil)
    }
}
```

Look up the exact `NewsletterSender` and `PendingNewsletterSender` initializers in `NewsletterStore.swift` to populate the fixture correctly.

- [ ] **Step 2: Run failing.** Expected: compile failure.

- [ ] **Step 3: Modify `NewsletterStore`**

```swift
final class NewsletterStore: Clearable {
    // ...

    init(client: APIClient = .shared) {
        self.client = client
        ClearableStoreRegistry.register(self)
    }

    func clearForSignOut() {
        ingestAddress = nil
        senders = []
        pending = []
        isLoading = false
        errorMessage = nil
    }

    #if DEBUG
    func injectForTesting(
        ingestAddress: String?,
        senders: [NewsletterSender],
        pending: [PendingNewsletterSender]
    ) {
        self.ingestAddress = ingestAddress
        self.senders = senders
        self.pending = pending
    }
    #endif
}
```

- [ ] **Step 4: Run pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/NewsletterStore.swift apps/ios/BrettTests/Stores/NewsletterStoreClearTests.swift
git commit -m "feat(ios): NewsletterStore conforms to Clearable"
```

---

### Task 8: `CalendarAccountsStore`

**Files:**
- Modify: `apps/ios/Brett/Stores/CalendarAccountsStore.swift`
- Create: `apps/ios/BrettTests/Stores/CalendarAccountsStoreClearTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import Brett

@Suite("CalendarAccountsStore clear", .tags(.smoke))
@MainActor
struct CalendarAccountsStoreClearTests {
    @Test func clearForSignOutDropsAccounts() {
        ClearableStoreRegistry.resetForTesting()
        let store = CalendarAccountsStore()
        store.injectForTesting(accounts: [TestFixtures.makeCalendarAccount()])
        #expect(store.accounts.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.accounts.isEmpty)
        #expect(store.lastError == nil)
        #expect(store.isLoading == false)
    }
}
```

Add `TestFixtures.makeCalendarAccount()` returning a fully-populated `CalendarAccount` instance — read the struct definition in `CalendarAccountsStore.swift` to mirror exactly.

- [ ] **Step 2: Run failing.** Expected: compile failure.

- [ ] **Step 3: Modify `CalendarAccountsStore`**

```swift
final class CalendarAccountsStore: Clearable {
    // ...

    init(api: APIClient = .shared) {
        self.api = api
        ClearableStoreRegistry.register(self)
    }

    func clearForSignOut() {
        accounts = []
        isLoading = false
        lastError = nil
    }

    #if DEBUG
    func injectForTesting(accounts: [CalendarAccount]) {
        self.accounts = accounts
    }
    #endif
}
```

- [ ] **Step 4: Run pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/CalendarAccountsStore.swift apps/ios/BrettTests/Stores/CalendarAccountsStoreClearTests.swift apps/ios/BrettTests/TestSupport/TestFixtures.swift
git commit -m "feat(ios): CalendarAccountsStore conforms to Clearable"
```

---

### Task 9: `AIProviderStore`

`AIProviderStore` is a process-wide singleton (`AIProviderStore.shared`). Registration happens in its init. The test must respect that.

**Files:**
- Modify: `apps/ios/Brett/Stores/AIProviderStore.swift`
- Create: `apps/ios/BrettTests/Stores/AIProviderStoreClearTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import Testing
@testable import Brett

@Suite("AIProviderStore clear", .tags(.smoke))
@MainActor
struct AIProviderStoreClearTests {
    @Test func clearForSignOutDropsHasActiveProvider() {
        ClearableStoreRegistry.resetForTesting()
        let store = AIProviderStore()
        store.injectForTesting(hasActiveProvider: true)
        #expect(store.hasActiveProvider == true)

        ClearableStoreRegistry.clearAll()

        #expect(store.hasActiveProvider == nil)
    }
}
```

- [ ] **Step 2: Run failing.** Expected: compile failure.

- [ ] **Step 3: Modify `AIProviderStore`**

```swift
final class AIProviderStore: Clearable {
    // ...

    init(client: APIClient = .shared) {
        self.client = client
        ClearableStoreRegistry.register(self)
    }

    func clearForSignOut() {
        hasActiveProvider = nil
    }

    #if DEBUG
    func injectForTesting(hasActiveProvider: Bool?) {
        self.hasActiveProvider = hasActiveProvider
    }
    #endif
}
```

Note: the existing `static let shared = AIProviderStore()` already triggers init so it self-registers on first access. No change needed there.

- [ ] **Step 4: Run pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/AIProviderStore.swift apps/ios/BrettTests/Stores/AIProviderStoreClearTests.swift
git commit -m "feat(ios): AIProviderStore conforms to Clearable"
```

---

### Task 10: `ChatStore` migrates to `Clearable`

The existing `ChatStoreRegistry` keeps existing — but we add `Clearable` conformance + `clearForSignOut()` so a future change can drop `ChatStoreRegistry.cancelAllActive()` from `Session.tearDown` once any unrelated callers of `ChatStoreRegistry` are gone.

**Files:**
- Modify: `apps/ios/Brett/Stores/ChatStore.swift:574+ (registry section)` and class declaration

- [ ] **Step 1: Write the failing test**

Append to `apps/ios/BrettTests/Sync/ChatStreamingTests.swift` (or create `apps/ios/BrettTests/Stores/ChatStoreClearTests.swift`):

```swift
@Suite("ChatStore clear", .tags(.smoke))
@MainActor
struct ChatStoreClearTests {
    @Test func clearForSignOutCancelsStreamsAndClearsMessages() {
        ClearableStoreRegistry.resetForTesting()
        let store = ChatStore()
        store.injectForTesting(messages: [.init(role: .user, text: "stale")])
        #expect(store.messages.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.messages.isEmpty)
        #expect(store.isStreaming == false)
    }
}
```

Look up the actual `BrettMessage` initializer or the in-memory message-shape in `ChatStore.swift` — the test must use the real type.

- [ ] **Step 2: Run failing.** Expected: compile failure.

- [ ] **Step 3: Modify `ChatStore`**

In `apps/ios/Brett/Stores/ChatStore.swift`:

Change class declaration to `final class ChatStore: Clearable {`.

In init, after the existing `ChatStoreRegistry.register(self)` line, add: `ClearableStoreRegistry.register(self)`.

Add method:

```swift
    /// Clearable conformance — cancel any in-flight stream and drop the
    /// in-memory message buffer. The persisted `BrettMessage` rows are
    /// wiped separately by `PersistenceController.wipeAllData`.
    func clearForSignOut() {
        cancelAll()
        // Clear UI-buffer message arrays. Substitute the real property
        // names (likely `messages`, `pendingMessage`, etc.) — read the
        // existing ChatStore properties to get this exactly right.
        messages = []
        pendingAssistant = nil
    }

    #if DEBUG
    func injectForTesting(messages: [ChatMessage]) {
        self.messages = messages
    }
    #endif
```

The `ChatMessage` type, `messages` property, and `pendingAssistant` should be read from the existing `ChatStore.swift` and substituted correctly.

- [ ] **Step 4: Run pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Stores/ChatStore.swift apps/ios/BrettTests/Stores/ChatStoreClearTests.swift
git commit -m "feat(ios): ChatStore conforms to Clearable; existing registry retained"
```

---

### Task 11: No-op conformance for read-only stores

`SelectionStore`, `ItemStore`, `ListStore`, `MessageStore`, `CalendarStore`, `AttachmentStore` — these either already self-clear (SelectionStore) or don't hold meaningful in-memory state independent of SwiftData (the `@Query`-backed ones). They need to conform so the regression-guard test in Phase 5 passes.

**Files:**
- Modify each of: `SelectionStore.swift`, `ItemStore.swift`, `ListStore.swift`, `MessageStore.swift`, `CalendarStore.swift`, `AttachmentStore.swift`

- [ ] **Step 1: Modify each store**

For `SelectionStore.swift`: change class declaration to `final class SelectionStore: Clearable {`. Add `ClearableStoreRegistry.register(self)` to init. Replace the existing `clear()` method with conforming `clearForSignOut()` (or keep both, having `clear()` call `clearForSignOut()`).

```swift
final class SelectionStore: Clearable {
    // ... existing properties ...

    static let shared = SelectionStore()

    init() {
        ClearableStoreRegistry.register(self)
    }

    func clearForSignOut() { clear() }

    func clear() {
        selectedTaskId = nil
        selectedEventId = nil
        lastCreatedItemId = nil
        pendingSettingsTab = nil
    }
}
```

For each of `ItemStore`, `ListStore`, `MessageStore`, `CalendarStore`, `AttachmentStore`: change class declaration to add `: Clearable`, register self in init, add `func clearForSignOut() {}` (Wave B fills these).

- [ ] **Step 2: Run all tests**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -30`
Expected: All tests pass. New stores compile cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Stores/SelectionStore.swift apps/ios/Brett/Stores/ItemStore.swift apps/ios/Brett/Stores/ListStore.swift apps/ios/Brett/Stores/MessageStore.swift apps/ios/Brett/Stores/CalendarStore.swift apps/ios/Brett/Stores/AttachmentStore.swift
git commit -m "feat(ios): remaining stores conform to Clearable (no-op for now)"
```

---

### Task 12: Remove `SelectionStore.shared.clear()` from sign-out paths

Now that `SelectionStore` is registered, `AuthManager.signOut` and `AuthManager.clearInvalidSession` no longer need to call `SelectionStore.shared.clear()` directly — `ClearableStoreRegistry.clearAll()` (called from `Session.tearDown`) handles it.

**Files:**
- Modify: `apps/ios/Brett/Auth/AuthManager.swift:203, 242`

- [ ] **Step 1: Locate and remove**

In `apps/ios/Brett/Auth/AuthManager.swift`, delete line 203 (`SelectionStore.shared.clear()`) and line 242 (same call inside `clearInvalidSession`).

- [ ] **Step 2: Run tests**

Run the full suite. Expected: still green — fan-out via the registry produces the same observable behavior.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Auth/AuthManager.swift
git commit -m "refactor(ios): drop manual SelectionStore.clear from signOut (covered by registry fan-out)"
```

---

## Phase 3 — Concurrency hardening

### Task 13: `[weak self]` on AuthManager keychain-hydrate Task

**Files:**
- Modify: `apps/ios/Brett/Auth/AuthManager.swift:84`

- [ ] **Step 1: Write the failing test**

Append to `apps/ios/BrettTests/Auth/AuthManagerTests.swift`:

```swift
@Test func hydrateTaskDoesNotRetainSelfAfterRelease() async throws {
    weak var weakManager: AuthManager?
    do {
        let manager = AuthManager()
        weakManager = manager
        // Manager goes out of scope at end of `do` block.
    }
    // Give the implicit Task a tick to run and release the strong ref.
    try await Task.sleep(nanoseconds: 50_000_000)
    #expect(weakManager == nil, "AuthManager should be deallocated after going out of scope")
}
```

- [ ] **Step 2: Run failing**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/AuthManagerTests/hydrateTaskDoesNotRetainSelfAfterRelease 2>&1 | tail -20`
Expected: assertion fails — the strong-self capture in the keychain-hydrate Task pins the manager.

- [ ] **Step 3: Modify**

In `apps/ios/Brett/Auth/AuthManager.swift`, find:

```swift
        if let stored = try? KeychainStore.readToken() {
            self.token = stored
            // We don't have a user record yet (`/users/me` hasn't returned),
            // but we know there's a valid token. `refreshCurrentUser` hydrates
            // the user and, on success, installs the session.
            Task { await self.refreshCurrentUser() }
        }
```

Replace the `Task { ... }` line with:

```swift
            Task { [weak self] in await self?.refreshCurrentUser() }
```

- [ ] **Step 4: Run pass**

Expected: test passes; existing AuthManager tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Auth/AuthManager.swift apps/ios/BrettTests/Auth/AuthManagerTests.swift
git commit -m "fix(ios): break strong-self capture in AuthManager keychain hydrate"
```

---

### Task 14: BrettApp scenePhase Task tracking + cancellation

The five `Task { ... }` calls inside `RootView.onChange(of: scenePhase)` and `onChange(of: isAuthenticated)` (`BrettApp.swift:218, 225, 251, 256, 270`) fire-and-forget. A rapid background↔active flap can leave stale Tasks racing. We give each a tracked handle and cancel the prior one on phase change.

**Files:**
- Modify: `apps/ios/Brett/BrettApp.swift:153-272 (RootView struct)`

- [ ] **Step 1: Write the failing test**

This is hard to test cleanly via Swift Testing because `RootView` depends on a SwiftUI environment. Add a focused test of the helper that owns the cancellation logic, after we extract it.

Create `apps/ios/BrettTests/Stores/ScenePhaseTaskTrackerTests.swift`:

```swift
import Testing
@testable import Brett

@Suite("ScenePhaseTaskTracker", .tags(.smoke))
@MainActor
struct ScenePhaseTaskTrackerTests {
    @Test func startingNewTaskCancelsPreviousOne() async throws {
        let tracker = ScenePhaseTaskTracker()
        var firstFinished = false
        var firstCancelled = false

        tracker.start {
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
                firstFinished = true
            } catch {
                firstCancelled = true
            }
        }
        // Give the first task a moment to start.
        try await Task.sleep(nanoseconds: 10_000_000)

        tracker.start {
            // Second task is a no-op so we can observe cancellation of the first.
        }

        try await Task.sleep(nanoseconds: 250_000_000)
        #expect(firstFinished == false)
        #expect(firstCancelled == true)
    }

    @Test func cancelStopsRunningTask() async throws {
        let tracker = ScenePhaseTaskTracker()
        var cancelled = false
        tracker.start {
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
            } catch {
                cancelled = true
            }
        }
        try await Task.sleep(nanoseconds: 10_000_000)
        tracker.cancel()
        try await Task.sleep(nanoseconds: 30_000_000)
        #expect(cancelled == true)
    }
}
```

- [ ] **Step 2: Run failing.** Expected: compile failure (`ScenePhaseTaskTracker` doesn't exist).

- [ ] **Step 3: Implement and wire up**

Add a small helper at the top of `apps/ios/Brett/BrettApp.swift` (above `RootView`):

```swift
/// Owns one in-flight `Task` at a time. Replaces the fire-and-forget
/// `Task { ... }` pattern in scenePhase / isAuthenticated handlers. When a
/// new task is started, the previous one is cancelled — so a rapid
/// background↔active flap can't leave a stale "clear badge" coexisting
/// with a "request authorization."
@MainActor
final class ScenePhaseTaskTracker {
    private var current: Task<Void, Never>?

    func start(_ work: @escaping () async -> Void) {
        current?.cancel()
        current = Task { await work() }
    }

    func cancel() {
        current?.cancel()
        current = nil
    }
}
```

In `RootView`, declare three trackers as `@State`:

```swift
private struct RootView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var lockManager = BiometricLockManager.shared

    @State private var badgeTracker = ScenePhaseTaskTracker()
    @State private var sessionRefreshTracker = ScenePhaseTaskTracker()
    @State private var shareDrainTracker = ScenePhaseTaskTracker()
```

Replace the existing `Task { ... }` calls inside the two `onChange` handlers and the `.task` modifier with calls into the trackers. Concretely:

```swift
        .onChange(of: authManager.isAuthenticated) { _, isAuth in
            if isAuth {
                lockManager.handleFreshSignIn()
                badgeTracker.start { await BadgeManager.shared.requestAuthorization() }
            } else {
                lockManager.handleSignOut()
                badgeTracker.start { await BadgeManager.shared.clear() }
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                lockManager.handleDidEnterBackground()
                ShakeMonitor.shared.stop()
            case .active:
                lockManager.handleWillEnterForeground()
                ShakeMonitor.shared.start()
                ShareIngestor.shared.configure(auth: authManager)
                shareDrainTracker.start { await ShareIngestor.shared.drain() }
                sessionRefreshTracker.start { [authManager] in
                    await authManager.refreshIfStale()
                }
            default:
                break
            }
        }
        .task {
            ShakeMonitor.shared.start()
            ShareIngestor.shared.configure(auth: authManager)
            shareDrainTracker.start { await ShareIngestor.shared.drain() }
        }
```

Inside the `.task` of the `MainContainer` mount, leave the badge `Task { await BadgeManager... }` as-is (it's a one-shot per mount and dies with the view).

- [ ] **Step 4: Run pass.** Expected: tracker tests pass; existing AppLaunchTests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/BrettApp.swift apps/ios/BrettTests/Stores/ScenePhaseTaskTrackerTests.swift
git commit -m "fix(ios): track scenePhase tasks; cancel prior on transition"
```

---

### Task 15: AttachmentUploader.queueTask retain-cycle fix

The existing `processQueue` body:

```swift
    func processQueue() {
        if let existing = queueTask, !existing.isCancelled { return }
        queueTask = Task { [weak self] in
            guard let self else { return }
            await self.drain()
            await MainActor.run { self.queueTask = nil }
        }
    }
```

The `await MainActor.run { self.queueTask = nil }` closure captures `self` strongly inside the `[weak self]` outer Task. Once we pass the `guard let self`, the strong ref escapes. Fix: use `[weak self]` again on the inner closure, or restructure to clear `queueTask` from the main actor explicitly without re-capturing.

**Files:**
- Modify: `apps/ios/Brett/Sync/AttachmentUploader.swift:279-286`

- [ ] **Step 1: Write the failing test**

Add to `apps/ios/BrettTests/Sync/AttachmentUploaderTests.swift` (or create a new file in that directory):

```swift
@Test func processQueueDoesNotRetainSelfAcrossDrain() async throws {
    weak var weakUploader: AttachmentUploader?
    do {
        let persistence = PersistenceController.makePreview()
        let store = AttachmentStore(context: persistence.mainContext)
        let uploader = AttachmentUploader(
            apiClient: .shared,
            attachmentStore: store,
            persistence: persistence,
            useBackgroundSession: false
        )
        weakUploader = uploader
        uploader.processQueue()
        // Let drain complete (queue is empty so it returns immediately).
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    try await Task.sleep(nanoseconds: 50_000_000)
    #expect(weakUploader == nil, "AttachmentUploader should not be retained after going out of scope")
}
```

- [ ] **Step 2: Run failing.** Expected: assertion fails — uploader retained.

- [ ] **Step 3: Modify**

Replace the `processQueue` body:

```swift
    func processQueue() {
        if let existing = queueTask, !existing.isCancelled { return }
        queueTask = Task { [weak self] in
            await self?.drain()
            // Use [weak self] explicitly inside the MainActor.run closure to
            // avoid escaping a strong reference through the inner task.
            await MainActor.run { [weak self] in
                self?.queueTask = nil
            }
        }
    }
```

- [ ] **Step 4: Run pass.** Expected: weak-self test passes; existing AttachmentUploader tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Sync/AttachmentUploader.swift apps/ios/BrettTests/Sync/AttachmentUploaderTests.swift
git commit -m "fix(ios): break retain cycle in AttachmentUploader.processQueue"
```

---

### Task 16: SSEClient runConnectLoop sleep cancellation

The `try? await Task.sleep` at [SSEClient.swift:206](../../../apps/ios/Brett/Sync/SSEClient.swift:206) eats `CancellationError`. The `while !Task.isCancelled` check immediately after catches it, so functionally this is fine — but the `try?` swallows the only signal that the loop should exit immediately. Replace with explicit cancellation handling so disconnect-during-backoff is provably immediate.

**Files:**
- Modify: `apps/ios/Brett/Sync/SSEClient.swift:179-215`
- Create: `apps/ios/BrettTests/Sync/SSEClientLifecycleTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import Testing
import Foundation
@testable import Brett

@Suite("SSEClient lifecycle", .tags(.sync))
@MainActor
struct SSEClientLifecycleTests {
    @Test func disconnectCancelsLoopWithinShortDeadline() async throws {
        let client = SSEClient(
            apiClient: APIClient.shared,
            session: .shared,
            maxBackoffSeconds: 30,
            backoffMultiplier: 0
        )
        client.connect()
        try await Task.sleep(nanoseconds: 20_000_000)
        let start = Date()
        client.disconnect()
        // Wait until the internal loopTask reports cancelled. With a 30s
        // backoff sleep currently in flight, the test would take 30s if the
        // sleep weren't immediately cancelled.
        try await Task.sleep(nanoseconds: 100_000_000)
        let elapsed = Date().timeIntervalSince(start)
        #expect(elapsed < 1.0, "disconnect must terminate the loop within 1s, got \(elapsed)s")
    }

    @Test func loopTaskIsClearedAfterDisconnect() async throws {
        let client = SSEClient(
            apiClient: APIClient.shared,
            session: .shared,
            maxBackoffSeconds: 30,
            backoffMultiplier: 0
        )
        client.connect()
        try await Task.sleep(nanoseconds: 20_000_000)
        client.disconnect()
        try await Task.sleep(nanoseconds: 50_000_000)
        #expect(client.hasLoopTask == false)
    }
}
```

Add a DEBUG-only `var hasLoopTask: Bool { loopTask != nil }` to `SSEClient`.

- [ ] **Step 2: Run failing.** Expected: timing assertion fails (the loop's `try?` swallows the cancel and the `while !Task.isCancelled` check then exits — but the structural concern is the inability to test). Actually this may already pass — verify, and if it does, the test still has value as a regression guard.

- [ ] **Step 3: Modify**

Replace the catch in `runConnectLoop`:

```swift
            // Existing:
            // try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))

            // Replacement: surface cancellation explicitly so the loop exits
            // immediately on disconnect, without waiting for the next
            // `while !Task.isCancelled` check.
            if delay > 0 {
                do {
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                } catch is CancellationError {
                    break
                } catch {
                    BrettLog.sse.error("SSE backoff sleep failed: \(String(describing: error), privacy: .public)")
                    break
                }
            }
```

- [ ] **Step 4: Run pass.** Expected: lifecycle tests pass; existing SSEClientTests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Sync/SSEClient.swift apps/ios/BrettTests/Sync/SSEClientLifecycleTests.swift
git commit -m "fix(ios): SSEClient disconnect terminates loop immediately"
```

---

## Phase 4 — Logged errors

These tasks each replace one `try? context.save()` with `do/catch` that logs at `.error`. The category to use is determined by which subsystem the call lives in (`BrettLog.sync`, `BrettLog.attachments`, `BrettLog.auth`, etc.).

### Task 17: SyncManager.swift:381

**Files:**
- Modify: `apps/ios/Brett/Sync/SyncManager.swift` — read context first to find exactly what the save is doing.

- [ ] **Step 1: Read the surrounding code**

Run: `awk 'NR>=370 && NR<=390' apps/ios/Brett/Sync/SyncManager.swift`

Identify the entry point and what the save covers (likely `flushDeadMutations` or similar).

- [ ] **Step 2: Modify**

Replace `try? context.save()` at line 381 with:

```swift
        do {
            try context.save()
        } catch {
            BrettLog.sync.error("SyncManager flush save failed: \(String(describing: error), privacy: .public)")
        }
```

- [ ] **Step 3: Run all sync tests**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing-tag sync 2>&1 | tail -20`
Expected: All green.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Sync/SyncManager.swift
git commit -m "fix(ios): log SyncManager save failures instead of swallowing"
```

---

### Task 18: ConflictResolver.swift:105 + ShareIngestor.swift:161

Both are single-line replacements analogous to Task 17.

**Files:**
- Modify: `apps/ios/Brett/Sync/ConflictResolver.swift:105`
- Modify: `apps/ios/Brett/Sync/ShareIngestor.swift:161`

- [ ] **Step 1: Apply both replacements**

`ConflictResolver.swift:105`:
```swift
        do {
            try context.save()
        } catch {
            BrettLog.sync.error("ConflictResolver logConflict save failed: \(String(describing: error), privacy: .public)")
        }
```

`ShareIngestor.swift:161`:
```swift
        do {
            try context.save()
        } catch {
            BrettLog.sync.error("ShareIngestor drain save failed: \(String(describing: error), privacy: .public)")
        }
```

- [ ] **Step 2: Run sync tests.** Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Sync/ConflictResolver.swift apps/ios/Brett/Sync/ShareIngestor.swift
git commit -m "fix(ios): log ConflictResolver + ShareIngestor save failures"
```

---

### Task 19: AttachmentUploader try? saves (5 sites)

**Files:**
- Modify: `apps/ios/Brett/Sync/AttachmentUploader.swift:264, 320, 327, 445, 463`

- [ ] **Step 1: Replace each**

Each of the five `try? persistence.mainContext.save()` lines becomes:

```swift
        do {
            try persistence.mainContext.save()
        } catch {
            BrettLog.attachments.error("AttachmentUploader save at <site description> failed: \(String(describing: error), privacy: .public)")
        }
```

Substitute `<site description>` for each (`enqueue`, `retry-cap`, `start-upload`, `complete`, `fail`).

- [ ] **Step 2: Run attachment tests.**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:BrettTests/AttachmentUploaderTests 2>&1 | tail -20`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Sync/AttachmentUploader.swift
git commit -m "fix(ios): log AttachmentUploader save failures (5 sites)"
```

---

### Task 20: AuthManager server sign-out errors

**Files:**
- Modify: `apps/ios/Brett/Auth/AuthManager.swift:219-223, 248-253`

- [ ] **Step 1: Modify both catch blocks**

In `signOut()`:

```swift
        do {
            try await endpoints.signOut()
        } catch {
            BrettLog.auth.error("Server sign-out failed (non-fatal): \(String(describing: error), privacy: .public)")
        }
```

In `clearInvalidSession()`:

```swift
        do {
            try await endpoints.signOut()
        } catch {
            // Token is already invalid server-side; this call will likely
            // 401 too. Log at info because the failure is expected.
            BrettLog.auth.info("Server sign-out after invalid-session 401 failed (expected): \(String(describing: error), privacy: .public)")
        }
```

- [ ] **Step 2: Run auth tests.** Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Auth/AuthManager.swift
git commit -m "fix(ios): log server-side sign-out errors instead of swallowing"
```

---

### Task 21: BackgroundService — replace `#if DEBUG print` with `BrettLog`

**Files:**
- Modify: `apps/ios/Brett/Services/BackgroundService.swift:162-203`

- [ ] **Step 1: Modify**

Replace the three `#if DEBUG print(...) #endif` blocks at lines 165-167, 173-176, 199-201 with `BrettLog.app` calls. Use a new `BrettLog.app` channel (already exists per [BrettLog.swift](../../../apps/ios/Brett/Utilities/BrettLog.swift)). Examples:

```swift
        guard let url = Bundle.main.url(forResource: "background-manifest", withExtension: "json") else {
            BrettLog.app.error("BackgroundService: missing background-manifest.json in bundle")
            return
        }
        do {
            let data = try Data(contentsOf: url)
            self.manifest = try JSONDecoder().decode(BackgroundManifest.self, from: data)
        } catch {
            BrettLog.app.error("BackgroundService: failed to decode manifest: \(String(describing: error), privacy: .public)")
        }
```

And in `loadConfigIfNeeded`:

```swift
        } catch {
            BrettLog.app.error("BackgroundService: failed to load /config: \(String(describing: error), privacy: .public)")
        }
```

- [ ] **Step 2: Run tests.** Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Services/BackgroundService.swift
git commit -m "fix(ios): BackgroundService logs via BrettLog instead of #if DEBUG print"
```

---

## Phase 5 — Regression guards

### Task 22: SilentTrySaveGuardTests

A grep-based guard that fails if a future commit re-introduces `try? context.save()` in `apps/ios/Brett/Sync/`. The allowlist captures the legitimate exceptions (none today after Phase 4).

**Files:**
- Create: `apps/ios/BrettTests/Sync/SilentTrySaveGuardTests.swift`

- [ ] **Step 1: Write the test**

```swift
import Testing
import Foundation
@testable import Brett

/// Regression guard: every `try? context.save()` in the sync subsystem
/// hides a real failure mode. Phase 4 of Wave A converted them all to
/// logged saves. This test fails if a future change reintroduces the
/// pattern. New legitimate exceptions (deliberately-best-effort cleanup)
/// can be added to `allowlist`.
@Suite("Silent try? save guard", .tags(.sync))
struct SilentTrySaveGuardTests {
    /// File-relative paths under `Sync/` allowed to use `try? <ctx>.save()`.
    /// Empty by default — every site must either log or be allowlisted with
    /// a one-line comment justifying the choice.
    private static let allowlist: Set<String> = []

    @Test func noTryQuestionContextSaveInSyncDirectory() throws {
        let syncDirectory = URL(fileURLWithPath: #file)
            .deletingLastPathComponent() // .../Sync
            .deletingLastPathComponent() // .../BrettTests
            .deletingLastPathComponent() // .../ios
            .appendingPathComponent("Brett/Sync", isDirectory: true)

        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(
            at: syncDirectory,
            includingPropertiesForKeys: nil
        ) else {
            Issue.record("Could not enumerate Sync directory at \(syncDirectory.path)")
            return
        }

        var offenders: [String] = []
        for case let fileURL as URL in enumerator where fileURL.pathExtension == "swift" {
            let contents = try String(contentsOf: fileURL, encoding: .utf8)
            // Match `try? <something>.save()` — the pattern we eliminated.
            let pattern = #"try\?\s+\w+(\.\w+)*\.save\("#
            let regex = try NSRegularExpression(pattern: pattern)
            let range = NSRange(contents.startIndex..., in: contents)
            let matches = regex.matches(in: contents, range: range)
            if !matches.isEmpty {
                let relativePath = fileURL.lastPathComponent
                if !Self.allowlist.contains(relativePath) {
                    offenders.append("\(relativePath): \(matches.count) occurrence(s)")
                }
            }
        }

        #expect(offenders.isEmpty, """
            Found `try? <ctx>.save()` in sync directory — these silently swallow
            errors. Replace with do/catch + BrettLog, or add the file to the
            allowlist with a comment explaining why.
            \(offenders.joined(separator: "\n"))
            """)
    }
}
```

- [ ] **Step 2: Run test.** Expected: PASS (every site was converted in Phase 4).

- [ ] **Step 3: Manually verify the test catches regressions**

Temporarily add `try? context.save()` to a test file (e.g., into `SyncManager.swift`), run the guard test, see it fail, revert.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/BrettTests/Sync/SilentTrySaveGuardTests.swift
git commit -m "test(ios): regression guard for silent try? saves in sync paths"
```

---

### Task 23: ClearableConformanceTests

Reflection guard: every `@Observable final class` under `Stores/` conforms to `Clearable`.

**Files:**
- Create: `apps/ios/BrettTests/Stores/ClearableConformanceTests.swift`

- [ ] **Step 1: Write the test**

Reflecting over Swift class conformances at runtime is brittle. Instead, use a curated list that the test author updates whenever a new store is added. The test fails the build if the curated list is out of sync with disk.

```swift
import Testing
import Foundation
@testable import Brett

/// Regression guard: every store in the Stores/ directory must conform to
/// `Clearable`. The check is two-step:
///
///  1. Compare a curated list of expected store types against the actual
///     `.swift` files on disk under `Stores/`. If a new file appears that
///     looks like a store, the test fails — author must add it to the list.
///  2. Each entry is compile-checked at the bottom: a generic helper that
///     only accepts `Clearable` types validates conformance.
@Suite("Clearable conformance", .tags(.smoke))
@MainActor
struct ClearableConformanceTests {
    /// Curated list. Add entries when new stores ship. Each is also referenced
    /// in `assertConformance` below — that reference is what enforces the
    /// `Clearable` constraint at compile time.
    private static let expectedStores: [String] = [
        "AIProviderStore.swift",
        "AttachmentStore.swift",
        "BriefingStore.swift",
        "CalendarAccountsStore.swift",
        "CalendarStore.swift",
        "ChatStore.swift",
        "ClearableStoreRegistry.swift",
        "ItemStore.swift",
        "ListStore.swift",
        "MessageStore.swift",
        "NewsletterStore.swift",
        "PersistenceController.swift",
        "ScoutStore.swift",
        "SearchStore.swift",
        "SelectionStore.swift",
        "UserProfileStore.swift",
    ]

    @Test func curatedStoreListMatchesFilesOnDisk() throws {
        let storesDirectory = URL(fileURLWithPath: #file)
            .deletingLastPathComponent() // Stores
            .deletingLastPathComponent() // BrettTests
            .deletingLastPathComponent() // ios
            .appendingPathComponent("Brett/Stores", isDirectory: true)

        let fm = FileManager.default
        let onDisk = try fm.contentsOfDirectory(atPath: storesDirectory.path)
            .filter { $0.hasSuffix(".swift") }
            .sorted()

        let expected = Self.expectedStores.sorted()
        #expect(onDisk == expected, """
            New file appeared (or one was removed) in Stores/. Update the
            `expectedStores` list AND ensure any new store conforms to
            `Clearable` + registers in init.
            On disk:  \(onDisk)
            Expected: \(expected)
            """)
    }

    /// Compile-time conformance check. The body intentionally references the
    /// types — if any of them stops conforming to `Clearable`, the build
    /// fails before the test even runs.
    @Test func storesConformToClearable() {
        assertConformance(AIProviderStore.self)
        assertConformance(AttachmentStore.self)
        assertConformance(BriefingStore.self)
        assertConformance(CalendarAccountsStore.self)
        assertConformance(CalendarStore.self)
        assertConformance(ChatStore.self)
        assertConformance(ItemStore.self)
        assertConformance(ListStore.self)
        assertConformance(MessageStore.self)
        assertConformance(NewsletterStore.self)
        assertConformance(ScoutStore.self)
        assertConformance(SearchStore.self)
        assertConformance(SelectionStore.self)
        assertConformance(UserProfileStore.self)
    }

    private func assertConformance<T: Clearable>(_ type: T.Type) {
        // No runtime assertion — the generic constraint enforces this at
        // compile time. The call exists to anchor the type into the test.
        _ = type
    }
}
```

- [ ] **Step 2: Run test.** Expected: PASS.

- [ ] **Step 3: Verify the guard catches drift**

Temporarily rename `BriefingStore` to `BriefingStoreV2` (just the type, not the file). Build fails. Revert.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/BrettTests/Stores/ClearableConformanceTests.swift
git commit -m "test(ios): regression guard for Clearable conformance across stores"
```

---

## Phase 6 — Final verification

### Task 24: Full test run + manual smoke

- [ ] **Step 1: Full unit test suite**

Run: `xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -30`
Expected: All green. Count of tests should be original count + new tests added in Wave A (~20).

- [ ] **Step 2: Full UI test suite**

Run: `xcodebuild test -scheme BrettUITests -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -20`
Expected: Same green/skipped count as before.

- [ ] **Step 3: Manual smoke checklist**

Boot the app on a simulator. Walk through:

1. Cold launch as user A. Verify Today renders. Sign out.
2. Sign in as user B (different account). Verify Today renders B's data — no items, lists, scouts, briefing, or chat from A appear.
3. Send a chat message, kill the app mid-stream (force-quit). Relaunch. Verify the partial assistant message either persists (if SSE persisted) or is gone — no orphaned "thinking..." spinner.
4. Start an attachment upload. Background the app. Bring it back. Verify the upload either completes or surfaces a clear error.
5. Rapidly swipe up to background and tap to foreground 5x in 3 seconds. Verify no UI flicker, no badge race, no stuck "loading" state.
6. Trigger a sync conflict (edit a task on iOS while the same task is edited on desktop). Verify the conflict resolves and a `BrettLog.sync` line appears in Console.app.

- [ ] **Step 4: Push to branch**

```bash
git push origin claude/suspicious-agnesi-6f55a9
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "fix(ios): Wave A — concurrency & lifecycle hygiene" --body "$(cat <<'EOF'
## Summary
Wave A of the iOS simplification plan ([spec](docs/superpowers/specs/2026-04-26-ios-simplification-design.md)). Tightens concurrency and lifecycle:

- New `Clearable` protocol + `ClearableStoreRegistry` fans cleanup out from `Session.tearDown` to every store.
- `[weak self]` on `AuthManager` keychain-hydrate Task; tracked + cancellable scenePhase Tasks in `RootView`; retain-cycle break in `AttachmentUploader.processQueue`; explicit cancellation handling for `SSEClient` backoff sleep.
- Replaced ~10 silent `try? context.save()` calls in sync paths with logged `do/catch`; same treatment for `AuthManager` server sign-out errors and `BackgroundService` manifest/config loads.
- Two regression guards: `SilentTrySaveGuardTests` (no `try? .save()` in `Sync/`), `ClearableConformanceTests` (every store in `Stores/` conforms).

## Test plan
- [ ] Full unit test suite green
- [ ] UI test suite green
- [ ] Sign out → sign in as different user, no leakage anywhere (Today, Lists, Scouts, Chat, Briefing, Calendar)
- [ ] Mid-chat-stream force-quit recovers cleanly
- [ ] Mid-upload backgrounding completes or surfaces clear error
- [ ] Rapid background↔active 5x in 3s, no flicker / stuck state
- [ ] Sync conflict produces a `BrettLog.sync` line in Console.app

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (run once after final task)

- [ ] **Spec coverage:** Each Wave A scope item from the spec maps to ≥1 task above:
  - Task lifetime cleanup (SSEClient, AttachmentUploader, scenePhase, AuthManager) → Tasks 13–16
  - Logged-error hygiene → Tasks 17–21
  - Sign-out fan-out → Tasks 1–12
  - Delete dead scaffolding → DROPPED (verified live; documented in plan header)
- [ ] **No placeholders:** Every step has a concrete file path, code block, expected output, or commit command.
- [ ] **Type consistency:** `Clearable`, `ClearableStoreRegistry`, `ScenePhaseTaskTracker` are used consistently across tasks.
- [ ] **Test framework:** All new tests use Swift Testing (`@Test`, `@Suite`, `#expect`) per existing convention.
- [ ] **Tag usage:** All new tests tag with `.smoke`, `.sync`, or `.auth` per `apps/ios/BrettTests/TestSupport/TestTags.swift`.
- [ ] **Commits:** Each task ends with a commit; PR squashes/preserves per project convention.
