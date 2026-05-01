# iOS Simplification — Wave D: Navigation Unification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the iOS app's three coexisting navigation patterns (NavigationStack push, manual `path.append` two-step, and ad-hoc sheets) into one `NavDestination` enum that drives both `.sheet(item:)` (modal-style destinations) and `.navigationDestination(for:)` (push-style destinations). Fix the known two-step settings deep-link bug. Rename `SelectionStore` → `NavStore` and make it presentation-state-only.

**Architecture:** Four phases. (1) Expand `NavDestination` to cover sheet-style destinations (`.taskDetail(id:)`, `.search`, `.feedback`, `.newScout`, `.editScout(id:)`) and add `.settingsTab(SettingsTab)` to collapse the two-step settings push into one. (2) Fold the three boolean-flag sheets in `MainContainer` and the two child-view sheets into `NavDestination`-driven `.sheet(item:)` modifiers. (3) Rename `SelectionStore` → `NavStore`. Drop properties that the new `NavDestination` covers (`selectedTaskId`, `pendingSettingsTab`); keep `lastCreatedItemId` as a separate small UI-signal property (it's a scroll-to-new signal, not navigation). (4) Verification + PR update. Tests stay focused on the `SettingsTab(fragment:)` mapping (existing) plus a new test asserting the unified routing produces single pushes.

**Tech Stack:** Swift 6 / SwiftUI. Existing infra: `ClearableStoreRegistry` (Wave A), Wave B's `@Query`-driven views, `BrettLog`. New file: `apps/ios/Brett/Stores/NavStore.swift` (replaces `SelectionStore.swift`).

**Spec:** [`docs/superpowers/specs/2026-04-26-ios-simplification-design.md`](../specs/2026-04-26-ios-simplification-design.md), §Wave D.

---

## Spec reconciliation

A few decisions made during reconnaissance:

1. **`SettingsView`'s internal `.navigationDestination(for: SettingsTab.self)` STAYS as secondary nav.** Folding it into the main `NavDestination` would require either (a) prefixing every settings sub-route with `.settingsTab(SettingsTab)` (clunky for in-Settings navigation) or (b) flattening every settings tab into the main `NavDestination` (explodes the enum). The spec's only hard requirement on settings is "fix the two-step push" — done by adding `NavDestination.settingsTab(SettingsTab)` that pushes both `Settings` AND the tab in one stack-append.

2. **`lastCreatedItemId` stays.** Reconnaissance shows it's a "scroll-to-newly-created-item" signal driven by the omnibar, NOT navigation state. Keep on `NavStore` as a non-navigation companion property. Rename ergonomically if a less-confusing name fits (e.g., `pendingScrollToItemId`); same semantics.

3. **`selectedEventId` is dead state.** Recon flagged it as "inspection-only — not used for sheet presentation." Verify with `grep` during Task 6; if truly unused, delete. If something does read it, leave it as a non-navigation property like `lastCreatedItemId`.

4. **No new sub-stores or dependency injection rewrites.** Wave D is navigation only. The store rename is mechanical (find-and-replace).

---

## File structure

**New files (1):**
- `apps/ios/Brett/Stores/NavStore.swift` — replaces `SelectionStore.swift`. Holds `currentDestination: NavDestination?` (drives `.sheet(item:)`) plus a small set of non-nav signals.

**Heavily modified:**
- `apps/ios/Brett/Views/MainContainer.swift` — single `.sheet(item:)` driven by `NavStore.currentDestination`; expanded `.navigationDestination` switch; the `pendingSettingsTab` two-step block goes away.
- `apps/ios/Brett/Views/Shared/TaskRow.swift` — Reconnect pill switches from `pendingSettingsTab` to a direct `NavStore.go(to: .settingsTab(...))` call.
- `apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift` — `NewScout` sheet moves from local `@State` flag to a `NavStore.go(to: .newScout)` call; presentation handled by `MainContainer`'s unified sheet.
- `apps/ios/Brett/Views/Scouts/ScoutDetailView.swift` — `EditScout` sheet same treatment.
- `apps/ios/Brett/Views/Settings/SettingsView.swift` — no structural changes; the Reconnect pill uses `.settingsTab(...)` to push directly.

**Deleted:**
- `apps/ios/Brett/Stores/SelectionStore.swift` — replaced by `NavStore.swift`.

**Modified tests:**
- `apps/ios/BrettTests/Views/SettingsNavigationTests.swift` — same coverage; just updates store references if any.
- `apps/ios/BrettTests/Stores/ClearableConformanceTests.swift` — curated list update (`SelectionStore.swift` → `NavStore.swift`).
- New: `apps/ios/BrettTests/Views/NavStoreTests.swift` — tests the new store + the `settingsTab` flow as a single push.

**Total: 1 new + 5 modified + 1 deleted + 2 modified tests + 1 new test.**

---

## Phase 1 — Expand `NavDestination` and fix the two-step settings push

### Task 1: Add new `NavDestination` cases

**Files:**
- Modify: `apps/ios/Brett/Views/MainContainer.swift` — `NavDestination` enum (lines 6–12)
- Create: `apps/ios/BrettTests/Views/NavStoreTests.swift`

#### Step 1: Write the failing test

Create `apps/ios/BrettTests/Views/NavStoreTests.swift`:

```swift
import Testing
import Foundation
@testable import Brett

/// Tests for the unified `NavDestination` enum that drives both
/// `.sheet(item:)` and `.navigationDestination(for:)`. Verifies new
/// cases exist + their associated values are accessible.
@Suite("NavDestination", .tags(.smoke))
struct NavDestinationTests {
    @Test func taskDetailCarriesItemId() {
        let dest = NavDestination.taskDetail(id: "item-1")
        if case .taskDetail(let id) = dest {
            #expect(id == "item-1")
        } else {
            Issue.record("expected .taskDetail")
        }
    }

    @Test func searchHasNoAssociatedValue() {
        let dest = NavDestination.search
        if case .search = dest {
            // Pass — exists.
        } else {
            Issue.record("expected .search")
        }
    }

    @Test func feedbackHasNoAssociatedValue() {
        let dest = NavDestination.feedback
        if case .feedback = dest {} else { Issue.record("expected .feedback") }
    }

    @Test func newScoutHasNoAssociatedValue() {
        let dest = NavDestination.newScout
        if case .newScout = dest {} else { Issue.record("expected .newScout") }
    }

    @Test func editScoutCarriesScoutId() {
        let dest = NavDestination.editScout(id: "scout-1")
        if case .editScout(let id) = dest {
            #expect(id == "scout-1")
        } else {
            Issue.record("expected .editScout")
        }
    }

    @Test func settingsTabCarriesTab() {
        let dest = NavDestination.settingsTab(.calendar)
        if case .settingsTab(let tab) = dest {
            #expect(tab == .calendar)
        } else {
            Issue.record("expected .settingsTab")
        }
    }

    @Test func equalityWorksForCasesWithAssociatedValues() {
        #expect(NavDestination.taskDetail(id: "x") == NavDestination.taskDetail(id: "x"))
        #expect(NavDestination.taskDetail(id: "x") != NavDestination.taskDetail(id: "y"))
    }
}
```

#### Step 2: Run test, verify failure

```bash
cd apps/ios && xcodegen
cd apps/ios && xcodebuild build-for-testing -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | grep -E "(BUILD SUCCEEDED|BUILD FAILED|error:)" | head -10
```

Expected: BUILD FAILED — the new cases (`taskDetail`, `search`, `feedback`, `newScout`, `editScout`, `settingsTab`) don't exist yet on `NavDestination`.

#### Step 3: Add the new cases

In `apps/ios/Brett/Views/MainContainer.swift`, find the `NavDestination` enum (around line 6) and replace it with:

```swift
/// Single source of truth for navigation across the app. Drives both
/// `.sheet(item:)` (modal-style destinations) and
/// `.navigationDestination(for: NavDestination.self)` (push-style
/// destinations). Wave D unified the previous mix of three patterns
/// (push, manual `path.append`, and ad-hoc booleans) into this enum
/// so a single `NavStore.currentDestination` value drives every
/// presentation decision in one place.
enum NavDestination: Hashable {
    // Push-style destinations (drive `.navigationDestination(for:)`).
    case settings
    case settingsTab(SettingsTab)
    case scoutsRoster
    case scoutDetail(id: String)
    case eventDetail(id: String)
    case listView(id: String)

    // Sheet-style destinations (drive `.sheet(item:)`).
    case taskDetail(id: String)
    case search
    case feedback
    case newScout
    case editScout(id: String)

    /// True for cases that should present as a sheet rather than a push.
    /// `MainContainer` reads this to decide which presenter wraps the
    /// destination — `.sheet(item:)` for `true`, the navigation stack
    /// for `false`. Keeping the choice as a property on the enum
    /// avoids scattering routing logic across views.
    var isSheet: Bool {
        switch self {
        case .taskDetail, .search, .feedback, .newScout, .editScout:
            return true
        case .settings, .settingsTab, .scoutsRoster, .scoutDetail, .eventDetail, .listView:
            return false
        }
    }
}
```

`SettingsTab` already conforms to `Hashable` and lives in `apps/ios/Brett/Views/Settings/SettingsView.swift` — verify by reading the file. If it doesn't conform, add `Hashable` conformance.

#### Step 4: Run test, verify pass

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/NavDestinationTests 2>&1 | grep -E "(passed|failed|error:)" | tail -10
```

Expected: 7 tests pass.

Run broader smoke:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: 637 tests pass (630 baseline + 7 new). Existing `.navigationDestination` switch must still compile (we added cases but didn't break existing handling — note that adding cases to a switch may produce non-exhaustive warnings; we'll address those when we update the switch in Task 2).

If the existing `.navigationDestination(for: NavDestination.self) { dest in switch dest { ... } }` switch in `MainContainer.swift:251-264` now has non-exhaustive warnings, the build still succeeds (warning, not error) but those are addressed in Task 2.

#### Step 5: Commit

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/suspicious-agnesi-6f55a9 && git add apps/ios/Brett/Views/MainContainer.swift apps/ios/BrettTests/Views/NavStoreTests.swift
git commit -m "feat(ios): expand NavDestination enum for sheet + push unification"
```

---

### Task 2: Update `MainContainer`'s `.navigationDestination` switch + collapse the two-step settings push

**Files:**
- Modify: `apps/ios/Brett/Views/MainContainer.swift`

#### Step 1: Add the failing test

Append to `apps/ios/BrettTests/Views/NavStoreTests.swift`:

```swift
@Suite("Settings deep-link", .tags(.smoke))
struct SettingsDeepLinkTests {
    /// Wave D's central bug fix: settings deep-links push ONE thing
    /// (`NavDestination.settingsTab(...)`) onto the stack, not two
    /// (`NavDestination.settings` then `SettingsTab`). The
    /// destination's `isSheet` is false — it's a push.
    @Test func settingsTabDestinationIsPush() {
        let dest = NavDestination.settingsTab(.calendar)
        #expect(dest.isSheet == false)
    }

    /// `.settingsTab(.calendar)` is hashable + equatable, suitable
    /// for `path.append(...)` and `NavigationStack` identity.
    @Test func settingsTabHashableAndEquatable() {
        let a = NavDestination.settingsTab(.calendar)
        let b = NavDestination.settingsTab(.calendar)
        let c = NavDestination.settingsTab(.aiProviders)
        #expect(a == b)
        #expect(a != c)
        #expect(a.hashValue == b.hashValue)
    }
}
```

#### Step 2: Run, confirm pass

(These tests pass after Task 1's enum change, so this is just a regression-guard add.)

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests/SettingsDeepLinkTests 2>&1 | grep -E "(passed|failed)" | tail -10
```

Expected: 2 new tests pass.

#### Step 3: Update the `.navigationDestination` switch

In `apps/ios/Brett/Views/MainContainer.swift`, find the `.navigationDestination(for: NavDestination.self) { dest in switch dest { ... } }` block (around lines 251–264). Replace with:

```swift
.navigationDestination(for: NavDestination.self) { destination in
    switch destination {
    case .settings:
        SettingsView()
    case .settingsTab(let tab):
        // Unified single-step deep-link: pushing
        // `.settingsTab(.calendar)` lands directly on the calendar
        // sub-page with `Settings` as the back-button parent. Avoids
        // the prior two-`path.append` pattern that left back-button
        // in a half-state.
        SettingsView(initialTab: tab)
    case .scoutsRoster:
        ScoutsRosterView()
    case .scoutDetail(let id):
        ScoutDetailView(scoutId: id)
    case .eventDetail(let id):
        EventDetailView(eventId: id)
    case .listView(let id):
        ListView(listId: id)
    case .taskDetail, .search, .feedback, .newScout, .editScout:
        // Sheet-style destinations are presented via `.sheet(item:)`
        // elsewhere on this view; reaching them through the push
        // stack is a programming error. Render an `EmptyView` so a
        // miswired `path.append` is harmless rather than crashing.
        EmptyView()
    }
}
```

This requires `SettingsView` to accept an optional `initialTab` parameter. Read `apps/ios/Brett/Views/Settings/SettingsView.swift` to find its current init shape. Add a parameter:

```swift
struct SettingsView: View {
    let initialTab: SettingsTab?

    @State private var selectedTab: SettingsTab?

    init(initialTab: SettingsTab? = nil) {
        self.initialTab = initialTab
        self._selectedTab = State(initialValue: initialTab)
    }

    var body: some View {
        // ... existing body
    }
}
```

How `SettingsView` consumes `selectedTab` depends on its current structure. Two patterns to look for:

- If `SettingsView` uses `.navigationDestination(for: SettingsTab.self)` and an inner stack: programmatically push the initial tab on `.task` or `.onAppear` if `selectedTab != nil`. Use a stored `@State private var path: NavigationPath` for this inner stack and set `path.append(initialTab)` if non-nil.
- If `SettingsView` uses a list of NavigationLinks: drive selection via `selectedTab` (`NavigationLink(value:)` + `.navigationDestination(for: SettingsTab.self)`).

Read the actual code and adapt; the goal is "render Settings with the given tab already pushed."

#### Step 4: Update the `pendingSettingsTab` consumer in `MainContainer`

Find the existing block at `MainContainer.swift:310-315`:

```swift
.onChange(of: selection.pendingSettingsTab) { _, tab in
    guard let tab else { return }
    path.append(NavDestination.settings)
    path.append(tab)
    selection.pendingSettingsTab = nil
}
```

Replace with:

```swift
.onChange(of: selection.pendingSettingsTab) { _, tab in
    guard let tab else { return }
    path.append(NavDestination.settingsTab(tab))
    selection.pendingSettingsTab = nil
}
```

This is the bug fix: ONE append, not two. Back-button correctly returns to the calling screen.

(Phase 3 will remove `pendingSettingsTab` entirely; for now, keep it as the bridge so the change is small.)

#### Step 5: Run tests

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: 639 tests pass (637 + 2 new). Manual smoke needed:
- Open a re-link task in Today
- Tap the Reconnect pill
- Verify Settings → the right tab pushes in one step
- Tap back; verify it returns to Today (NOT empty Settings)

If you can't manually verify in this environment, document and note in the report.

#### Step 6: Commit

```bash
git commit -m "fix(ios): collapse settings deep-link to single push via NavDestination.settingsTab"
```

---

## Phase 2 — Fold sheets into `NavDestination`-driven `.sheet(item:)`

Goal: `MainContainer` has ONE `.sheet(item:)` modifier driven by a binding to `NavStore.currentDestination`. Existing booleans (`showSearch`, `showFeedback`, sheet-via-`selectedTaskId`) and child-view local sheets (NewScoutSheet, EditScoutSheet) all collapse into this.

### Task 3: TaskDetail + Search + Feedback sheets via NavDestination

**Files:**
- Modify: `apps/ios/Brett/Views/MainContainer.swift`
- Modify: `apps/ios/Brett/Stores/SelectionStore.swift` — add `currentDestination` property without renaming the file yet (the rename happens in Phase 3)

#### Steps

1. Add `currentDestination: NavDestination?` to `SelectionStore`:

```swift
@MainActor
@Observable
final class SelectionStore {
    var selectedTaskId: String?           // KEEP for now — Phase 3 removes
    var selectedEventId: String?          // KEEP for now — Phase 3 removes if unused
    var lastCreatedItemId: String?        // KEEP — non-nav signal
    var pendingSettingsTab: SettingsTab?  // KEEP for now — Phase 3 removes

    /// Current sheet-style destination. Wave D added this to drive
    /// the unified `.sheet(item:)` on `MainContainer`. Push-style
    /// navigation continues to flow through `NavigationStack.path`
    /// for now; only sheet presentation reads this property.
    var currentDestination: NavDestination?

    static let shared = SelectionStore()

    func clear() {
        selectedTaskId = nil
        selectedEventId = nil
        lastCreatedItemId = nil
        pendingSettingsTab = nil
        currentDestination = nil
    }
}
```

2. In `MainContainer`, replace the three existing sheet modifiers with one:

Find (around lines 268-305):
- `.sheet(isPresented: <task-detail binding>)` for TaskDetailView
- `.sheet(isPresented: $showSearch)` for SearchSheet
- `.sheet(isPresented: $showFeedback)` for FeedbackSheet

Replace with a single:

```swift
.sheet(item: $selection.currentDestination) { destination in
    switch destination {
    case .taskDetail(let id):
        TaskDetailView(itemId: id)
    case .search:
        SearchSheet()
    case .feedback:
        FeedbackSheet()
    case .newScout:
        NewScoutSheet()
    case .editScout(let id):
        // EditScoutSheet's existing init shape — read ScoutDetailView for the param.
        EditScoutSheet(scoutId: id)
    case .settings, .settingsTab, .scoutsRoster, .scoutDetail, .eventDetail, .listView:
        // Push-style destinations are not sheet-presentable. Render
        // empty so a misrouted sheet drive doesn't crash.
        EmptyView()
    }
}
```

Note: `.sheet(item:)` requires the bound value to be `Identifiable`. `NavDestination` is `Hashable` but not `Identifiable`. Two options:

- (a) Add `Identifiable` conformance to `NavDestination` with `var id: Self { self }` (since it's already `Hashable`).
- (b) Use a binding-bridge pattern that wraps `NavDestination` in an `Identifiable` shim.

Use (a) — simpler:

```swift
extension NavDestination: Identifiable {
    var id: Self { self }
}
```

3. Remove the now-dead state:
   - `@State private var showSearch = false` — delete (and its binding consumers)
   - `@State private var showFeedback = false` — delete
   - The Boolean-binding wrapper around `selection.selectedTaskId` for the task-detail sheet — delete

4. Update the call sites that previously toggled these booleans:
   - Magnifying-glass tap: `showSearch = true` → `selection.currentDestination = .search`
   - Shake gesture: `showFeedback = true` → `selection.currentDestination = .feedback`
   - Task row tap: `selection.selectedTaskId = id` → `selection.currentDestination = .taskDetail(id: id)` (Phase 3 will drop `selectedTaskId` entirely)

5. Run tests + manual smoke:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: 639 tests pass.

Manual: tap a task → detail sheet opens. Tap magnifying glass → search sheet opens. Shake → feedback sheet (if reachable in dev). Each should dismiss cleanly.

6. Commit:

```bash
git commit -m "refactor(ios): MainContainer sheets unified via NavDestination.currentDestination"
```

---

### Task 4: NewScout + EditScout sheets via NavDestination

**Files:**
- Modify: `apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift`
- Modify: `apps/ios/Brett/Views/Scouts/ScoutDetailView.swift`

#### Steps

1. **`ScoutsRosterView`:** find the local `@State private var isPresentingNewScout = false` and the `.sheet(isPresented:)` modifier. Remove both. Replace the button-tap handler that sets `isPresentingNewScout = true` with `selection.currentDestination = .newScout`. The sheet is now presented by `MainContainer`'s unified handler.

   `ScoutsRosterView` likely needs `@Environment(SelectionStore.self) private var selection` (or whatever the existing access pattern is — it may use `.shared` directly today).

2. **`ScoutDetailView`:** same pattern for `isPresentingEdit`. Replace with `selection.currentDestination = .editScout(id: scoutId)`.

3. Run tests + manual smoke:
   - Tap "+" on Scouts roster → NewScout sheet opens.
   - In ScoutDetailView, tap edit → EditScout sheet opens.

4. Commit:

```bash
git commit -m "refactor(ios): scout sheets routed through NavDestination"
```

---

## Phase 3 — Rename `SelectionStore` → `NavStore` + slim its surface

Goal: `SelectionStore` becomes `NavStore`. Properties that the unified `NavDestination` now covers (`selectedTaskId`, `pendingSettingsTab`) are removed. `lastCreatedItemId` stays. `selectedEventId` is verified dead and deleted.

### Task 5: Verify `selectedEventId` usage

**Files:** read-only reconnaissance.

```bash
grep -rn "selectedEventId" apps/ios/Brett/
```

Three possible outcomes:
- **Truly unused:** delete it (in Task 6).
- **Used as a non-nav signal** (e.g., "highlight this event in calendar"): keep it on `NavStore`, document.
- **Used as nav state:** fold into `NavDestination.eventDetail(id:)` and remove `selectedEventId`.

Document the outcome in your report; don't commit yet — Task 6 collapses the rename + the cleanup into one commit.

---

### Task 6: Rename `SelectionStore` → `NavStore`

**Files:**
- Create: `apps/ios/Brett/Stores/NavStore.swift`
- Delete: `apps/ios/Brett/Stores/SelectionStore.swift`
- Modify: every `.shared` consumer (per recon, ~11 call sites)
- Modify: `apps/ios/BrettTests/Stores/ClearableConformanceTests.swift` — curated list update

#### Steps

1. Create `apps/ios/Brett/Stores/NavStore.swift`:

```swift
import Foundation
import Observation

/// App-wide navigation + UI-signal state.
///
/// Wave D consolidated this from `SelectionStore` so the previous mix
/// of three navigation patterns (manual `path.append`, ad-hoc Boolean
/// sheet flags, and stack-driven push) collapses into one source of
/// truth: `currentDestination` drives every sheet-style presentation,
/// and the navigation stack reads pushes via the same `NavDestination`
/// enum.
///
/// Non-nav signals (`lastCreatedItemId`) stay on this store as small
/// per-app-session UI hints. They're not navigation state but they're
/// in the same blast-radius (cleared on sign-out, not persisted).
@MainActor
@Observable
final class NavStore: Clearable {
    /// Current sheet-style destination. Setting this presents a sheet
    /// in `MainContainer`; clearing it dismisses. Push-style
    /// destinations flow through `NavigationStack.path` directly.
    var currentDestination: NavDestination?

    /// Id of the most-recently-created item — set by the Omnibar
    /// after a successful create. Pages observe this via `.onChange`
    /// to scroll the new row into view; users adding to a long list
    /// otherwise can't tell whether the create happened.
    ///
    /// Not navigation; UI signal. Kept here because it's
    /// session-scoped state that needs the same sign-out clear that
    /// other UI state gets.
    var lastCreatedItemId: String?

    static let shared = NavStore()

    init() {
        ClearableStoreRegistry.register(self)
    }

    /// Clearable conformance — drop everything on sign-out. The
    /// next user's session starts with no pending sheet, no scroll
    /// signal, and no stale ids.
    func clearForSignOut() {
        currentDestination = nil
        lastCreatedItemId = nil
    }

    /// Convenience: navigate to a destination. Wraps the property
    /// assignment so call sites read like `nav.go(to: .search)` —
    /// reads better at the use site than `selection.currentDestination = .search`.
    func go(to destination: NavDestination) {
        currentDestination = destination
    }

    /// Convenience: dismiss the current sheet.
    func dismiss() {
        currentDestination = nil
    }
}
```

Note: this drops `selectedTaskId`, `selectedEventId`, and `pendingSettingsTab` since the new `NavDestination` covers all three uses.

2. Delete `apps/ios/Brett/Stores/SelectionStore.swift`.

3. **Update every consumer.** Find them:

```bash
grep -rn "SelectionStore" apps/ios/Brett apps/ios/BrettTests | grep -v "SelectionStore.swift"
```

Each occurrence is one of:
- `SelectionStore.shared` → `NavStore.shared`
- `@Environment(SelectionStore.self)` → `@Environment(NavStore.self)`
- `selection.selectedTaskId = id` → `selection.go(to: .taskDetail(id: id))`
- `selection.selectedEventId = id` → either `selection.go(to: .eventDetail(id: id))` (if it was actually nav state) or delete (if dead)
- `selection.pendingSettingsTab = tab` → `selection.go(to: .settingsTab(tab))` (and delete the `.onChange(of: pendingSettingsTab)` block in `MainContainer.swift:310-315` since it's no longer needed)
- `selection.lastCreatedItemId` → `selection.lastCreatedItemId` (unchanged; just store rename)
- `.environment(SelectionStore.shared)` → `.environment(NavStore.shared)`

The Reconnect pill in `TaskRow.swift` was a major consumer. Update its tap handler:

```swift
// Before:
SelectionStore.shared.pendingSettingsTab = type.settingsTab

// After:
NavStore.shared.go(to: .settingsTab(type.settingsTab))
```

4. **Update `MainContainer` to drop `pendingSettingsTab` consumption.** The `.onChange(of: selection.pendingSettingsTab)` block at line 310 (post-Task-2 it was `path.append(NavDestination.settingsTab(tab))`) goes away — the Reconnect pill now writes directly to `currentDestination`, but **wait** — is `.settingsTab(...)` a push or a sheet? Per Task 1's `isSheet` property, push. So `currentDestination` is the wrong slot.

   Resolution: split the API on `NavStore` into push-vs-sheet routes:

   ```swift
   func push(_ destination: NavDestination) {
       // Pushes through MainContainer's NavigationStack.
       // MainContainer observes pendingPushDestination and appends.
       pendingPushDestination = destination
   }

   var pendingPushDestination: NavDestination?
   ```

   And in `MainContainer`:

   ```swift
   .onChange(of: nav.pendingPushDestination) { _, dest in
       guard let dest else { return }
       path.append(dest)
       nav.pendingPushDestination = nil
   }
   ```

   The `go(to:)` method dispatches by `dest.isSheet`:

   ```swift
   func go(to destination: NavDestination) {
       if destination.isSheet {
           currentDestination = destination
       } else {
           pendingPushDestination = destination
       }
   }
   ```

   This lets call sites just write `nav.go(to: .settingsTab(.calendar))` regardless of whether it's a sheet or a push.

5. **Update `ClearableConformanceTests`** curated list:

```swift
// In apps/ios/BrettTests/Stores/ClearableConformanceTests.swift, find:
private static let expectedStores: [String] = [
    // ...
    "SelectionStore.swift",
    // ...
]
```

Replace `SelectionStore.swift` with `NavStore.swift`. Run xcodegen to pick up the file rename.

6. Run tests:

```bash
cd apps/ios && xcodegen
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: 639 tests pass (or fewer if `selectedEventId`-related tests existed and got retired with the field).

7. Manual smoke:
   - Sign out → sign in: verify `NavStore.shared.clearForSignOut()` runs (the `Clearable` regression-guard test should already cover this).
   - Tap Reconnect on a re-link task → settings tab pushes correctly.
   - Tap a task → detail sheet opens.
   - Tap "+" on Scouts → New Scout sheet opens.

8. Commit:

```bash
git commit -m "refactor(ios): rename SelectionStore -> NavStore; route via go(to:)"
```

---

### Task 7: Update navigation tests + clean up call-site naming

**Files:**
- Modify: `apps/ios/BrettTests/Views/SettingsNavigationTests.swift`
- Modify: any test referencing `SelectionStore` (if any)
- Optional: rename `selection` parameter to `nav` at call sites for readability

#### Steps

1. Search tests for `SelectionStore`:

```bash
grep -rn "SelectionStore" apps/ios/BrettTests
```

If any tests reference `SelectionStore`, update to `NavStore`. Most tests likely don't touch it directly.

2. Optional readability pass: in views that have `@Environment(NavStore.self) private var selection`, consider renaming the property to `private var nav` since the type changed. This is purely aesthetic — only do it if it makes the code clearer and only in files where you're already touching for other reasons. **Don't sweep the whole codebase for `selection` → `nav`** — that's a large diff with no behavior change.

3. Add a regression test to `NavStoreTests.swift` covering the `go(to:)` push-vs-sheet dispatch:

```swift
@Suite("NavStore routing", .tags(.smoke))
@MainActor
struct NavStoreRoutingTests {
    @Test func goToSheetDestinationSetsCurrentDestination() {
        let store = NavStore()
        store.go(to: .search)
        #expect(store.currentDestination == .search)
        #expect(store.pendingPushDestination == nil)
    }

    @Test func goToPushDestinationSetsPendingPush() {
        let store = NavStore()
        store.go(to: .settingsTab(.calendar))
        #expect(store.pendingPushDestination == .settingsTab(.calendar))
        #expect(store.currentDestination == nil)
    }

    @Test func dismissClearsCurrentDestination() {
        let store = NavStore()
        store.currentDestination = .search
        store.dismiss()
        #expect(store.currentDestination == nil)
    }

    @Test func clearForSignOutClearsEverything() {
        let store = NavStore()
        store.currentDestination = .search
        store.pendingPushDestination = .settings
        store.lastCreatedItemId = "item-1"
        store.clearForSignOut()
        #expect(store.currentDestination == nil)
        #expect(store.pendingPushDestination == nil)
        #expect(store.lastCreatedItemId == nil)
    }
}
```

4. Run all tests:

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: 643 tests pass (639 + 4 new).

5. Commit:

```bash
git commit -m "test(ios): NavStore routing tests + cleanup"
```

---

## Phase 4 — Verification + PR update

### Task 8: Final smoke + push + PR update

#### Step 1: Full unit test suite

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:BrettTests 2>&1 | grep -E "(Test run|tests in|passed|failed)" | tail -5
```

Expected: ~643 tests pass.

#### Step 2: UI test suite

```bash
cd apps/ios && xcodebuild test -scheme BrettUITests -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -10
```

Expected: same green/skipped count as before.

#### Step 3: Manual smoke checklist

Boot the simulator. Walk through:

1. **Sheet presentation:** tap a task → TaskDetail sheet opens → swipe down to dismiss. Tap "+" on Scouts → NewScout sheet → dismiss.
2. **Push navigation:** tap a list in the drawer → ListView pushes. Back button returns to root. Tap a scout in roster → ScoutDetail pushes. Back returns.
3. **Settings deep-link (THE BUG FIX):** Open a re-link task in Today (e.g., "Reconnect Google Calendar"). Tap the Reconnect pill. Verify: Settings → Calendar tab pushes in ONE step (the back button label says "Today" or whatever the task's source page is, NOT "Settings"). Tap back. Verify: returns directly to Today, NOT to an empty Settings page.
4. **Search:** tap magnifying glass → Search sheet opens. Cancel.
5. **Sign out → sign in as different user:** verify `NavStore` clears all state (test covers this; UI smoke is belt-and-suspenders).

#### Step 4: Push branch

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/suspicious-agnesi-6f55a9 && git push origin claude/suspicious-agnesi-6f55a9 2>&1 | tail -5
```

If SSH fails (per Wave B/C history), fall back:

```bash
git -c "credential.helper=!gh auth git-credential" push https://github.com/brentbarkman/brett.git claude/suspicious-agnesi-6f55a9 2>&1 | tail -5
```

#### Step 5: Update PR description

Add Wave D section. Get the current body:

```bash
gh pr view 105 --json body --jq .body
```

Run `gh pr edit 105` with the existing body + a new Wave D section appended, plus update the title to mention all four waves.

Wave D section template:

```markdown
## Wave D — navigation unification

[Plan](docs/superpowers/plans/2026-04-28-ios-simplification-wave-d.md). One `NavDestination` enum drives both `.sheet(item:)` (modal-style) and `.navigationDestination(for:)` (push-style).

- **`NavDestination` expanded.** Added `.taskDetail(id:)`, `.search`, `.feedback`, `.newScout`, `.editScout(id:)` (sheet-style) plus `.settingsTab(SettingsTab)` (push-style). Existing 5 cases retained. New `isSheet: Bool` property steers each case to the right presenter.
- **Settings deep-link bug fixed.** Re-link task → Reconnect pill used to push `.settings` THEN the tab in two separate stack-appends, leaving back button in a half-state. Now single `path.append(.settingsTab(.calendar))`. Back button correctly returns to the calling screen.
- **Sheets unified.** `MainContainer` now has ONE `.sheet(item:)` driven by `NavStore.currentDestination`. Three boolean sheet flags + one binding-bridge pattern collapsed to one. Child views (`ScoutsRosterView`, `ScoutDetailView`) route their sheets through the same store.
- **`SelectionStore` → `NavStore`.** Renamed; properties trimmed to navigation state + `lastCreatedItemId` UI signal. `selectedTaskId`/`selectedEventId`/`pendingSettingsTab` removed (covered by `NavDestination` cases). New `go(to:)` API dispatches push-vs-sheet automatically.

[Final test count] tests passing across all four waves.

### Wave D test plan
- [ ] Settings deep-link: re-link task → Reconnect pill → Settings/Calendar tab pushes in ONE step. Back button returns to calling screen, NOT empty Settings.
- [ ] Sheet presentation: TaskDetail, Search, Feedback, NewScout, EditScout all open from their triggers and dismiss cleanly.
- [ ] Push navigation: list view, scout detail, event detail still push correctly.
- [ ] Sign out → sign in as different user: `NavStore` is fully cleared (no stale `currentDestination` or `lastCreatedItemId`).
```

Then update the PR title to:

```bash
gh pr edit 105 --title "fix(ios): Waves A + B + C + D — concurrency, single source of truth, god-file splits, navigation unification"
```

(Or shorter: "iOS simplification waves A–D".)

#### Step 6: Confirm

```bash
gh pr view 105 --json title,url --jq '"\(.title)\n\(.url)"'
```

---

## Constraints

- 7 commits maximum (one per task; some tasks may produce zero commits if nothing's actually dead).
- Don't touch the `MutationCompactor` decision (separate spawned task from Wave B).
- Don't refactor `SettingsView`'s internal `.navigationDestination(for: SettingsTab.self)` switch — it stays as a secondary nav, and the new `NavDestination.settingsTab(tab)` initializes `SettingsView` with the right tab pre-selected.
- Don't add new abstractions beyond what's spelled out (no `Router` class, no `NavigationCoordinator` pattern). The `NavStore` + `NavDestination` enum are the two new primitives.
- The `selection` → `nav` rename in views is OPTIONAL and only inside files you're already editing — don't sweep.

## Self-review checklist (run once after final task)

- [ ] **Spec coverage:** Every Wave D scope item from the spec maps to ≥1 task above:
  - One `NavDestination` enum drives sheet + push → Tasks 1, 2, 3, 4
  - Settings deep-link via single push → Task 2
  - `SelectionStore` → `NavStore`, presentation-state-only → Tasks 5, 6
  - Removes manual two-step `path.append` → Task 2
- [ ] **No placeholders:** every step has a concrete file path, code block, expected output, or commit command.
- [ ] **Type consistency:** `NavDestination`, `NavStore`, `currentDestination`, `pendingPushDestination`, `go(to:)`, `dismiss()`, `isSheet` used consistently across tasks.
- [ ] **Commits:** each task ends with a commit message matching project convention.
- [ ] **Test framework:** Swift Testing for new tests.

## Risk acknowledgment

Wave D is the smallest of the four waves — most of the heavy lifting (Clearable fan-out, atomicity, view restructuring, file splits) already landed in A/B/C. Remaining risks:

- **`SettingsView(initialTab:)` integration:** the inner secondary nav must accept and handle a pre-selected tab. If `SettingsView` doesn't currently have a `path: NavigationPath` for its inner stack, the implementation may need to add one. Mitigation: read the file before Task 2 and adapt the integration to the existing pattern.
- **Sheet vs push dispatch correctness:** `NavStore.go(to:)` dispatches by `NavDestination.isSheet`. If a future case is added without setting `isSheet` correctly, it routes wrong. Mitigation: the `NavDestinationTests` and `NavStoreRoutingTests` cover the existing cases; new cases force test additions via the exhaustive switch in `isSheet`.
- **Sheet dismissal race:** the existing `handleSearchSelection` defers navigation push by 0.35s after sheet close. After Wave D, this still works (the sheet dismiss clears `currentDestination` synchronously; the deferred push uses the same path). But verify the manual smoke during Task 8 covers the search-result-tap → sheet-dismiss → push-detail flow.

## What this wave does NOT do

- No tab-bar / three-page swipe changes — that's load-bearing per `BUILD_LOG.md`.
- No new screens.
- No iOS↔desktop URL-scheme parity beyond the existing hash-fragment alignment.
- No restructuring of `SettingsView`'s internal nav (secondary navigation stays).

After Wave D merges, the four-wave iOS simplification is complete.
