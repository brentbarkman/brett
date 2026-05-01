# iOS Simplification — Wave B: Single Source of Truth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SwiftData the single source of truth for items, lists, scouts, and the user profile. Every list-bearing view binds via `@Query` (with `userId` in the predicate, not a post-fetch filter); stores become mutation-only facades that enqueue + write atomically and inject their `userId` / `syncManager` instead of reading them from `ActiveSession.shared`.

**Architecture:** Five phases. (1) Mutation atomicity — stores become idempotent: enqueue + persist within a single transaction with `context.rollback()` on failure. Inject `userId` + `syncManager` into mutation methods so stores stop reading from `ActiveSession.shared`. (2) View `userId`-in-predicate — every list-bearing page splits a `*Body(userId:)` subview that embeds `userId` in the `@Query` predicate (the only way to use a captured value, since `#Predicate` can't read from `@Environment`). (3) Drop store reads — delete `ItemStore.fetchInbox/fetchToday/fetchUpcoming` (already dead) plus `fetchAll` / `fetchById` (or downgrade to internal helpers). Views that still call them get rewired to `@Query` first. (4) `ScoutStore` migrates to SwiftData-backed (drop the in-memory `[ScoutDTO]` array; views `@Query<Scout>`). (5) `UserProfileStore` drops `cachedProfile`; settings views `@Query<UserProfile>`. Regression guards keep the patterns from drifting back.

**Tech Stack:** Swift 6 / SwiftUI / SwiftData / Swift Testing. Existing infra: `InMemoryPersistenceController`, `MockURLProtocol`, `TestFixtures`, `BrettLog`. Building on Wave A: every store now conforms to `Clearable` and registers with `ClearableStoreRegistry`; stores have `[weak self]`/scenePhase/retain-cycle hardening; sync paths log via `BrettLog`.

**Spec:** [`docs/superpowers/specs/2026-04-26-ios-simplification-design.md`](../specs/2026-04-26-ios-simplification-design.md), §Wave B.

---

## What this wave touches (file-level summary)

**New files (5):**

- `apps/ios/Brett/Stores/ItemMutator.swift` — protocol + extension separating mutation-only surface (Phase 1).
- `apps/ios/Brett/Stores/ListMutator.swift` — same pattern for lists.
- `apps/ios/BrettTests/Stores/MutationAtomicityTests.swift` — verify rollback on save failure.
- `apps/ios/BrettTests/Stores/UserScopedQueryTests.swift` — multi-user `@Query` predicate scoping.
- `apps/ios/BrettTests/Stores/StoreReadGuardTests.swift` — regression guard: no public read methods on `ItemStore`/`ListStore`.

**Heavily modified (stores, ~6):**

- `apps/ios/Brett/Stores/ItemStore.swift` — mutation methods take `Item` directly (not `id`); injection of `userId` + `syncManager`; rollback on save failure; `fetchAll`/`fetchById` deleted (or made `internal`/`private` for sync-engine internal use only); `fetchInbox`/`fetchToday`/`fetchUpcoming` deleted outright.
- `apps/ios/Brett/Stores/ListStore.swift` — same treatment.
- `apps/ios/Brett/Stores/ScoutStore.swift` — drop in-memory `scouts: [APIClient.ScoutDTO]` array; mutations write to SwiftData via `upsertLocal`; views `@Query`.
- `apps/ios/Brett/Stores/UserProfileStore.swift` — drop `cachedProfile`; methods accept context; views `@Query`.
- `apps/ios/Brett/Sync/SyncEntityMapper.swift` — internal callers of `fetchAll(userId:nil)` replaced with predicate descriptors (sync-internal use stays unscoped).
- `apps/ios/Brett/Sync/PushEngine.swift` / `PullEngine.swift` — same internal-fetch replacement if they call store fetch methods.

**View migrations (10+):**

- `apps/ios/Brett/Views/Today/TodayPage.swift` — split `TodayPageBody(userId:)` with `@Query` predicates that embed `userId`.
- `apps/ios/Brett/Views/Inbox/InboxPage.swift` — same split.
- `apps/ios/Brett/Views/List/ListsPage.swift` — same split.
- `apps/ios/Brett/Views/List/ListView.swift` — replace `itemStore.fetchAll(...)` and `listStore.fetchById(...)` with `@Query` predicates.
- `apps/ios/Brett/Views/Omnibar/ListDrawer.swift` — same.
- `apps/ios/Brett/Views/Detail/TaskDetailView.swift` — `@Query` for the single item + the move-to-list picker.
- `apps/ios/Brett/Views/Calendar/CalendarPage.swift` — keep store-mediated date-window fetch (calendar windowing isn't a clean `@Query`); just thread injected `userId`.
- `apps/ios/Brett/Views/Inbox/TriagePopup.swift` — `@Query<ItemList>` for the move-to-list picker.
- `apps/ios/Brett/Views/Omnibar/OmnibarView.swift` — same parser-resolution paths.
- `apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift` — switch from `scoutStore.scouts` (DTO) to `@Query<Scout>`.
- `apps/ios/Brett/Views/Scouts/ScoutDetailView.swift` — same.
- `apps/ios/Brett/Views/Settings/*.swift` — eleven `profileStore.current` call sites switch to `@Query<UserProfile>`.

**Total: ~5 new files, ~17 modified files.**

---

## Wave-A reconciliation note

Wave A added `Clearable` conformance with empty `clearForSignOut()` on stores that didn't yet need it. After Wave B, those stores **may** acquire real in-memory state (or stop having any). Each store's `clearForSignOut()` body should be re-checked at the end of Wave B, and:

- If a store now holds in-memory caches (e.g., `BriefingStore` if expanded), keep the body live.
- If a store is purely mutation/`@Query`-mediated, leave the empty body — the conformance regression test (Task 23 of Wave A) requires every store to keep the protocol.

Spec §Cross-cutting also requested a **stronger `Clearable` conformance check** that flags stores with non-trivial stored properties whose `clearForSignOut()` is empty. That's deferred — adds noise without catching anything we'd ship by accident, and the per-store explicit clear methods written in Wave A (and the new mutation flow in Wave B) are well-tested.

---

## Phase 1 — Mutation atomicity & dependency injection

Goal: stores stop reading `ActiveSession.shared` inside mutations; mutations are atomic (rollback on save failure).

### Task 1: ItemStore.create — atomic create with rollback

**Files:**

- Modify: `apps/ios/Brett/Stores/ItemStore.swift` (`create(...)` method, around lines 160–190)
- Create: `apps/ios/BrettTests/Stores/MutationAtomicityTests.swift`

#### Step 1: Write the failing test

Create `apps/ios/BrettTests/Stores/MutationAtomicityTests.swift`:

```swift
import Testing
import Foundation
import SwiftData
@testable import Brett

/// Mutation atomicity guarantees: every store mutation is a single
/// transaction. If `context.save()` fails (disk full, schema mismatch,
/// etc.), the in-memory `Item`/`ItemList` insertion AND the queued
/// `MutationQueueEntry` are both rolled back so the model + queue stay
/// in lockstep. Without this, a partial-failure leaves a row with no
/// queue entry (or vice versa) — sync silently stalls forever.
@Suite("Mutation atomicity", .tags(.smoke))
@MainActor
struct MutationAtomicityTests {
    @Test func createRollsBackBothItemAndQueueOnSaveFailure() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        // Inject a save-failure: insert a row that violates a constraint
        // before the test mutation runs. The ModelContext will throw on
        // the next save() call, allowing us to observe rollback.
        let saveFailureInjector = SaveFailureInjector(context: context)
        saveFailureInjector.armForNextSave()

        // Attempt the create. Expect the call to surface the error.
        #expect(throws: SaveFailureInjector.InjectedError.self) {
            _ = try store.create(
                userId: "alice",
                title: "Test rollback",
                type: .task,
                status: .active,
                dueDate: nil,
                listId: nil,
                notes: nil,
                source: "Brett"
            )
        }

        // After rollback, both the Item and the MutationQueueEntry should be absent.
        let items = try context.fetch(FetchDescriptor<Item>())
        #expect(items.filter { $0.title == "Test rollback" }.isEmpty)

        let queueEntries = try context.fetch(FetchDescriptor<MutationQueueEntry>())
        #expect(queueEntries.filter { $0.entityType == "item" }.isEmpty)
    }
}
```

If `SaveFailureInjector` doesn't exist, define it inline in the test file using a sentinel approach: write a row that causes `save()` to throw on the next call. The simplest reliable pattern is to drop into the underlying `NSPersistentStore` via `context.processPendingChanges()` and force a constraint violation, OR — simpler — directly call `context.save()` after inserting an invalid row. If neither works cleanly, take the testing-double approach below.

```swift
// Test helper — inserts a sentinel that causes the next save() to throw.
@MainActor
private final class SaveFailureInjector {
    enum InjectedError: Error { case armed }

    private let context: ModelContext
    private var armed = false

    init(context: ModelContext) {
        self.context = context
    }

    func armForNextSave() {
        armed = true
    }

    /// Returns a closure that wraps `context.save()` and conditionally throws.
    /// Calls into `ItemStore` aren't easily interceptable, so the test uses
    /// `ModelContextSpy` instead — see the alternate implementation below.
}
```

Actually, the cleanest practical approach: pass an injectable saver via a protocol. Update the test to:

```swift
@Test func createRollsBackBothItemAndQueueOnSaveFailure() throws {
    let context = try InMemoryPersistenceController.makeContext()
    let store = ItemStore(
        context: context,
        saver: ThrowingSaver()
    )

    #expect(throws: ThrowingSaver.InjectedError.self) {
        _ = try store.create(
            userId: "alice",
            title: "Test rollback",
            type: .task,
            status: .active,
            dueDate: nil,
            listId: nil,
            notes: nil,
            source: "Brett"
        )
    }

    let items = try context.fetch(FetchDescriptor<Item>())
    #expect(items.filter { $0.title == "Test rollback" }.isEmpty)

    let queueEntries = try context.fetch(FetchDescriptor<MutationQueueEntry>())
    #expect(queueEntries.filter { $0.entityType == "item" }.isEmpty)
}
```

Where `ThrowingSaver` is a test-helper conforming to a new `ModelContextSaving` protocol — see Step 3.

#### Step 2: Run test to verify it fails

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/MutationAtomicityTests 2>&1 | tail -20
```

Expected: compile failure (`ModelContextSaving` doesn't exist; `ItemStore.create` doesn't `throw`).

#### Step 3: Modify `ItemStore`

Read `apps/ios/Brett/Stores/ItemStore.swift` end-to-end. Locate the `create(userId:title:...)` method (around line 160). Locate the `private func save()` helper (around line 308) and `enqueueCreate(_:)` helper (around line 330).

Add at the top of the file (or in a new file `Stores/ModelContextSaving.swift` if you prefer):

```swift
/// Indirection over `ModelContext.save()` that lets tests inject a
/// failure path. Production code passes a `LiveSaver(context:)`; tests
/// pass `ThrowingSaver` to exercise the rollback branch in mutation
/// methods. The protocol is intentionally tiny — saving is the only
/// operation that needs an injection seam.
@MainActor
protocol ModelContextSaving {
    func save() throws
    func rollback()
}

@MainActor
struct LiveSaver: ModelContextSaving {
    let context: ModelContext
    func save() throws { try context.save() }
    func rollback() { context.rollback() }
}

#if DEBUG
/// Test helper — every `save()` call throws `InjectedError.armed`. Used by
/// `MutationAtomicityTests` to exercise the rollback branch without
/// constructing an actual disk-full / constraint-violation scenario.
@MainActor
struct ThrowingSaver: ModelContextSaving {
    enum InjectedError: Error, Equatable { case armed }
    func save() throws { throw InjectedError.armed }
    func rollback() { /* no-op — the throwing saver doesn't write */ }
}
#endif
```

Note: `ThrowingSaver`'s `rollback()` is a deliberate no-op because the throw happens *before* any context state was committed. The test asserts that the calling store invokes `rollback()` on its real `ModelContext` — which the test passes a separate `LiveSaver` view of via shared context. To exercise the production rollback path, the test constructs the store like this:

```swift
let liveSaver = LiveSaver(context: context)
let store = ItemStore(context: context, saver: ThrowingSaverWrappingLive(live: liveSaver))
```

…where `ThrowingSaverWrappingLive` calls `live.rollback()` from its own `rollback()`:

```swift
#if DEBUG
@MainActor
struct ThrowingSaverWrappingLive: ModelContextSaving {
    let live: LiveSaver
    enum InjectedError: Error, Equatable { case armed }
    func save() throws { throw InjectedError.armed }
    func rollback() { live.rollback() }
}
#endif
```

Use `ThrowingSaverWrappingLive` in the atomicity tests so that the production-side `saver.rollback()` actually reverts the in-flight context state. The test in Step 1 already references `ThrowingSaver` by name; rename to `ThrowingSaverWrappingLive` (or keep both — `ThrowingSaver` for "rollback is a no-op" scenarios, `ThrowingSaverWrappingLive` for "exercise real rollback").

Add to `ItemStore`:

- An optional `saver: ModelContextSaving` stored property, defaulting to `LiveSaver(context: context)` constructed in init.
- An init parameter `saver: ModelContextSaving? = nil`. If nil, default to `LiveSaver(context: context)` in init body.

Modify `create` to be `throws` and use the rollback pattern:

```swift
@discardableResult
func create(
    userId: String,
    title: String,
    type: ItemType = .task,
    status: ItemStatus = .active,
    dueDate: Date? = nil,
    listId: String? = nil,
    notes: String? = nil,
    source: String = "Brett"
) throws -> Item {
    let item = Item(
        userId: userId,
        type: type,
        status: status,
        title: title,
        notes: notes,
        source: source,
        dueDate: dueDate,
        listId: listId,
        createdAt: Date(),
        updatedAt: Date()
    )

    context.insert(item)
    enqueueCreate(item)

    do {
        try saver.save()
    } catch {
        // Both the optimistic insert AND the queued mutation are
        // discarded: rollback() reverts every uncommitted change in
        // the context. Without this, the row would remain in-memory
        // (visible to @Query consumers) but the queue would be empty,
        // so the create never reaches the server.
        saver.rollback()
        BrettLog.store.error("ItemStore create save failed: \(String(describing: error), privacy: .public)")
        throw error
    }

    syncManager?.schedulePushDebounced()
    return item
}
```

Note: `syncManager?.schedulePushDebounced()` — if `syncManager` isn't already a stored property, add it as optional + inject via init. (Task 4 covers this fully; for Task 1, just keep the existing `ActiveSession.syncManager?.schedulePushDebounced()` — Task 4 will switch it.)

Update every caller of `ItemStore.create` to handle the new `throws`:

- `apps/ios/Brett/Views/Omnibar/OmnibarView.swift` (line ~150 — wrap in `do/try` and surface the error to the user)
- Any other caller surfaced by grep — adapt similarly.

#### Step 4: Run test to verify it passes

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/MutationAtomicityTests/createRollsBackBothItemAndQueueOnSaveFailure 2>&1 | tail -20
```

Expected: PASS.

Run broader sanity:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/ItemStoreUpdateTests -only-testing:BrettTests/UserScopedFetchTests 2>&1 | tail -20
```

Expected: green.

#### Step 5: Commit

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/suspicious-agnesi-6f55a9 && git add apps/ios/Brett/Stores/ItemStore.swift apps/ios/Brett/Stores/ModelContextSaving.swift apps/ios/BrettTests/Stores/MutationAtomicityTests.swift apps/ios/Brett/Views/Omnibar/OmnibarView.swift
git commit -m "feat(ios): ItemStore.create rollbacks on save failure"
```

---

### Task 2: ItemStore.update + delete + toggle — atomic with rollback

**Files:**

- Modify: `apps/ios/Brett/Stores/ItemStore.swift` (`applyUpdate`, `delete`, `toggleStatus`)
- Modify: `apps/ios/BrettTests/Stores/MutationAtomicityTests.swift` (add 3 tests)

#### Step 1: Write the failing tests

Append to `MutationAtomicityTests.swift`:

```swift
@Test func updateRollsBackOnSaveFailure() throws {
    let context = try InMemoryPersistenceController.makeContext()
    let store = ItemStore(context: context, saver: LiveSaver(context: context))

    // Seed an item.
    let item = try store.create(
        userId: "alice",
        title: "Original",
        type: .task,
        status: .active,
        dueDate: nil,
        listId: nil,
        notes: nil,
        source: "Brett"
    )
    let originalTitle = item.title

    // Now swap the saver to a throwing one to test update rollback.
    let throwingStore = ItemStore(
        context: context,
        saver: ThrowingSaver()
    )
    throwingStore.update(id: item.id, changes: ["title": "New title"], userId: "alice")

    // After rollback, the item's title is unchanged.
    let refreshed: Item? = try context.fetch(
        FetchDescriptor<Item>(predicate: #Predicate { $0.id == item.id })
    ).first
    #expect(refreshed?.title == originalTitle)

    // No leftover queue entry for this update.
    let updateEntries = try context.fetch(
        FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.entityId == item.id }
        )
    )
    // Only the create entry exists.
    #expect(updateEntries.count == 1)
    #expect(updateEntries.first?.action == .create)
}

@Test func deleteRollsBackOnSaveFailure() throws {
    let context = try InMemoryPersistenceController.makeContext()
    let store = ItemStore(context: context, saver: LiveSaver(context: context))

    let item = try store.create(
        userId: "alice", title: "Goner", type: .task,
        status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
    )

    let throwingStore = ItemStore(context: context, saver: ThrowingSaver())
    throwingStore.delete(id: item.id, userId: "alice")

    let refreshed: Item? = try context.fetch(
        FetchDescriptor<Item>(predicate: #Predicate { $0.id == item.id })
    ).first
    #expect(refreshed != nil, "delete rolled back; item should still exist")
    #expect(refreshed?.deletedAt == nil, "deletedAt should be nil after rollback")
}

@Test func toggleStatusRollsBackOnSaveFailure() throws {
    let context = try InMemoryPersistenceController.makeContext()
    let store = ItemStore(context: context, saver: LiveSaver(context: context))

    let item = try store.create(
        userId: "alice", title: "Toggle me", type: .task,
        status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
    )

    let throwingStore = ItemStore(context: context, saver: ThrowingSaver())
    throwingStore.toggleStatus(id: item.id, userId: "alice")

    let refreshed: Item? = try context.fetch(
        FetchDescriptor<Item>(predicate: #Predicate { $0.id == item.id })
    ).first
    #expect(refreshed?.status == "active", "rollback should restore active status")
}
```

#### Step 2: Run tests to verify failure

Expected: compile failure or assertion failure (rollback not yet implemented for update / delete / toggle).

#### Step 3: Modify `ItemStore` mutations

In `apps/ios/Brett/Stores/ItemStore.swift`:

Modify `applyUpdate(_:changes:previousValues:)` (around line 220) to wrap the save in do/try with rollback:

```swift
private func applyUpdate(
    _ item: Item,
    changes: [String: Any],
    previousValues: [String: Any]
) {
    item.apply(changes: changes)
    enqueueUpdate(
        item,
        changes: changes,
        previousValues: previousValues
    )

    do {
        try saver.save()
    } catch {
        saver.rollback()
        BrettLog.store.error("ItemStore update save failed: \(String(describing: error), privacy: .public)")
        return
    }

    syncManager?.schedulePushDebounced()
}
```

Modify `delete(id:userId:)` (signature change — Task 4 fully formalizes the userId parameter; for now just inline replace `ActiveSession.userId` with the parameter):

```swift
func delete(id: String, userId: String) {
    guard let item = fetchById(id, userId: userId) else { return }
    let before = ItemSnapshotBuilder.snapshot(of: item)

    item.deletedAt = Date()
    item._syncStatus = SyncStatus.pendingDelete.rawValue

    enqueueDelete(item, beforeSnapshot: before)

    do {
        try saver.save()
    } catch {
        saver.rollback()
        BrettLog.store.error("ItemStore delete save failed: \(String(describing: error), privacy: .public)")
        return
    }

    syncManager?.schedulePushDebounced()
}
```

Modify `toggleStatus(id:userId:)` similarly (delegates to `update` which now uses rollback path).

For Task 2, the goal is to thread `saver` and the rollback pattern through every mutation. `userId` parameter becomes the new contract for mutations that previously read `ActiveSession.userId`. Update callers in subsequent tasks; for now, the mutation methods that internally called `fetchById(id, userId: ActiveSession.userId)` get the userId from the new parameter.

If callers haven't been updated yet (e.g., view code still calls `delete(id:)` without userId), provide a `delete(id:)` overload temporarily that reads from `ActiveSession.userId` for backward compat. Mark it `@available(*, deprecated, message: "Pass userId explicitly — Task 4 will remove this overload.")` so the compiler nags you to migrate. Alternatively, just bite the bullet and update all callers in this task — it's mostly mechanical.

#### Step 4: Run tests

Expected: all three new tests pass; existing `ItemStoreUpdateTests` still green.

#### Step 5: Commit

```bash
git commit -m "feat(ios): ItemStore mutations rollback atomically on save failure"
```

---

### Task 3: ListStore — same atomicity treatment

**Files:**
- Modify: `apps/ios/Brett/Stores/ListStore.swift`
- Modify: `apps/ios/BrettTests/Stores/MutationAtomicityTests.swift`

Same pattern as Task 2 applied to `ListStore`:

- Inject `saver: ModelContextSaving` via init
- `create(userId:name:colorClass:) throws -> ItemList` — wrap save in do/catch + rollback
- `applyUpdate` — same pattern
- `archive(id:userId:)` / `unarchive(id:userId:)` — accept explicit userId
- `reorder(ids:userId:)` — same

Add atomicity tests for `ListStore.create` and `update` to `MutationAtomicityTests.swift`. Same shape as Task 2; just substitute `ListStore` and `ItemList`.

Update callers:

- `apps/ios/Brett/Views/Inbox/TriagePopup.swift` (line 60)
- `apps/ios/Brett/Views/List/ListsPage.swift` (line 140)
- `apps/ios/Brett/Views/Omnibar/ListDrawer.swift` (line 200, 220)

Commit:

```bash
git commit -m "feat(ios): ListStore mutations rollback atomically on save failure"
```

---

### Task 4: Inject userId + syncManager into ItemStore

**Files:**
- Modify: `apps/ios/Brett/Stores/ItemStore.swift`
- Modify: every caller that currently doesn't pass `userId`.

Goal: stop reading `ActiveSession.shared` (and `ActiveSession.syncManager`) from inside store methods. Caller passes `userId` explicitly; `syncManager` is captured at init.

#### Steps

1. Replace `ActiveSession.userId` reads in `update`, `delete`, `toggleStatus` with the new explicit `userId` parameter (already started in Task 2; complete here).
2. Replace `ActiveSession.syncManager?.schedulePushDebounced()` with `syncManager?.schedulePushDebounced()`. Add `private weak var syncManager: SyncTrigger?` injected via init. Default to nil (so unit tests can construct without a sync manager).

   Define a `SyncTrigger` protocol in a new file `apps/ios/Brett/Sync/SyncTrigger.swift`:

   ```swift
   /// Minimal protocol for "schedule a debounced push." Lets stores accept a
   /// `SyncManager` *or* a test double without coupling to the full sync
   /// engine surface. `SyncManager` already has the method — just declare
   /// conformance.
   @MainActor
   protocol SyncTrigger: AnyObject {
       func schedulePushDebounced()
   }

   extension SyncManager: SyncTrigger {}
   ```

3. The `ItemStore` init becomes:

```swift
init(
    context: ModelContext = PersistenceController.shared.mainContext,
    saver: ModelContextSaving? = nil,
    syncManager: SyncTrigger? = ActiveSession.syncManager
) {
    self.context = context
    self.saver = saver ?? LiveSaver(context: context)
    self.syncManager = syncManager
    ClearableStoreRegistry.register(self)
}
```

The default `syncManager: ActiveSession.syncManager` evaluates **at init time**, which is the right window: `ActiveSession.syncManager` is non-nil if the user is signed in when the store constructs. Tests pass `syncManager: nil` (or a mock). Production view code constructs `ItemStore()` and gets the live one.

**Test mock for the regression test:**

```swift
#if DEBUG
@MainActor
final class MockSyncTrigger: SyncTrigger {
    private(set) var scheduleCallCount = 0
    func schedulePushDebounced() { scheduleCallCount += 1 }
}
#endif
```

Place this in `apps/ios/BrettTests/TestSupport/MockSyncTrigger.swift` so multiple test files can use it.

Verify: `ActiveSession.userId` and `ActiveSession.syncManager` references inside `ItemStore.swift` are gone.

4. Add a regression test in `MutationAtomicityTests.swift` that constructs `ItemStore` with a mock `SyncTrigger` and asserts `schedulePushDebounced()` was called exactly once after a successful create.

Commit:

```bash
git commit -m "refactor(ios): ItemStore takes injected userId + syncManager"
```

---

### Task 5: Inject userId + syncManager into ListStore

Same pattern as Task 4. Commit:

```bash
git commit -m "refactor(ios): ListStore takes injected userId + syncManager"
```

---

## Phase 2 — View `userId`-in-predicate (init-based subviews)

Goal: every list-bearing view stops the `userItems = allItems.filter { $0.userId == uid }` post-fetch pattern. Replaced with an init-based `*Body(userId: String)` subview that constructs `@Query` with the predicate baked in.

The pattern is uniform; the first task spells it out and subsequent tasks reference it.

### Task 6: TodayPage → TodayPageBody(userId:)

**Files:**
- Modify: `apps/ios/Brett/Views/Today/TodayPage.swift`
- Create: `apps/ios/BrettTests/Stores/UserScopedQueryTests.swift`

#### Step 1: Write the failing test

Create `apps/ios/BrettTests/Stores/UserScopedQueryTests.swift`:

```swift
import Testing
import SwiftData
@testable import Brett

/// Multi-user @Query scoping: a SwiftData predicate that captures
/// `userId` should isolate user A's rows from user B's. This protects
/// the multi-user invariant against the Wave B refactor that moved
/// `userId` from a Swift `.filter { ... }` into the `@Query` predicate.
@Suite("User-scoped @Query", .tags(.smoke))
@MainActor
struct UserScopedQueryTests {
    @Test func itemPredicateIsolatesUsersExactly() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)

        // Seed: 3 items for alice, 2 for bob, all undeleted.
        for i in 0..<3 { context.insert(TestFixtures.makeItem(userId: "alice", title: "alice-\(i)")) }
        for i in 0..<2 { context.insert(TestFixtures.makeItem(userId: "bob",   title: "bob-\(i)")) }
        try context.save()

        // The predicate Wave B installs on `@Query<Item>` in TodayPageBody:
        let userId = "alice"
        let aliceItems = try context.fetch(
            FetchDescriptor<Item>(
                predicate: #Predicate { $0.deletedAt == nil && $0.userId == userId }
            )
        )
        #expect(aliceItems.count == 3)
        #expect(aliceItems.allSatisfy { $0.userId == "alice" })

        // Sanity: bob's predicate sees bob's only.
        let bobUid = "bob"
        let bobItems = try context.fetch(
            FetchDescriptor<Item>(
                predicate: #Predicate { $0.deletedAt == nil && $0.userId == bobUid }
            )
        )
        #expect(bobItems.count == 2)
        #expect(bobItems.allSatisfy { $0.userId == "bob" })
    }
}
```

This test is the **predicate-shape regression guard**: it asserts that the SwiftData `#Predicate` macro can capture and use a `userId: String` value as expected, with `&&` joining `deletedAt` and `userId` checks. If a future SwiftData version regresses on captured-string predicates, this test catches it before any view-layer test does.

#### Step 2: Run the test

Expected: PASS (predicate works in isolation).

#### Step 3: Migrate TodayPage

Read `apps/ios/Brett/Views/Today/TodayPage.swift`. The current shape (around lines 30–80):

```swift
struct TodayPage: View {
    @Environment(AuthManager.self) private var authManager
    @Query(filter: #Predicate<Item> { $0.deletedAt == nil }, sort: \Item.createdAt, order: .reverse)
    private var allItems: [Item]
    @Query(filter: #Predicate<ItemList> { $0.deletedAt == nil }, sort: \ItemList.sortOrder)
    private var allLists: [ItemList]
    @Query(filter: #Predicate<CalendarEvent> { $0.deletedAt == nil }, sort: \CalendarEvent.startTime)
    private var allEvents: [CalendarEvent]

    private var userItems: [Item] {
        guard let uid = authManager.currentUser?.id else { return [] }
        return allItems.filter { $0.userId == uid }
    }
    // ... ditto for userLists, userEvents
}
```

Refactor to:

```swift
struct TodayPage: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            TodayPageBody(userId: userId)
        } else {
            // Signed-out fallback (or empty). The auth gate
            // upstream usually prevents this branch, but render
            // an empty state defensively rather than nil-fallback.
            EmptyView()
        }
    }
}

private struct TodayPageBody: View {
    let userId: String
    @Query private var items: [Item]
    @Query private var lists: [ItemList]
    @Query private var events: [CalendarEvent]
    @Query private var syncHealthRows: [SyncHealth]

    init(userId: String) {
        self.userId = userId

        let itemPredicate = #Predicate<Item> { item in
            item.deletedAt == nil && item.userId == userId
        }
        _items = Query(filter: itemPredicate, sort: \Item.createdAt, order: .reverse)

        let listPredicate = #Predicate<ItemList> { list in
            list.deletedAt == nil && list.userId == userId
        }
        _lists = Query(filter: listPredicate, sort: \ItemList.sortOrder)

        let eventPredicate = #Predicate<CalendarEvent> { event in
            event.deletedAt == nil && event.userId == userId
        }
        _events = Query(filter: eventPredicate, sort: \CalendarEvent.startTime)

        _syncHealthRows = Query()
    }

    var body: some View {
        // ... existing body, but reference `items`/`lists`/`events`
        // directly (no more `userItems` / `userLists` / `userEvents`
        // computed properties).
    }
}
```

The body of `TodayPageBody` is the same logic as the current `TodayPage` body, with three substitutions:

- `userItems` → `items`
- `userLists` → `lists`
- `userEvents` → `events`

Remove the three `userItems`/`userLists`/`userEvents` computed properties from the source.

If `TodayPage` had any `@State` instances of `ItemStore`/`ListStore`/`CalendarStore` consumed within the body, leave them alone — Phase 3 handles store-mediated reads. For Phase 2, the goal is just to embed `userId` in the predicate.

#### Step 4: Run tests

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/UserScopedQueryTests 2>&1 | tail -10
```

Manually verify in the simulator:

- Sign in as user A. Today renders.
- Sign out, sign in as user B (different account). Today renders B's items only.
- No flicker of A's items between sign-in transitions.

#### Step 5: Commit

```bash
git commit -m "refactor(ios): TodayPage embeds userId in @Query predicate via TodayPageBody"
```

---

### Task 7: InboxPage → InboxPageBody(userId:)

Same pattern as Task 6 applied to `apps/ios/Brett/Views/Inbox/InboxPage.swift`.

The current InboxPage post-filter is more complex:

```swift
private var allInboxItems: [Item] {
    guard let uid = authManager.currentUser?.id else { return [] }
    let now = Date()
    return nonDeletedItemsAnyUser.filter { item in
        item.userId == uid &&
        item.listId == nil &&
        item.status == ItemStatus.active.rawValue &&
        (item.snoozedUntil == nil || item.snoozedUntil! <= now)
    }
}
```

The `userId == uid` and `listId == nil` and `status == "active"` filters move into the predicate. The `snoozedUntil <= now` part is harder because `now` is "right now" — capture via a `@State` time tick or just leave that single condition as a post-filter (acceptable trade-off).

Refactored:

```swift
private struct InboxPageBody: View {
    let userId: String
    @Query private var inboxItems: [Item]

    init(userId: String) {
        self.userId = userId
        let predicate = #Predicate<Item> { item in
            item.deletedAt == nil &&
            item.userId == userId &&
            item.listId == nil &&
            item.dueDate == nil &&
            item.status == "active"
        }
        _inboxItems = Query(filter: predicate, sort: \Item.createdAt, order: .reverse)
    }

    private var visibleInboxItems: [Item] {
        let now = Date()
        return inboxItems.filter { item in
            item.snoozedUntil == nil || item.snoozedUntil! <= now
        }
    }

    var body: some View {
        // ... existing body, reference `visibleInboxItems`
    }
}
```

Commit:

```bash
git commit -m "refactor(ios): InboxPage embeds userId in @Query predicate via InboxPageBody"
```

---

### Task 8: ListsPage → ListsPageBody(userId:)

Same pattern. Two `@Query`s in `ListsPage.swift`: `listsAnyUser` and `itemsAnyUser`. Both move their userId filter into the predicate. Commit:

```bash
git commit -m "refactor(ios): ListsPage embeds userId in @Query predicate via ListsPageBody"
```

---

### Task 9: ListView → @Query for items + list

`ListView` currently calls `itemStore.fetchAll(userId: uid, listId: id)` imperatively (line 51) and `listStore.fetchById(listId)` for the list metadata (line 37).

Replace both with `@Query` in an init-based subview:

```swift
private struct ListViewBody: View {
    let userId: String
    let listId: String

    @Query private var lists: [ItemList]
    @Query private var items: [Item]

    init(userId: String, listId: String) {
        self.userId = userId
        self.listId = listId

        let listPredicate = #Predicate<ItemList> { list in
            list.id == listId && list.userId == userId
        }
        _lists = Query(filter: listPredicate)

        let itemPredicate = #Predicate<Item> { item in
            item.deletedAt == nil && item.userId == userId && item.listId == listId
        }
        _items = Query(filter: itemPredicate, sort: \Item.createdAt, order: .reverse)
    }

    private var realList: ItemList? { lists.first }
}
```

Commit:

```bash
git commit -m "refactor(ios): ListView reads via @Query instead of itemStore.fetchAll"
```

---

### Task 10: ListDrawer → @Query

Same treatment for `ListDrawer.swift`. Commit:

```bash
git commit -m "refactor(ios): ListDrawer reads via @Query instead of post-filter"
```

---

### Task 11: TaskDetailView → @Query for the single item + lists

`TaskDetailView` currently calls `itemStore.fetchById(itemId)` (unscoped — a real bug) and `listStore.fetchAll(userId: uid)`.

Replace with init-based subview:

```swift
private struct TaskDetailBody: View {
    let userId: String
    let itemId: String

