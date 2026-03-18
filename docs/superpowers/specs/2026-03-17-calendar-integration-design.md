# Calendar Integration — Design Spec

**Date:** 2026-03-17
**Status:** Approved

## Overview

Google Calendar integration for Brett. Connects one or more Google accounts, syncs events in real-time via webhooks + SSE, and provides a rich event detail panel with RSVP, private notes, and Brett chat. Includes both a sidebar timeline (daily driver) and a full calendar page (day/week/month views) for navigating past and future events.

## Core Requirements

- Multiple Google accounts, each with selectable calendar visibility
- Separate OAuth flow from sign-in auth (calendar-specific scopes)
- Real-time sync: Google webhooks → incremental sync → SSE push → React Query invalidation
- No event creation/editing in v1 — read + RSVP only
- Event detail slideout panel (550px, same shell as task detail)
- Brett thread on events (mocked for now, not context-aware)
- Private notes per event (rich text, local only, never synced to Google)
- Full calendar page with day/week/month views + configurable X-days

## Data Model

### GoogleAccount

| Field | Type | Notes |
|-------|------|-------|
| id | String (PK) | |
| userId | String (FK → User) | |
| googleEmail | String | |
| googleUserId | String | |
| accessToken | String | Encrypted (AES-256-GCM, see Token Encryption) |
| refreshToken | String | Encrypted (AES-256-GCM, see Token Encryption) |
| tokenExpiresAt | DateTime | For refresh logic |
| connectedAt | DateTime | |
| updatedAt | DateTime | |

**Constraints:** `@@unique([userId, googleUserId])` — prevents duplicate connections of the same Google account.

### CalendarList

| Field | Type | Notes |
|-------|------|-------|
| id | String (PK) | |
| googleAccountId | String (FK → GoogleAccount) | |
| googleCalendarId | String | |
| name | String | |
| color | String | Google's color hex |
| isVisible | Boolean | User toggle |
| isPrimary | Boolean | |
| watchChannelId | String? | Webhook subscription |
| watchResourceId | String? | Webhook subscription |
| watchToken | String? | HMAC-signed token for webhook verification |
| watchExpiration | DateTime? | Webhook expiry |
| syncToken | String? | Google incremental sync token (per-calendar, not per-account) |

### CalendarEvent

| Field | Type | Notes |
|-------|------|-------|
| id | String (PK) | |
| userId | String (FK → User) | Denormalized for query/auth convenience |
| googleAccountId | String (FK → GoogleAccount) | |
| calendarListId | String (FK → CalendarList) | |
| googleEventId | String | |
| title | String | |
| description | String? | |
| location | String? | |
| startTime | DateTime | |
| endTime | DateTime | |
| isAllDay | Boolean | |
| status | String | confirmed / tentative / cancelled |
| myResponseStatus | String | accepted / declined / tentative / needsAction |
| recurrence | String? | RRULE from Google |
| recurringEventId | String? | Links instances to parent |
| meetingLink | String? | Extracted Zoom/Meet/Teams URL |
| googleColorId | String? | Raw Google colorId — resolved at render time |
| organizer | Json | { name, email } |
| attendees | Json | [{ name, email, responseStatus, organizer }] |
| attachments | Json | [{ title, url, mimeType }] |
| rawGoogleEvent | Json | Full Google event JSON |
| syncedAt | DateTime | |
| createdAt | DateTime | |
| updatedAt | DateTime | |

**Constraints:** `@@unique([googleAccountId, googleEventId])` — natural key for upserts during sync.

### CalendarEventNote

| Field | Type | Notes |
|-------|------|-------|
| id | String (PK) | |
| calendarEventId | String (FK → CalendarEvent) | |
| userId | String (FK → User) | |
| content | String (Text) | Rich text, Tiptap |
| createdAt | DateTime | |
| updatedAt | DateTime | |

Notes are stored server-side but private to the user — never synced back to Google.

### BrettMessage (migration)

Add a nullable `calendarEventId` FK alongside the existing `itemId` FK. Both are nullable — exactly one must be set per row.

| Field | Type | Notes |
|-------|------|-------|
| itemId | String? (FK → Item) | Nullable (was required) |
| calendarEventId | String? (FK → CalendarEvent) | New, nullable |

This preserves Prisma relations and cascade deletes for both parent types. Existing rows keep their `itemId` values; new calendar event messages use `calendarEventId`. Application-level validation ensures exactly one FK is set.

### Existing CalendarEvent type migration

