# Multi-Granola Account Support

**Date:** 2026-05-16
**Status:** Design — approved sections 1-6
**Scope:** API + desktop + iOS, single coordinated release

## Problem

Today, a Brett user can connect exactly one Granola account. The DB schema enforces it (`GranolaAccount.userId @unique`), the OAuth callback upserts on `userId`, every sync entry point does `findUnique({ where: { userId } })`, and the settings UI on desktop + iOS renders a single account.

Users with both personal and work Granola accounts can only see meeting notes from one of them. That's the gap we're closing.

## Non-goals

- Sharing Granola accounts across Brett users (team/EA use cases).
- Per-account preferences that diverge from the per-account model already in the schema — auto-create toggles remain on `GranolaAccount`, not centralized on `User`.
- A reconnect-this-specific-account API. We rely on Google's OAuth identity (email) to route re-auth to the correct row.
- Per-account manual sync endpoint. YAGNI until a user complains one account is stuck.

## Database

One change to the schema:

```prisma
model GranolaAccount {
  id              String @id @default(uuid())
- userId          String @unique  // one Granola account per user
+ userId          String           // multiple Granola accounts per user
  user            User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  email           String
  // ... unchanged ...
+ @@unique([userId, email])
  @@index([userId])
}
```

Drop `@unique` on `userId`; add `@@unique([userId, email])` to prevent the same Google identity being added twice to one Brett user. Mirrors `GoogleAccount @@unique([userId, googleUserId])`.

Unchanged:
- `MeetingNote.granolaDocumentId @unique` — Granola issues globally unique document IDs.
- `MeetingNote @@unique([userId, calendarEventId])` — collisions resolved via the existing `MeetingNoteSource` merge layer (see Sync section).
- `MeetingNote.granolaAccountId` — already nullable + `SetNull` on delete.

**Migration:** single `ALTER TABLE` to drop the old unique index and create the new composite one. Non-destructive, no data movement, no two-phase deploy needed.

## API surface (breaking)

Per discussion, we ship a breaking shape change to `GET /granola/auth` rather than versioning the endpoint. Older clients that haven't autoupdated will see the response as "not connected" and render the Connect button. Clicking Connect on a stale client goes through the new OAuth path and works correctly. Not graceful, but not destructive.

### Routes

| Method | Path | Body / Params | Returns |
|---|---|---|---|
| `GET` | `/granola/auth` | — | `{ connected: bool, accounts: GranolaAccountRecord[] }` |
| `POST` | `/granola/auth/connect` | — | `{ url }` (OAuth start; always adds a new account) |
| `GET` | `/granola/auth/callback` | OAuth params | HTML response (closes tab on success) |
| `DELETE` | `/granola/auth/:accountId` | accountId in path | `{ ok: true }` |
| `PATCH` | `/granola/auth/:accountId/preferences` | `{ autoCreateMyTasks?, autoCreateFollowUps? }` | `{ account: GranolaAccountRecord }` |
| `POST` | `/granola/auth/sync` | — | `{ ok: true, meetingsSynced: number }` — runs across all accounts |
| `GET` | `/granola/auth/meetings/by-event/:eventId` | unchanged | unchanged |
| `POST` | `/granola/auth/meetings/:meetingId/reprocess` | unchanged | unchanged |

### Ownership check on every `:accountId` route

```ts
const account = await prisma.granolaAccount.findFirst({
  where: { id: accountId, userId: user.id },
});
if (!account) return c.json({ error: "Not found" }, 404);
```

Mirrors [calendar-accounts.ts:226](apps/api/src/routes/calendar-accounts.ts:226). Without this, any authed user could disconnect another user's account by ID.

### OAuth callback change

Today the callback does `prisma.granolaAccount.upsert({ where: { userId }, ... })`. After:

```ts
const granolaAccount = await prisma.granolaAccount.upsert({
  where: { userId_email: { userId, email } },
  create: { id: generateId(), userId, email, ...tokens },
  update: { ...tokens },
});
```

Routing logic:
- **Re-auth same account** (same email): updates tokens on existing row.
- **Adding a second account** (different email): creates a new row.

This makes the "Reconnect" button continue to work without the API needing to know which row to target — Google's OAuth identity does the routing.

PKCE state remains keyed `pkce:granola:<userId>` — one in-flight connect per user is fine.

## Sync engine

Three entry points in [granola-sync.ts](apps/api/src/services/granola-sync.ts), all keyed on `userId`, all currently doing `findUnique`. Refactor to `findMany` + per-account iteration, with the per-account body extracted into a private helper:

