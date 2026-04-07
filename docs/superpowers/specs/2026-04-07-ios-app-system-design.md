# Brett iOS App — System Design

**Date:** 2026-04-07
**Status:** Draft
**Branch:** `feat/mobile-v1`

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stack | React Native (Expo 53) + Swift native extensions | TypeScript sharing for 80% of app, native Swift for platform features (widgets, Siri, Live Activities) |
| Scope | Full feature parity with desktop | All features — tasks, lists, inbox, calendar, scouts, AI chat, briefings, content capture, meeting notes, attachments, search, settings |
| Offline | Full offline-first | Local SQLite, mutation queue, background sync, field-level conflict resolution |
| Auth | Email/password + Google OAuth + Sign in with Apple + Face ID/Touch ID | Apple requires Sign in with Apple if you offer other social login. Face ID is table stakes. |
| Background sync | BGTaskScheduler + silent push notifications | Most reliable combo for keeping data fresh on iOS |
| Push notifications | Full notification surface | Any event can trigger — specific triggers specced separately |
| Expo SDK | 53 (latest) | New Architecture by default, best native module bridging |

---

## 1. High-Level Architecture

### System Context

```
┌─────────────────────────────────────────────────────────┐
│                    Brett Monorepo                        │
│                                                         │
│  packages/                                              │
│    @brett/types      ─── shared TS interfaces ──────┐   │
│    @brett/utils      ─── helpers (dates, IDs, etc) ──┤   │
│    @brett/business   ─── domain logic (validation) ──┤   │
│                                                      │   │
│  apps/                                               │   │
│    api/              ─── Hono + Prisma (Railway) ────┤   │
│    desktop/          ─── Electron + React ───────────┤   │
│    mobile/           ─── Expo 53 + React Native ─────┘   │
│      ├── app/              (Expo Router screens)         │
│      ├── src/                                            │
│      │   ├── db/           (SQLite + sync engine)        │
│      │   ├── api/          (HTTP client + SSE)           │
│      │   ├── auth/         (better-auth + Apple + FaceID)│
│      │   ├── hooks/        (React hooks for data access) │
│      │   ├── components/   (RN components)               │
│      │   ├── notifications/ (push + local)               │
│      │   └── store/        (Zustand app state)           │
│      ├── native/                                         │
│      │   ├── widget-bridge/ (Expo Module — JS↔Swift)     │
│      │   ├── widgets/      (Swift WidgetKit targets)     │
│      │   ├── intents/      (Swift App Intents for Siri)  │
│      │   └── share/        (Share Extension target)      │
│      └── ios/              (generated Xcode project)     │
└─────────────────────────────────────────────────────────┘
```

### Code Sharing Strategy

| Layer | Shared with desktop | Mobile-specific |
|-------|-------------------|-----------------|
| Types/interfaces | `@brett/types` | -- |
| Validation/business logic | `@brett/business` | -- |
| Utilities | `@brett/utils` | -- |
| API endpoints | Same REST API | Different HTTP client (offline-aware) |
| Auth provider | Same better-auth server | + Sign in with Apple, Face ID |
| UI components | Nothing | All new (React Native primitives) |
| State management | Nothing | Offline-first Zustand + SQLite |
| Real-time | Same SSE event types | Different transport (SSE foreground, silent push background) |

`@brett/ui` is NOT imported by mobile. It's web-only React (HTML, Tailwind, framer-motion). Mobile builds its own component library with React Native primitives, `react-native-reanimated`, native blur views, and platform-native patterns. This is what gives it an iOS-native feel rather than a "web app in a shell" feel.

When Android ships later, the React Native mobile app shares ~95% of its code with Android — that's the real cross-platform payoff.

---

## 2. Offline-First Data Layer

This is the most architecturally significant piece. Every user interaction writes locally first, syncs to the server in the background, and handles conflicts gracefully.

### 2.1 Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Local storage | `expo-sqlite` | Ships with Expo 53, synchronous API, zero extra native deps |
| ORM | Drizzle ORM (`drizzle-orm/expo-sqlite`) | Type-safe queries, migration management, mirrors Prisma mental model |
| Sync engine | Custom (~1500-2000 LOC) | Purpose-built for our API, single-user sync is simple enough to own without a framework |

**Why not WatermelonDB:** Single maintainer, maintenance cadence slowing, dependency risk for critical infrastructure.

**Why not PowerSync:** Adds infrastructure (sync service connecting to Postgres). Library > service for this use case.

**Why custom is OK here:** Brett is single-user, multi-device. No collaborative editing, no CRDTs needed, no operational transforms. The sync engine is a mutation queue + incremental pull + field-level merge. Well within "own it" territory.

### 2.2 Local SQLite Schema

#### Data Tables (mirror server Prisma models)

```
items              — tasks + content (all fields from Prisma Item model)
lists              — user's lists
calendar_events    — synced Google Calendar events
calendar_event_notes — user's private notes on events
scouts             — scout configs
scout_findings     — findings
brett_messages      — chat history per item/event
attachments        — metadata only (file bytes stay on S3)
user_profile       — cached user data + preferences (singleton row)
```

Every synced table has these metadata columns:

```sql
_syncStatus     TEXT DEFAULT 'synced'
  -- 'synced' | 'pending_create' | 'pending_update' | 'pending_delete' | 'provisional' | 'conflict'
_baseUpdatedAt  TEXT
  -- server's updatedAt when this record was last synced (NOT phone clock)
_lastError      TEXT
  -- error message if sync failed (null when clean)
```

#### Sync Infrastructure Tables

```sql
_mutation_queue (
  id                 TEXT PRIMARY KEY,    -- client UUID, doubles as idempotency key
  idempotency_key    TEXT UNIQUE,         -- prevents duplicate server processing on retry
  entity_type        TEXT NOT NULL,       -- 'item', 'list', 'calendar_event', etc.
  entity_id          TEXT NOT NULL,       -- server ID of the affected record
  action             TEXT NOT NULL,       -- 'CREATE' | 'UPDATE' | 'DELETE' | 'CUSTOM'
  endpoint           TEXT NOT NULL,       -- full API path: '/things/abc123'
  method             TEXT NOT NULL,       -- 'POST' | 'PATCH' | 'DELETE'
  payload            TEXT NOT NULL,       -- JSON body
  changed_fields     TEXT,               -- JSON array: ["title","dueDate"] (UPDATE only)
  previous_values    TEXT,               -- JSON: field values BEFORE the local edit
  base_updated_at    TEXT,               -- record's server updatedAt at mutation time
  before_snapshot    TEXT,               -- JSON: full record state before mutation (for rollback)
  depends_on         TEXT,               -- mutation_queue.id (for ordered dependencies)
  batch_id           TEXT,               -- groups related mutations (e.g., bulk triage)
  status             TEXT DEFAULT 'pending',  -- pending | in_flight | failed | dead | blocked
  retry_count        INTEGER DEFAULT 0,
  error              TEXT,               -- last error message/code
  error_code         INTEGER,            -- HTTP status code of last failure
  created_at         TEXT NOT NULL
)

_attachment_uploads (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL,
  local_file_path TEXT NOT NULL,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  stage           TEXT DEFAULT 'pending',  -- pending | requesting_url | uploading | confirming | done | failed
  presigned_url   TEXT,
  storage_key     TEXT,
  upload_progress REAL DEFAULT 0,          -- 0.0 to 1.0
  error           TEXT,
  retry_count     INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL
)

_sync_cursors (
  table_name      TEXT PRIMARY KEY,
  last_synced_at  TEXT,                    -- server timestamp of last successful pull
  is_initial_sync_complete INTEGER DEFAULT 0
)

_conflict_log (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  mutation_id     TEXT,
  local_values    TEXT NOT NULL,            -- JSON: what we tried to write
  server_values   TEXT NOT NULL,            -- JSON: what the server had
  conflicted_fields TEXT,                   -- JSON array: fields where server won
  resolution      TEXT NOT NULL,            -- 'server_wins' | 'merged'
  resolved_at     TEXT NOT NULL
)

_sync_health (
  id                        TEXT PRIMARY KEY DEFAULT 'singleton',
  last_successful_push_at   TEXT,
  last_successful_pull_at   TEXT,
  pending_mutation_count    INTEGER DEFAULT 0,
  dead_mutation_count       INTEGER DEFAULT 0,
  is_pushing                INTEGER DEFAULT 0,
  is_pulling                INTEGER DEFAULT 0,
  last_error                TEXT,
  consecutive_failures      INTEGER DEFAULT 0
)
```

