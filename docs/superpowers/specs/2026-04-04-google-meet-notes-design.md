# Google Meet Notes Integration — Design Spec

## Overview

Add Google Meet transcripts and meeting notes as a second source for the meeting notes pipeline, alongside the existing Granola integration. Introduce a provider abstraction layer so future providers (Zoom, Microsoft Teams) plug in cleanly.

**Key decisions made during brainstorming:**

- Both Google Meet transcripts AND meeting notes are captured (transcript preferred when available, meeting notes as fallback)
- One MeetingNote record per meeting, multiple sources feed into it
- Provider abstraction layer (not just extending the pipeline) because Zoom and Microsoft are on the roadmap
- Narrowly-scoped Google OAuth (`drive.metadata.readonly` + `documents.readonly`) requested upfront, with re-auth option in calendar settings if initially declined
- Action items extracted once on first source arrival; later sources only update transcript/summary/embeddings
- Runtime permission detection — if Drive scope wasn't granted, skip silently

## Data Model Changes

### New Table: MeetingNoteSource

Stores raw provider data before merge. One row per provider per meeting.

```prisma
model MeetingNoteSource {
  id            String   @id @default(uuid())
  meetingNoteId String
  meetingNote   MeetingNote @relation(fields: [meetingNoteId], references: [id], onDelete: Cascade)
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider      String   // "granola" | "google_meet" | "zoom" | "microsoft"
  externalId    String   // Provider-specific ID (granolaDocumentId, Drive file ID, etc.)

  // Provider account FKs — nullable, only one set per row based on provider
  granolaAccountId String?
  granolaAccount   GranolaAccount? @relation(fields: [granolaAccountId], references: [id], onDelete: SetNull)
  googleAccountId  String?
  googleAccount    GoogleAccount?  @relation(fields: [googleAccountId], references: [id], onDelete: SetNull)

  title         String
  summary       String?  @db.Text
  transcript    Json?    // Raw transcript from this provider
  attendees     Json?    // Raw attendees from this provider
  rawData       Json?    // Scrubbed provider response (PII redacted — see scrubProviderRawData())
  syncedAt      DateTime @default(now())
  createdAt     DateTime @default(now())

  @@unique([provider, externalId])
  @@index([meetingNoteId])
  @@index([userId, provider])
}
```

**Account FK design:** Instead of a polymorphic `accountId` string, we use nullable typed FKs (`granolaAccountId`, `googleAccountId`). Only one is set per row based on `provider`. This gives us real FK constraints with `onDelete: SetNull` (source records survive account disconnection but lose the account link). When resolving accounts, always include `userId` in the lookup to prevent cross-user access.

### MeetingNote Model Changes

Evolve from Granola-specific to source-agnostic:

```
Remove:
  - granolaDocumentId (moved to MeetingNoteSource.externalId)
  - granolaAccountId  (moved to MeetingNoteSource.accountId)
  - granolaAccount    (relation removed)

Add:
  - sources    String[]  // ["granola", "google_meet"] — which providers contributed
  - meetingNoteSources MeetingNoteSource[]  // relation to raw source data

Add constraint:
  - @@unique([userId, calendarEventId])  // One merged note per meeting per user — prevents race condition duplicates

Keep unchanged:
  - id, userId, calendarEventId
  - title, summary, transcript, attendees, actionItems
  - meetingStartedAt, meetingEndedAt
  - rawData (deprecated — kept for migration, new data goes to MeetingNoteSource.rawData)
  - syncedAt, createdAt, updatedAt
  - items[] (task relation)
  - provider field (repurposed: now tracks which provider's data was used for initial action item extraction)
```

### GoogleAccount Schema Addition

Add to the existing `GoogleAccount` model:

```
  hasDriveScope  Boolean  @default(false)  // Whether user granted Drive metadata + Docs read scopes
```