The existing `CalendarEvent` interface in `@brett/types` (used by `CalendarTimeline.tsx` and `DetailPanel.tsx`) has a different shape (string-based times, color union, `hasBrettContext`). Migration plan:

1. Rename existing interface to `CalendarEventDisplay` — this becomes the UI view model
2. Add new `CalendarEvent` type matching the DB model
3. Create a `toCalendarEventDisplay(event: CalendarEvent, colorMap: ColorMap): CalendarEventDisplay` mapper
4. Update `CalendarTimeline.tsx` and `DetailPanel.tsx` to consume `CalendarEventDisplay`
5. Update `DetailPanel.tsx` type discrimination (`startTime` is now DateTime on both types — discriminate via a `type` field or separate props)

### Token Encryption

Application-level AES-256-GCM encryption for `accessToken` and `refreshToken`:

- New env var: `CALENDAR_TOKEN_ENCRYPTION_KEY` (32-byte hex string)
- Encrypt before writing to DB, decrypt on read
- Implemented as utility functions (`encryptToken` / `decryptToken`) called in the Google account service layer
- IV generated per encryption, stored alongside ciphertext

## Google Calendar OAuth

Separate from better-auth sign-in. Calendar connection uses the same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` but requests calendar-specific scopes:

- `https://www.googleapis.com/auth/calendar.events` — read/write (for RSVP)
- `https://www.googleapis.com/auth/calendar.readonly` — read calendar list
- `openid email profile` — identify connected account

Flow:
1. Settings → "Connect Google Calendar" → system browser OAuth
2. Callback stores tokens in `GoogleAccount`
3. Fetch calendar list → populate `CalendarList` with all calendars visible by default
4. Trigger initial sync

Multiple accounts: each gets its own `GoogleAccount` row and independent OAuth tokens.

Disconnect: remove `GoogleAccount` + cascade delete related rows, revoke token with Google.

## Real-Time Infrastructure (SSE Event Bus)

Reusable infrastructure for all future real-time features.

### Server

- `GET /events/stream` — SSE endpoint, authenticated, one connection per client
- In-memory connection registry keyed by `userId`
- Heartbeat every 30s: `: heartbeat\n\n`
- Event format: `event: <type>\ndata: <JSON>\n\n`

### Starting event types

```
calendar.event.created
calendar.event.updated
calendar.event.deleted
calendar.sync.complete
```

### Future event types (designed for, not built)

```
task.updated
brett.message
notification.created
```

### Client

- `useEventStream()` hook — connects on app start, auto-reconnects (SSE built-in)
- Exponential backoff on connection drop
- Handlers invalidate React Query caches by event type
- Generic — any component can register handlers

### SSE auth lifecycle

- SSE connection is authenticated via the same bearer token used for REST calls
- Server closes the stream when the session expires
- Client's reconnect logic refreshes the auth token before re-establishing the SSE connection
- The `useEventStream()` hook handles this transparently — on disconnect, it checks token freshness before reconnecting

### Scaling note

In-memory registry works for single API instance. If scaling to multiple instances, swap to Redis pub/sub backing the same SSE interface. No client changes needed.

### Future voice

When voice dictation is added, a separate WebSocket handles client→server audio streaming. SSE (server→client) and WebSocket (client→server audio) coexist independently. No rework to SSE infrastructure.

## Google Webhook & Sync Architecture

### Initial sync (on account connect)

1. OAuth complete → store tokens
2. Fetch calendar list → populate `CalendarList`
3. Fetch events per visible calendar (30 days back, 90 days forward) → populate `CalendarEvent`
4. Register Google push notification channel per calendar → store watch IDs in `CalendarList`

### On-demand fetch (outside sync window)

When the user navigates outside the synced window (e.g., 3 months ago in month view), the client detects the gap and triggers an on-demand fetch from Google for that date range. Results are cached in `CalendarEvent` rows, expanding the synced window. This avoids over-fetching at initial sync while ensuring the full calendar page always has data.

### Ongoing sync (webhook-driven)

1. Google POSTs to `POST /webhooks/google-calendar`
2. Verify: match `X-Goog-Channel-ID` + `X-Goog-Resource-ID` against stored values
3. Incremental sync: `events.list` with `syncToken` → returns only changed events
4. Upsert `CalendarEvent` rows
5. Publish SSE events → UI updates instantly

### Reconciliation (3 layers)

