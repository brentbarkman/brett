# Today Count Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Badge the macOS dock icon (Electron) and iOS app icon with the count of outstanding Today items (overdue + due today + due this week).

**Architecture:** Renderer pushes the count to the Electron main process over a new IPC channel (`set-badge-count`); main calls `app.setBadgeCount(n)`. On iOS a `BadgeManager` singleton requests `.badge` notification authorization once, computes the count via a new pure function `TodaySections.badgeCount(items:)`, and calls `UNUserNotificationCenter.setBadgeCount(_:)`. Hooked from `MainContainer` so mutations anywhere in the app keep the badge fresh while the app is foreground/active.

**Tech Stack:** Electron 28 (`app.setBadgeCount`), React + `useEffect`, SwiftUI + SwiftData, `UNUserNotificationCenter` (iOS 16+), Swift Testing (`@Suite`/`@Test`).

**Spec:** [docs/superpowers/specs/2026-04-24-today-count-badge-design.md](../specs/2026-04-24-today-count-badge-design.md)

---

## File Map

**Desktop (create/modify):**
- Modify `apps/desktop/electron/main.ts` — add `set-badge-count` IPC handler.
- Modify `apps/desktop/electron/preload.ts` — expose `electronAPI.setBadgeCount(n)`.
- Modify `apps/desktop/src/App.tsx` — `useEffect` that pushes `activeThingsForCount.length` (or 0 when signed out) to the main process.

**iOS (create):**
- Create `apps/ios/Brett/Services/BadgeManager.swift` — authorization + badge write wrapper.
- Create `apps/ios/BrettTests/Views/TodaySectionsBadgeTests.swift` — Swift Testing suite for `TodaySections.badgeCount(items:)`.

**iOS (modify):**
- Modify `apps/ios/Brett/Views/Today/TodayPage.swift` — add static `TodaySections.badgeCount(items:)`.
- Modify `apps/ios/Brett/Views/MainContainer.swift` — `@Query` for items + `.onChange(of: allItems)` + `.onChange(of: scenePhase)` calling `BadgeManager.shared.refresh`.
- Modify `apps/ios/Brett/BrettApp.swift` — `requestAuthorization` on first sign-in, `clear` on sign-out.

No changes to `features.md` / `architecture.md` required — this is additive, visual-only chrome.

---

## Task 1: Desktop — IPC skeleton for `set-badge-count`

**Files:**
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`

- [ ] **Step 1: Add the main-process handler**

Open `apps/desktop/electron/main.ts`. Find the existing block of `ipcMain.handle(...)` calls (around line 69+, just after the auth token handlers) and append:

```ts
// macOS dock badge (and Linux Unity launcher). No-op on Windows. Clamp
// at the boundary — the renderer is trusted, but a stray NaN or
// negative number would throw inside Electron.
ipcMain.handle("set-badge-count", (_event, count: unknown) => {
  const n = typeof count === "number" && Number.isFinite(count) ? count : 0;
  app.setBadgeCount(Math.max(0, Math.floor(n)));
});
```

- [ ] **Step 2: Expose it in the preload bridge**

Open `apps/desktop/electron/preload.ts`. Add the new method inside the existing `contextBridge.exposeInMainWorld("electronAPI", { ... })` object, alongside the others:

```ts
setBadgeCount: (count: number) => ipcRenderer.invoke("set-badge-count", count),
```

- [ ] **Step 3: Typecheck the electron build**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS, no errors from either `tsconfig.electron.json` or the renderer tsconfig.

- [ ] **Step 4: Manually confirm the IPC call resolves**

Run `pnpm dev:desktop` from the repo root (or `pnpm electron:dev` from `apps/desktop`), wait for the Electron window to open, then in the renderer DevTools console run:

```js
await window.electronAPI.setBadgeCount(3)
```

Expected: the call resolves to `undefined` with no error, and the macOS dock icon shows a `3` badge. Calling `setBadgeCount(0)` clears it.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main.ts apps/desktop/electron/preload.ts
git commit -m "feat(desktop): add set-badge-count IPC for macOS dock badging"
```

---

## Task 2: Desktop — wire the count in the renderer

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Import the auth hook (if not already in scope)**

