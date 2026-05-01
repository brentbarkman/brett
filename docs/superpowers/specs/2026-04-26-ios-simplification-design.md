# iOS App Simplification — Four-Wave Plan

**Date:** 2026-04-26
**Status:** Draft, awaiting approval
**Author:** brent (with senior-engineer review)

## Why this exists

The iOS app is in production but feels fragile. A four-agent review of the sync engine, stores, views, and auth/lifecycle layers all converged on five overlapping root causes:

1. Two (sometimes three) sources of truth for the same data — `@Query`, in-memory store cache, and mutation queue all touching the same rows.
2. Unstructured concurrency — fire-and-forget `Task { ... }` with weak/strong-self hazards across `SSEClient`, `AttachmentUploader`, `BrettApp` scenePhase handlers, and `AuthManager` hydrate.
3. God files (600–918 lines) doing 3+ jobs — `SyncEntityMapper`, `ChatStore`, top-three settings views, `TaskDetailView`.
4. Silent error swallowing — ~40 `try?` calls in sync paths plus undocumented swallows in `AuthManager.signOut` and `BackgroundService`.
5. Sign-out / multi-user fragility — singleton `ActiveSession` access, `wipeAllData()` doesn't fan out to in-memory store caches.

This spec breaks the cleanup into four shippable waves, ordered so each one is safer than the next and leaves the app in a working state.

## Goals

- Eliminate the staleness/race feel during normal use.
- Make all formerly-silent failure modes visible (logs, error toasts where appropriate).
- Reduce iOS Swift LOC by ~1500–2500 net (estimate; mostly mapper + redundant store fetch paths + dead scaffolding).
- Establish regression tests so subsequent feature work doesn't reintroduce these patterns.

## Non-goals

- No feature changes. All four waves are pure refactors with behavioral parity. If we discover a real bug, we file/fix it separately.
- No iOS-version bump, no new third-party dependencies, no Swift 6 strict-concurrency rollout (worth doing, but separately).
- No desktop or API changes. iOS-only.
- No platform integrations (widgets, Siri, Share Extension) — still deferred per `BUILD_LOG.md`.

## Phasing overview

| Wave | Theme | Risk | Effort | Net LOC change |
|---|---|---|---|---|
| A | Concurrency & lifecycle hygiene | Low | ~1 day | +200 (mostly logging + cancellation) |
| B | Single source of truth (kill redundant caches) | Medium | ~2 days | -800 to -1500 |
| C | God-file splits | Medium | ~2-3 days | -500 to -1000 (after codegen) |
| D | Navigation unification | Low-medium | ~1 day | -100 to -200 |

Each wave ships as its own PR `main → release`. We do not start a wave until the previous one is merged and verified in production for at least 24h.

---

## Wave A — Concurrency & lifecycle hygiene

### Scope

1. **Task lifetime cleanup**
   - `SSEClient.loopTask` — replace stored-Task pattern with structured concurrency anchored to a parent Task we explicitly cancel on `disconnect()`. Hook `AsyncStream.onTermination` to null out references.
   - `AttachmentUploader.consumerTask` and `queueTask` — same treatment. Break the `MainActor.run`-induced retain cycle by capturing only what's needed.
   - `BrettApp` `RootView` scenePhase handlers — give each phase its own `Task<Void, Never>?` and cancel on next phase change. Five call sites: lines 218, 225, 251, 256, 270.
   - `AuthManager.refreshCurrentUser` Task — `[weak self]` capture.

2. **Logged-error hygiene in sync paths**
   - Replace ~40 `try?` calls in `PushEngine`, `PullEngine`, `ConflictResolver`, `AttachmentUploader`, `SyncManager` with `do/catch` that logs via `BrettLog.<channel>`.
   - Exception: deliberately-best-effort calls keep `try?` but get a one-line comment explaining why.
   - `AuthManager.signOut` — log server-side sign-out errors at warn level.
   - `BackgroundService` manifest decode failures — log at warn level.

