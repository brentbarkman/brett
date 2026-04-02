# Brett's Take & Brett Chat — Design Spec

**Date:** 2026-04-01
**Status:** Approved

## Overview

Wire up Brett's AI features: **Brett's Take** (pre-generated insights for calendar events) and **Brett Chat** (on-demand AI conversation for tasks and calendar events). Clean up dead stub routes. Add graceful handling when AI is not configured. Ensure all AI usage is properly tracked in the existing token accounting system.

## Decisions

- **Brett's Take is calendar-only.** Tasks don't benefit from pre-generated AI commentary — the user wrote them and has the context. Brett Chat is the right AI surface for tasks.
- **Pre-generation, not on-demand.** Takes are generated after calendar sync for upcoming events, so they're ready when the user opens the detail panel. No loading spinners.
- **Two qualification criteria.** An event qualifies for a Take if: (a) it has a description longer than 50 characters, OR (b) it's recurring and a previous occurrence has a meeting transcript.
- **UX hint.** Calendar event cards show a `✦` sparkle icon when a Take is available, encouraging discovery.
- **Graceful degradation.** When no AI provider is configured, skip pre-generation silently and show a helpful inline message in Brett Chat pointing to Settings.
- **Clean up stub routes.** Remove `apps/api/src/routes/brett.ts` entirely — dead code that returns placeholder text.

## Data Model Changes

### CalendarEvent — add two fields

```prisma
model CalendarEvent {
  // ... existing fields
  brettObservation      String?   @db.Text
  brettObservationAt    DateTime?
}
```

- `brettObservation`: The cached Take text.
- `brettObservationAt`: Timestamp of generation. Compared against `updatedAt` to detect staleness — if the event was updated after generation (description changed, new transcript added), the Take is stale and regenerates on next sync.

No other schema changes needed. `AIUsageLog` already tracks everything via `source: "bretts_take"`.

## Pre-generation Pipeline

### Trigger

After each Google Calendar sync completes (already runs periodically via the existing sync system).

### Flow

1. Calendar sync fetches/updates events for the next 48 hours.
2. For each event, check qualification:
   - `description` exists AND `description.length > 50` → qualifies
   - OR `recurringEventId` exists AND another `CalendarEvent` with the same `recurringEventId` and an earlier `startTime` has a related `MeetingNote` with a non-empty `transcript` field → qualifies
3. For qualifying events where `brettObservation IS NULL` OR `brettObservationAt < updatedAt` (stale):
   - Check that the user has an active, valid AI config. If not, skip silently.
   - Call the orchestrator to generate a Take (reuse existing `bretts_take` input type).
   - Store result in `brettObservation` + set `brettObservationAt` to now.
4. Non-qualifying events: skip. No Take shown.

### Budget cap

Process at most **10 events per sync cycle** to prevent a large calendar import from burning tokens. Prioritize by `startTime` (soonest first).

### Context sent to LLM

- Event title, description, attendees, location
- User's notes on the event (from `CalendarEventNote`)
- If recurring: the most recent transcript/meeting note from a prior occurrence of the same `recurringEventId`

### Token accounting

Pre-generated Takes are logged to `AIUsageLog` with `source: "bretts_take"`. This is already handled by the orchestrator's `logUsage()` call — no new tracking code needed. The existing usage summary endpoint and Settings UI already display `bretts_take` as a source.

## UI Changes

### Calendar event cards (list views)

- Show a small `✦` sparkle icon on events that have a non-null `brettObservation`.
- Subtle — doesn't compete with event title. Uses `text-amber-400/60` or similar muted accent.
- Appears in all calendar list views (UpcomingView, full calendar page).

### CalendarEventDetailPanel

- Displays the cached `brettObservation` in the existing purple-bordered callout (already built at lines 305-323).
- No loading state needed — Takes are pre-generated.
- If `brettObservation` is null (event doesn't qualify or hasn't been processed yet), show nothing. No empty state, no placeholder.