Open `apps/desktop/src/App.tsx`. Confirm `useAuth` from `./auth/AuthContext` is imported. If not:

```ts
import { useAuth } from "./auth/AuthContext";
```

Most likely it's already imported — search for `useAuth` before adding.

- [ ] **Step 2: Pull `user` off the auth context**

Near the top of the `App` component body (alongside the existing hook calls), add:

```ts
const { user } = useAuth();
```

If `const { user } = useAuth()` already exists in the component, skip this step.

- [ ] **Step 3: Add the badge-sync effect**

Immediately after the existing `activeThingsForCount` / `todayQuerySuccess` line in `apps/desktop/src/App.tsx` (currently around line 461), add:

```ts
// Push the Today count (overdue + due today + this week) to the macOS
// dock via the main process. Clears to 0 when signed out so the dock
// doesn't keep a stale number for the previous user. No-op in browsers
// and on Windows. iOS parity lives in apps/ios/Brett/Services/BadgeManager.
useEffect(() => {
  const api = (window as { electronAPI?: { setBadgeCount?: (n: number) => Promise<void> } }).electronAPI;
  if (!api?.setBadgeCount) return;
  const count = user ? activeThingsForCount.length : 0;
  api.setBadgeCount(count).catch(() => {
    // Ignore — losing a badge update is strictly cosmetic.
  });
}, [user, activeThingsForCount.length]);
```

Make sure `useEffect` is already imported from React at the top of the file; if not, add it.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @brett/desktop typecheck`
Expected: PASS.

- [ ] **Step 5: Manually verify end-to-end**

Run `pnpm dev:full` (or start the API + desktop separately). Sign in to a test account that has at least one active task due this week or earlier. Expected: the macOS dock icon shows the correct number of outstanding items. Complete a task → the badge decrements. Sign out → the badge clears to zero.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(desktop): badge dock icon with Today count"
```

---

## Task 3: iOS — add `TodaySections.badgeCount(items:)` with tests

**Files:**
- Create: `apps/ios/BrettTests/Views/TodaySectionsBadgeTests.swift`
- Modify: `apps/ios/Brett/Views/Today/TodayPage.swift`

This is the shared source of truth for the iOS badge count. Bucketing already exists on `TodaySections`; we expose a pure helper so `MainContainer` can call it without rendering.

- [ ] **Step 1: Write the failing tests**

Create `apps/ios/BrettTests/Views/TodaySectionsBadgeTests.swift`:

```swift
import Foundation
import Testing
@testable import Brett

/// Tests for `TodaySections.badgeCount(items:)` — the number that drives
/// the iOS home-screen badge. Count = overdue + due today + this week,
/// excluding Next Week, completed, and archived items.
@Suite("TodaySections.badgeCount", .tags(.views))
struct TodaySectionsBadgeTests {

    private let calendar = Calendar.current

    // MARK: - Dates

    private var startOfToday: Date { calendar.startOfDay(for: Date()) }
    private var yesterday: Date { calendar.date(byAdding: .day, value: -1, to: startOfToday)! }
    private var noonToday: Date { calendar.date(byAdding: .hour, value: 12, to: startOfToday)! }
    /// A date strictly inside "this week" but after today. If today is
    /// Saturday, "+1 day" lands in next week — clamp to end-of-week-minus-1h.
    private var laterThisWeek: Date {
        let weekday = calendar.component(.weekday, from: Date())
        let daysUntilEndOfWeek = max(0, 8 - weekday) // matches bucket()
        let endOfWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: startOfToday)!
        // One hour before end-of-week — guaranteed inside the bucket on every weekday.
        return calendar.date(byAdding: .hour, value: -1, to: endOfWeek)!
    }
    private var nextWeek: Date {
        let weekday = calendar.component(.weekday, from: Date())
        let daysUntilEndOfWeek = max(0, 8 - weekday)
        let endOfWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: startOfToday)!
        return calendar.date(byAdding: .day, value: 2, to: endOfWeek)!
    }

    // MARK: - Cases

    @Test func emptyInputReturnsZero() {
        #expect(TodaySections.badgeCount(items: []) == 0)
    }

    @Test func countsOverdue() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: yesterday),
            TestFixtures.makeItem(status: .active, dueDate: yesterday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 2)
    }

    @Test func countsToday() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: noonToday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 1)
    }

    @Test func countsThisWeek() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: laterThisWeek),
        ]
        #expect(TodaySections.badgeCount(items: items) == 1)
    }

    @Test func excludesNextWeek() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: nextWeek),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func excludesCompletedItems() {
        let items = [
            TestFixtures.makeItem(status: .done, dueDate: yesterday),
            TestFixtures.makeItem(status: .done, dueDate: noonToday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func excludesArchivedItems() {
        let items = [
            TestFixtures.makeItem(status: .archived, dueDate: yesterday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func excludesItemsWithoutDueDate() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: nil),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func sumsBucketsTogether() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: yesterday),
            TestFixtures.makeItem(status: .active, dueDate: noonToday),
            TestFixtures.makeItem(status: .active, dueDate: laterThisWeek),
            TestFixtures.makeItem(status: .active, dueDate: nextWeek),       // excluded
            TestFixtures.makeItem(status: .done,   dueDate: noonToday),       // excluded
            TestFixtures.makeItem(status: .active, dueDate: nil),             // excluded
        ]
        #expect(TodaySections.badgeCount(items: items) == 3)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run the BrettTests suite (from Xcode: ⌘U with the `BrettTests` scheme, or from CLI with your usual `xcodebuild test` command — check `apps/ios/BUILD_LOG.md` if unsure).
Expected: All `TodaySectionsBadgeTests` cases fail to compile with "Type 'TodaySections' has no member 'badgeCount'".

- [ ] **Step 3: Implement `badgeCount`**

Open `apps/ios/Brett/Views/Today/TodayPage.swift`. Inside the existing `struct TodaySections { ... }` block (near `activeCount` around line 454), add:

```swift
/// Count shown on the iOS home-screen badge and the macOS dock badge.
/// Overdue + due today + due this week, excluding Next Week, completed,
/// archived, and items without a due date. Mirrors desktop's
/// `activeThingsForCount.length` derivation in `apps/desktop/src/App.tsx`.
static func badgeCount(items: [Item]) -> Int {
    let s = bucket(items: items, reflowKey: 0)
    return s.overdue.count + s.today.count + s.thisWeek.count
}
```

- [ ] **Step 4: Run tests to verify they pass**

Re-run the BrettTests suite.
Expected: All 9 `TodaySectionsBadgeTests` cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Views/Today/TodayPage.swift apps/ios/BrettTests/Views/TodaySectionsBadgeTests.swift
git commit -m "feat(ios): add TodaySections.badgeCount helper + tests"
```

---

## Task 4: iOS — create `BadgeManager`

**Files:**
- Create: `apps/ios/Brett/Services/BadgeManager.swift`

This wraps `UNUserNotificationCenter` so the rest of the app never touches the system notification API directly.

- [ ] **Step 1: Confirm the Services directory exists**

Run: `ls apps/ios/Brett/Services 2>/dev/null || echo missing`
If `missing`, create it: `mkdir -p apps/ios/Brett/Services`

Whether you created it or not, the new file is added to Xcode's `Brett` target — either via the Xcode sidebar (drag the new file into the `Brett` group, make sure "Add to targets: Brett" is checked) or by editing `apps/ios/Brett.xcodeproj/project.pbxproj` if the project uses synthesized file references. Follow the pattern used by other recent files under `apps/ios/Brett/` — check `git log` on a recent iOS addition to see which approach the author used.

- [ ] **Step 2: Write the manager**

Create `apps/ios/Brett/Services/BadgeManager.swift`:

```swift
import Foundation
import SwiftUI
import UserNotifications

/// Centralises writes to the iOS home-screen badge.
///
/// Count semantics: overdue + due today + this week (see
/// `TodaySections.badgeCount`). The actual value is pushed by
/// `MainContainer` whenever the live item set changes or the scene
/// becomes active.
///
/// TODO(push): While the app is backgrounded we can't re-compute the
/// badge — SwiftData observers are asleep and we have no background
/// refresh path. The count therefore goes stale until the user opens
/// the app or it becomes `.active`. Closing the loop requires an APNs
/// silent push that carries the new badge value in its payload. See
/// `docs/superpowers/specs/2026-04-24-today-count-badge-design.md`
/// ("Background staleness") — do this when real notifications ship.
@MainActor
@Observable
final class BadgeManager {
    static let shared = BadgeManager()

    private var didRequestAuthorization = false

    private init() {}

    /// Ask once for `.badge` authorization. Idempotent — subsequent calls
    /// are no-ops so we don't re-prompt on every sign-in. The prompt
    /// itself is fine to share with real notifications later; iOS merges
    /// authorization across option sets.
    func requestAuthorization() async {
        guard !didRequestAuthorization else { return }
        didRequestAuthorization = true
        do {
            _ = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.badge])
        } catch {
            // Best-effort; badge is cosmetic.
        }
    }

    /// Recompute the badge from the current item set and push it to
    /// iOS. Safe to call on every SwiftData change — the underlying
    /// `setBadgeCount` is cheap and idempotent.
    func refresh(items: [Item]) async {
        let count = TodaySections.badgeCount(items: items)
        try? await UNUserNotificationCenter.current().setBadgeCount(count)
    }

    /// Clear the badge — called on sign-out.
    func clear() async {
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
}
```

- [ ] **Step 3: Build to verify the file compiles**

Build the `Brett` target (⌘B in Xcode with the `Brett` scheme).
Expected: no errors. If Xcode reports "Cannot find type 'Item' in scope", the file isn't in the `Brett` target — fix the target membership.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Brett/Services/BadgeManager.swift apps/ios/Brett.xcodeproj/project.pbxproj
git commit -m "feat(ios): add BadgeManager for app icon badging"
```

(If the project doesn't use a `.pbxproj`-synchronised file list, just `git add` the new `.swift` file.)

---

## Task 5: iOS — wire the manager into the app lifecycle

**Files:**
- Modify: `apps/ios/Brett/Views/MainContainer.swift`
- Modify: `apps/ios/Brett/BrettApp.swift`

- [ ] **Step 1: Add the `@Query` + refresh hooks in `MainContainer`**

Open `apps/ios/Brett/Views/MainContainer.swift`. Near the top of `MainContainer` (alongside `@Query private var syncHealthRows: [SyncHealth]`, around line 65), add:

```swift
@Query(
    filter: #Predicate<Item> { $0.deletedAt == nil },
    sort: \Item.createdAt,
    order: .reverse
) private var allItems: [Item]

@Environment(\.scenePhase) private var scenePhase
```

If `scenePhase` is already in scope on `MainContainer` (check the existing file first), skip adding it again.

- [ ] **Step 2: Attach the refresh effects**

In the same file, in the `var body: some View { NavigationStack(path: $path) { ... } }` block, attach two new modifiers at the same level as the other `.onChange(...)` handlers (e.g. next to `.onChange(of: hasCompletedInitialSync)`):

```swift
.onChange(of: allItems) { _, items in
    Task { await BadgeManager.shared.refresh(items: items) }
}
.onChange(of: scenePhase) { _, phase in
    if phase == .active {
        Task { await BadgeManager.shared.refresh(items: allItems) }
    }
}
.task {
    // Cold-launch refresh — `onChange(of: allItems)` doesn't fire
    // for the initial value, so seed once here.
    await BadgeManager.shared.refresh(items: allItems)
}
```

Note: if `MainContainer` already has a `.task { ... }` modifier at the top level, merge the badge refresh into it rather than adding a second one.

- [ ] **Step 3: Request authorization on sign-in, clear on sign-out**

Open `apps/ios/Brett/BrettApp.swift`. Find the `.onChange(of: authManager.isAuthenticated)` block inside `RootView` (around line 147). Extend each branch:

```swift
.onChange(of: authManager.isAuthenticated) { _, isAuth in
    if Self.isUITest { return }
    if isAuth {
        SyncManager.shared.start()
        startSSE()
        lockManager.handleFreshSignIn()
        Task { await BadgeManager.shared.requestAuthorization() }
    } else {
        SyncManager.shared.stop()
        stopSSE()
        lockManager.handleSignOut()
        Task { await BadgeManager.shared.clear() }
    }
}
```

Also add the authorization request for the "already signed in at launch" path. In the same file, inside the `.task { ... }` that follows the `if lockManager.isLocked { ... } else { MainContainer() ... }` block (around line 130), add one line:

```swift
.task {
    if !Self.isUITest {
        SyncManager.shared.start()
        startSSE()
        await BadgeManager.shared.requestAuthorization()
    }
}
```

- [ ] **Step 4: Build**

Build the `Brett` target (⌘B).
Expected: no errors. If `BadgeManager` is unresolved, confirm target membership from Task 4 Step 1.

- [ ] **Step 5: Manually verify on a real device**

The iOS Simulator does not render home-screen badges reliably; use a physical device. Sign in, grant the notifications prompt when it appears, press home/swipe up, and confirm the Brett app icon shows the Today count. Create or complete a task in the app → the badge updates. Sign out → the badge clears.

If the prompt never appears, check Settings → Notifications → Brett — if authorization is already allowed (e.g. from a prior dev build), the prompt is suppressed; the badge should still work.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Brett/Views/MainContainer.swift apps/ios/Brett/BrettApp.swift
git commit -m "feat(ios): badge app icon with Today count"
```