```ts
async function syncOneAccount(
  account: GranolaAccount,
  userId: string,
  opts: { mode: "initial" | "incremental" | "post-meeting"; windowStart?: Date; windowEnd?: Date },
): Promise<{ syncedCount: number }> {
  // existing per-account logic from initialGranolaSync / incrementalGranolaSync / syncAfterMeeting
}

export async function initialGranolaSync(userId: string): Promise<void> {
  const accounts = await prisma.granolaAccount.findMany({ where: { userId } });
  for (const account of accounts) {
    try {
      await syncOneAccount(account, userId, { mode: "initial" });
    } catch (err) {
      // log + create re-link task scoped to this specific accountId
    }
  }
}
```

Failure isolation: `try/catch` per account. A token-refresh failure on account A creates a re-link task for account A only; account B continues syncing.

**[granola-provider.ts](apps/api/src/services/meeting-providers/granola-provider.ts):**
- `isAvailable(userId)` — returns true if at least one account exists (semantically unchanged).
- `fetchForEvent(userId, event)` — iterate all accounts, build combined candidate set, run existing matcher across the union. Best match wins.
- `fetchRecent(userId, since, until)` — iterate, concatenate.

**[granola-action-items.ts:221](apps/api/src/services/granola-action-items.ts:221)** — currently `findUnique({ where: { userId } })`. The function has `meetingNote.granolaAccountId` in scope already; use that directly. Removes a query and removes a multi-account ambiguity.

**[cron.ts](apps/api/src/jobs/cron.ts)** — unchanged. Both cron jobs already do `findMany({ select: { userId: true } })` and dedupe via `Set` ([cron.ts:136-145](apps/api/src/jobs/cron.ts:136), [cron.ts:172-180](apps/api/src/jobs/cron.ts:172)). With multi-account, the dedupe still yields one user per loop iteration, and the per-user sync function handles fanout internally. This is the payoff for keeping the public sync API user-scoped.

**[granola-mcp.ts](apps/api/src/lib/granola-mcp.ts)** — unchanged. Already account-keyed (`getGranolaClient(granolaAccountId)`), token refresh lock already per-account.

## Collision handling

When two of a user's Granola accounts both have data for the same calendar event, `MeetingNote @@unique([userId, calendarEventId])` would block the second insert. Solved using the existing `MeetingNoteSource` merge layer (added in the Phase 1 cross-provider migration):

```
For each granola meeting being synced for account A:
  1. Match against the user's calendar events (existing logic).
  2. If matched:
       Look up existing MeetingNote for (userId, calendarEventId).
       If exists:
         - Upsert MeetingNoteSource(meetingNoteId, provider="granola", externalId=docId, granolaAccountId=A).
         - Backfill transcript/summary/attendees on the existing MeetingNote only if those fields are currently null.
         - Skip MeetingNote.create.
       If not exists:
         - Create MeetingNote (existing logic).
         - Also create the corresponding MeetingNoteSource row.
  3. If no calendar event match:
       Create MeetingNote with calendarEventId=null. The unique constraint doesn't apply to nulls in Postgres, so two accounts' unmatched meetings coexist as separate notes.
```

Action item extraction (`granola-action-items.ts`) runs once per MeetingNote regardless of how many sources feed it — the AI doesn't need to know about source-level duplication.

## Desktop UI

**Types** ([packages/types/src/meeting-notes.ts](packages/types/src/meeting-notes.ts)):
```ts
export interface GranolaAccountStatus {
  connected: boolean;
- account: GranolaAccountRecord | null;
+ accounts: GranolaAccountRecord[];
}
```

**Hooks** ([apps/desktop/src/api/granola.ts](apps/desktop/src/api/granola.ts)):
- `useGranolaAccount()` → `useGranolaAccounts()` — returns the list
- `useDisconnectGranola()` → mutation takes `accountId`
- `useUpdateGranolaPreferences()` → mutation takes `accountId` plus the prefs
- `useConnectGranola()` — unchanged (always adds another)

**[CalendarSection.tsx](apps/desktop/src/settings/CalendarSection.tsx)** — mirror the Google Calendar section structure already in the same file. Section header gets a "+ Connect Another" affordance that's always visible. Each connected account renders as its own card containing: email + last sync, Reconnect button, Disconnect button (with per-card confirmation), `autoCreateMyTasks` toggle, `autoCreateFollowUps` toggle. Card chrome (background, border, radius) matches the existing `ConnectedAccountRow` styling for Google calendars per the CLAUDE.md "List container chrome consistency" rule.

Empty state unchanged: single "Connect Granola" CTA.

## iOS UI

**[CalendarSettingsView.swift](apps/ios/Brett/Views/Settings/CalendarSettingsView.swift):**
```swift
struct GranolaAccountStatus: Decodable {
    let connected: Bool
-   let account: GranolaAccount?
+   let accounts: [GranolaAccount]
}
```

The existing `GranolaAccount` struct stays.