Existing rows default to `false`. When a user re-auths and grants the scope, this flips to `true`. `GoogleMeetProvider.isAvailable()` checks this field.

### Migration Strategy (Two-Phase)

**Phase 1 — Additive (deploy with code that writes both old and new):**

1. Add `MeetingNoteSource` table
2. Add `sources String[]` to MeetingNote (default `[]`)
3. Add `conferenceId String?` to CalendarEvent
4. Add `hasDriveScope Boolean @default(false)` to GoogleAccount
5. Make `granolaDocumentId` optional (`String?`) — keep the unique constraint
6. Make `granolaAccountId` optional (`String?`) — keep the FK
7. Add `@@unique([userId, calendarEventId])` to MeetingNote (requires backfill: for any duplicate userId+calendarEventId pairs, merge into one record first)
8. Backfill: for each existing MeetingNote, create a MeetingNoteSource row with `provider: "granola"`, `externalId: granolaDocumentId`, `granolaAccountId`, copying title/summary/transcript/attendees/rawData. Set `sources: ["granola"]` on the MeetingNote.

During Phase 1, existing Granola sync code continues writing `granolaDocumentId` — no cron breakage.

**Phase 2 — Cutover (separate deploy, after Phase 1 is fully live):**

1. Switch cron from Granola-specific sync to coordinator
2. Deploy and verify coordinator is working
3. Drop `granolaDocumentId` and `granolaAccountId` columns from MeetingNote
4. Remove old Granola-specific dedup code that referenced those columns

## Provider Abstraction

### Interface

```typescript
// apps/api/src/services/meeting-providers/types.ts

interface MeetingNoteProvider {
  readonly provider: string;

  // Fetch notes for a specific calendar event (post-meeting cron trigger)
  fetchForEvent(
    userId: string,
    calendarEvent: CalendarEvent,
  ): Promise<ProviderMeetingData | null>;

  // Bulk fetch for a time range (periodic sweep, initial sync)
  fetchRecent(
    userId: string,
    since: Date,
    until: Date,
  ): Promise<ProviderMeetingData[]>;

  // Is this provider connected and authorized for this user?
  isAvailable(userId: string): Promise<boolean>;
}

interface ProviderMeetingData {
  provider: string;
  externalId: string;
  accountId: string;  // The provider-specific account ID (GranolaAccount.id or GoogleAccount.id)
  calendarEventId?: string;  // If provider can directly link to a calendar event (Google Meet can, Granola can't)
  title: string;
  summary: string | null;
  transcript: MeetingTranscriptTurn[] | null;
  attendees: MeetingNoteAttendee[] | null;
  meetingStartedAt: Date;
  meetingEndedAt: Date;
  rawData: unknown;
}
```

### Provider Implementations

#### GranolaProvider

Wraps existing `granola-sync.ts` logic:

- `isAvailable`: checks for GranolaAccount with valid (non-stale) tokens
- `fetchForEvent`: queries Granola MCP for meetings in a window around the event (existing 15min-before to 30min-after logic), uses existing meeting-matcher to find best match
- `fetchRecent`: lists meetings in date range via Granola MCP (existing listGranolaMeetings + getMeetings + getTranscript flow)
- Normalizes Granola's XML/text MCP responses into ProviderMeetingData using existing parsers in `granola-mcp.ts`

#### GoogleMeetProvider

New implementation:

- `isAvailable`: checks for GoogleAccount with Drive scope granted (see OAuth section)
- `fetchForEvent`: given a CalendarEvent, looks for linked transcript/notes Google Docs
- `fetchRecent`: searches Drive for Meet transcript/notes docs created in the time range
- Parses Google Docs content into ProviderMeetingData

**How Google Meet artifacts are discovered:**

1. **Via calendar event attachments** — Google Meet auto-attaches transcript docs to the calendar event. The CalendarEvent already stores `attachments` JSON. Filter for `mimeType: "application/vnd.google-apps.document"` with title patterns like "Transcript - ..." or meeting notes naming conventions.

