# Incremental Google Drive Scopes for Meeting Notes

**Date:** 2026-04-06
**Status:** Approved

## Problem

When connecting Google Calendar, Brett requests `drive.metadata.readonly` and `documents.readonly` upfront alongside calendar scopes. Google's consent screen displays this as "see all your Google Docs," which is alarming and may cause users to abandon the connection flow entirely. The Drive/Docs scopes are only needed for meeting notes — not for core calendar functionality.

## Solution

Split the OAuth scope request into two tiers. Present a pre-redirect interstitial that lets users opt into meeting notes before seeing Google's consent screen. Users who skip can upgrade later from settings without a second OAuth round-trip being the default path.

## Design

### OAuth Scope Tiers

**Base scopes** (always requested):
- `calendar.events`
- `calendar.readonly`
- `contacts.readonly`
- `contacts.other.readonly`
- `openid`, `email`, `profile`

**Meeting notes scopes** (opt-in via interstitial toggle):
- `drive.metadata.readonly`
- `documents.readonly`

`getCalendarAuthUrl()` accepts `includeMeetingNotes: boolean`. When `false`, Drive/Docs scopes are omitted from the OAuth URL.

### Pre-redirect Interstitial

A modal shown after clicking "Connect Google Calendar" but before the OAuth redirect.

**Layout:**
- Google icon + "Connect your Google Calendar" heading
- "Brett will sync your events and keep them up to date" subtitle
- Toggle row (default: on): **"Include meeting notes"**
  - Copy: *"Brett reads your Meet transcripts to extract action items and build a richer picture of your work. Less note-taking, fewer dropped balls."*
- Cancel / Continue to Google → buttons

**Behavior:**
- Toggle on → `POST /calendar/accounts/connect?meetingNotes=true` → full scope set
- Toggle off → `POST /calendar/accounts/connect?meetingNotes=false` → base scopes only
- Cancel → close modal, no redirect

### Data Model

Add `meetingNotesEnabled` boolean to `GoogleAccount` (default: `true`).

Two flags now control meeting notes:
- `hasDriveScope` — whether the token has Drive/Docs scopes (set by OAuth callback, read-only)
- `meetingNotesEnabled` — whether the user wants meeting notes (user-controlled toggle)

Meeting notes are active only when **both** are `true`.

### Settings Toggle

Replace the static green/amber dot + [Enable] button in `CalendarSection` with a toggle matching the calendar visibility toggle style:

| State | Toggle | Behavior on click |
|-------|--------|-------------------|
| `hasDriveScope=true`, `meetingNotesEnabled=true` | Gold (on) | `PATCH` → set `meetingNotesEnabled=false`, instant |
| `hasDriveScope=true`, `meetingNotesEnabled=false` | Gray (off) | `PATCH` → set `meetingNotesEnabled=true`, instant |
| `hasDriveScope=false`, `meetingNotesEnabled=false` | Gray (off) + "Requires permissions" | Triggers reauth flow (existing incremental consent) |

### API Changes

| Endpoint | Change |
|----------|--------|
| `POST /calendar/accounts/connect` | Accept `meetingNotes` query param, pass to `getCalendarAuthUrl()` |
| `GET /calendar/accounts/callback` | Set `meetingNotesEnabled` based on whether Drive scopes were granted |
| `PATCH /calendar/accounts/:accountId/meeting-notes` | New — toggles `meetingNotesEnabled`. If enabling and `hasDriveScope=false`, return 409 (client should trigger reauth instead) |
| `GoogleMeetProvider.isAvailable()` | Check `hasDriveScope && meetingNotesEnabled` |
| `GoogleMeetProvider.fetchForEvent()` | Check `hasDriveScope && meetingNotesEnabled` |

### Frontend Changes

| File | Change |
|------|--------|
| `apps/api/src/lib/google-calendar.ts` | Split `SCOPES` into `BASE_SCOPES` + `MEETING_NOTES_SCOPES`, update `getCalendarAuthUrl()` |
| `apps/api/src/routes/calendar-accounts.ts` | Accept `meetingNotes` param on connect, add PATCH endpoint, set `meetingNotesEnabled` in callback |
| `apps/api/src/services/meeting-providers/google-meet-provider.ts` | Gate on both flags |
| `apps/desktop/src/api/calendar-accounts.ts` | Pass `meetingNotes` param, add `useToggleMeetingNotes` mutation |
| `apps/desktop/src/settings/CalendarSection.tsx` | Add interstitial modal, replace status row with toggle |
| `packages/types/src/index.ts` | Add `meetingNotesEnabled` to `ConnectedCalendarAccount` |
| `apps/api/prisma/schema.prisma` | Add `meetingNotesEnabled Boolean @default(true)` to `GoogleAccount` |

### Disabling Meeting Notes

Toggle off → `PATCH /calendar/accounts/:accountId/meeting-notes` sets `meetingNotesEnabled=false`. The Google permission technically remains granted but Brett stops using it. No re-auth or scope revocation needed.

Users who want to fully revoke can do so from their Google Account permissions page — we don't surface this in the UI since the practical effect is the same.
