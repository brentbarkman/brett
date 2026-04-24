# Today Count Badge — Desktop Dock + iOS App Icon

**Date:** 2026-04-24
**Status:** Design approved; implementation plan pending.

## Problem

Neither client surfaces the Today count outside the app. On desktop, the count
sits in the sidebar but the macOS dock icon is a plain "B". On iOS, the app
icon never badges. Users have to open the app to know whether anything is due.

## Goal

Badge the desktop dock icon (macOS) and the iOS app icon with the count of
outstanding items for the Today view.

## Count definition

**`overdue + due today + due this week`**, excluding Next Week and completed
items. Matches the existing in-app sidebar badge on desktop.

- Desktop: `activeThingsForCount.length` from `apps/desktop/src/App.tsx`
  (active items whose `dueDate ≤ endOfWeekUTC`) is already exactly this number
  — reuse it.
- iOS: a new `TodaySections.badgeCount` computed property returns
  `overdue.count + today.count + thisWeek.count`. Keeps the bucket math in one
  place, so desktop and iOS agree on what "Today" means.

## Desktop — macOS dock badge

Electron exposes `app.setBadgeCount(n)` which sets the macOS dock badge (and
the Linux Unity launcher, and is a no-op on Windows). Setting 0 clears it.

**IPC surface:**

- `electron/preload.ts` exposes `electronAPI.setBadgeCount(n: number)`.
- `electron/main.ts` adds `ipcMain.handle("set-badge-count", (_e, n) =>
  app.setBadgeCount(Math.max(0, n | 0)))`. Clamp to a non-negative integer at
  the boundary — the renderer is trusted but defence in depth is cheap.
- `src/types/electron.d.ts` (or wherever `ElectronAPI` is declared) gains the
  new method on the interface.

**Renderer wiring** in `apps/desktop/src/App.tsx`:

- `useEffect` tied to `activeThingsForCount.length` calls
  `window.electronAPI?.setBadgeCount?.(count)`.
- `useEffect` also fires on auth transitions. On sign-out the count should go
  to 0 so the dock doesn't keep a stale number for the previous user. Easiest
  hook: the `signOut()` path in `AuthContext`.

No main-process state — the renderer pushes; the main process just forwards
to `app.setBadgeCount`. Renderer never sleeps in Electron, so the badge stays
fresh as long as the app is running.

## iOS — app icon badge

**Authorization:** request `.badge` via
`UNUserNotificationCenter.current().requestAuthorization(options: [.badge])`
on first authenticated launch. The user sees the standard notifications
permission prompt. That's acceptable — real notifications (APNs via FCM) are
planned and will share the same authorization. If the user denies, the badge
silently fails; everything else keeps working.

**New file** `apps/ios/Brett/Services/BadgeManager.swift`:

```swift
@Observable
final class BadgeManager {
    static let shared = BadgeManager()

    func requestAuthorization() async { /* .badge only */ }
    func refresh(items: [Item]) async {
        let count = TodaySections.badgeCount(items: items)
        try? await UNUserNotificationCenter.current().setBadgeCount(count)
    }
    func clear() async {
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
}
```

**Hook points:**

- `MainContainer.swift` gains a lightweight `@Query` over non-deleted items
  and an `.onChange(of: allItems)` that calls `BadgeManager.shared.refresh`.
  MainContainer is mounted for the full authenticated session, so the badge
  tracks mutations anywhere in the app — not only while TodayPage is visible.
- `.onChange(of: scenePhase)` in the same view refreshes on `.active`, so the
  badge settles after a sync pull when the user resumes the app.
- `BrettApp.swift` calls `BadgeManager.shared.requestAuthorization()` once on
  first sign-in and `BadgeManager.shared.clear()` on sign-out.

**Shared bucket logic:** `TodaySections` in
`apps/ios/Brett/Views/Today/TodayPage.swift` gains:

```swift
static func badgeCount(items: [Item]) -> Int {
    let s = bucket(items: items, reflowKey: 0)
    return s.overdue.count + s.today.count + s.thisWeek.count
}
```

Pays the full-bucket cost, which is fine — the data set is small (user's own
tasks) and the work already happens every time TodayPage renders. Future
optimisation if it ever shows up in a profile, not before.

## Background staleness

**Known limitation:** while the iOS app is backgrounded, the badge cannot
update — the view hierarchy isn't running and we have no background-refresh
path. If the user dismisses a task from the desktop while their phone is in
their pocket, the phone's badge will stay wrong until they open the app or it
becomes `.active` again.

This is deliberately out of scope for v1. The fix is a server-driven APNs
silent push that carries the new badge count in its payload — exactly what
we'll wire up when we add real notifications (FCM/APNs is already a planned
piece of infrastructure per the project notes).

Leave a `TODO` comment in `BadgeManager.swift` pointing at this doc so
whoever adds push notifications next knows to close the loop.

## Testing

- Unit test `TodaySections.badgeCount(items:)` with the existing
  TodaySections test fixtures (or add one if none exists yet). Cases: empty,
  only overdue, only today, mixed overdue/today/thisWeek, items in nextWeek
  are excluded, completed items are excluded, archived items are excluded.
- Desktop: manual verification on a physical Mac — the dock icon takes the
  badge.
- iOS: manual verification on a physical device (simulator doesn't show
  home-screen badges the same way). Verify the badge clears on sign-out.

## Out of scope

- APNs/FCM push for background badge updates (covered above).
- Windows taskbar badging (`app.setBadgeCount` no-ops there; not a product
  requirement).
- Showing a badge on the **iOS** Today tab icon — the in-app tab already
  renders its own section counts.
- Per-view badging (Inbox, Upcoming) on the dock/app icon. Today is the one
  number that represents "what needs attention now"; adding more would dilute
  the signal.