    @Query private var matchedItems: [Item]
    @Query private var lists: [ItemList]

    init(userId: String, itemId: String) {
        self.userId = userId
        self.itemId = itemId

        let itemPredicate = #Predicate<Item> { item in
            item.id == itemId && item.userId == userId
        }
        _matchedItems = Query(filter: itemPredicate)

        let listPredicate = #Predicate<ItemList> { list in
            list.deletedAt == nil && list.userId == userId
        }
        _lists = Query(filter: listPredicate, sort: \ItemList.sortOrder)
    }

    private var item: Item? { matchedItems.first }
}
```

Side effect: this fixes the unscoped `fetchById` cross-user defense gap in TaskDetail.

Commit:

```bash
git commit -m "refactor(ios): TaskDetailView reads via @Query (fixes unscoped lookup)"
```

---

### Task 12: TriagePopup + Omnibar parser-resolution

`TriagePopup` uses `listStore.fetchAll(userId:)` for the move-to-list picker.
`OmnibarView` uses `listStore.fetchAll(userId:)` for `#list` tag resolution.

Both can switch to `@Query<ItemList>` with `userId` predicate.

Commit:

```bash
git commit -m "refactor(ios): TriagePopup + Omnibar use @Query for list picker"
```

---

## Phase 3 — Drop store reads