The `granolaConnectedRows(_:)` helper at [CalendarSettingsView.swift:411](apps/ios/Brett/Views/Settings/CalendarSettingsView.swift:411) currently renders one account's three rows (identity + reconnect, auto-create-my-tasks, auto-create-follow-ups). After: replaced by a per-account card rendered for each element of `state.accounts`, plus a "+ Connect Another" row in the section header (always visible).

`connectGranola()`, `disconnectGranola(accountId:)`, `updateGranolaPreferences(accountId:autoCreateMyTasks:autoCreateFollowUps:)` — disconnect and updatePreferences take an accountId; connect does not.

Reconnect flow inherits the desktop strategy: tap Reconnect → OAuth flow → callback upserts on `(userId, email)` → tokens are refreshed for that specific row. Identical UX to today.

**Sync engine on iOS is unchanged.** Meeting notes still arrive via `/sync/pull`. Multi-account is a settings-screen change only.

## Testing

### API tests

| File | Type | Coverage |
|---|---|---|
| `granola-auth.test.ts` | update | array response shape; `DELETE /:id` and `PATCH /:id/preferences` require ownership (404 for other-user account ID); callback creates new row for new email, updates for same email |
| `granola-multi-account.test.ts` | new | end-to-end: user with 2 GranolaAccounts, `initialGranolaSync` syncs both; failure in account A does not abort account B; re-link task created for the failing account specifically |
| `granola-sync-window.test.ts` | update | iterate-accounts shape doesn't regress windowing |
| `meeting-providers-merge.test.ts` | update | two granola sources merge to one MeetingNote when calendarEventId matches; produces 2 MeetingNoteSource rows, no P2002 |
| `connection-health.test.ts` | update | re-link task scoped to `accountId`; resolving one account's re-link doesn't clear another's |

### Failure modes explicitly covered

- One account's refresh fails → re-link task for that account only; other accounts sync normally.
- Same `granolaDocumentId` appears in two of the user's accounts → second sync is a no-op (sync path checks `MeetingNote` existence by `granolaDocumentId` before insert).
- User disconnects account A while a sync of account B is in flight → B's iteration completes normally; per-account try/catch + per-account DB context isolates them.
- Stale desktop/iOS client hits new API → sees `accounts: []` ignored by `data.account` check → renders Connect button. Clicking it works.

### Manual verification

- Desktop: connect two accounts via `preview_*` tools, screenshot the two-card settings layout, disconnect one, verify the other persists.
- iOS: simulator run, decode test for two-account `GranolaAccountStatus` payload, manual smoke of connect/disconnect/reconnect.
- Migration: run against a copy of prod-shaped data, verify no row count change, existing queries still resolve.

## Out-of-scope follow-ups

- Per-account manual sync endpoint (add when a user complains one is stuck).
- Account labels/nicknames distinct from email (e.g., "Personal", "Work").
- Sorting/reordering accounts in the UI.
- Sharing accounts across Brett users.

## File-by-file summary

**API** (`apps/api/`):
- `prisma/schema.prisma` — drop `@unique` on `GranolaAccount.userId`, add `@@unique([userId, email])`
- `prisma/migrations/<timestamp>_multi_granola/` — new migration
- `src/routes/granola-auth.ts` — array shape, per-account routes, ownership checks, callback upsert on `(userId, email)`
- `src/services/granola-sync.ts` — iterate accounts in 3 entry points, extract `syncOneAccount` helper, source-merge collision logic
- `src/services/meeting-providers/granola-provider.ts` — iterate accounts in `fetchForEvent` and `fetchRecent`
- `src/services/granola-action-items.ts` — use `meetingNote.granolaAccountId` instead of looking up by userId
- `src/__tests__/granola-auth.test.ts`, `granola-multi-account.test.ts` (new), updates to merge/health/sync-window tests

**Shared types** (`packages/types/`):
- `src/meeting-notes.ts` — `GranolaAccountStatus.accounts: GranolaAccountRecord[]`

**Desktop** (`apps/desktop/`):
- `src/api/granola.ts` — hook rename + accountId-keyed mutations
- `src/settings/CalendarSection.tsx` — per-account card list, "Connect Another" affordance

**iOS** (`apps/ios/Brett/`):
- `Views/Settings/CalendarSettingsView.swift` — `accounts: [GranolaAccount]`, per-account card rendering, per-account API calls
- `BrettTests/` — decoder test for two-account payload

## Release sequence

Single PR. On merge to `release`:
1. API deploys automatically (Railway).
2. Locally: `scripts/release.sh desktop` — signed DMG/ZIP, autoupdater manifest.
3. Locally: `scripts/release.sh ios` — IPA to TestFlight.

There is a window of minutes-to-hours between the API deploy and desktop/iOS rollout where stale clients show "not connected" + a Connect button. That's the cost of breaking-change-with-coordinated-release per the design decision.