#### Schema Design Decisions

- **IDs are client-generated UUIDs** for offline-created records. Uses `@brett/utils/generateId()` — same function as the server. No collision risk with UUIDs.
- **JSON columns** for nested data (attendees, sources, tool calls). SQLite handles this with `json_extract()`.
- **No foreign key enforcement in SQLite.** FKs would break during partial syncs (item arrives before its list). Referential integrity is enforced at the application layer and by the server. UI handles dangling references gracefully (e.g., item references a list that hasn't synced yet — show item without list badge).
- **Timestamps are always server-issued ISO strings.** Phone clock is never used for sync decisions. Eliminates clock skew.
- **WAL mode enabled** for concurrent read/write access:

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=OFF;
```

### 2.3 Sync Engine Architecture

Five components, each with a single responsibility:

```
┌──────────────────────────────────────────────────────────┐
│                     SyncManager                           │
│  Orchestrates sync cycles. Decides when to pull/push.     │
│  Holds sync lock. Exposes status to UI.                   │
│                                                           │
│  Cycle: PUSH first → then PULL                            │
│  (Push first so server has our changes before we pull)    │
│                                                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │ PushEngine   │  │ PullEngine   │  │ NetworkMonitor   │ │
│  │              │  │              │  │                  │ │
│  │ Drains the   │  │ Fetches      │  │ @react-native-   │ │
│  │ mutation     │  │ changes from │  │ community/netinfo│ │
│  │ queue FIFO   │  │ server since │  │ + /health ping   │ │
│  │              │  │ last cursor  │  │                  │ │
│  │ Handles:     │  │              │  │ Emits:           │ │
│  │ • field merge│  │ Handles:     │  │ • online         │ │
│  │ • idempotency│  │ • pagination │  │ • offline        │ │
│  │ • retries    │  │ • table order│  │                  │ │
│  │ • dep chains │  │ • tombstones │  │                  │ │
│  │ • coalescing │  │ • upserts    │  │                  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────────────┘ │
│         │                │                                │
│  ┌──────▼────────────────▼──────┐                        │
│  │      ConflictResolver         │                        │
│  │                               │                        │
│  │  Field-level merge logic      │                        │
│  │  previousValues comparison    │                        │
│  │  Logs all resolutions         │                        │
│  └──────────────────────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

### 2.4 Mutation Queue — Processing

#### Mutation Lifecycle

```
pending → in_flight → [success: dequeued]
                    → [409 conflict: resolved via ConflictResolver, dequeued]
                    → [400/422 permanent: rollback from before_snapshot, status='dead', notify user]
                    → [404 gone: dequeued (record deleted elsewhere, desired state)]
                    → [5xx/network: status='pending', retryCount++, exponential backoff]
                    → [retryCount >= 10: status='dead', notify user]
```

Network errors have no max retry (they'll resolve). Server errors cap at 10 retries.

#### Mutation Compaction

Before pushing, compact the queue to minimize network calls:

```
Multiple UPDATEs to same record:
  → Merge into one UPDATE with union of changedFields
  → previousValues: earliest mutation's values
  → base_updated_at: earliest mutation's timestamp

CREATE followed by UPDATEs:
  → Merge UPDATEs into the CREATE payload

CREATE followed by DELETE:
  → Remove both (net zero — never existed on server)

UPDATE followed by DELETE:
  → Keep only the DELETE
```

#### Dependency Chains

Mutations can depend on each other via `depends_on`:

```
Mutation A: POST /lists {name: "Work"}              depends_on: null
Mutation B: POST /things {title: "...", listId: X}   depends_on: A

Processing:
  1. Process A → server returns real ID
  2. Rewrite B's payload: replace local list ID with server ID
  3. Process B

If A fails permanently → B marked 'blocked', user notified
```

**ID mapping:** When the server returns a different ID than the client-generated one (unlikely with UUIDs, but possible), the sync engine rewrites all pending mutations referencing the old ID.

### 2.5 Field-Level Conflict Resolution

Each UPDATE mutation carries `previousValues` — the field values from SQLite before the local edit.

```
Client sends:
{
  changedFields: ["title"],
  payload: { title: "Buy groceries" },
  previousValues: { title: "Buy milk" },
  baseUpdatedAt: "T0"
}

Server merge logic:
  For each field in changedFields:
    if server.record[field] == mutation.previousValues[field]:
      → Server hasn't changed this field → apply client's value
    else:
      → Field changed elsewhere → server wins → add to conflictedFields

  Return: merged record + list of conflicted fields (if any)
```

**Example — non-overlapping fields (both changes preserved):**

```
Phone (offline): changes title to "Buy groceries"
Desktop: changes dueDate to tomorrow

Push: { changedFields: ["title"], previousValues: { title: "Buy milk" } }
Server: current title is "Buy milk" (unchanged) → apply → title = "Buy groceries"
Server: dueDate was changed by desktop → not in changedFields → untouched

Result: title = "Buy groceries", dueDate = tomorrow. Both edits preserved.
```

**Example — overlapping field (server wins):**

```
Phone (offline): marks task complete
Desktop: marks task not-complete (more recently)

Push: { changedFields: ["status"], previousValues: { status: "active" }, payload: { status: "done" } }
Server: current status is "active" (desktop set it back) — BUT previousValues.status == "active" == current?

Wait — this case needs the timestamp check too:
  server.updatedAt (T3) > mutation.baseUpdatedAt (T0)
  AND server.record.status ("active") == previousValues.status ("active")
  → Field value matches but record was modified after our snapshot
  → This means desktop changed status to done, then back to active
  → previousValues match IS the right check — server hasn't diverged on this field
  → Apply client's change: status = "done"

Actually, this is the correct behavior: the desktop user set it back to active,
but the phone user's intent to complete it is also valid. Since the server's
current value for status matches what the phone expected, there's no conflict.
The phone's change applies.

If the desktop had set status to "archived" (different from previousValues "active"):
  → previousValues.status ("active") != server.status ("archived")
  → Conflict: server wins, status stays "archived"
```

### 2.6 Provisional Recurrence (Offline Completion)

When a recurring task is completed offline, the next occurrence doesn't exist yet (server generates it). To prevent a jarring gap in the UI:

```
1. Mark current task done locally (optimistic)
2. Read recurrenceRule from the record
3. Call @brett/business computeNextDueDate(recurrenceRule, currentDueDate)
4. Create provisional next occurrence in local SQLite:
   {
     id: generateId(),
     ...parentTask (title, list, reminder, recurrence fields),
     dueDate: computedNextDate,
     status: "active",
     completedAt: null,
     _syncStatus: "provisional",
     _provisionalParentId: parentTask.id
   }
5. Do NOT enqueue a CREATE mutation for the provisional record
6. Queue only the toggle mutation for the completed task

On sync:
  → Push toggle mutation → server creates real next occurrence
  → Pull brings back server-generated next occurrence
  → Match provisional by: _provisionalParentId + dueDate proximity (within 1 day)
  → Replace provisional with server record (server ID, server timestamps)
  → If no match (server logic differs): delete provisional, use server version
```

### 2.7 Attachment Upload Saga

Attachments are multi-step operations with their own state machine, separate from the mutation queue:

```
Stage transitions:

pending → requesting_url → uploading → confirming → done
              │                │            │
              ▼                ▼            ▼
           failed          failed       failed
         (retry)     (if URL expired,   (retry — file
                      back to pending)   already on S3)

pending:
  → POST /things/:itemId/attachments/presign { filename, mimeType, sizeBytes }
  → Returns: { presignedUrl, storageKey }
  → Save to _attachment_uploads record

uploading:
  → PUT file to presigned S3 URL
  → Track upload progress (0.0 → 1.0 for UI progress bar)
  → If presigned URL expired (403): go back to 'pending'

confirming:
  → POST /things/:itemId/attachments/confirm { storageKey, filename, mimeType, sizeBytes }
  → Creates server-side attachment record
  → Returns attachment with ID and download URL

done:
  → Create local attachment record in SQLite
  → Remove from _attachment_uploads
  → Optionally cache file locally, or delete local copy
```

**Resumability:** App killed at any stage → on next launch, resume from last completed stage. Presigned URLs expire (1 hour TTL) — if expired, request a new one.

**Separate queue from mutations.** Attachment uploads are long-running and shouldn't block the fast mutation queue. SyncManager processes both: mutations first (fast), then attachments (slow).

### 2.8 Pull Protocol

```
POST /sync/pull
Request:
{
  cursors: {
    items: "2026-04-07T10:00:00Z",       // null for initial sync
    lists: "2026-04-07T09:30:00Z",
    calendar_events: "2026-04-07T10:00:00Z",
    scouts: "2026-04-07T08:00:00Z",
    scout_findings: null,
    brett_messages: "2026-04-07T10:00:00Z",
    attachments: "2026-04-07T10:00:00Z"
  },
  limit: 500   // records per table per page
}

Response:
{
  changes: {
    items: {
      upserted: [{ id, title, status, ..., updatedAt }],
      deleted: ["id_1", "id_2"],     // tombstones (soft-deleted)
      hasMore: false
    },
    lists: { upserted: [...], deleted: [...], hasMore: false },
    ...
  },
  cursors: {                          // new cursors to store
    items: "2026-04-07T12:00:00Z",
    lists: "2026-04-07T12:00:00Z",
    ...
  },
  serverTime: "2026-04-07T12:00:01Z"
}
```

**No selective sync scopes for v1.** All records (active, done, archived) returned per table. Paginated at 500 records per page. Selective scoping deferred until real-world sync payload sizes justify it.

**Upsert logic on pull:**
- Record exists locally AND `_syncStatus` is `synced` → overwrite with server data
- Record exists locally AND `_syncStatus` is `pending_*` → skip (don't clobber unsent local changes)
- Record doesn't exist locally → insert
- ID in `deleted` list → remove from local SQLite

**Table ordering for initial sync:** Lists before items (items reference lists). Scouts before scout_findings. User profile first (needed for UI chrome).

### 2.9 Push Protocol

```
POST /sync/push
Request:
{
  mutations: [
    {
      idempotencyKey: "uuid-1",
      entityType: "item",
      entityId: "item_123",
      action: "UPDATE",
      payload: { title: "Buy groceries", status: "done" },
      changedFields: ["title", "status"],
      previousValues: { title: "Buy milk", status: "active" },
      baseUpdatedAt: "2026-04-07T10:00:00Z"
    }
  ]
}

Response:
{
  results: [
    {
      idempotencyKey: "uuid-1",
      status: "applied",          // "applied" | "merged" | "conflict" | "error"
      record: { ... },            // full current server state (always returned)
      conflictedFields: [],       // fields where server won
      error: null
    }
  ],
  serverTime: "2026-04-07T12:00:01Z"
}
```

**Server processing per mutation:**
1. Check `IdempotencyKey` table → if already processed, return cached result
2. Fetch current record from DB
3. If `action == CREATE`: insert (idempotency key prevents duplicates)
4. If `action == DELETE`: soft-delete (idempotent — deleting twice is fine)
5. If `action == UPDATE`: run field-level merge (see section 2.5)
6. Store idempotency key + result
7. Return merged record state

### 2.10 Initial Sync (First Login)

Prioritized, paginated, progressive — app becomes usable before sync completes:

```
Phase 1 — app usable after this (~1-2 seconds):
  1. user_profile                      (1 record)
  2. lists                             (typically <20 records)
  3. items                             (paginated, 500 per page)

Phase 2 — background, app is interactive:
  4. calendar_events                   (paginated)
  5. scouts                            (typically <10)
  6. scout_findings                    (paginated)

Phase 3 — lazy, on-demand:
  7. brett_messages                     (when detail panel opened)
  8. attachments                       (metadata only, files on-demand)
```

UI shows a subtle progress indicator during phases 1-2. App is fully interactive after phase 1 — user can create tasks, browse lists, etc. even while background sync continues.

**Resumable:** If interrupted (app killed, network lost), partially-synced tables have valid cursors. On next launch, tables with cursors do incremental sync; tables without cursors resume from where they left off.

### 2.11 Sync Triggers

| Trigger | Action | Priority |
|---------|--------|----------|
| App launched / foregrounded | Push then Pull | High |
| Pull-to-refresh gesture | Pull | High |
| Mutation created | Push (debounced 1s) | High |
| Network reconnected (was offline) | Push then Pull | High |
| Silent push notification received | Targeted pull (hinted table) | Medium |
| SSE event received (foreground) | Targeted pull (specific record) | Medium |
| BGTaskScheduler wakeup | Push then Pull | Low |
| Timer (every 5 min while active) | Pull | Low |

### 2.12 Error Handling — All Failure Paths

| Failure | Behavior |
|---------|----------|
| **Network unreachable** | Leave in queue. Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, cap 5min. Listen for network restore → immediate retry. No max retries (will resolve). |
| **HTTP 400/422 (validation)** | Permanent failure. Restore local record from `before_snapshot`. Move to 'dead'. Notify user: "Couldn't save: {reason}". |
| **HTTP 401 (auth expired)** | Pause all sync. Silent token refresh. On success: resume. On failure: route to sign-in. |
| **HTTP 409 (conflict)** | Normal path — run field-level merge. Update local with merged result. Log to `_conflict_log`. |
| **HTTP 404/410 (gone)** | Record deleted on server. Remove from local SQLite. Dequeue mutation. |
| **HTTP 5xx (server error)** | Retry with backoff. After 10 retries: move to 'dead', notify user. |
| **App killed during push** | Mutation was 'in_flight'. On next launch: reset to 'pending', re-process. Idempotency key prevents duplicate application. |
| **Stale cursor (>30 days)** | Server returns `{ fullSyncRequired: true }`. Phone does fresh initial sync. |

### 2.13 Optimistic UI + Rollback

```
User action → mutation handler:
  1. Read current record from SQLite (for before_snapshot + previousValues)
  2. Write updated record to SQLite (optimistic)
  3. Update Zustand store → UI re-renders immediately
  4. Update widget data via WidgetBridge
  5. Enqueue mutation in _mutation_queue
  6. Trigger sync push (debounced 1s)

On sync response:
  Success → update local record with server response (may include server-computed fields)
  Merged  → update local with merged result (some fields may differ from optimistic)
  Rejected → restore from before_snapshot, notify user inline
```

### 2.14 Sync Lock

```
Two locks:
  pushLock — one push operation at a time
  pullLock — one pull operation at a time

Push and pull CAN run concurrently (different data paths).
Two pulls CANNOT (would corrupt cursors).
Two pushes CANNOT (would duplicate mutations).

Implementation: simple boolean + callback queue.
If locked, queue the request, execute when lock releases.
```

### 2.15 Calendar Event Sync — Simplified Model

Calendar events are primarily read-only from the mobile perspective:

```
PULL: Full sync — server syncs from Google Calendar, mobile pulls results
PUSH: Only three mutation types:
  • PATCH /calendar/events/:id/rsvp     — update RSVP status
  • PUT /calendar/events/:id/notes      — upsert private notes
  • POST /calendar/events/:id/brett     — send Brett chat message

NOT supported from mobile (use Google Calendar app):
  • Creating calendar events
  • Editing event details
  • Deleting events
```

### 2.16 Widget Data Sharing

The RN app and native Swift extensions (widgets, Siri, Share Extension) share data via an App Group:

```
App Group ID: group.com.brett.app

Contents:
  UserDefaults (App Group)          — tiny KV pairs for small/medium widgets
  /shared.sqlite                    — denormalized subset for large widgets
  /widget_mutations.json            — widget → app mutation queue
  /shared_items.json                — Share Extension → app items

Written by: RN app (after sync + after optimistic local mutations)
Read by: Widget, Siri Intents, Share Extension
```

**Tier 1 — UserDefaults (App Group):** Fast KV access, no locking.

```
Keys:
  todayTasks: JSON array [{id, title, status, listColor}]
  nextEvent: JSON {title, startTime, location, calendarColor}
  inboxCount: number
  pendingMutations: number
  lastSyncedAt: ISO string
```

**Tier 2 — Shared SQLite:** Separate database file in the App Group container. Contains only today's tasks and today's events. Written by RN app, read-only by widgets.

**WidgetBridge Expo Module** (Swift, exposed to JS):

```typescript
WidgetBridge.updateWidgetData(payload)    // write UserDefaults + shared SQLite
WidgetBridge.readWidgetMutations()        // read + clear widget_mutations.json
WidgetBridge.readSharedItems()            // read + clear shared_items.json
WidgetBridge.reloadWidgets()              // WidgetCenter.reloadAllTimelines()
```

Called after every successful sync AND after optimistic local mutations.

### 2.17 Logout Behavior

```
On sign-out:
  1. Check pendingMutationCount + pendingAttachmentUploads
  2. If > 0: warn user with dialog:
     "You have {n} unsynced changes that will be lost."
     [Sync Now] → attempt push → on success: proceed → on failure: warn again
     [Logout Anyway] → wipe and proceed
     [Cancel] → dismiss
  3. On confirmed logout:
     → Close SSE connection
     → Wipe main SQLite database
     → Wipe shared App Group SQLite
     → Clear App Group UserDefaults
     → Clear Keychain tokens (expo-secure-store)
     → Trigger widget reload (shows logged-out state)
     → Navigate to sign-in screen
```

### 2.18 What Does NOT Sync Locally

| Data | Reason |
|------|--------|
| Embeddings (1024-dim vectors) | Too large, requires pgvector |
| AI streaming responses | Real-time only, not cacheable |
| Scout run execution state | Server-side only |
| Weather data | API-proxied, short TTL, tiny payload |
| Meeting transcripts (full text) | Large, fetch on-demand |
| Attachment file bytes | Stay on S3, download on-demand with local cache |

### 2.19 Data Encryption at Rest

No SQLCipher needed. iOS provides this natively:

```
SQLite file protection: NSFileProtectionComplete
  → Database encrypted when device is locked
  → Decryption key derived from device passcode + Secure Enclave
  → Zero code on our side — set file attribute on database creation

Auth tokens: iOS Keychain via expo-secure-store
  → Hardware-encrypted
  → Accessible only when device is unlocked (WHEN_UNLOCKED_THIS_DEVICE_ONLY)
```

---

## 3. API Client & Networking

### 3.1 HTTP Client

Single `apiClient` module wrapping all HTTP calls. Uses React Native's built-in `fetch` — no axios/ky dependency.

```
Interceptor chain (applied in order):
  1. Base URL injection (env: API_URL)
  2. Auth header: Authorization: Bearer {token}
  3. Network check: if offline → throw OfflineError immediately
  4. Token refresh: on 401 → refresh token → retry once
     (mutex prevents concurrent refresh storms)
  5. Timeout: 30s default (configurable per-request)
  6. Response parsing: JSON + structured error shaping
```

**Token refresh flow:**
1. Request returns 401
2. Acquire refresh mutex (only one refresh at a time)
3. `POST /api/auth/refresh { refreshToken }`
4. Success → store new tokens → retry original request
5. Failure → emit `auth:expired` event → navigate to sign-in
6. Release mutex → queued requests retry with new token

**Offline detection:** `@react-native-community/netinfo` for reachability + `GET /health` ping as fallback (netinfo can false-positive behind captive portals).

### 3.2 SSE Client (Foreground Real-Time)

When the app is foregrounded and online, maintain an SSE connection:

```
Connect:
  1. POST /events/ticket → get short-lived auth ticket (60s TTL)
  2. GET /events/stream?ticket={ticket} → EventSource

On event received:
  Parse event type → trigger targeted pull for affected entity/table
  (SSE is a notification channel — the pull gets the actual data)

On disconnect:
  Exponential backoff reconnect: 1s, 2s, 4s, 8s, max 30s
  On reconnect: full incremental pull (cursors catch up on anything missed)
  After 5 failed reconnects: stop, rely on pull-on-foreground

On app backgrounded:
  Close SSE connection (iOS will kill it anyway)
```

**React Native SSE:** `react-native-sse` library or minimal custom EventSource using `fetch` with `ReadableStream`. The built-in `EventSource` API isn't available in RN — needs a polyfill.

### 3.3 Background Sync

Three mechanisms, layered by priority:

**1. BGTaskScheduler (iOS Background Tasks)**

```swift
// Registered: "com.brett.sync"
// iOS schedules based on usage patterns
// Budget: ~30s execution time
// Schedule: request every 15 minutes, iOS decides when
// Action: push pending mutations → pull changes → update widget data
```

**2. Silent Push Notifications**

```
Server sends APNs silent push on relevant changes:
  { "aps": { "content-available": 1 }, "syncHint": { "table": "items" } }
iOS wakes app briefly (~30s)
App runs targeted pull for hinted table
Budget: ~2-3 per hour (iOS throttled)
```

**3. Foreground sync on every app open**

Most reliable baseline. Push-then-pull on every foreground event.

---

## 4. Authentication

### 4.1 Auth Providers

```
┌──────────────────────────────────────────────────────┐
│  ┌─────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │Email/Password│  │ Google   │  │Sign in w/ Apple│  │
│  │  (existing)  │  │ OAuth    │  │    (NEW)       │  │
│  └──────┬──────┘  └────┬─────┘  └───────┬────────┘  │
│         └───────────────┼────────────────┘            │
│                         ▼                             │
│              better-auth server                       │
│              (+ Apple provider)                       │
│                         │                             │
│                         ▼                             │
│              JWT Bearer Token                         │
│                         │                             │
│                         ▼                             │
│              expo-secure-store (iOS Keychain)          │
│                         │                             │
│                         ▼                             │
│              Face ID / Touch ID (app lock)             │
└──────────────────────────────────────────────────────┘
```

### 4.2 Sign in with Apple (New)

Required by App Store if offering Google OAuth.

**Mobile side:** `expo-apple-authentication` for native iOS sheet.

```
1. User taps "Sign in with Apple"
2. Native iOS sheet: Face ID / device passcode
3. Returns: identityToken (JWT) + authorizationCode + user info
4. POST /api/auth/sign-in/social { provider: "apple", idToken, code }
5. Server validates with Apple, creates/matches user
6. Returns session token → stored in Keychain
```

**API side:** Add Apple as social provider in better-auth config.

**Apple quirk:** Name and email are only provided on FIRST sign-in. If the user chooses "Hide My Email," Apple returns a relay address. Server must persist this on first auth and not expect it again.

### 4.3 Google OAuth on iOS

Different flow from desktop (no ephemeral HTTP server):

```
1. expo-auth-session → ASWebAuthenticationSession (native Safari sheet)
2. Google sign-in completes
3. Redirect to: brett://auth/callback?token=...
4. App intercepts deep link, extracts token
5. Store in Keychain
```

API needs to support a mobile redirect URI alongside the existing desktop flow.

### 4.4 Token Storage

```
expo-secure-store (iOS Keychain):
  "auth_token"      → JWT session token
  "refresh_token"   → Refresh token
  "user_id"         → For scoping local data

Keychain config:
  accessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY
  → Not synced to other devices via iCloud Keychain
  → Deleted on device wipe

Shared Keychain Group: "com.brett.shared"
  → Widgets and Siri Intents can read auth_token for API calls
```

### 4.5 Face ID / Touch ID

App lock — not an auth mechanism. JWT is the auth; biometrics gate UI access.

```
On app foreground:
  1. Check: biometric lock enabled? (device-local preference, NOT synced)
  2. Check: time since last background > grace period?
  3. If yes to both: present biometric prompt
     → expo-local-authentication: authenticateAsync()
     → Face ID / Touch ID / device passcode fallback
  4. Success → show app
  5. Failure → stay on lock screen, retry button
  6. Biometric not enrolled → fall back to device passcode

Grace period options (user configurable):
  • Immediately (every foreground)
  • After 1 minute
  • After 5 minutes (default)
  • After 15 minutes
  • Never (disabled)

Biometric preference is device-local only (stored in expo-secure-store,
not synced to server). Enabling on iPhone doesn't enable on iPad.
```

### 4.6 Auth State Machine

```
NO_TOKEN ──── sign in/up/OAuth ────▶ AUTHENTICATING
    ▲                                       │
    │                                  success
    │                                       │
    │                                       ▼
    │                               BIOMETRIC_CHECK
    │                               (if enabled)
    │                                       │
    │                               passed / not enabled
    │                                       │
    │                                       ▼
    │                               INITIAL_SYNC
    │                               (first login only)
    │                                       │
    │                               sync complete
    │                                       │
    │                                       ▼
    └──── logout / token expired ◀──── READY
                                    (app fully usable)
```

---

## 5. State Management

### 5.1 Architecture

**Zustand** for app state — lightweight, no boilerplate, excellent React Native support.

```
React Components
  → Custom hooks (useItems, useLists, useCalendar, useSyncStatus)
    → Zustand store (in-memory, hydrated from SQLite)
      → SQLite (Drizzle ORM) — persistent, offline-safe
        → Sync engine — pushes/pulls to API
```

### 5.2 Data Flow — Reads

```
Component mounts (e.g., TodayScreen):
  → useItems({ status: "active", dueBefore: endOfWeek })
  → Reads from Zustand store (instant, in-memory)
  → If store is empty (first load): hydrate from SQLite (synchronous with Expo 53)
  → Sync engine pulls in background → SQLite updated → Zustand updated → re-render
```

### 5.3 Data Flow — Writes

```
User toggles task complete:
  → store.toggleItem(id)
    1. Read current record from SQLite (before_snapshot + previousValues)
    2. Write updated record to SQLite (optimistic)
    3. If recurring: generate provisional next occurrence
    4. Update Zustand store → UI re-renders immediately
    5. Update widget data (WidgetBridge)
    6. Enqueue mutation
    7. Trigger sync push (debounced 1s)
```

### 5.4 Store Slices

```
itemsStore:     Map<id, Item>  + selectors: today, inbox, upcoming, byList, done
listsStore:     List[]         + selectors: active, archived
calendarStore:  Map<id, Event> + selectors: forDate, upNext
scoutsStore:    Scout[]        + findings Map, memories Map
authStore:      User | null, isAuthenticated, biometricEnabled
syncStore:      SyncHealth, pendingCount, isSyncing, lastSyncedAt
uiStore:        activeDetailId, searchQuery (ephemeral, not persisted)
```

### 5.5 Why Zustand

| Alternative | Why not |
|-------------|---------|
| Redux | Boilerplate heavy, overkill |
| React Query | Designed for server-cache, not offline-first SQLite |
| Jotai/Recoil | Atom-based doesn't fit synced collections |
| MobX | Works, but Zustand is simpler and lighter |

---

## 6. Native Swift Extensions

Four native Xcode targets sharing data via App Groups.

### 6.1 WidgetKit Widgets

| Size | Content | Data Source |
|------|---------|-------------|
| **Small** | Next event countdown OR inbox count | App Group UserDefaults |
| **Medium** | Today's tasks (top 4-5) with interactive checkboxes | App Group shared SQLite |
| **Large** | Today's tasks + next 3 events | App Group shared SQLite |

**Interactive widgets (iOS 17+):** Tap checkbox to complete task without opening app.

```swift
struct ToggleTaskIntent: AppIntent {
    @Parameter(title: "Task ID") var taskId: String
    
    func perform() async throws -> some IntentResult {
        // Write to App Group: widget_mutations.json
        // App reads on next foreground → enqueues in mutation queue
    }
}
```

**Widget mutations flow:** Widget writes to `widget_mutations.json` in App Group. RN app reads on foreground via `WidgetBridge.readWidgetMutations()`, converts to proper mutation queue entries, processes normally.

### 6.2 App Intents (Siri + Shortcuts)

```swift
struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Task"
    @Parameter(title: "Title") var title: String
    @Parameter(title: "List") var list: ListEntity?
    @Parameter(title: "Due Date") var dueDate: Date?
    
    func perform() async throws -> some IntentResult & ProvidesDialog {
        // Write to App Group widget_mutations.json
        return .result(dialog: "Added '\(title)' to Brett")
    }
}

struct ShowTodayIntent: AppIntent {
    // Opens app via deep link: brett://today
}

struct SearchIntent: AppIntent {
    @Parameter(title: "Query") var query: String
    // Opens app via deep link: brett://search?q={query}
}
```

**Shortcut donations:** App donates intents based on usage patterns. Siri may suggest them proactively.

### 6.3 Live Activities (iOS 16.1+)

Upcoming meeting countdown on lock screen and Dynamic Island.

```swift
struct MeetingActivityAttributes: ActivityAttributes {
    let eventId: String
    let title: String
    let meetingLink: String?
    
    struct ContentState: Codable, Hashable {
        let minutesUntil: Int
        let status: MeetingStatus  // upcoming | starting_soon | happening_now | ended
    }
}
```

**Lifecycle:**
- Event starts in < 30 minutes → start Live Activity
- Updates every minute with countdown
- Event starts → "happening now" with meeting link
- Event ends (or 15 min after start) → end Live Activity

### 6.4 Share Extension

Share URLs/text/files from other apps into Brett's inbox:

```
Safari → Share → "Brett"
  → Minimal Swift UI: content preview + optional list picker
  → Write to App Group: shared_items.json
  → When app opens: WidgetBridge.readSharedItems() → create items via mutation queue
```

### 6.5 App Group Configuration

```
App Group ID: group.com.brett.app

/Library/Preferences/group.com.brett.app.plist  — UserDefaults
/shared.sqlite                                   — Widget SQLite
/widget_mutations.json                           — Widget → app mutations
/shared_items.json                               — Share Extension → app items
```

---

## 7. Push Notifications

### 7.1 Infrastructure

FCM wraps APNs for iOS delivery. Server sends to FCM, FCM delivers via APNs.

### 7.2 Device Registration

```
On app launch (after auth):
  1. expo-notifications: requestPermissions()
  2. Get push token
  3. POST /devices/register { token, platform: "ios", appVersion }

On token refresh: re-register automatically
On logout: POST /devices/unregister { token }
```

### 7.3 Notification Types

**Visible (user sees banner):**

| Type | Example |
|------|---------|
| `task.reminder` | "Buy groceries — due today" |
| `task.stale` | "Hey, does this still matter?" |
| `scout.finding` | "Market Watch found something: {title}" |
| `calendar.upcoming` | "Standup in 10 minutes" |
| `briefing.ready` | "Your morning briefing is ready" |
| `inbox.new` | "New item in inbox from {source}" |

**Silent (app wakes, no banner):**

| Type | Purpose |
|------|---------|
| `sync.hint` | Triggers incremental pull for specific table |
| `calendar.updated` | Calendar sync completed, pull events |
| `scout.run.completed` | Pull findings |

### 7.4 Actionable Notifications

```
task.reminder:
  [Done] → complete task from lock screen (enqueue mutation)
  [Snooze 1h] → snooze task
  [Tomorrow] → snooze to tomorrow

scout.finding:
  [View] → open app to finding (foreground)
  [Dismiss] → mark finding dismissed
```

---

## 8. API Additions — Full Summary

All server-side changes needed for mobile support:

### New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sync/pull` | POST | Incremental + initial sync pull |
| `/sync/push` | POST | Push mutations with field-level merge |
| `/things/:id/attachments/presign` | POST | Request presigned upload URL |
| `/things/:id/attachments/confirm` | POST | Confirm completed S3 upload |
| `/devices/register` | POST | Register push notification device |
| `/devices/unregister` | DELETE | Remove push notification device |

### Database Migrations

| Change | Tables Affected |
|--------|----------------|
| Add `deletedAt` column (soft deletes) | Item, List, CalendarEvent, Scout, ScoutFinding, Attachment, BrettMessage |
| Add `IdempotencyKey` table | New table |
| Add `DeviceToken` table | New table |
| Add Apple social provider | better-auth config (auto-migrated) |

### Server Logic Additions

| Addition | Scope |
|----------|-------|
| Soft-delete: update all DELETE endpoints to set `deletedAt` instead of hard delete | All delete routes |
| Tombstone cleanup cron: hard-delete where `deletedAt > 30 days` | Cron job |
| Push notification helper: fire APNs on relevant events | Integrate into existing mutation flows |
| Silent push alongside SSE: when SSE event fires, also send APNs silent push | SSE event handlers |
| Mobile OAuth redirect URI support | Auth config |
| Idempotency middleware on `/sync/push` | New middleware |

### Unchanged

All existing endpoints remain as-is. Desktop app is fully unaffected. New endpoints are additive.

---

## 9. Testing Strategy

### 9.1 Sync Engine (Highest Priority)

**Unit tests:**
- Mutation compaction: all permutations (UPDATE+UPDATE, CREATE+UPDATE, CREATE+DELETE, UPDATE+DELETE)
- Conflict resolution: previousValues comparison, field-level merge
- Dependency chain resolution: ordered processing, blocked on failure
- Retry/backoff logic: exponential timing, max retry caps
- Queue persistence: simulated crash + recovery
- Provisional recurrence: generation + replacement on sync
- Widget mutation ingestion: read + convert + enqueue
- Attachment saga: all stage transitions + failure recovery

**Integration tests (mock API):**
- Full push cycle: enqueue → compact → push → apply server response
- Full pull cycle: fetch changes → upsert → update cursors
- Push-then-pull ordering verification
- Conflict during push → accept server state → verify local state
- Initial sync: paginated, table-ordered, resumable after interruption
- Token refresh during sync
- Offline → queue → online → flush → verify

**Edge case tests:**
- Create list offline → add item to list → sync (dependency chain with ID rewrite)
- Complete recurring task offline → provisional generated → sync → replaced
- 10 rapid edits to same record → coalesced to one mutation
- Widget toggles task → app reads → mutation processed
- Share Extension shares URL → app reads → item created
- Logout with pending mutations → warning shown

### 9.2 API Sync Endpoints

- `/sync/pull`: incremental, pagination, tombstones, empty response, full sync mode
- `/sync/push`: clean apply, field merge, conflict, idempotency replay, batch with dependencies, validation errors

### 9.3 UI (Detox E2E)

- Auth: sign in → biometric → initial sync → today screen
- Task lifecycle: create → edit → complete → uncomplete → delete
- Offline: airplane mode → create task → reconnect → verify synced
- Pull-to-refresh: server change → refresh → verify visible
- Deep links: `brett://today`, `brett://inbox`, `brett://lists/:slug`

### 9.4 Native Extensions

- Widget: renders with mock App Group data, checkbox interaction writes mutations
- App Intents: "Add Task" creates item, "Show Today" opens deep link
- Share Extension: URL/text share writes to `shared_items.json`

---

## 10. Build & Deploy

### 10.1 EAS Build Profiles

| Profile | Purpose | Distribution |
|---------|---------|-------------|
| `development` | Local dev, Expo dev client | Simulator + device |
| `preview` | Internal testing | TestFlight internal |
| `production` | App Store release | TestFlight external → App Store |

### 10.2 CI/CD Pipeline

```
Push to feat/mobile-* branch:
  → Turborepo: typecheck + lint + test (shared packages + mobile)
  → EAS Build: development profile (verify compilation)

PR merged to main:
  → EAS Build: preview profile
  → Auto-submit to TestFlight internal
  → Notification with TestFlight link

Manual trigger (release):
  → EAS Build: production profile
  → EAS Submit: upload to App Store Connect
  → Manual review + release
```

### 10.3 Expo Config Highlights

```typescript
{
  scheme: "brett",                    // deep linking: brett://
  ios: {
    bundleIdentifier: "com.brett.app",
    infoPlist: {
      NSFaceIDUsageDescription: "Unlock Brett with Face ID",
      NSCameraUsageDescription: "Attach photos to tasks",
      NSPhotoLibraryUsageDescription: "Attach images to tasks",
    },
    entitlements: {
      "com.apple.security.application-groups": ["group.com.brett.app"],
      "aps-environment": "production",
    },
  },
}
```

### 10.4 Apple Developer Requirements

```
App ID: com.brett.app
App Group: group.com.brett.app
Push Notifications: enabled (APNs key → Firebase)
Sign in with Apple: enabled (Service ID configured)
Associated Domains: applinks:brett.app (universal links)
Keychain Sharing: com.brett.shared (shared with extensions)
```

---

## Appendix: Glossary

| Term | Meaning |
|------|---------|
| **Mutation** | A pending local write (create, update, delete) waiting to sync to server |
| **Tombstone** | A soft-deleted server record (has `deletedAt`), synced to mobile so it can remove the local copy |
| **Provisional** | A locally-generated record (e.g., next recurring task) that will be replaced by the server's authoritative version on sync |
| **Cursor** | A per-table timestamp marking the last successful sync pull — only records updated after this are fetched |
| **Idempotency key** | A client-generated UUID attached to each mutation, preventing duplicate processing on retry |
| **App Group** | An iOS shared container allowing the main app, widgets, and extensions to share files and UserDefaults |
| **Field-level merge** | Conflict resolution that compares individual changed fields rather than whole records, preserving non-conflicting changes from both sides |

---

## Addendum A: Peer Engineering Review Findings

Review performed against the complete spec. Findings organized by severity with fixes.

### CRITICAL — Must fix before implementation begins

**A1. Soft deletes are a massive server-side refactor, not a table cell.**

The spec assumes `deletedAt` columns exist, but the entire codebase uses hard `prisma.*.delete()` everywhere. Converting to soft deletes means:
- Add `deletedAt` column to every synced model via migration
- Every query (not just sync) needs `WHERE deletedAt IS NULL` — this touches ~80+ queries across all route files
- Use Prisma middleware or a base query helper to exclude soft-deleted records globally
- Existing desktop behavior must remain unchanged
- Cascade behavior changes (deleting a list currently cascade-deletes its items)

**Fix:** This needs its own dedicated implementation plan. Consider Prisma middleware that auto-appends `deletedAt IS NULL` to all `findMany`/`findFirst` calls, with an explicit `includeSoftDeleted: true` escape hatch for the sync endpoint.

**A2. Several synced models lack `updatedAt` — cursors will miss updates.**

Models missing `updatedAt` that participate in sync:
- `Attachment` — only has `createdAt`
- `BrettMessage` — only has `createdAt`
- `ScoutFinding` — only has `createdAt` (but `feedbackUseful` gets updated after creation)

Without `updatedAt`, the cursor-based pull will never re-fetch updated records from these tables.

**Fix:** Add `updatedAt DateTime @updatedAt` to every model that participates in sync. For truly append-only models (BrettMessage), `createdAt` works as the cursor, but this must be explicitly documented and guaranteed.

**A3. ID format mismatch — server uses CUIDs, spec says UUIDs.**

The Prisma schema uses `@default(cuid())` for most models. `@brett/utils/generateId()` produces UUID v4 via `crypto.randomUUID()`. Client-generated offline records will have UUID-shaped IDs while server-created records have CUID-shaped IDs.

**Fix:** Have the mobile client generate CUIDs instead (use `@paralleldrive/cuid2`). Or switch the server to UUID (bigger change). Either way, ID format must be consistent. Cheapest fix: add `generateCuid()` to `@brett/utils` for mobile use, keep server as-is.

**A4. Redundant `id` and `idempotency_key` in mutation queue.**

The spec says `id` "doubles as idempotency key" but then has a separate `idempotency_key` column. Confusing. If they're the same value, drop `idempotency_key` and use `id` as the key sent to the server.

**Fix:** Remove `idempotency_key` column. The `id` field IS the idempotency key. Simplify the schema and the push protocol docs to be consistent.

### HIGH — Must address during implementation

**A5. Pull concurrency with SSE events corrupts cursor behavior.**

When a full pull is queued and an SSE event triggers a targeted pull simultaneously, the targeted pull may advance a table's cursor, causing the full pull to miss records for that table.

**Fix:** When a full pull is pending/in-progress, targeted SSE pulls are absorbed — they don't run independently. The full pull already fetches everything since the cursor. Document this merge behavior in the SyncManager.

**A6. Mutation compaction loses dependency chains.**

CREATE+UPDATE compaction merges payloads but doesn't union `depends_on` values. If a subsequent UPDATE changes `listId` to a new list that also has a pending CREATE, the compacted mutation has the wrong dependency.

**Fix:** Compaction must build the union of all `depends_on` values across compacted mutations.

**A7. Widget/Siri IPC via JSON file is fragile — use shared SQLite.**

`widget_mutations.json` has no file locking, no atomicity, no crash safety. Concurrent writes from widget + reads from app can corrupt data.

**Fix:** Use the existing shared App Group SQLite database for widget-to-app mutations. Add a `widget_mutations` table. SQLite gives atomicity and crash safety for free. Drop the JSON file approach entirely. Same fix applies to `shared_items.json` from the Share Extension.

**A8. Provisional recurrence: limit to one level, tighter matching.**

Users could complete a provisional (the next occurrence of a completed recurring task), creating a chain of provisionals built on unstable foundations. Also, the "within 1 day" matching window is too loose.

**Fix:** Disallow completing provisional records. If `_syncStatus == "provisional"`, the toggle action should be blocked with "Sync required to complete this task." Also: match provisionals by `_provisionalParentId` (deterministic) first, dueDate proximity second (6-hour window, not 24-hour).

**A9. Token refresh during sync push can duplicate side effects.**

If a push POST partially succeeds, returns 401 (from a proxy), token refreshes, and the POST retries — the idempotency keys prevent duplicate data, but server-side events (SSE, push notifications) may fire twice.

**Fix:** Server-side idempotency must also gate side effects. When a mutation is replayed via idempotency key, return the cached result WITHOUT re-firing events.

**A10. `before_snapshot` storage is unbounded and expensive.**

Large content items (multi-KB `contentBody`) generate full snapshots on every mutation.

**Fix:** Run compaction eagerly on every enqueue (not just before push). When mutations are coalesced, only the earliest `before_snapshot` is kept. Purge `before_snapshot` and `previous_values` from the queue after successful sync (they're only needed for rollback of pending mutations).

**A11. Calendar events should be time-windowed on sync.**

Syncing all calendar events (potentially years of history) is excessive. A user with 2+ years of active calendar could have 5,000+ events with large JSON blobs.

**Fix:** Calendar events in `/sync/pull` are scoped to last 90 days + future events. Older events fetched on-demand when the user scrolls to that date range. This is a per-table exception to the "sync everything" rule — it's justified by the volume and the fact that old events are rarely needed.

### MEDIUM

**A12. Add `protocolVersion: 1` to sync requests.** Enables forward compatibility when the protocol evolves.

**A13. Tombstone retention must exceed the stale cursor threshold.** If both are 30 days, there's a race. Fix: 45-day tombstone retention, 30-day cursor staleness.

**A14. Use async SQLite queries for hydration of large tables.** Synchronous reads on >100 rows will cause UI jank. Reserve sync API for single-record lookups.

**A15. Add local schema versioning.** Drizzle migrations run at app start before hydration. If migration fails: wipe DB, trigger fresh initial sync. Store schema version in a `_meta` table.

**A16. Commit to a specific SSE library.** `react-native-sse` or custom implementation — verify Expo 53/New Architecture compatibility before implementation.

**A17. Remove unused `conflict` from `_syncStatus` enum.** The conflict resolver always produces a final state (synced or pending). Records never sit in `conflict` status. Remove it to avoid confusion.

**A18. Specify the `user_profile` singleton sync behavior.** Pull: always returned as a single object (not an array). No pagination. Cursor: single timestamp. Push: specific PATCH fields allowed (assistantName, timezone, location, etc.). Document the mapping from Prisma `User` model to local `user_profile` table.

**A19. Test `rrule` package on Hermes.** The `rrule` dependency uses `luxon` which depends on `Intl.DateTimeFormat`. Hermes has limited Intl support. May need `intl-pluralrules` polyfill or full ICU Hermes build.

### LOW

**A20.** Large attachment uploads (>5MB) are foreground-only. Document this. Consider `NSURLSessionUploadTask` with background session for large files in a future version.

**A21.** Add a target binary size budget and measure in CI. Expo 53 + Swift extensions + all deps could easily exceed 50MB.

**A22.** Validate shared data from App Group before processing — run through `@brett/business` validators.

**A23.** Auto-prune `_conflict_log` entries older than 30 days or cap at 1,000 rows.

**A24.** `_sync_health` singleton: store `last_successful_push_at` and `last_successful_pull_at` in SQLite for persistence. Store transient fields (`is_pushing`, `is_pulling`) in Zustand only.

**A25.** Add test scenarios: clock skew resilience, concurrent sessions/account switching, app update with pending mutations, partial initial sync + immediate offline.

**A26.** Clarify Detox E2E CI infrastructure — macOS runners needed. If local-only, document it.

### UNDERSPECIFIED — Must answer before implementation

**A27. Sync push batch size.** All pending mutations in one POST? Batched by 50? By table? Answer: batch by 50 mutations max per POST. If one fails permanently, dequeue it and continue. If one fails transiently (5xx), stop the batch and retry later.

**A28. Server schema changes with new required fields.** If server adds a required field and old mobile client pushes a CREATE without it, the 422 kills the mutation permanently. Answer: new required fields must have server-side defaults for a deprecation period matching the minimum supported app version.

**A29. SSE events during pull.** If a pull is in-flight and SSE says "items updated," absorb into pending full pull (per A5).

**A30. Zustand hydration selectivity.** On launch: hydrate `lists` (all), `items` (active only for initial render), `user_profile`. Hydrate done/archived items lazily when those screens are accessed. Cap in-memory items at 5,000 — beyond that, paginate from SQLite.

**A31. Debounce behavior for rapid mutations.** User toggles 5 tasks in 2 seconds: each mutation is enqueued immediately. The 1s debounce timer resets on each enqueue. When it fires: run compaction, then push the compacted batch. Net result: one push with 5 mutations (or fewer after compaction).

**A32. Live Activity timer updates.** Use SwiftUI's `Text(.date, style: .timer)` for the countdown — this is client-side rendering that iOS updates automatically, no push needed. Server push only needed to update content state (e.g., meeting title changed, meeting cancelled).

**A33. Failed attachment upload cleanup.** After 3 retries at any stage: move to `failed`. Surface to user: "Attachment couldn't upload. [Retry] [Delete]". Auto-purge failed uploads older than 7 days.

---

## Addendum B: Security Review Findings

Review performed by a principal security engineer specializing in mobile. Findings with attack scenarios and remediations.

### CRITICAL — Must fix before implementation begins

**B1. No ownership validation on `/sync/push` and `/sync/pull` (IDOR)**

The sync endpoints accept `entityId` values from the client. Without server-side ownership checks, a compromised client could send mutations targeting another user's records.

**Attack:** Attacker with valid token sends `POST /sync/push` with mutations referencing other users' entity IDs.

**Fix:** The server MUST verify that every `entityId` in every mutation belongs to the authenticated user. The pull endpoint MUST filter results to only the authenticated user's data. This is a hard requirement on the sync endpoint implementation — not optional.

**B2. Extensions should NOT have raw auth tokens**

The shared Keychain gives all extensions (widgets, Siri, Share Extension) access to the full JWT session token. Extensions are a wider attack surface — they process untrusted input and can be invoked by any app.

**Fix:** Extensions do NOT get network access or raw tokens. They write to the shared App Group (SQLite or UserDefaults). The main app processes their mutations on foreground. This is already the design for widget mutations — apply it consistently. Remove the shared Keychain group for tokens. If an extension absolutely needs API access in the future, create scope-limited extension tokens.

**B3. OAuth must use Universal Links + PKCE, not custom URL scheme**

The `brett://auth/callback?token=...` pattern is vulnerable to URL scheme hijacking — any app can register `brett://`. And sending the token in the URL is a separate vulnerability (URLs are logged, visible in process lists, leaked via Referer headers).

**Fix:**
- Use Universal Links (`https://brett.app/auth/callback`) instead of custom URL scheme. Requires Apple App Site Association file — already listed in section 10.4 but not used for OAuth.
- Use Authorization Code flow with PKCE instead of returning the token directly. The callback returns a short-lived authorization code. The app exchanges it for a token via back-channel POST.
- better-auth supports PKCE — configure it.

### HIGH

**B4. Add TLS certificate pinning.**

Without pinning, a MITM with a valid certificate (corporate proxy, compromised CA, user-installed root cert) can intercept all API traffic.

**Fix:** Pin against the SPKI hash of the API server's certificate. Use `react-native-ssl-pinning` or equivalent. Include a backup pin for rotation. Document the pin rotation procedure.

**B5. Encrypt App Group data at rest.**

The shared SQLite and UserDefaults in the App Group contain task titles, calendar events, locations — PII in plaintext. On jailbroken devices, any process can read the App Group.

**Fix:** Apply `NSFileProtectionComplete` to all files in the App Group container. Do NOT store meeting links (which may contain embedded passwords like Zoom PBX codes) in widget data. Sanitize sensitive fields before writing to the App Group.

**B6. Rate limit all new endpoints.**

`/sync/push`, `/sync/pull`, `/devices/register`, `/devices/unregister` have no rate limiting specified.

**Fix:**
- `/sync/push`: 60 req/min per user, max 50 mutations per request, max 1MB body
- `/sync/pull`: 120 req/min per user
- `/devices/register`: 10 req/min per user, max 10 devices per user
- Apply existing `rateLimiter` middleware

**B7. Validate all sync mutation payloads server-side.**

The sync endpoint must not be a generic write-anything API. Without validation, attackers could escalate privileges, write to unauthorized tables, or inject malformed data.

**Fix:**
- Allowlist `entityType` values: `item`, `list`, `calendar_event_note` (etc.). Reject all others.
- Validate `action` is one of `CREATE`, `UPDATE`, `DELETE`
- For each `entityType`, validate `payload` against the same schema the existing REST endpoints use
- Validate `changedFields` correspond to mutable fields
- The sync endpoint must NOT bypass existing per-route authorization or validation logic

**B8. Harden biometric lock with Keychain ACL.**

The current design has biometrics as a UI-only gate — the JWT is fully accessible without biometrics. On a jailbroken device, an attacker reads the token directly from Keychain.

**Fix:** When biometric lock is enabled, store the auth token with `kSecAccessControlBiometryCurrentSet` via `expo-secure-store`'s `requireAuthentication: true`. This makes the Keychain item hardware-gated by biometrics, not just a UI check. Default grace period should be "Immediately" rather than 5 minutes.

### MEDIUM

**B9. Implement app switcher screenshot protection.** Blur or splash overlay when app backgrounds to prevent sensitive data visible in app switcher.

**B10. Use Notification Service Extension for visible push content.** Fetch actual notification content from server at display time rather than sending task titles through APNs. Keeps sensitive data out of Apple's infrastructure.

**B11. Validate all deep link parameters as untrusted input.** Sanitize query parameters, validate route paths, verify OAuth callbacks have matching nonce/state.

**B12. Validate and sanitize Share Extension input.** Cap payload sizes (10KB text), strip HTML/scripts, run through `@brett/business` validators.

**B13. Add runtime jailbreak detection (defense in depth).** Detect common indicators (Cydia, writable system paths, debugger attachment). Degrade gracefully — warn user, require more frequent re-auth. Not a hard gate (easily bypassed) but raises the bar.

**B14. Reduce presigned URL TTL from 1 hour to 15 minutes.** Confirm endpoint must verify: S3 object exists, size matches, storageKey was issued for this user/item. Never log presigned URLs. Purge from `_attachment_uploads` after use.

**B15. HMAC-sign widget mutations.** Widget signs with a key from shared Keychain. App verifies before processing. Prevents tampering by processes with App Group access but not Keychain access. Restrict widget mutation types to a small allowlist (task toggles only).

### LOW

**B16.** Clipboard: use `localOnly` and `expirationDate` options for sensitive copied data (meeting links, AI responses).

**B17.** Audit all Expo/RN dependencies for data collection. Configure crash reporters to scrub PII. Review Expo telemetry.

**B18.** Implement progressive account lockout after failed sign-in attempts (separate from IP rate limiting).

**B19.** Validate FCM device token format before storing. Consider Apple Device Check or App Attest for device verification.

**B20.** On account deletion: send push notification triggering full local wipe on all registered devices. Hard-delete all user data server-side (not just soft-delete).

**B21.** Verify `expo-secure-store` 2KB value limit vs JWT size. If JWT may exceed 2KB, use raw Keychain API via custom Expo module.

**B22.** Pin exact dependency versions. Enable lockfile integrity checks. Audit native modules before major version updates.