1. **syncToken (primary)** — each webhook/reconciliation uses syncToken. Google guarantees all changes since last token are returned, even if webhooks were missed.
2. **Periodic reconciliation (secondary)** — background job every 4-6 hours per account. Incremental sync with syncToken regardless of webhook activity.
3. **Full sync fallback (rare)** — if syncToken is rejected by Google (too old/invalidated), drop token, full fetch, diff against stored events.

### Drift detection

- `syncedAt` on each `CalendarEvent`
- If reconciliation finds Google's `updated` > our `syncedAt`, drift occurred
- Log as metrics for tuning reconciliation interval

### User-facing sync status

- Settings: "Last synced: 2 min ago" per account
- Warning badge if sync fails repeatedly

### Webhook management

- Channels expire (~7 days)
- Daily cron renews expiring channels
- If renewal fails, periodic reconciliation provides safety net

### Token refresh

- Check `tokenExpiresAt` before any Google API call
- Refresh if expired, update `GoogleAccount`
- If refresh fails (revoked access), mark account as disconnected, surface in settings

### Webhook endpoint security

- `POST /webhooks/google-calendar` is unauthenticated (Google can't send bearer tokens)
- Verify by matching `X-Goog-Channel-ID` + `X-Goog-Resource-ID` against stored values
- Additionally verify `X-Goog-Channel-Token` — an HMAC-signed token (using `CALENDAR_TOKEN_ENCRYPTION_KEY`) set during `watch()` registration, stored as `watchToken` on `CalendarList`
- Reject unknown or invalid combinations

### Webhook debounce

- Google can send bursts of webhooks for bulk changes
- On webhook receipt, enqueue a sync job with a 2-second debounce per calendar
- If multiple webhooks arrive for the same calendar within the window, only one sync runs

## Calendar Sidebar (Enhanced CalendarTimeline)

Upgrade existing `CalendarTimeline.tsx` from mock data to real data.

### Data flow

- `useCalendarEvents(date)` → `GET /calendar/events?date=YYYY-MM-DD`
- SSE events trigger React Query invalidation → automatic refetch
- Colors mapped from Google palette to glass morphism variants

### Current time indicator

- Replace hardcoded time with `setInterval` every 60s
- Red dot + line moves in real-time
- Visible window auto-scrolls to keep current time in view

### Event countdown badge

- Next upcoming event shows "Starts in 12 min"
- Updates every minute
- Transitions to "Now" during event, disappears after

### Join meeting button

- If `meetingLink` present, video icon on event card
- Hover tooltip (compact): clickable "Join" button
- Opens in system browser

### Conflict detection

- Overlapping events get warning border
- Rendered side-by-side (narrower columns) like Google Calendar

### Quick RSVP

- Right-click context menu: Accept / Tentative / Decline
- Mutation → updates Google → SSE pushes update

### Buffer indicators

- Between back-to-back events: "0 min buffer" (red) or "15 min" (neutral)
- Only shown when gap < 15 minutes

## Full Calendar Page

New route `/calendar` in left nav.

### Navigation

- Left nav: calendar icon
- Top bar: Day | Week | Month view switcher + X-days configurable view
- Date navigation: back/forward arrows, "Today" button, date range label

### Day view

- Full-height time grid (midnight to midnight, scrolled to working hours)
- Event cards (wider than sidebar), all-day events in top strip
- Current time indicator (red line)

### Week view

- 7-column grid (or X-day configurable), time grid on left
- Conflicts side-by-side within column
- All-day events top strip
- Today column highlighted

### X-days view

- User picks 2-14 days, same layout as week, persists preference

### Month view

- Traditional calendar grid
- Events as colored pills, max 3 per day, "+N more" overflow
- Click day → switches to day view

### Shared behavior

- Click event → opens detail slideout panel
- Hover → progressive tooltip (compact → expanded after ~1.5s)
- Conflict highlighting
- Multi-calendar overlay, events distinguished by color
- No event creation/editing in v1

## Event Detail Slideout Panel

550px glass panel, same infrastructure as task detail.

### Section order

1. **Header** — title, date/time, calendar badge (color + name), location with "Join meeting" link, recurrence indicator
2. **RSVP** — Accept / Tentative / Decline buttons + note field. Note always visible. Fires with RSVP click if populated. If RSVP already selected, note sends on blur or panel close. The note maps to Google's attendee `comment` field in the Calendar API — it is synced to Google, not local-only.
3. **Brett's Take** — purple-tinted card, mocked content
4. **Agenda** — event description (read-only from Google), Google attachments and links rendered inline
5. **Attendees** — name, email, response status icon. Max 4 visible, "+X more" clickable to expand full list. Count in section header.
6. **Your Notes** — rich text (Tiptap), local only. Empty state placeholder: "Not synced to Google". Debounced save (500ms).
7. **Brett Thread** — collapsible, pinned at bottom, message count badge. Mocked (not context-aware).

## Hover Tooltip (Progressive Disclosure)

Used on both sidebar and full calendar page event cards.

### Compact (instant on hover)

- Event title
- Time + location
- Description snippet (2-line clamp)
- Attendee count ("4 attendees")

### Expanded (after ~1.5s dwell)

- Everything from compact, plus:
- RSVP status badge
- Full description
- Individual attendees (name + email + response status), max 4, "+X more"
- Recurrence info

## Meeting Link Extraction

**Priority order:**
1. `conferenceData.entryPoints[]` — structured Google data (Meet, Zoom add-on)
2. Location field — regex for Zoom, Teams, Webex, Meet URLs
3. Description field — same regex fallback

Stored in `meetingLink` on `CalendarEvent` at sync time.

## Google Calendar Color Mapping

- Fetch Google color definitions once per account via `colors` API, cache in memory
- Map each Google `colorId` to a base hue (red, blue, green, purple, amber, teal, pink, etc.)
- For each hue, define glass variant: `{ bg: 'rgba(R,G,B,0.15)', border: 'rgba(R,G,B,0.4)', text: 'rgba(R,G,B,0.9)' }`
- Event-level `googleColorId` overrides calendar color when present
- Color resolution happens at **render time** using a cached color map — not stored on the event. This way, calendar-level color changes propagate immediately to all events without re-syncing.
- Preserves user's Google color intent, adapted to glass morphism aesthetic

## Settings — Connected Calendars

New section in Settings page between Security and Sign Out.

- "Connect Google Calendar" button → OAuth flow
- Per connected account:
  - Google email address
  - "Last synced: X ago"
  - Calendar list with visibility toggle checkboxes
  - "Disconnect" button (with confirmation dialog)
- Multiple accounts stack vertically
- On connect: all calendars visible by default, user toggles off unwanted ones
- No color customization in v1

## API Routes (New)

| Method | Path | Purpose |
|--------|------|---------|
| GET | /calendar/events | Fetch events for date range |
| GET | /calendar/events/:id | Single event with full detail |
| PATCH | /calendar/events/:id/rsvp | Update RSVP + optional note |
| GET | /calendar/events/:id/notes | Get private notes |
| PUT | /calendar/events/:id/notes | Upsert private notes |
| GET | /calendar/events/:id/brett | Brett messages (paginated) |
| POST | /calendar/events/:id/brett | Send Brett message |
| POST | /calendar/events/:id/brett-take | Generate Brett observation |
| GET | /calendar/accounts | List connected accounts + calendars |
| POST | /calendar/accounts/connect | Initiate OAuth |
| GET | /calendar/accounts/callback | OAuth callback |
| DELETE | /calendar/accounts/:id | Disconnect account |
| PATCH | /calendar/accounts/:id/calendars/:calId | Toggle calendar visibility |
| GET | /events/stream | SSE event bus |
| POST | /webhooks/google-calendar | Google push notification receiver |

## New Environment Variables

| Variable | Purpose |
|----------|---------|
| `CALENDAR_TOKEN_ENCRYPTION_KEY` | 32-byte hex string for AES-256-GCM encryption of Google OAuth tokens |
| `GOOGLE_WEBHOOK_BASE_URL` | Public URL for Google webhook delivery (e.g., `https://api.brett.app`) |

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` already exist for sign-in OAuth and are reused for calendar OAuth with different scopes.

## Cron Jobs

| Job | Frequency | Purpose |
|-----|-----------|---------|
| Webhook renewal | Daily | Renew expiring Google watch channels |
| Periodic reconciliation | Every 4-6 hours | Incremental sync per account as safety net |

Implementation: application-level cron via a lightweight scheduler (e.g., `node-cron`) running in the API process. If scaling to multiple instances, move to an external scheduler or use leader election.

## Out of Scope (v1)

- Event creation/editing (use Google Calendar directly)
- Calendar-level color customization
- Context-aware Brett AI (thread is mocked)
- Voice dictation (future WebSocket, no impact on SSE)
- Attendee click-through (display only)
- Push notifications / system notifications
