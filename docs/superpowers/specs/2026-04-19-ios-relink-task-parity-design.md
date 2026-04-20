# iOS Relink Task Parity — Design

**Date:** 2026-04-19
**Status:** Approved for implementation

## Problem

When an external integration breaks (token revoked, API key invalid, sync fails), the API creates a "re-link" task via `createRelinkTask()` in `apps/api/src/lib/connection-health.ts`. Desktop renders these tasks with a distinctive gold "Reconnect" pill that launches the re-auth flow. On iOS, the same tasks sync down but render as plain task rows with no reconnect affordance — users see "Re-link Google Calendar" as an ordinary checkbox task and must guess to open Settings.

This breaks the project's **iOS ↔ Desktop visual parity** rule and leaves iOS users without a clear recovery path.

## Goals

- iOS task rows detect relink tasks and render a "Reconnect" pill matching desktop's gold pill treatment.
- Tap → deep-link into the matching iOS Settings screen where the user can reconnect.
- Full coverage for all three connection types the API produces: `google-calendar`, `granola`, `ai`.
- Build out the missing **Granola settings section** on iOS so the granola reconnect path lands somewhere real.

## Non-Goals

- In-app OAuth from the task itself (i.e. tapping "Reconnect" does **not** launch `ASWebAuthenticationSession` directly — it deep-links to Settings, matching the native iOS idiom and avoiding duplication of desktop's polling/invalidation logic).
- New relink types beyond the three the API currently produces.
- Re-architecting the existing `SettingsTab` / `deepLinkTab` plumbing.

## Design

### 1. Relink detection helper

New file `apps/ios/Brett/Sync/RelinkTask.swift`. Mirrors desktop's `parseConnectionType` in [connection-health.ts:19-25](apps/desktop/src/api/connection-health.ts:19).

```swift
enum RelinkType: String {
    case googleCalendar = "google-calendar"
    case granola
    case ai

    var settingsTab: SettingsTab {
        switch self {
        case .googleCalendar, .granola: return .calendar
        case .ai: return .aiProviders
        }
    }
}

struct RelinkTask {
    let type: RelinkType

    /// Parses a sourceId of the form `relink:<type>:<accountId>`.
    /// Returns nil if the item is not a relink task.
    static func parse(source: String?, sourceId: String?) -> RelinkTask? {
        guard source == "system", let sid = sourceId, sid.hasPrefix("relink:") else { return nil }
        let parts = sid.split(separator: ":", maxSplits: 2)
        guard parts.count >= 2, let type = RelinkType(rawValue: String(parts[1])) else { return nil }
        return RelinkTask(type: type)
    }
}
```

Granola deep-links to `.calendar` because Granola lives as a section inside `CalendarSettingsView` on iOS (matching desktop, where it sits inside the calendar settings section — see [CalendarSection.tsx:239](apps/desktop/src/settings/CalendarSection.tsx:239)).

### 2. TaskRow reconnect pill

In `apps/ios/Brett/Views/Shared/TaskRow.swift`, the trailing HStack (before the due-date chip) conditionally renders a pill when `RelinkTask.parse(source: item.source, sourceId: item.sourceId) != nil` and the item is active:

- Background: `BrettColors.gold.opacity(0.15)`
- Foreground: `BrettColors.gold`
- Icon: `arrow.triangle.2.circlepath` (SF Symbol; nearest match to desktop's lucide `RefreshCw`)
- Label: "Reconnect"
- Corner radius: matches existing pill chips in the app
- Tap: calls a new closure `onReconnect: (RelinkType) -> Void` passed via init (default `{ _ in }`)

The pill is wrapped in a `Button` with `.buttonStyle(.plain)` and uses `.contentShape(Rectangle())` + `.highPriorityGesture` so tapping it doesn't toggle the checkbox or open the task detail sheet.

### 3. Reconnect routing

A new small router object `RelinkRouter` owns the navigation side-effect:

```swift
@Observable
final class RelinkRouter {
    var pendingTab: SettingsTab?

    func reconnect(_ type: RelinkType, navigationPath: inout NavigationPath) {
        pendingTab = type.settingsTab
        navigationPath.append(NavDestination.settings)
    }
}
```

`RelinkRouter` is injected at the app root (`BrettApp.swift`) via `.environment(...)` so all list views can reach it.

`TodayPage`, `InboxPage`, `ListView`, and `UpcomingView` — every surface that renders `TaskRow` — wire `onReconnect` to call `router.reconnect(type, navigationPath: &path)`. The project's **list behavior consistency** rule requires this to land on all four simultaneously.

### 4. SettingsView deep-link consumption

`SettingsView` already declares `@AppStorage("settings.deeplink.tab")` but the value is dead. We replace it with the `RelinkRouter`'s `pendingTab`:

```swift
.onAppear {
    if let tab = relinkRouter.pendingTab {
        navigationPath.append(tab)
        relinkRouter.pendingTab = nil
    }
}
```

(`SettingsView` already defines `.navigationDestination(for: SettingsTab.self)` — the infrastructure is in place; we only need to trigger the append.)

The existing `@AppStorage("settings.deeplink.tab")` line is removed — it was never wired and the `RelinkRouter` supersedes it cleanly.

### 5. Granola Settings (new)

#### 5a. API layer

New file `apps/ios/Brett/Networking/Endpoints/GranolaEndpoints.swift` with four endpoints matching the API:

- `GET /granola/auth` → `GranolaAccountStatus { connected: Bool, account: GranolaAccount? }`
- `POST /granola/auth/connect` → `{ url: String }` (OAuth URL to open)
- `POST /granola/auth/disconnect` → `{}`
- `PATCH /granola/preferences` → accepts `{ autoCreateMyTasks?, autoCreateFollowUps? }`

New file `apps/ios/Brett/Stores/GranolaAccountStore.swift` — `@Observable` store with `load()`, `connect()`, `disconnect()`, `updatePreferences(...)`. Invalidates via `refresh()` after mutations (no long-poll; the user returning to the app from Safari re-runs `load()` via `.onAppear`/scene phase).

#### 5b. OAuth flow

Reuses the existing `ASWebAuthenticationSession` pattern from [GoogleSignInProvider.swift](apps/ios/Brett/Auth/GoogleSignInProvider.swift) and `CalendarSettingsView`:

1. Call `POST /granola/auth/connect` → receive OAuth URL
2. Open in `ASWebAuthenticationSession` with callback URL scheme `brett://granola-callback`
3. On successful return, call `load()` to refresh connected status
4. Resolved relink tasks auto-complete server-side via `resolveRelinkTask()` and sync down on next pull

#### 5c. UI section

A new "Meeting Notes" section added to `CalendarSettingsView` using the same `BrettSettingsSection` primitive. Mirrors desktop's [CalendarSection.tsx:239-353](apps/desktop/src/settings/CalendarSection.tsx:239) structure:

- **Disconnected state:** descriptive text + gold "Connect Granola" button
- **Connected state:**
  - Account row: amber status dot, email, "Synced <date>" timestamp, disconnect button (with two-step confirm)
  - Preference toggles:
    - "Auto-create my tasks" (`autoCreateMyTasks`)
    - "Auto-create follow-ups" (`autoCreateFollowUps`)

Typography, spacing, toggle style — all use existing `BrettSettings*` primitives. No new design primitives introduced.

### 6. Reconnect affordance in existing Settings screens

Audit + small additions, NOT a redesign:

- **`CalendarSettingsView`** — likely already shows broken accounts; verify there's a visible reconnect/re-auth affordance per account. If the only affordance is disconnect-then-reconnect, add a "Reconnect" button on broken accounts that directly re-runs the OAuth flow.
- **`AIProviderSettingsView`** — broken AI keys should be visually flagged (e.g. amber dot + "Re-enter key" call-out on the affected provider row). Users re-enter the API key in-place; there's no OAuth to re-run.

Scope-limit: only add what's missing to close the loop from a relink task. Don't refactor surrounding UI.

## Data Flow

```
API detects broken integration
  → createRelinkTask(userId, type, accountId, reason)
  → Item with source="system", sourceId="relink:<type>:<accountId>"

iOS sync pull
  → SwiftData Item created (no special handling — existing mapper works unchanged)

TaskRow renders
  → RelinkTask.parse(source, sourceId) → RelinkTask?
  → If present + active: show gold "Reconnect" pill

User taps pill
  → RelinkRouter.reconnect(type, navigationPath:)
  → NavDestination.settings pushed, pendingTab set

SettingsView.onAppear
  → appends pendingTab to internal nav path
  → Calendar or AIProviders screen pushed

User reconnects inside that screen (existing or new flow)
  → API resolveRelinkTask() auto-completes the task
  → iOS sync pull → task disappears from Today
```

## Testing

### Unit

- `RelinkTaskTests.swift` — covers valid sourceIds (each of 3 types), invalid (wrong source, missing prefix, unknown type, malformed), nil inputs.
- `GranolaAccountStoreTests.swift` — mocked endpoint responses for load/connect/disconnect/updatePreferences.

### Integration / UI

- Snapshot or behavioural test: `TaskRow` renders the reconnect pill for a relink item and does not for a normal item.
- Navigation test: tapping the pill sets `RelinkRouter.pendingTab` to the expected `SettingsTab`.

### Manual verification

1. Dev: break a Google Calendar token (set to "invalid" in DB) → trigger a sync → observe relink task appear on iOS Today with gold pill.
2. Tap pill → land on Calendar Settings.
3. Reconnect the account → task auto-completes on next sync pull.
4. Repeat for Granola (disconnect → observe relink task → tap → Calendar Settings → Meeting Notes section → Connect).
5. Repeat for AI (invalidate a provider key in DB → observe relink task → tap → AI Providers screen).

## Files Changed

**New:**
- `apps/ios/Brett/Sync/RelinkTask.swift`
- `apps/ios/Brett/Routing/RelinkRouter.swift`
- `apps/ios/Brett/Networking/Endpoints/GranolaEndpoints.swift`
- `apps/ios/Brett/Stores/GranolaAccountStore.swift`
- `apps/ios/BrettTests/Sync/RelinkTaskTests.swift`
- `apps/ios/BrettTests/Stores/GranolaAccountStoreTests.swift`

**Modified:**
- `apps/ios/Brett/Views/Shared/TaskRow.swift` — pill rendering + onReconnect closure
- `apps/ios/Brett/Views/Today/TodayPage.swift` — wire onReconnect
- `apps/ios/Brett/Views/Inbox/InboxPage.swift` — wire onReconnect
- `apps/ios/Brett/Views/Lists/ListView.swift` — wire onReconnect
- `apps/ios/Brett/Views/Upcoming/UpcomingView.swift` — wire onReconnect (if applicable)
- `apps/ios/Brett/Views/Settings/SettingsView.swift` — replace dead `deepLinkTab` with `RelinkRouter` consumption
- `apps/ios/Brett/Views/Settings/CalendarSettingsView.swift` — add Meeting Notes section; ensure per-account reconnect affordance on broken accounts
- `apps/ios/Brett/Views/Settings/AIProviderSettingsView.swift` — flag broken providers with re-enter-key affordance
- `apps/ios/Brett/BrettApp.swift` — inject `RelinkRouter` into environment

## Open Questions

None at spec time. (Any discovery of an unexpected gap in `CalendarSettingsView` or `AIProviderSettingsView` during implementation — e.g. the reconnect affordance is more complex than anticipated — triggers a pause to discuss, not silent scope expansion.)

## Estimated Effort

~6–8 hours:
- Relink detection + router + TaskRow pill + four list wirings: ~2h
- SettingsView deep-link plumbing: ~30m
- Granola endpoints + store + tests: ~1.5h
- Granola Settings UI section: ~1.5h
- Reconnect affordance audits in Calendar + AI Providers: ~1h
- Manual verification + cleanup: ~1h