2. **Via Drive search (fallback)** — Query Drive API for docs in the "Meet Recordings" folder or with `appProperties` linking them to a Meet conference, filtered by creation date matching the event window.

3. **Via conferenceData on the raw Google event** — Currently scrubbed during sync. We need to preserve the `conferenceData.conferenceId` field (not the full object) to correlate Meet artifacts. Add this as a new field on CalendarEvent.

**Google Docs parsing:**

- Use Google Docs API (`documents.get`) to retrieve structured content
- Transcript format: timestamped speaker turns — parse into `MeetingTranscriptTurn[]`
- Meeting notes format: freeform collaborative doc — store as summary text

### Provider Registry

```typescript
// apps/api/src/services/meeting-providers/registry.ts

class MeetingProviderRegistry {
  private providers: MeetingNoteProvider[] = [];

  register(provider: MeetingNoteProvider): void;

  // Returns providers that are connected for this user
  async getAvailable(userId: string): Promise<MeetingNoteProvider[]>;

  // Returns all registered providers
  getAll(): MeetingNoteProvider[];
}

// Singleton, initialized at app startup
export const providerRegistry = new MeetingProviderRegistry();
providerRegistry.register(new GranolaProvider());
providerRegistry.register(new GoogleMeetProvider());
```

## Coordinator / Merge Logic

### MeetingNoteCoordinator

Orchestrates fetching from all providers and merging into a single MeetingNote.

```typescript
// apps/api/src/services/meeting-providers/coordinator.ts

class MeetingNoteCoordinator {
  constructor(private registry: MeetingProviderRegistry) {}

  // Called by post-meeting cron (per calendar event)
  async syncForEvent(userId: string, calendarEvent: CalendarEvent): Promise<void>;

  // Called by periodic sweep cron
  async syncRecent(userId: string, since: Date, until: Date): Promise<void>;

  // Called on initial provider connection
  async initialSync(userId: string, provider: string): Promise<number>;
}
```

**syncForEvent flow:**

1. Get available providers for this user
2. For each provider, call `fetchForEvent(userId, calendarEvent)` **in parallel** (fetch phase)
3. Collect results. **Merge sequentially** (not in parallel — prevents duplicate MeetingNote race):
   For each result:
   a. Check if MeetingNoteSource already exists (by `[provider, externalId]` unique constraint) — skip if so
   b. Scrub raw data via `scrubProviderRawData(provider, rawData)` before storage (see Security section)
   c. Upsert the MeetingNote for this calendar event using `prisma.meetingNote.upsert()` with `where: { userId_calendarEventId: { userId, calendarEventId } }`. The `@@unique([userId, calendarEventId])` constraint guarantees one record per meeting.
   d. Create MeetingNoteSource record with scrubbed provider data
   e. Merge provider data into MeetingNote fields (see merge rules below)
   f. If this is the first source (MeetingNote was just created): extract action items, enqueue embedding
   g. If this is a subsequent source: only re-embed (skip action item extraction)
4. Publish SSE event: `meeting.note.synced` with `{ meetingNoteId, calendarEventId, sources }` so the desktop UI refreshes

**Merge rules (field-level priority):**