### TaskDetailPanel

- **Remove** the Brett's Take blue callout (lines 256-269 that display `brettObservation`).
- Keep Brett Chat (`BrettThread`) as the only AI surface for tasks.

### Brett Chat — AI not configured state

When the user doesn't have an active AI provider:
- The `useBrettChat` hook's `sendMessage` will get a 403 from `aiMiddleware`.
- Instead of silently failing, show an inline message in the BrettThread area: "Connect an AI provider in Settings to chat with Brett." with a clickable link/button that opens Settings → AI section.
- This applies to both task and calendar event chat.

### Brett Chat — verify end-to-end

Brett Chat appears to be fully wired (BrettThread → useBrettChat → API → orchestrator → SSE). Verify it actually works for both tasks and calendar events. Fix any issues found during verification.

## API Changes

### Remove stub routes

- Delete `apps/api/src/routes/brett.ts` entirely.
- Remove its import (`import brett from "./routes/brett"`) and route registration (`app.route("/things", brett)`) from `apps/api/src/app.ts`.
- The old `BrettMessage` model in the schema can stay for now (data migration is a separate concern).

### Remove item-side Take endpoint

- Remove `POST /brett/take/:itemId` from `brett-intelligence.ts` (the item-side endpoint). Keep the event-side endpoint `POST /brett/take/event/:eventId`.
- Remove or scope the `useBrettsTake` hook to calendar events only.

### Pre-generation endpoint

Add a new internal function (not a public route) that the calendar sync calls after completing a sync cycle:

```typescript
async function generatePendingTakes(userId: string): Promise<void>
```

This function:
1. Queries qualifying events in the next 48 hours for the user.
2. Filters to events needing generation (null or stale Take).
3. Caps at 10 events per cycle.
4. For each, calls the orchestrator and stores the result.

This runs inline after calendar sync (not as a separate cron), so it reuses the same auth context and AI config lookup.

## Admin Panel Integration

No new admin sections needed. The existing infrastructure handles this:

- **`AIUsageLog`** already tracks `source: "bretts_take"` — pre-generated Takes use the same source tag.
- **Usage summary endpoint** (`GET /ai/usage/summary`) already aggregates by source, so `bretts_take` usage appears alongside `brett_thread`, `omnibar`, etc.
- **Settings → AI section** already displays per-source usage breakdowns under each provider's expandable "Usage" section. `bretts_take` will appear as "bretts take" in the source label (existing `replace(/_/g, " ")` formatting).
- **Admin panel** (separate app, per `2026-03-31-admin-panel-design.md`) will surface the same `AIUsageLog` data via its own admin routes — no changes needed to that spec.

Verify that the existing usage tracking actually works end-to-end:
1. Pre-generation calls the orchestrator with proper `source: "bretts_take"`.
2. Orchestrator calls `logUsage()` which writes to `AIUsageLog`.
3. Usage summary endpoint includes these records.
4. Settings UI displays them.

## Cleanup Checklist

- [ ] Delete `apps/api/src/routes/brett.ts`
- [ ] Remove import + route registration from `apps/api/src/app.ts`
- [ ] Remove Brett's Take display from `TaskDetailPanel.tsx`
- [ ] Remove item-side Take endpoint from `brett-intelligence.ts`
- [ ] Scope or remove `useBrettsTake` for items
- [ ] Add `brettObservation` + `brettObservationAt` fields to CalendarEvent in Prisma schema
- [ ] Run migration
- [ ] Implement `generatePendingTakes()` function
- [ ] Wire `generatePendingTakes()` into calendar sync completion
- [ ] Add `✦` sparkle indicator to calendar event cards
- [ ] Add "AI not configured" inline message to BrettThread
- [ ] Verify Brett Chat works end-to-end for tasks
- [ ] Verify Brett Chat works end-to-end for calendar events
- [ ] Verify token accounting works for pre-generated Takes
- [ ] Verify usage displays correctly in Settings → AI → Usage
