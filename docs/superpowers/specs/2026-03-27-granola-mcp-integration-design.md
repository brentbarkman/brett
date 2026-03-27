# Granola MCP Integration — Design Spec

**Date:** 2026-03-27
**Status:** Approved

## Overview

Integrate Granola (meeting notes app) into Brett via Granola's official MCP server. Syncs meeting notes, transcripts, and AI-generated summaries into Brett's database, links them to Google Calendar events, and auto-creates action items as tasks. Enables Brett's chat to answer questions about meetings and analyze patterns across recurring meeting series.

## Core Requirements

- Connect Granola account via OAuth (per-user, browser-based)
- Sync meeting notes, summaries, and transcripts into local DB
- Match Granola meetings to existing Google Calendar events
- Auto-extract action items and create them as inbox tasks after meetings end
- Surface meeting notes in calendar event detail panel
- Enable Brett chat to query meeting content and analyze patterns across recurring meetings
- On-demand fallback: user can ask Brett for action items if auto-poll hasn't run yet

## Integration Path

**Granola Official MCP Server** (`https://mcp.granola.ai/mcp`)
- Transport: Streamable HTTP
- Auth: OAuth 2.0 with Dynamic Client Registration (browser-based, per-user)
- Available on Pro plan (user's current plan)

**MCP Tools Used:**

| Tool | Purpose |
|------|---------|
| `list_meetings` | Browse meetings by time range for sync |
| `get_meetings` | Full meeting details (max 10 per call) |
| `get_meeting_transcript` | Raw transcripts with speaker attribution |
| `query_granola_meetings` | Natural language queries for chat integration |

**Not using:** REST API (requires Business+ plan for API keys).

## Data Model

### GranolaAccount

| Field | Type | Notes |
|-------|------|-------|
| id | String (PK) | |
| userId | String (FK → User) | |
| email | String | Granola account email |
| accessToken | String | Encrypted (AES-256-GCM) |
| refreshToken | String | Encrypted (AES-256-GCM) |
| tokenExpiresAt | DateTime | For proactive refresh |
| lastSyncAt | DateTime? | Tracks incremental sync position |
| createdAt | DateTime | |
| updatedAt | DateTime | |

**Constraints:** `@@unique([userId])` — one Granola account per user.

### GranolaMeeting

| Field | Type | Notes |
|-------|------|-------|
| id | String (PK) | |
| granolaDocumentId | String (unique) | Granola's `not_`-prefixed ID |
| userId | String (FK → User) | |
| calendarEventId | String? (FK → CalendarEvent) | Nullable — linked via matching algorithm |
| title | String | Meeting title |
| summary | String? | AI-generated summary from Granola |
| transcript | Json? | Array of speaker turns `[{source, speaker, text}]` |
| actionItems | Json? | Extracted action items `[{title, dueDate?, assignee?}]` |
| attendees | Json? | Array of attendee objects `[{name, email}]` |
| meetingStartedAt | DateTime | |
| meetingEndedAt | DateTime | |
| rawData | Json? | Full MCP response for future-proofing |
| syncedAt | DateTime | When we last synced this meeting |
| createdAt | DateTime | |
| updatedAt | DateTime | |

**Constraints:** `@@unique([granolaDocumentId])` — prevents duplicate syncs.

### Changes to Existing Models

**Item (task):**
- Add `granolaMeetingId` (nullable FK → GranolaMeeting) — links auto-created action item tasks back to their source meeting

**No changes to CalendarEvent** — the FK lives on `GranolaMeeting.calendarEventId` pointing to it.

### Relationship Summary

```
User → GranolaAccount (1:1, auth)
User → GranolaMeeting (1:many, synced notes)
GranolaMeeting → CalendarEvent (many:1, matching)
Item → GranolaMeeting (many:1, action item provenance)
```

## Meeting-to-Event Matching

Granola meetings don't carry Google Calendar event IDs. We match them to `CalendarEvent` records using a scored algorithm.

### Algorithm

1. **Time overlap (required gate):** Granola meeting start/end must overlap with a calendar event's start/end within ±15 minute tolerance. No overlap = no match candidate.

2. **Title similarity (weight: 0.6):** Fuzzy string match (normalized Levenshtein or similar) between Granola meeting title and calendar event summary.

3. **Attendee overlap (weight: 0.4):** Ratio of shared attendee emails between Granola and calendar event attendee lists.

4. **Scoring:** `score = (title_similarity * 0.6) + (attendee_overlap_ratio * 0.4)`. Take highest scorer above a confidence threshold (e.g., 0.5).

### Edge Cases

- **No match found:** Store `GranolaMeeting` with `calendarEventId: null`. Still queryable in chat, action items still created.
- **Ad-hoc meetings:** Not on calendar — no match, same behavior as above.
- **One-to-one constraint:** A calendar event has at most one linked Granola meeting. First match wins.
- **Better match later:** If a re-sync produces a higher-confidence match for an already-linked event, update the link (rare edge case).

## Sync Service & Polling

### GranolaSyncService

Lives in `apps/api/src/services/granola-sync.ts`. Mirrors the pattern of `calendar-sync.ts`.

### Two Sync Triggers

**1. Calendar-driven (primary):**
- When a calendar event's end time passes, wait 5 minutes (for Granola to finish processing)
- Query Granola for notes matching that time window
- Implemented as a job queue: cron job scans for recently-ended events and enqueues sync tasks
- Fast turnaround — action items appear within ~5-10 minutes of meeting end

**2. Periodic sweep (safety net):**
- Every 30 minutes during working hours
- Calls `list_meetings` for the current day
- Syncs any new notes we haven't seen (check against `granolaDocumentId`)
- Catches meetings missed by the calendar-driven trigger (e.g., ad-hoc meetings)

### Working Hours Gate

Both triggers respect a working hours window: **8am–7pm in the user's timezone** (configurable later). No polling outside this window. First sweep of the day catches anything from late the prior evening.

### Sync Flow Per Meeting

1. `list_meetings` → get meeting IDs and metadata
2. For new meetings (unknown `granolaDocumentId`): `get_meetings` → full details
3. `get_meeting_transcript` → store transcript
4. Run matching algorithm → link to `CalendarEvent` if match found
5. Extract action items (see below) → create `Item` records
6. Publish SSE event → desktop UI updates in real-time

### Action Item Extraction

Use Brett's AI orchestrator to parse Granola's summary and identify action items. Avoids brittle ProseMirror JSON parsing.

**Prompt pattern:** "Extract action items from these meeting notes. For each, return a title and optional due date. Only include items assigned to or relevant to {user_name}."

**Task creation per action item:**
- `type: "task"`
- `source: "granola"`
- `sourceUrl`: link to Granola meeting (if available)
- `status: "active"` (lands in inbox)
- `granolaMeetingId`: FK to the source meeting
- No `listId` — inbox by default, user triages

### Incremental Sync

Track `lastSyncAt` per `GranolaAccount`. On each sweep, only fetch notes created/updated after that timestamp using `list_meetings` time range filters.

### Token Refresh

Proactively refresh OAuth tokens before expiry (same pattern as Google Calendar). If refresh fails, mark account as disconnected and surface a notification via SSE → desktop shows reconnection prompt.

## Chat Integration

### New AI Skills

Registered in the existing SkillRegistry alongside current skills.

**1. `queryMeetingNotes`**
- Trigger: User asks about meeting content ("what did we discuss in the standup?")
- Implementation: Search local `GranolaMeeting` records by title/date/attendees, return summary + relevant transcript excerpts
- Works in task chat, calendar event chat, and omnibar contexts

**2. `getMeetingActionItems`**
- Trigger: User asks for action items ("what were the action items from my 2pm?")
- Implementation: Return extracted action items from matched meeting, offer to create any as tasks
- This is the on-demand fallback when auto-poll hasn't run yet
- If no local data yet, query Granola MCP directly, sync the meeting, then return results

**3. `analyzeMeetingPattern`**
- Trigger: User asks about patterns in recurring meetings ("what keeps coming up in our weekly syncs?")
- Implementation: Query multiple `GranolaMeeting` records for a recurring event series (matched via calendar recurrence), use transcripts for longitudinal analysis
- Returns patterns, recurring topics, stale action items, attendance trends

### Context-Aware Behavior

- **Calendar event chat:** When a `CalendarEvent` has a linked `GranolaMeeting`, Brett automatically has that meeting's notes in context — no need to explicitly ask.
- **Omnibar:** Brett can search across all meetings by date, attendee, or topic.
- **Task chat:** If a task has a `granolaMeetingId`, Brett has the source meeting context.

### No Architecture Changes

Skills return tool results via the existing streaming chunk types (`tool_call`, `tool_result`). Display hints trigger React Query invalidation (e.g., `tasks_created` when action items are created via chat).

## OAuth & Account Connection

### Flow

1. User goes to Settings → Connected Accounts → clicks "Connect Granola"
2. Desktop opens system browser to API: `GET /granola/auth/connect`
3. API initiates OAuth 2.0 with Dynamic Client Registration against Granola's MCP auth endpoint
4. User authenticates with their Granola account in browser
5. Callback hits `GET /granola/auth/callback` → access + refresh tokens received
6. Tokens encrypted with AES-256-GCM, stored in `GranolaAccount`
7. Browser shows success page, desktop polls for connection status
8. First full sync kicks off immediately

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/granola/auth/connect` | Initiate OAuth flow |
| GET | `/granola/auth/callback` | OAuth callback, store tokens |
| GET | `/granola/account` | Get connection status |
| DELETE | `/granola/account` | Disconnect (delete account + all synced data) |

### Disconnect

Deleting a Granola account removes the `GranolaAccount` and all `GranolaMeeting` records. Action item tasks already created remain in the user's task list but lose their `granolaMeetingId` link (set to null via `onDelete: SetNull`).

### One Account Per User

Unlike Google Calendar (multiple accounts), Granola is one account per person.

## Desktop UI Changes

### Settings Page — Connected Accounts

- New "Granola" row alongside Google Calendar
- Shows: connection status, connected email, last sync time
- Connect/Disconnect button
- Same card/row pattern as Google Calendar connection

### Calendar Event Detail Panel

When a `CalendarEvent` has a linked `GranolaMeeting`:
- **"Meeting Notes" section** with AI summary
- **Expandable transcript viewer** (collapsed by default — transcripts are long)
- **"Action Items" subsection** listing extracted items with ability to create any as tasks

### Inbox — Action Item Tasks

- Tasks created from Granola show a small "from meeting" indicator with the meeting title
- Clicking it navigates to the linked calendar event detail panel

### No New Pages

All Granola data surfaces through existing UI: calendar event detail, chat, inbox, settings.

## Encryption & Security

- OAuth tokens encrypted at rest with AES-256-GCM (same as Google Calendar tokens)
- Transcripts stored in DB — sensitive but necessary for longitudinal analysis
- Users can disconnect and delete all synced Granola data at any time
- No Granola data leaves our server (no forwarding to third parties)

## File Structure

```
apps/api/src/
  routes/granola-auth.ts          — OAuth connect/callback/status/disconnect
  routes/granola.ts               — Granola meeting data endpoints (if needed)
  services/granola-sync.ts        — Sync service (polling, matching, extraction)
  lib/granola-mcp.ts              — MCP client wrapper (Streamable HTTP transport)

packages/ai/src/
  skills/query-meeting-notes.ts   — Chat skill: query meeting content
  skills/get-meeting-action-items.ts — Chat skill: on-demand action items
  skills/analyze-meeting-pattern.ts  — Chat skill: recurring meeting analysis
  mcp/granola.ts                  — Update existing placeholder with real implementation

apps/desktop/src/
  api/granola.ts                  — React hooks for Granola connection status
  (Settings + CalendarEvent UI updates in existing components)

apps/api/prisma/
  schema.prisma                   — GranolaAccount + GranolaMeeting models, Item FK addition
```