---

## Task 6: Cross-check and final typecheck

- [ ] **Step 1: Run the full TypeScript typecheck**

Run: `pnpm typecheck`
Expected: PASS across all workspace packages.

- [ ] **Step 2: Run the API test suite**

Run: `pnpm test`
Expected: PASS (no API changes were made, but confirm nothing regressed).

- [ ] **Step 3: Run the iOS unit tests**

Either ⌘U in Xcode with the `BrettTests` scheme, or your project's standard `xcodebuild test` invocation.
Expected: all tests pass, including the new `TodaySectionsBadgeTests`.

- [ ] **Step 4: Final desktop sanity check**

Start the desktop app one more time (`pnpm dev:desktop`). Sign in, verify the dock badge matches what the sidebar shows for Today, and that it follows mutations in real time (add a task due today, complete a task, change a due date into/out of the window).

- [ ] **Step 5: Final iOS sanity check**

On a physical device, repeat the Today → completion flow and verify the home-screen badge follows. Background the app, make a change on desktop, foreground the app — the badge should snap to the new value on `.active` (this is the expected foreground-only behavior; full background fidelity is parked behind the APNs work per the spec).

No commit here — verification only.

---

## Self-Review

**Spec coverage (from [2026-04-24-today-count-badge-design.md](../specs/2026-04-24-today-count-badge-design.md)):**

- ✅ Count definition (overdue + today + this-week) — Task 3 (Swift), Task 2 (reuses desktop's existing `activeThingsForCount`).
- ✅ Desktop IPC via `app.setBadgeCount` — Task 1.
- ✅ Renderer useEffect tied to count + sign-out clears to 0 — Task 2.
- ✅ iOS `.badge` authorization — Task 5 Step 3.
- ✅ iOS `BadgeManager` singleton with `requestAuthorization`/`refresh`/`clear` — Task 4.
- ✅ MainContainer `@Query` + `onChange(allItems)` + `onChange(scenePhase)` — Task 5 Steps 1-2.
- ✅ Sign-out clears the iOS badge — Task 5 Step 3.
- ✅ `TodaySections.badgeCount` shared helper — Task 3 Step 3.
- ✅ Unit tests for the helper (empty, overdue, today, this-week, next-week-excluded, completed-excluded, archived-excluded, no-due-date, combined) — Task 3 Step 1.
- ✅ TODO pointing at the design doc for the background-staleness follow-up — Task 4 Step 2 (inside `BadgeManager.swift`).

**Placeholder scan:** No TBDs, no "TODO: implement X" in the plan body. Every code step has the actual code. The one `TODO(push):` in `BadgeManager.swift` is intentional — it's a forward reference for the APNs work and points at the spec.

**Type/name consistency:** `setBadgeCount` (IPC + preload + electronAPI), `badgeCount` (Swift static), `BadgeManager.shared.refresh(items:)`/`clear()`/`requestAuthorization()` — consistent across Tasks 1-5.
