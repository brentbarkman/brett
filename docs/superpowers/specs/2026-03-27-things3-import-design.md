# Things 3 Import — Design Spec

## Overview

One-time import of tasks and projects from Things 3's local SQLite database into Brett. Accessible from a new "Import" section in Settings. macOS only.

Things 3 has no public API or web access. The only way to extract data is by reading the local SQLite database at:

```
~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/Things Database.thingsdatabase/main.sqlite
```

This path is consistent across all Things 3 installations on macOS.

## Data Mapping

| Things 3 | Brett | Notes |
|---|---|---|
| Project (`TMTask.type=1`) | List | Name preserved, default color assigned |
| To-do (`TMTask.type=0`) | Task (`Item`) | Title, notes, due date mapped |
| To-do in project | Task in corresponding List | `listId` set to created list |
| To-do with no project | Task with no list (Inbox) | `listId` = null |
| Checklist items (`TMChecklistItem`) | Markdown appended to `notes` | `- [x]` / `- [ ]` format |
| `TMTask.deadline` | `dueDate` (day precision) | Things date format decoded (see below) |
| `TMTask.notes` | `notes` field | Plain text preserved |
| `TMTask.creationDate` | `createdAt` | Unix timestamp → ISO 8601 |
| `TMTask.status=0` (incomplete) | `status=active` | |
| `TMTask.status=3` (completed) | `status=done`, `completedAt` from `stopDate` | |
| `TMTask.status=2` (canceled) | `status=done`, `completedAt` from `stopDate` | Treated same as completed |
| Trashed items (`trashed=1`) | Skipped | Not imported |

### What We Skip

- **Areas** — no Brett equivalent
- **Headings** — no Brett equivalent (project sub-groupings)
- **Tags** — no Brett equivalent
- **`startDate`** — Brett has no "start date" / "when" concept
- **Recurrence** — Things 3 recurrence rules are proprietary
- **Reminders** — not worth mapping without recurrence context

## Things 3 Database Schema (Relevant Parts)

### TMTask

The central table. Tasks, projects, and headings all live here, distinguished by `type`.

| Column | Type | Description |
|---|---|---|
| `uuid` | TEXT | Primary key |
| `type` | INTEGER | 0 = to-do, 1 = project, 2 = heading |
| `title` | TEXT | Task/project name |
| `notes` | TEXT | Rich text notes |
| `status` | INTEGER | 0 = incomplete, 2 = canceled, 3 = completed |
| `trashed` | INTEGER | 0 = active, 1 = in trash |
| `creationDate` | REAL | Unix timestamp (seconds, UTC) |
| `userModificationDate` | REAL | Unix timestamp of last edit |
| `stopDate` | REAL | Unix timestamp when completed/canceled |
| `deadline` | INTEGER | Things date format (packed binary) |
| `project` | TEXT | UUID of parent project (FK to TMTask) |
| `area` | TEXT | UUID of parent area (FK to TMArea) |
| `start` | INTEGER | 0 = Inbox, 1 = Anytime, 2 = Someday |

### TMChecklistItem

| Column | Type | Description |
|---|---|---|
| `uuid` | TEXT | Primary key |
| `title` | TEXT | Checklist item text |
| `status` | INTEGER | 0 = incomplete, 2 = canceled, 3 = completed |
| `task` | TEXT | FK to parent TMTask.uuid |
| `index` | INTEGER | Sort order within checklist |

### Things Date Format

`deadline` and `startDate` use a packed binary integer:

```
YYYYYYYYYYYMMMMDDDDD0000000
11 bits year | 4 bits month | 5 bits day | 7 zero bits
```

Decoding:
```typescript
function decodeThingsDate(value: number): Date {
  const day = (value >> 7) & 0x1f;
  const month = (value >> 12) & 0xf;
  const year = (value >> 16) & 0x7ff;
  return new Date(year, month - 1, day);
}
```

## Architecture

### Desktop — Electron Main Process

The Electron main process handles reading the local SQLite file:

1. **Dependency:** `better-sqlite3` — synchronous SQLite reader, standard in Electron apps
2. **Reads** the Things 3 database at the known path
3. **Queries** for all non-trashed tasks (`type=0`) and projects (`type=1`), plus checklist items
4. **Maps** data into Brett's import payload format
5. **Sends** single HTTP request to the API

Exposed via IPC to the renderer:

```typescript
// Main process IPC handlers
ipcMain.handle('things3:scan', async () => {
  // Returns { projects: number, tasks: { active: number, completed: number } }
  // or { error: string } if DB not found
});

ipcMain.handle('things3:import', async () => {
  // Reads DB, maps data, calls POST /import/things3
  // Returns { success: true, lists: number, tasks: number }
  // or { error: string }
});
```

### API — Bulk Import Endpoint

```
POST /import/things3
Authorization: Bearer <token>
```

**Request body:**

```typescript
{
  lists: Array<{
    name: string;
    thingsUuid: string;  // Things 3 project UUID, for task→list resolution
  }>;
  tasks: Array<{
    title: string;
    notes?: string;
    dueDate?: string;              // ISO 8601 date
    status: "active" | "done";
    completedAt?: string;          // ISO 8601 datetime
    createdAt?: string;            // ISO 8601 datetime
    thingsProjectUuid?: string;    // resolves to listId via lists created above
  }>;
}
```

**Server-side logic:**

1. Validate payload (enforce max sizes, required fields)
2. Begin transaction
3. Create all lists, building a `thingsUuid → listId` map
4. Create all tasks, resolving `thingsProjectUuid` to `listId` using the map
5. Set `source = "Things 3"` on all imported items
6. Commit transaction
7. Return `{ lists: number, tasks: number }`

All-or-nothing: if any part fails, the entire import rolls back.

### Validation

- List names: truncate at 100 chars, deduplicate (append number if needed)
- Task titles: truncate at 500 chars, skip if empty
- Notes: no size limit (TEXT field)
- Dates: validate ISO format, skip invalid dates rather than failing
- Max payload: enforce reasonable limit (e.g., 10,000 tasks) with clear error

## UI Design

### Settings Section

New "Import" section in SettingsPage, placed after the AI/Memory sections and before Sign Out. Follows the existing section pattern.

### States

**1. Idle (default)**
- Section header: "Import"
- Subtext: "Import your tasks from other apps"
- "Import from Things 3" button with Things 3 icon/label
- macOS only — on other platforms, this section is hidden entirely (Electron provides `process.platform`)

**2. Scanning**
- Button shows spinner + "Scanning Things 3..."
- Disabled state

**3. Preview**
- Summary card: "Found 5 projects and 312 tasks (247 active, 65 completed)"
- "Import" confirmation button + "Cancel" link
- Glass card style consistent with other settings sections

**4. Importing**
- Progress text: "Importing..."
- Spinner, disabled state

**5. Done**
- Success message: "Imported 5 lists and 312 tasks from Things 3"
- Timestamp: "Imported on Mar 27, 2026"
- No re-import button — one-time operation
- Persist import timestamp to user preferences (localStorage)

**6. Error**
- DB not found: "Things 3 database not found. Is Things 3 installed?"
- Permission denied: "Unable to read Things 3 database. Check file permissions."
- API error: "Import failed. Please try again."
- All errors show retry button to return to idle state

### Import Completion Persistence

The "already imported" state is stored in localStorage keyed by user ID. This is purely cosmetic — it prevents showing the import button again, but doesn't prevent re-import at the API level. If a user clears localStorage, they could re-import, which would create duplicates. This is an acceptable tradeoff for simplicity.

## What We're NOT Building

- **Sync** — one-time import only, no ongoing sync
- **Re-import / dedup** — no UUID tracking for incremental updates
- **Tag import** — no tag system in Brett
- **Area import** — no area concept in Brett
- **Heading preservation** — no sub-grouping within lists
- **Recurrence mapping** — Things 3 rules are proprietary
- **Start date mapping** — Brett has no "when" / start date concept
- **File picker fallback** — auto-detect only, error if not found
- **Non-macOS support** — Things 3 is macOS only