Goal: now that views are `@Query`-driven, remove `ItemStore.fetchAll` / `fetchById` / `fetchInbox` / `fetchToday` / `fetchUpcoming` from the public surface. Internal callers (sync engine, mutation methods that need to look up a row by id) keep access via private/internal helpers.

### Task 13: Delete the dead read methods

**Files:**
- Modify: `apps/ios/Brett/Stores/ItemStore.swift`
- Modify: `apps/ios/Brett/Stores/ListStore.swift`

Steps:

1. Delete `ItemStore.fetchInbox(userId:)`, `fetchToday(userId:)`, `fetchUpcoming(userId:)`. Already not called from any view (per exploration).
2. Update internal `fetchById` use inside mutation methods (`update`, `delete`, `toggleStatus`) to a `private` helper named `findById(_:userId:)` that uses a `FetchDescriptor` with predicate. This keeps the internal lookup but doesn't expose it on the public API.
3. Delete `ItemStore.fetchAll(userId:listId:status:)`. Replace any remaining caller with a direct `@Query` in their view (already done in Phase 2 for the views; this catches stragglers).
4. `ListStore.fetchAll`, `fetchById`: same treatment. The internal `nextSortOrder(userId:)` (which currently calls `fetchAll`) gets a private `allListsForSort(userId:)` helper using a direct fetch.
5. Delete the now-orphaned `UserScopedFetchTests` cases that exercised the old API. The Wave B `UserScopedQueryTests` plus regression-guard tests (Task 16) cover the multi-user invariant.
6. Update `apps/ios/Brett/Sync/SyncEntityMapper.swift` if it called `ItemStore.fetchById(_, userId: nil)` — replace with a direct `FetchDescriptor` query. (Confirm via grep before this task.)

