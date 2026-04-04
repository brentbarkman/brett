# Connection Health UX — Design Spec

**Date:** 2026-04-04
**Status:** Draft

## Problem

When an integration breaks (Granola token revoked, Google Calendar auth expired, AI key invalid), the connection health system creates a re-link task in Today. But the task is a dead end — it tells you something is broken but doesn't help you fix it. You have to manually navigate to Settings, figure out which tab, and reconnect.

## Goals

1. **Fix from the task** — re-link tasks get a "Reconnect" button that triggers the same OAuth flow as the initial connect, right from the task card
2. **Badge on Settings** — a dot indicator on the settings button in the left nav when broken connections exist, so you know something needs attention even if you dismiss the task
3. **Badge on Settings tab** — when you open Settings, the relevant tab (Calendar, AI Providers) shows a dot so you're guided to the right place

## Design

### 1. Reconnect Action on Re-link Tasks

**Data change:** Add `sourceId` to the `Thing` view model for system re-link items (currently only exposed for scout items). The `sourceId` format `relink:<type>:<accountId>` lets the frontend determine the connection type.

**`Thing` type** (`packages/types/src/index.ts`): Add optional `sourceId?: string` field.

**`itemToThing`** (`packages/business/src/index.ts`): Include `sourceId` when `source === "system"` and `sourceId` starts with `"relink:"`.

**Frontend — reconnect hook** (`apps/desktop/src/api/connection-health.ts`): New hook `useReconnect(sourceId: string)` that:
- Parses the connection type from `sourceId` (e.g., `relink:granola:abc` → `"granola"`)
- For `granola`: calls the same mutation as `useConnectGranola` (POST `/granola/auth/connect`, open browser, poll)
- For `google-calendar`: calls the same mutation as `useConnectCalendar` (POST `/calendar/accounts/connect`, open browser, poll)
- For `ai`: navigates to `/settings#ai-providers` (needs a form, can't do inline)
- Returns `{ reconnect, isPending, type }` where `type` determines button label

**UI — task components:** Both `InboxItemRow` and `ThingCard` check for `thing.sourceId?.startsWith("relink:")`. When true, render a "Reconnect" button (or "Fix in Settings" for AI). Style: small pill button, gold accent, appears alongside existing controls.

**Auto-completion:** The existing `resolveRelinkTask` on the backend already auto-completes re-link tasks when OAuth succeeds. No change needed — the task will disappear from Today after successful reconnect.

### 2. Settings Badge in Left Nav

**API endpoint** (`apps/api/src/routes/things.ts`): New `GET /things/broken-connections` that returns `{ count: number; types: string[] }` — count of active re-link tasks and which connection types are broken. Lightweight query on `item` table where `source = "system"` and `sourceId LIKE "relink:%"` and `status IN ("active", "snoozed")`.

**Frontend hook** (`apps/desktop/src/api/connection-health.ts`): `useBrokenConnections()` query hook. Polls on a long interval (60s) since connection state changes infrequently. Also invalidated when items are refetched.

**LeftNav** (`packages/ui/src/LeftNav.tsx`): New prop `hasBrokenConnections?: boolean`. When true, render a small amber dot on the settings button (top-right corner of the avatar, similar to notification indicators). Works in both collapsed and expanded states.

**App.tsx**: Pass `hasBrokenConnections` from the `useBrokenConnections` hook to `LeftNav`.

### 3. Tab Badge in Settings

**SettingsLayout** (`apps/desktop/src/settings/SettingsLayout.tsx`): Consume the same `useBrokenConnections()` hook. The `types` array tells us which tabs need dots:
- `types` includes `"google-calendar"` or `"granola"` → dot on "Calendar" tab
- `types` includes `"ai"` → dot on "AI Providers" tab

**Tab dot style:** Small amber circle (6px) positioned to the right of the tab label text, vertically centered. Consistent with the LeftNav badge color.

## Files to Modify

| File | Change |
|------|--------|
| `packages/types/src/index.ts` | Add `sourceId?: string` to `Thing` |
| `packages/business/src/index.ts` | Include `sourceId` in `itemToThing` for relink items |
| `apps/api/src/routes/things.ts` | Add `GET /things/broken-connections` endpoint |
| `apps/desktop/src/api/connection-health.ts` | New file: `useBrokenConnections()` + `useReconnect()` hooks |
| `packages/ui/src/LeftNav.tsx` | Add `hasBrokenConnections` prop + amber dot on settings button |
| `packages/ui/src/InboxItemRow.tsx` | Reconnect button for relink tasks |
| `packages/ui/src/ThingCard.tsx` | Reconnect button for relink tasks |
| `apps/desktop/src/settings/SettingsLayout.tsx` | Tab badge dots from broken connection types |
| `apps/desktop/src/App.tsx` | Wire `useBrokenConnections` → `LeftNav` prop |

## Out of Scope

- Inline reconnect for AI Provider (needs a form — navigates to settings instead)
- Push/SSE for real-time connection status (polling is fine for this frequency)
- Broken connection banner or toast (the task + badges are sufficient)