| Field | Rule |
|-------|------|
| title | First source wins (don't overwrite) |
| summary | Prefer Granola > Google Meet notes > Google Meet transcript (auto-generated summaries are lower quality) |
| transcript | Prefer the longer/richer transcript. Granola typically wins (speaker attribution + audio capture). Google Meet transcript used if Granola has none. |
| attendees | Union of all sources (dedupe by email, case-insensitive) |
| meetingStartedAt/EndedAt | Prefer calendar event times, fall back to provider-reported times |
| sources | Append provider to array |

**Merge is idempotent** — running it again with the same source data produces the same result. The MeetingNoteSource records are the source of truth; the MeetingNote can always be re-derived.

### Calendar Event Matching

For providers that don't directly link to a calendar event (e.g., Granola), the existing meeting-matcher logic applies. GoogleMeetProvider gets a direct link via attachments or conferenceId, so no fuzzy matching needed.

The coordinator first tries direct calendarEventId. If the provider returns data without a calendar event link, it falls back to the existing `findBestMatch()` algorithm.

## Google OAuth Changes

### Scope Addition

Add two narrowly-scoped OAuth scopes to `google-calendar.ts`:

```typescript
"https://www.googleapis.com/auth/drive.metadata.readonly",  // Drive file search (files.list)
"https://www.googleapis.com/auth/documents.readonly",        // Google Docs content read (documents.get)
```

**Why not `drive.readonly`?** `drive.readonly` grants read access to ALL files in a user's Drive. If our OAuth client is ever compromised, the blast radius is every connected user's entire Drive. With `drive.metadata.readonly` + `documents.readonly`, the attacker can only list file metadata and read Google Docs — not download arbitrary files (PDFs, spreadsheets, images, etc.).

These are requested upfront during the standard Google Calendar connection flow. Users may decline them — that's fine.

### Runtime Scope Detection

After OAuth callback, check which scopes were actually granted:

```typescript
const grantedScopes = tokenResponse.scope.split(' ');
const hasDriveScope =
  grantedScopes.includes('https://www.googleapis.com/auth/drive.metadata.readonly') &&
  grantedScopes.includes('https://www.googleapis.com/auth/documents.readonly');
```

Store `hasDriveScope: boolean` on GoogleAccount so `GoogleMeetProvider.isAvailable()` can check it without re-introspecting tokens every time.

### Re-auth Flow

If the user didn't grant Drive scopes initially, they can re-auth from calendar settings:

1. New API endpoint: `POST /calendar/accounts/:accountId/reauth`
2. **Security: ownership check required** — must verify `{ id: accountId, userId: user.id }` before generating the OAuth URL. Return 404 if the account doesn't belong to the authenticated user. This prevents IDOR where user A triggers re-auth on user B's account.
3. Generate OAuth URL with `include_granted_scopes=true` + Drive/Docs scopes
4. Embed `user.id` (the authenticated caller) in the HMAC-signed state parameter — same pattern as existing connect flow
5. Callback verifies state-embedded userId matches session, updates GoogleAccount with new tokens + `hasDriveScope: true`
6. Trigger `coordinator.initialSync(userId, "google_meet")` to backfill last 30 days of Meet notes
7. GoogleMeetProvider becomes available for this user going forward

### CalendarEvent Schema Addition

Add `conferenceId String?` to CalendarEvent. This is a short opaque string (not PII) used to correlate Meet artifacts.

**Extraction point:** In `calendar-sync.ts:upsertEvents()`, extract `conferenceData.conferenceId` from the raw Google event BEFORE calling `scrubRawEvent()`, and include it in the `eventData` object:

```typescript
conferenceId: event.conferenceData?.conferenceId ?? null,
```

`scrubRawEvent()` continues to strip the full `conferenceData` object — we only persist the ID.

## Cron Integration

### User Discovery (Critical Change)

Currently, the post-meeting cron queries `prisma.granolaAccount.findMany()` to discover users — this means Google-only users never trigger. The fix:

**Post-meeting cron user discovery:** Query CalendarEvent directly for recently-ended events. The cron already does this to find events in the 5-15 minute window — use the `userId` from those events. Then call `coordinator.syncForEvent(userId, calendarEvent)` which internally checks `registry.getAvailable(userId)` to determine which providers are connected.

**Periodic sweep user discovery:** Query the union of users with either a GranolaAccount OR a GoogleAccount with `hasDriveScope = true`. This replaces the current `granolaAccount.findMany()` query.

### Existing Crons (Modified)

**Post-meeting sync (every 5 minutes):**
Currently: finds recently-ended events → queries GranolaAccount users → calls `syncAfterMeeting()`
Change: finds recently-ended events → calls `coordinator.syncForEvent(userId, calendarEvent)` for each event's userId. No provider-specific user discovery needed — the event itself identifies the user.

**Periodic sweep (every 30 minutes):**
Currently: calls `incrementalGranolaSync()` per GranolaAccount user
Change: queries all users with any provider connected → calls `coordinator.syncRecent(userId, since, until)` for each. Working hours gate (8am-7pm) still applies.

### No New Crons Needed

The existing cron schedule handles both providers. Google Meet artifacts appear on a similar timeline to Granola (5-15 min post-meeting), so the 5-minute post-meeting trigger catches both.

## Google Drive / Docs API Integration

### New Library: google-drive.ts

```typescript
// apps/api/src/lib/google-drive.ts

// Get authenticated Drive client (reuses GoogleAccount tokens)
function getDriveClient(googleAccount: GoogleAccount): drive_v3.Drive;

// Get authenticated Docs client
function getDocsClient(googleAccount: GoogleAccount): docs_v1.Docs;

// Find Meet transcript/notes docs linked to a calendar event
async function findMeetArtifacts(
  driveClient: drive_v3.Drive,
  calendarEvent: CalendarEvent,
): Promise<{ transcriptFileId: string | null; notesFileId: string | null }>;

// Parse a Google Doc transcript into structured turns
async function parseTranscriptDoc(
  docsClient: docs_v1.Docs,
  fileId: string,
): Promise<MeetingTranscriptTurn[]>;

// Parse a Google Doc meeting notes into summary text
async function parseMeetingNotesDoc(
  docsClient: docs_v1.Docs,
  fileId: string,
): Promise<string>;
```

**Artifact discovery strategy:**

1. **Primary: calendar event attachments** — Check CalendarEvent.attachments for Google Docs matching transcript/notes patterns (`mimeType: "application/vnd.google-apps.document"` with title "Transcript - ..." or meeting notes naming conventions). This is the reliable path — Google Meet auto-attaches these.

2. **Fallback: Drive search** — Only if no attachments found. Query Drive API with properly escaped parameters:
   ```
   mimeType='application/vnd.google-apps.document'
   and name contains '{escapedTitle}'
   and createdTime > '{eventStart - 1h}'
   and createdTime < '{eventEnd + 2h}'
   ```
   **Security: escape single quotes** in `escapedTitle` (replace `'` with `\'`) to prevent Drive query injection. An unescaped title like "Alice's 1:1" would break the query syntax; a malicious title could alter query semantics.

3. **Tiebreaker** when Drive search returns multiple candidates: prefer the doc whose `createdTime` is closest to `eventEnd`. Log when multiple candidates are found for debugging.

4. Distinguish transcript vs notes by title pattern: "Transcript - ..." vs meeting title or "Meeting notes - ..."

**Transcript doc parsing:**

Google Meet transcripts follow a consistent format:
```
[HH:MM:SS] Speaker Name
Spoken text here...

[HH:MM:SS] Another Speaker
More spoken text...
```

Parse line-by-line into `MeetingTranscriptTurn[]` with `source: "speaker"`, `speaker`, and `text` fields.

**Meeting notes doc parsing:**

Freeform collaborative content. Use Google Docs API `documents.get` to retrieve structured content elements, then flatten to plain text for the summary field. Preserve any bullet-list structure (may contain manually-written action items that the extraction pipeline can pick up).

## Settings UI Changes

### Calendar Settings Section

In `CalendarSection.tsx`, within the Google Calendar connected account area, add:

**Google Meet Notes status indicator + re-auth button:**

- If `hasDriveScope` is true: show green indicator "Meeting notes enabled"
- If `hasDriveScope` is false: show amber "Enable meeting notes" button that triggers re-auth flow

This sits within the existing connected Google Calendar account row, below the calendar list toggles.

### API Additions

- `GET /calendar/accounts/:id` — return `hasDriveScope` in response
- `POST /calendar/accounts/:id/reauth` — initiate re-auth with Drive scope

## Embedding Pipeline

No structural changes needed. The existing `assembleMeetingNoteText()` function works on the merged MeetingNote record. When a new source merges in updated transcript/summary data:

1. Call `enqueueEmbed({ entityType: "meeting_note", entityId, userId })` 
2. The pipeline re-assembles text from the (now-updated) MeetingNote
3. ContentHash check skips chunks that haven't changed
4. Only new/modified chunks get re-embedded

## Action Item Extraction

No structural changes. Extract on first source arrival only:

- When `coordinator.syncForEvent()` creates a new MeetingNote (first source), it calls `processActionItems()` using that source's summary
- When a later source merges in, action items are NOT re-extracted
- The `provider` field on MeetingNote tracks which provider's data was used for extraction (for debugging)

If the user triggers manual reprocessing (existing "reprocess" endpoint), it uses the current merged summary.

## Security

### PII Scrubbing for Raw Data

`MeetingNoteSource.rawData` must be scrubbed before storage, following the same pattern as `scrubRawEvent()` for calendar events.

Implement `scrubProviderRawData(provider: string, rawData: unknown): unknown`:

- **Granola:** Strip attendee emails from rawData, keep structural fields needed for re-parsing (meeting ID, title, timestamps). The full MCP response contains speaker names and emails.
- **Google Meet:** Strip `suggestionsViewMode`, `namedStyles`, suggested insertion/deletion author metadata from Docs API responses. Keep structural document content only.

This function is called by the coordinator before creating MeetingNoteSource records.

### Account Resolution Guard

When any provider resolves an account from an ID, always include `userId` in the query:

```typescript
// CORRECT — prevents cross-user access
prisma.googleAccount.findFirst({ where: { id: accountId, userId } })

// WRONG — accountId alone could reference another user's account
prisma.googleAccount.findFirst({ where: { id: accountId } })
```

This is enforced at the provider level, not the coordinator — each provider is responsible for its own account lookups.

### Drive Query Safety

All user-derived strings interpolated into Drive API `q` parameters must have single quotes escaped (`'` → `\'`). See the artifact discovery strategy section for details.

## Error Handling

- **Drive scope not granted:** `GoogleMeetProvider.isAvailable()` returns false. No errors, no noise.
- **Drive API rate limit:** Retry with exponential backoff (3 attempts). Log and skip on failure — the periodic sweep will catch it later.
- **Google Doc not parseable:** Store scrubbed rawData, set transcript/summary to null. Log warning. The MeetingNote still gets created from other sources or with partial data.
- **Granola auth stale + Google available:** Each provider is independent. Granola auth errors create a re-link task (existing behavior). Google continues working.
- **Both providers return data simultaneously:** Merge step is serialized (not parallel). MeetingNoteSource unique constraint prevents duplicates. MeetingNote upsert by `[userId, calendarEventId]` prevents duplicate parent records. Merge is idempotent.
- **P2002 (unique constraint violation):** Catch and log gracefully (same pattern as existing Granola sync) — indicates a concurrent sync already handled this source.

## Initial Sync Triggers

Each provider needs a defined trigger for its initial backfill:

| Provider | Trigger | Backfill Window |
|----------|---------|-----------------|
| Granola | After Granola OAuth callback (existing) | Last 30 days |
| Google Meet | After re-auth callback sets `hasDriveScope = true` | Last 30 days |
| Google Meet | After initial Google Calendar connect, if Drive scopes were granted | Last 30 days |

Both trigger `coordinator.initialSync(userId, provider)` which calls `provider.fetchRecent(userId, since, until)` with the 30-day window, then processes results through the normal merge flow with `extractActions: true`.

## SSE Events

Replace the Granola-specific `granola.meeting.synced` event with a provider-agnostic event:

- **`meeting.note.synced`** — published by coordinator after any successful merge. Payload: `{ meetingNoteId, calendarEventId, sources: string[], newSourceCount: number }`. Desktop UI listens for this to refresh meeting note views.
- **`meeting.note.action_items.created`** — published after action item extraction creates tasks. Same as existing `granola.action_items.created` but renamed for consistency. Payload: `{ meetingNoteId, count }`.

## Files to Create

| File | Purpose |
|------|---------|
| `apps/api/src/services/meeting-providers/types.ts` | Provider interface + ProviderMeetingData |
| `apps/api/src/services/meeting-providers/registry.ts` | Provider registry singleton |
| `apps/api/src/services/meeting-providers/coordinator.ts` | Sync orchestration + merge logic + PII scrubbing |
| `apps/api/src/services/meeting-providers/granola-provider.ts` | Granola adapter (wraps existing sync logic) |
| `apps/api/src/services/meeting-providers/google-meet-provider.ts` | Google Meet adapter |
| `apps/api/src/lib/google-drive.ts` | Drive + Docs API client + query escaping |
| Phase 1 migration file | Add tables/columns, backfill MeetingNoteSource |
| Phase 2 migration file | Drop Granola-specific columns from MeetingNote |

## Files to Modify

| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | MeetingNote changes + MeetingNoteSource + CalendarEvent.conferenceId + GoogleAccount.hasDriveScope |
| `apps/api/src/lib/google-calendar.ts` | Add `drive.metadata.readonly` + `documents.readonly` scopes |
| `apps/api/src/services/calendar-sync.ts` | Extract conferenceId in `upsertEvents()` before `scrubRawEvent()` |
| `apps/api/src/jobs/cron.ts` | Replace Granola-specific cron calls with coordinator, fix user discovery |
| `apps/api/src/routes/granola-auth.ts` | Meeting note routes become provider-agnostic |
| `apps/api/src/routes/calendar-accounts.ts` | Add reauth endpoint (with ownership check), return hasDriveScope, trigger initial sync |
| `packages/types/src/meeting-notes.ts` | Update types for multi-source |
| `apps/desktop/src/settings/CalendarSection.tsx` | Add Google Meet notes status + re-auth UI |
| `apps/desktop/src/api/calendar-accounts.ts` | Add reauth hook |
| `packages/ai/src/embedding/assembler.ts` | No changes needed (works on merged MeetingNote) |

## Testing Strategy

### Unit Tests
- Provider interface compliance for both Granola and Google Meet providers
- Merge logic: field-level priority rules, idempotency (merge same data twice → no change)
- Transcript doc parsing: standard format, edge cases (empty doc, malformed timestamps)
- Meeting notes doc parsing: freeform content → summary text
- Drive query escaping: titles with single quotes, special characters
- `scrubProviderRawData`: verify PII is stripped for each provider type
- Scope detection: parse various `tokenResponse.scope` strings correctly

### Integration Tests
- Full coordinator flow with mocked providers: fetch → merge → MeetingNote + MeetingNoteSource created
- Cron trigger → coordinator → MeetingNote creation for Google-only user (no Granola)
- Re-auth flow: ownership check rejects wrong user, accepts correct user, updates hasDriveScope
- Two-phase migration: Phase 1 backfill creates correct MeetingNoteSource rows

### Edge Cases
- Both providers return data for same meeting → one MeetingNote, two MeetingNoteSource rows
- Only one provider available → works identically to single-source today
- Drive scope missing → GoogleMeetProvider.isAvailable() returns false, Granola still works
- Google Doc parsing failures → MeetingNote created with partial data, logged
- Empty transcripts → MeetingNote created with null transcript, no embedding failure
- Concurrent sync runs → P2002 caught gracefully, no duplicate records
- Calendar event with no conferenceId → Drive fallback search triggers
- Event title with single quotes → Drive query doesn't break