Run the full unit suite to confirm nothing broke:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: green.

Commit:

```bash
git commit -m "refactor(ios): delete ItemStore + ListStore public read methods"
```

---

### Task 14: Migrate fetch-method tests

`apps/ios/BrettTests/Stores/UserScopedFetchTests.swift` and `FetchByIdUserScopingTests.swift` exercised the now-deleted `ItemStore`/`ListStore` read methods. They also cover `CalendarStore`, `MessageStore`, and `AttachmentStore` — those stores still expose read methods (Wave B doesn't touch them) so those test cases stay.

Concrete actions:

1. **Item-related tests in `UserScopedFetchTests.swift`:** delete `fetchAllScopedToUser`, `fetchInboxScopedToUser`, `fetchTodayScopedToUser`, `fetchAllNilUserReturnsAllRowsForSyncInternals`. Coverage subsumed by `UserScopedQueryTests` (Item) plus internal-fetch use is now via `FetchDescriptor` directly in `SyncEntityMapper`.

2. **List-related tests:** delete `listFetchAllScopedToUser`. Same rationale.

3. **Item/list `fetchById` tests in `FetchByIdUserScopingTests.swift`:** delete the four Item/List cases. Add an equivalent test in `UserScopedQueryTests` that uses `FetchDescriptor` directly with predicate `id == X && userId == Y` to cover the same invariant.

4. **Keep:** every Calendar/Message/Attachment case in both files. They still test live API.

5. **The unscoped fetch invariant** (`fetchAllNilUserReturnsAllRowsForSyncInternals`) needs a replacement. Sync engine internals now use `FetchDescriptor<Item>(predicate: #Predicate { $0.deletedAt == nil })` directly. Add a test in `apps/ios/BrettTests/Sync/SyncInternalQueryTests.swift` (new file) that asserts an unscoped descriptor returns rows for both users — this is the existing contract for sync-internal use (e.g., the mutation queue wants to push every pending row regardless of who owns it).

Commit:

```bash
git commit -m "test(ios): migrate Item+List fetch-method tests to @Query coverage"
```

---

### Task 15: Regression guard — store read methods

**Files:**
- Create: `apps/ios/BrettTests/Stores/StoreReadGuardTests.swift`

A grep-based test that scans `ItemStore.swift` and `ListStore.swift` for public methods named `fetchAll` or `fetchById`. Fails if either reappears.

```swift
import Testing
import Foundation
@testable import Brett

@Suite("Store read-method guard", .tags(.smoke))
struct StoreReadGuardTests {
    /// Wave B removed all public read methods from `ItemStore` and
    /// `ListStore`. Views must use `@Query` instead. This guard fails
    /// if a future change re-exposes a read method on either type.
    @Test func itemStoreHasNoPublicFetchMethods() throws {
        try assertNoPublicReads(in: "ItemStore.swift")
    }

    @Test func listStoreHasNoPublicFetchMethods() throws {
        try assertNoPublicReads(in: "ListStore.swift")
    }

    private func assertNoPublicReads(in fileName: String) throws {
        // Find Brett/Stores via the bundled folder reference (mirrors
        // the silent-try-save guard added in Wave A — see project.yml).
        guard let storesDirectory = Bundle(for: BrettBundleAnchor.self)
            .url(forResource: "Stores", withExtension: nil) else {
            Issue.record("Could not resolve Stores bundle resource")
            return
        }
        let url = storesDirectory.appendingPathComponent(fileName)
        let contents = try String(contentsOf: url, encoding: .utf8)

        // Regex: any public-or-internal `func fetchAll` or `func fetchById`
        // that is NOT marked `private` immediately before. A simple match
        // for `func fetch` not preceded by `private` works for Wave B's
        // discipline (no protected/fileprivate scopes are in use).
        let pattern = #"^(?!.*private)\s*(?:internal\s+)?func\s+fetch(All|ById)"#
        let regex = try NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
        let range = NSRange(contents.startIndex..., in: contents)
        let matches = regex.matches(in: contents, range: range)
        #expect(matches.isEmpty, """
            \(fileName) re-exposed a public/internal `fetchAll` or
            `fetchById` method. Wave B removed these — views must use
            `@Query` instead.
            """)
    }
}

/// Anchor class for `Bundle(for:)`. Lives at the test target so resolution
/// finds the test bundle, which has the `Stores` folder reference.
private final class BrettBundleAnchor {}
```

(If the regex pattern is awkward in Swift literal escaping, wrap it in a raw string and escape carefully. The existing `SilentTrySaveGuardTests.swift` from Wave A is a good reference for the bundle-resolution pattern.)

Commit:

```bash
git commit -m "test(ios): regression guard — no public read methods on ItemStore/ListStore"
```

---

## Phase 4 — `ScoutStore` migrates to SwiftData-only

Goal: drop the in-memory `[APIClient.ScoutDTO]` array. Views `@Query<Scout>`. Mutations write to SwiftData via `upsertLocal`.

### Task 16: Verify `Scout` SwiftData model has all view-needed fields

**Files:** read-only.

Read `apps/ios/Brett/Models/Scout.swift`. Compare its fields against the fields `ScoutsRosterView.swift` and `ScoutDetailView.swift` read from `APIClient.ScoutDTO`.

Specifically:

- `name`, `goal`, `status`, `findingsCount`, `lastRunAt`, `lastFindingAt`, `summary`, `iconName` (or whatever the roster card displays).
- For ScoutDetail: full set including `frequency`, `prompt`, `aiProvider`, etc.

If any field is missing on `Scout`, add it as a stored property in a follow-up Task 16a. Commit message: `feat(ios): backfill missing Scout SwiftData fields`. Otherwise skip.

This is a **read-and-decide** task — actual model edits only land if needed.

Commit (only if model changed):

```bash
git commit -m "feat(ios): backfill <field-list> on Scout SwiftData model"
```

---

### Task 17: ScoutsRosterView → @Query<Scout>

**Files:**
- Modify: `apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift`

Replace `scoutStore.scouts` reads with `@Query<Scout>`. The view becomes:

```swift
struct ScoutsRosterView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            ScoutsRosterBody(userId: userId)
        }
    }
}

private struct ScoutsRosterBody: View {
    let userId: String
    @Query private var scouts: [Scout]
    @State private var statusFilter: ScoutStatusFilter = .all

    init(userId: String) {
        self.userId = userId
        let predicate = #Predicate<Scout> { scout in
            scout.deletedAt == nil && scout.userId == userId
        }
        _scouts = Query(filter: predicate, sort: \Scout.createdAt, order: .reverse)
    }

    private var filteredScouts: [Scout] {
        switch statusFilter {
        case .all: return scouts
        case .active: return scouts.filter { $0.status == "active" }
        case .paused: return scouts.filter { $0.status == "paused" }
        case .archived: return scouts.filter { $0.status == "archived" }
        }
    }

    var body: some View {
        // ... existing body, but ScoutCard takes `Scout` not `APIClient.ScoutDTO`.
    }
}
```

`ScoutCard` (or whatever the row component is named) needs to accept a `Scout` instead of an `APIClient.ScoutDTO`. The fields are 1:1 after Task 16.

Refresh-on-mount stays — `scoutStore.refreshScouts(status: nil)` writes via `upsertLocal` and the `@Query` updates reactively.

Commit:

```bash
git commit -m "refactor(ios): ScoutsRosterView reads via @Query<Scout>"
```

---

### Task 18: ScoutDetailView → @Query<Scout>

Same treatment for `ScoutDetailView`. Commit:

```bash
git commit -m "refactor(ios): ScoutDetailView reads via @Query<Scout>"
```

---

### Task 19: ScoutStore drops in-memory array

**Files:**
- Modify: `apps/ios/Brett/Stores/ScoutStore.swift`
- Modify: `apps/ios/BrettTests/Stores/ScoutStoreClearTests.swift` (already trivially passing without state — confirm or update)

Steps:

1. Remove the `private(set) var scouts: [APIClient.ScoutDTO]` property and any methods that mutate it directly.
2. `refreshScouts(status:)` keeps fetching from the API but only calls `upsertLocal(...)` — no in-memory cache update.
3. Mutation methods (`create`, `update`, `pause`, `resume`, `archive`, `delete`) keep the API + `upsertLocal` flow but stop touching the in-memory array.
4. Update `ScoutStore.clearForSignOut()` — Wave A cleared `scouts = []`; if `scouts` no longer exists, the body becomes empty (with a comment that SwiftData rows are wiped by `PersistenceController.wipeAllData()`).
5. Update `ScoutStoreClearTests` if its assertion was on `store.scouts.isEmpty`. New assertion: register the store, call `clearAll()`, no crash. (`@Query`-driven views handle the rest.)

Commit:

```bash
git commit -m "refactor(ios): ScoutStore drops in-memory DTO cache (SwiftData is canonical)"
```

---

## Phase 5 — `UserProfileStore` SwiftData-only

### Task 20: Settings views switch to @Query<UserProfile>

**Files:** modify each settings view that reads `profileStore.current`:

- `apps/ios/Brett/Views/Settings/SettingsView.swift`
- `apps/ios/Brett/Views/Settings/ProfileSettingsView.swift`
- `apps/ios/Brett/Views/Settings/AccountSettingsView.swift`
- `apps/ios/Brett/Views/Settings/BackgroundSettingsView.swift`
- `apps/ios/Brett/Views/Settings/LocationSettingsView.swift`

Pattern for each:

```swift
@Query(sort: \UserProfile.id) private var profiles: [UserProfile]
private var currentProfile: UserProfile? { profiles.first }
```

(The `userId` filter is implicit — there's only ever one `UserProfile` row per signed-in session, and sign-out wipes it. If multi-account-per-device becomes a thing, filter by `id == currentUser.id` here.)

Replace every `profileStore.current?.X` with `currentProfile?.X`. Replace every `guard let profile = profileStore.current else { ... }` with `guard let profile = currentProfile else { ... }`.

The mutations (e.g., `BackgroundSettingsView.swift:480` calling `store.update(from: payload)`) **still go through `UserProfileStore`** — Phase 5 only drops the read cache, not the mutation surface. Task 21 handles mutation rewrite.

Commit (one commit per settings view file would be cleanest, but combining is OK if the diff stays focused):

```bash
git commit -m "refactor(ios): settings views read UserProfile via @Query"
```

---

### Task 21: UserProfileStore drops cachedProfile

**Files:**
- Modify: `apps/ios/Brett/Stores/UserProfileStore.swift`
- Modify: `apps/ios/BrettTests/Stores/UserProfileStoreClearTests.swift`

Steps:

1. Delete `private var cachedProfile: UserProfile?` and the `current` computed property.
2. `update(from:)` becomes mutation-only. The lookup-or-insert path now does a direct `FetchDescriptor<UserProfile>(fetchLimit: 1)` to find the existing row (no in-memory cache to avoid TOCTOU; the lookup happens in a single main-actor-isolated method, so two concurrent calls from the main actor still serialize).
3. `refresh(client:)` keeps fetching and calling `update(from:)`.
4. `clearForSignOut()` becomes empty (with a comment that the SwiftData row is wiped by `wipeAllData()`).
5. Update `UserProfileStoreClearTests` — the test that asserts `store.current == nil` no longer compiles since `current` is gone. Replace with: register, populate, call `clearAll()`, observe the SwiftData row exists (since `clearForSignOut` is now empty) but `wipeAllData(in: context)` clears it.

Commit:

```bash
git commit -m "refactor(ios): UserProfileStore is mutation-only (drops cachedProfile)"
```

---

## Phase 6 — Verification

### Task 22: Update Wave A's silent-try-save guard allowlist if needed

**Files:**
- Modify: `apps/ios/BrettTests/Sync/SilentTrySaveGuardTests.swift`

Phase 1 added `do { try saver.save() } catch { rollback() }` patterns to ItemStore and ListStore. The guard test should still pass — `try saver.save()` is not `try? saver.save()`. But verify with a fresh run.

If somehow a `try?` slipped in during the wave, fix it.

No commit needed unless code changed.

---

### Task 23: Performance baseline — Today with N items

**Files:**
- Create: `apps/ios/BrettTests/Stores/QueryPerformanceTests.swift`

A single performance test that measures the cost of fetching 2000 items with the new userId predicate vs the old `allItems.filter { ... }` post-fetch pattern.

```swift
import Testing
import SwiftData
import XCTest
@testable import Brett

/// Locks in Wave B's promise that moving the userId filter from a Swift
/// `.filter { ... }` post-fetch to a SwiftData `#Predicate` is at worst
/// neutral and at best a measurable improvement. If a future SwiftData
/// regression slows down captured-string predicates, this catches it
/// before users feel it on Today/Inbox/Lists/Calendar.
final class QueryPerformanceTests: XCTestCase {
    @MainActor
    func testTodayPredicateScalesWith2000Items() throws {
        let context = try InMemoryPersistenceController.makeContext()
        // Seed 2000 items: 1500 alice, 500 bob.
        for i in 0..<1500 { context.insert(TestFixtures.makeItem(userId: "alice", title: "alice-\(i)")) }
        for i in 0..<500  { context.insert(TestFixtures.makeItem(userId: "bob",   title: "bob-\(i)")) }
        try context.save()

        let userId = "alice"
        let predicate = #Predicate<Item> { $0.deletedAt == nil && $0.userId == userId }

        measure {
            let results = (try? context.fetch(FetchDescriptor<Item>(predicate: predicate))) ?? []
            XCTAssertEqual(results.count, 1500)
        }
    }
}
```

Note: this uses XCTest's `measure`, not Swift Testing — Swift Testing doesn't yet have a built-in performance harness. That's fine; both frameworks coexist in the test target.

Commit:

```bash
git commit -m "test(ios): performance baseline for user-scoped @Query predicate"
```

---

### Task 24: Final smoke + manual verification

#### Step 1: Full test suite

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: green. Test count should be approximately Wave-A baseline (603) + ~10 new (atomicity + user-scoped @Query + store-read guard + perf).

#### Step 2: UI test suite

```bash
cd apps/ios && xcodebuild test -scheme BrettUITests -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -10
```

Expected: same green/skipped count as before.

#### Step 3: Manual smoke checklist

Boot the app on a simulator. Walk through:

1. Cold launch as user A. Today/Inbox/Lists/Calendar render with A's data.
2. Sign out, sign in as user B. Verify all four views render B's data only — no flash of A's items between transitions.
3. Create a new task on Today. Mid-flight, force-quit. Relaunch. Verify the task either persists (if create completed) or is gone (if save failed). Either way, no orphan queue entry.
4. Edit a task's title in TaskDetailView. Verify the change appears immediately on Today (`@Query` propagation).
5. Move a task to a list via the omnibar. Verify it moves, no stale @State in either Inbox or the destination List view.
6. Open Scouts roster. Pull to refresh. Verify scouts render. Tap one for detail. Verify detail loads correctly.
7. Open Settings → Profile. Verify name/email show correctly. Edit timezone. Verify the change persists across app restart.

#### Step 4: Push branch + update PR

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/suspicious-agnesi-6f55a9 && git push origin claude/suspicious-agnesi-6f55a9
```

Update the PR description (Wave A is already there) to add a Wave B section listing what changed:

```bash
gh pr edit 105 --body-file <path-to-updated-body>
```

Or if you prefer a separate PR for Wave B, branch from `claude/suspicious-agnesi-6f55a9` to a new `wave-b` branch and open a PR with base `claude/suspicious-agnesi-6f55a9` and head `wave-b`. (This is more useful if Wave A might still get review changes.)

---

## Self-review checklist (run once after final task)

- [ ] **Spec coverage:** Every Wave B scope item from the spec maps to ≥1 task above:
  - Mutation atomicity → Tasks 1–3
  - Inject userId / syncManager → Tasks 4–5
  - Move userId into @Query predicate → Tasks 6–12
  - Drop store reads → Tasks 13–15
  - ScoutStore SwiftData migration → Tasks 16–19
  - UserProfileStore SwiftData migration → Tasks 20–21
  - Regression guards → Tasks 15, 22, 23
- [ ] **No placeholders:** Every step has a concrete file path, code block, expected output, or commit command.
- [ ] **Type consistency:** `ModelContextSaving`, `LiveSaver`, `ThrowingSaver`, `SyncTrigger`, `*Body(userId:)` are used consistently.
- [ ] **Commits:** Each task ends with a commit message matching the project convention (no surprises).
- [ ] **Test framework:** Swift Testing for new tests; XCTest only for the performance baseline (which is fine — both coexist in the target).
- [ ] **Wave-A integrations preserved:** `ClearableStoreRegistry`, `[weak self]` patterns, logged saves all stay; nothing in Wave B undoes Wave A.
- [ ] **Net behavior change:** zero (this is a pure refactor / hardening); the only user-visible improvements are (a) atomic rollback on save failure, (b) faster predicate-side filtering on large lists.

## Risk acknowledgment

This is the riskiest of the four waves. Specifically:

- **Init-based subviews remount on userId change.** If `userId` changes mid-session (not currently possible — sign-out tears down everything — but defensively), the subview's `@Query` predicate is fixed once. Documented in each subview's init comment.
- **Mutation-method signature changes.** `ItemStore.create` becomes `throws`; `delete` and `toggleStatus` take an explicit `userId`. Every caller is updated in the same task that introduces the change. If a caller is missed, the build fails — there's no silent runtime break.
- **`#Predicate` macro limitations.** The Phase 2 tasks rely on `userId` being captured cleanly by `#Predicate`. `UserScopedQueryTests` (Task 6) is the regression guard if a future Swift/SwiftData version regresses on this. We've already verified the pattern works in production (`ItemStore.fetchAll` uses it).
- **Read-method deletion order.** Task 13 deletes `fetchAll` / `fetchById` only after every Phase-2 view migration is complete. Confirm via grep that no view-side caller remains before deleting.