3. **Sign-out fan-out**
   - Add a `Clearable` protocol with one method: `func clearForSignOut()`.
   - Each store conforms; `PersistenceController.wipeAllData()` (or, more precisely, `ActiveSession.tearDown`) calls `clearForSignOut()` on every registered store before wiping SwiftData.
   - Stores register themselves at init via a lightweight registry (extend the pattern `ChatStoreRegistry` already uses, or generalize it).

4. **Delete dead scaffolding** — DROPPED.
   - Verification before plan-writing showed all three candidates are live: `RelinkTask.parse` is called from `TaskRow`; `ConflictLogEntry` and `SyncHealth` are surfaced in `SyncHealthSettingsView` and consumed by Today/Inbox/Lists badge displays.
   - Wave C may revisit if any remain unsurfaced after Wave B's view rework.

### What we explicitly do NOT do in Wave A

- No store API changes (that's Wave B).
- No file splits (that's Wave C).
- No navigation changes (that's Wave D).

### Tests

#### Correctness (added)

- `SSEClientLifecycleTests` — start, cancel, verify the loop Task is cancelled and dereferenced; rapid connect/disconnect cycles don't leak.
- `AttachmentUploaderLifecycleTests` — upload-then-cancel mid-flight, app-suspend simulation, verify no continuation leaks. Extend existing `AttachmentUploaderTests`.
- `ScenePhaseRaceTests` — drive `RootView` scenePhase rapidly background↔active and assert the correct cancellation semantics. May need to extract phase handlers into a testable function.
- `SignOutFanOutTests` — sign in user A, populate in-memory state in 3+ stores, sign out, sign in user B, assert prior state is gone in every store. Builds on existing `PersistenceControllerWipeTests`.
- `LoggedErrorTests` — inject failing dependencies (closed `URLSession`, full disk, bad JSON) into push/pull engines; assert that errors are logged at the expected channel/level. Use `BrettLogTests` patterns.

#### Regression guards (added, lightweight)

- A grep-based guard test (`SilentTryGuardTests`) that scans `apps/ios/Brett/Sync/**.swift` for `try?` and fails if it appears outside an allowlist of files/lines with explanatory comments. Cheap to maintain, prevents drift back.
- A reflection-based test that asserts every store conforms to `Clearable` (catches "added a new store, forgot the registry").

### Risk

Low. Most changes are additive. Biggest risk is breaking SSE reconnect behavior — covered by `SSEClientLifecycleTests` and a manual smoke (force-quit during streaming, relaunch).

### Rollout

Single PR. Manual smoke checklist: cold launch + sign-in, kill mid-sync, foreground, send a chat message, kill mid-stream, foreground again. Sign out → sign in as different account, verify no leakage.

---

## Wave B — Single source of truth

### Scope

1. **Stores become mutation-only facades.** Remove read methods that re-fetch SwiftData; views use `@Query` directly.
   - `ItemStore.fetchAll`, `ItemStore.fetchById` — delete.
   - `ListStore.fetchAll` — delete (keep mutations).
   - `UserProfileStore.cachedProfile` — delete; views `@Query` the single profile row.
   - `ScoutStore` — pick one storage. Recommend SwiftData (consistency with rest of app); drop the in-memory `[ScoutDTO]` array. Views `@Query` `Scout`.
   - Stores that wrap pure-API data with no SwiftData backing (`AIProviderStore`, `BriefingStore`, `NewsletterStore` for senders, `CalendarAccountsStore`) stay as-is — they're the legitimate use case for an in-memory cache.

2. **Move userId filter into `@Query` predicates.** Every view that does `nonDeletedItems.filter { $0.userId == uid }` after fetching gets converted to a `@Query` predicate that captures `currentUserId` as a property. Affected views (at minimum): `TodayPage`, `InboxPage`, `ListView`, `CalendarPage`. Pattern consolidates in a `UserScopedQuery` helper or convention.

3. **Mutation atomicity.** Every store mutation (`create`, `update`, `delete`) becomes:
   - Build mutation payload
   - Enqueue mutation entry
   - Apply optimistic SwiftData write
   - Save context
   - All in one `try` block; if save throws, undo the SwiftData write *and* the queue entry.
   - Affected: `ItemStore`, `ListStore`, `ScoutStore`, others where applicable. Currently `ItemStore.create` enqueues then saves separately — failure leaves a row with no queue entry.

4. **Inject `userId` and `syncManager` into stores.** Stop reading `ActiveSession.shared` from inside store methods. Pass via init or per-call. Removes the singleton dependency that makes stores untestable without static mocking.

### What we explicitly do NOT do in Wave B

- No god-file splits.
- No navigation work.
- We do NOT delete `ItemStore` etc. entirely — they keep mutation methods. Views never construct mutations directly; that's a deliberate boundary.

### Tests

#### Correctness (added)

- `ItemStoreMutationAtomicityTests` — inject a save-failing context, verify queue + row stay consistent (both rolled back, no orphan).
- `UserScopedQueryTests` — multi-user fixture, sign in as A, populate items for A and B, assert visible-to-A list excludes B's items via predicate (not post-filter). Repeat for lists, scouts.
- `ScoutStoreMigrationTests` — pre-migration in-memory state vs post-migration SwiftData state — verify scouts roster, detail view, and judgments still resolve correctly after refactor.
- `OptimisticUpdateRollbackTests` — push fails, assert local SwiftData state reverts to `beforeSnapshot` and view re-renders accordingly.

#### Regression guards (added)

- `StoreReadMethodGuardTests` — reflection or grep guard that fails if `ItemStore`, `ListStore`, `UserProfileStore`, `ScoutStore` regain a public read method. Forces future code to use `@Query`.
- `StoreActiveSessionGuardTests` — grep guard that fails if any file under `Stores/` references `ActiveSession.shared` (or imports the singleton path). Forces injection.
- Snapshot-style test that the `userId` predicate is present in every list-bearing view. Done via grep/AST check in CI; cheap.

#### Performance regression guards (new)

- A baseline measurement test for "render Today with N=2000 items". Lock in current performance before refactor; refuse regressions of >10%. Implementation framework (XCTest `measure` vs Swift Testing equivalent) decided during the plan — whichever ships green in CI.

### Risk

Medium. Touches every list view. Biggest risks:
- A view stops updating because it lost a store binding without gaining a `@Query`.
- A mutation lands in SwiftData but the rollback path is never exercised because the test infra didn't simulate it before.

Mitigation: do this wave **after** Wave A so error logging is in place; staged commits within the PR (one entity at a time: items first, then lists, then scouts, then profile).

### Rollout

Single PR with internal staged commits. Manual smoke per entity. Test plan in PR description.

---

## Wave C — God-file splits

### Scope

1. **`ChatStore` (610 lines) → three pieces**
   - `StreamingChatClient` — owns the SSE session, buffer, chunk parsing, returns events. No persistence, no view-model state.
   - `ChatMessageBuffer` — observable, holds the in-memory message array per session. Subscribes to a stream.
   - `ChatPersister` — writes `BrettMessage` rows. Pure persistence.
   - `ChatStore` becomes a thin coordinator wiring the three (or removed; views inject directly).

2. **`SyncEntityMapper` (918 lines) → generic**
   - Try generic-Codable approach first: `extension SyncTrackedModel { static func upsert(_ payload: Payload, in: ModelContext) -> Self }` with model-specific `decode(from:)` and `encodeServerPayload()` per entity.
   - Goal: each model owns its own ~30-line mapping, mapper file becomes a ~100-line dispatcher.
   - Codegen via Swift macro is *not* in scope — too much new tooling. Manual factoring is enough.

3. **Top-three settings views split**
   - `LocationSettingsView` (891) → `LocationSettingsView` (UI shell) + `AssistantPersonaSection`, `MemoryFactsSection`, `TimezoneWeatherSection`. Each section gets a small `LocationSettingsSubStore` if it owns API calls.
   - `SecuritySettingsView` (784) → split by section (PIN, Face ID, Password) with sub-views.
   - `CalendarSettingsView` (749) → split by account vs preferences.

4. **`TaskDetailView` ↔ `EventDetailView` shared container**
   - Extract `DetailViewContainer<Content>` for ScrollView + dismiss + `.task` lifecycle. Both detail views compose around it.
   - Combine the four `.onChange` chains in `TaskDetailView` into one debounced `commitDraft` call.

5. **Dead-code sweep, cont.**
   - Anything else discovered during the splits.

### What we explicitly do NOT do in Wave C

- No navigation changes.
- No new dependencies.
- We do not change behavior of `SmartParser` (its 585 lines are well-tested and the regex strategy is fine for now). LLM fallback is a separate spec.

### Tests

#### Correctness (added)

- `StreamingChatClientTests` — feed canned SSE byte sequences, assert event stream output is correct. Decoupled from persistence.
- `ChatMessageBufferTests` — append, edit, finalize messages; observation correctness.
- `ChatPersisterTests` — write to in-memory context, assert rows; idempotency on retry.
- `SyncEntityMapperGenericTests` — round-trip every supported model (Items, Lists, Calendar, Scouts, Messages, Attachments, Profile) through the new generic path, assert byte-for-byte parity with the old mapper output. **This is the load-bearing safety net for this wave.**
- `LocationSettingsSubStoreTests` — per-substore unit tests (timezone update, fact deletion, etc.) — were impossible before because they were inline in a view.
- `DetailViewContainerSnapshotTests` — snapshot baseline for both Task and Event detail.

#### Regression guards (added)

- A line-count guard test (cheap CI script) that fails if any view file in `apps/ios/Brett/Views/Settings/*.swift` exceeds 400 lines without an opt-out comment. Crude but effective.
- A round-trip mapper test that runs against every model — locks in the behavior so future model additions can't break the generic dispatcher silently.

### Risk

Medium. The mapper refactor is the riskiest piece — a typo in serialization could corrupt sync. Mitigation: comprehensive round-trip tests plus a phased rollout (do one model at a time inside the PR, run tests after each).

### Rollout

Single PR with internal staged commits per file. Heavier review than A/B.

---

## Wave D — Navigation unification

### Scope

1. **One `NavDestination` enum drives everything.**
   - Sheet-style destinations (TaskDetail, EventDetail, Search, NewScout) → `.sheet(item:)` keyed on `NavDestination`.
   - Push-style destinations (Settings, ListView, ScoutDetail) → `.navigationDestination(for: NavDestination.self)`.
   - Remove the manual `path.append` two-step deep-link pattern.

2. **Settings deep-link via hash fragment, parity with desktop.**
   - `NavDestination.settings(tab: SettingsTab)` carries the tab.
   - Single `.navigationDestination` resolves it. Fixes the existing two-push bug where back-button returns to a half-state.
   - Tabs match CLAUDE.md valid hashes: `profile`, `security`, `calendar`, `ai-providers`, `newsletters`, `timezone-location`, `import`, `updates`, `account`.

3. **`SelectionStore` becomes presentation-state-only.**
   - Holds the current `NavDestination?`, not data. Data lookups are derived from it.
   - Removes the `.shared` singleton coupling in `MainContainer.swift:47` — replace with `@Environment(SelectionStore.self)`.

### What we explicitly do NOT do in Wave D

- No tab-bar/three-page swipe changes — that's load-bearing per `BUILD_LOG.md`.
- No new screens.
- No iOS↔desktop URL-scheme parity work beyond the hash-fragment alignment.

### Tests

#### Correctness (added)

- `NavDestinationRoutingTests` — for each destination, assert the correct presentation style (sheet vs push) is produced.
- `SettingsDeepLinkTests` — for each tab fragment, assert routing lands on the right sub-view; back button returns to the prior screen, not a half-state.
- `XCUITest: SettingsDeepLinkFlowTest` — full E2E: open task → tap "set timezone" link in Settings → tap timezone tab → back returns to task. Builds on existing `E2EFlowTests`.

#### Regression guards (added)

- An exhaustive switch over `NavDestination` cases in routing — Swift's exhaustiveness check itself is the regression guard. No additional test needed for that.
- A test that fails if `MainContainer` references `SelectionStore.shared` — keeps the env-injection contract.

### Risk

Low-medium. Navigation refactors are visible immediately if broken. Existing UI test (`E2EFlowTests`) catches the major paths.

### Rollout

Single PR. Heavy manual smoke on every navigation entry point: omnibar→detail, search→detail, list→detail, settings deep-links from connection-health re-link tasks, sheet dismissals.

---

## Cross-cutting concerns

### Test infrastructure additions (Wave A)

These get built once and reused across waves:

- **`ClearableStoreRegistry`** — a real registry abstraction (generalize `ChatStoreRegistry`) that all stores register with. Used by sign-out fan-out (Wave A) and as the basis for the conformance test (Wave A) and the read-method guard test (Wave B).
- **`InMemoryActiveSession`** — extends `InMemoryPersistenceController` to provide an injectable `ActiveSession` for tests. Required for Wave B's injection refactor.
- **`MockSyncManager`** — minimal protocol-based fake so stores can assert "I called schedulePushDebounced() once" without spinning up a real engine.
- **`PerformanceBaseline.swift`** — single test target capturing the "render Today with N items" baseline. Re-run pre/post Wave B.

### CI considerations

- The grep/line-count/shape guard tests run as the in-app test target itself (Swift Testing) so they execute wherever iOS tests run today.
- Confirm during Wave A's plan: does `.github/workflows/ci.yml` currently invoke iOS tests on a macOS runner with a booted simulator? If not, the guard tests run locally only until that's wired up — still valuable, but not enforced cross-PR.

### Verification per wave

For every wave, before merging to `release`:

1. Full `apps/ios/BrettTests` run, all green.
2. `apps/ios/BrettUITests` E2E suite, all green (one already-skipped test stays skipped).
3. Manual smoke on a real device for the wave's domain.
4. Sign-out / sign-in-as-different-user smoke after every wave (catches any regression to multi-user fragility).

### What to do if a wave reveals a non-fragility bug

File and fix separately. Do not absorb bug fixes into the refactor PRs — keeps blame easier and rollback cleaner.

## Resolved decisions

- **Wave A — store registry:** Fresh `ClearableStoreRegistry` protocol (not chat-specific). `ChatStoreRegistry` continues to exist for chat-specific behavior; clearing fans out via the new protocol.
- **Wave B — `ScoutStore` storage:** SwiftData. Drop the in-memory `[ScoutDTO]` array; views `@Query` `Scout` rows.
- **Wave C — mapper approach:** Manual generic-Codable refactor. Each model owns its own ~30-line encode/decode; mapper file becomes a ~100-line dispatcher. No Swift macro tooling.
- **Wave D — `SelectionStore` rename:** Rename to `NavStore`. Holds `currentDestination: NavDestination?` only.

## Out of scope (deferred)

- Strict Swift 6 concurrency rollout
- iOS↔desktop URL-scheme parity beyond hash fragments
- Platform integrations (widgets, Siri, Share Extension, push)
- LLM-based fallback for `SmartParser`
- React Compiler / desktop work (none of this is iOS)
- Performance optimizations beyond the userId-predicate move

## Acceptance criteria

- All four waves merged to `release`.
- Net iOS LOC reduced by at least 1200 (range estimate 1200–2500).
- No regression in existing test suite; new tests added per the test sections above are green.
- Manual smoke per the verification list above passes for each wave.
- A follow-up week of production use with no new "fragile feel" reports.
