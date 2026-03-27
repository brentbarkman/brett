# Things 3 Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-time import of Things 3 tasks and projects into Brett via a Settings section that reads the local SQLite database and bulk-creates lists + tasks.

**Architecture:** Desktop (Electron main process) reads the Things 3 SQLite database using `better-sqlite3`, maps projects→lists and tasks→tasks, sends a single JSON payload to a new `POST /import/things3` API endpoint that transactionally creates everything. A new Settings section drives the UI flow (scan → preview → import → done).

**Tech Stack:** better-sqlite3 (Electron main), Hono route (API), React + React Query (Settings UI), Prisma (database), Vitest (tests)

---

### Task 1: Add Import Types to @brett/types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add the import types**

Add at the end of `packages/types/src/index.ts`:

```typescript
// Things 3 Import
export interface Things3ImportList {
  name: string;
  thingsUuid: string;
}

export interface Things3ImportTask {
  title: string;
  notes?: string;
  dueDate?: string; // ISO 8601 date
  status: "active" | "done";
  completedAt?: string; // ISO 8601 datetime
  createdAt?: string; // ISO 8601 datetime
  thingsProjectUuid?: string; // resolves to listId server-side
}

export interface Things3ImportPayload {
  lists: Things3ImportList[];
  tasks: Things3ImportTask[];
}

export interface Things3ImportResult {
  lists: number;
  tasks: number;
}

export interface Things3ScanResult {
  projects: number;
  tasks: { active: number; completed: number };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add Things 3 import types"
```

---

### Task 2: Add Validation in @brett/business

**Files:**
- Modify: `packages/business/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/business/src/__tests__/things3-import-validation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateThings3Import } from "../index";

describe("validateThings3Import", () => {
  it("accepts a valid payload", () => {
    const result = validateThings3Import({
      lists: [{ name: "Work", thingsUuid: "abc-123" }],
      tasks: [
        { title: "Buy milk", status: "active" },
        {
          title: "Old task",
          status: "done",
          completedAt: "2024-01-15T10:00:00.000Z",
          thingsProjectUuid: "abc-123",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lists).toHaveLength(1);
      expect(result.data.tasks).toHaveLength(2);
    }
  });

  it("rejects missing body", () => {
    const result = validateThings3Import(null);
    expect(result.ok).toBe(false);
  });

  it("rejects non-array lists", () => {
    const result = validateThings3Import({ lists: "nope", tasks: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects non-array tasks", () => {
    const result = validateThings3Import({ lists: [], tasks: "nope" });
    expect(result.ok).toBe(false);
  });

  it("rejects list with empty name", () => {
    const result = validateThings3Import({
      lists: [{ name: "", thingsUuid: "abc" }],
      tasks: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects list with missing thingsUuid", () => {
    const result = validateThings3Import({
      lists: [{ name: "Work" }],
      tasks: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects task with empty title", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "", status: "active" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects task with invalid status", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "Test", status: "pending" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects payload exceeding 10,000 tasks", () => {
    const tasks = Array.from({ length: 10_001 }, (_, i) => ({
      title: `Task ${i}`,
      status: "active" as const,
    }));
    const result = validateThings3Import({ lists: [], tasks });
    expect(result.ok).toBe(false);
  });

  it("truncates list name at 100 chars", () => {
    const result = validateThings3Import({
      lists: [{ name: "A".repeat(150), thingsUuid: "abc" }],
      tasks: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lists[0].name.length).toBe(100);
    }
  });

  it("truncates task title at 500 chars", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "A".repeat(600), status: "active" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0].title.length).toBe(500);
    }
  });

  it("skips tasks with empty title after trim", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [
        { title: "   ", status: "active" },
        { title: "Valid task", status: "active" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].title).toBe("Valid task");
    }
  });

  it("validates dueDate format", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "Test", status: "active", dueDate: "not-a-date" }],
    });
    // Invalid dates are dropped, not rejected
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0].dueDate).toBeUndefined();
    }
  });

  it("validates completedAt format", () => {
    const result = validateThings3Import({
      lists: [],
      tasks: [{ title: "Test", status: "done", completedAt: "bad" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks[0].completedAt).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm vitest run packages/business/src/__tests__/things3-import-validation.test.ts`
Expected: FAIL — `validateThings3Import` not found

- [ ] **Step 3: Implement the validation function**

Add to the end of `packages/business/src/index.ts` (before the last line if there are re-exports):

```typescript
import type { Things3ImportPayload } from "@brett/types";

const MAX_IMPORT_TASKS = 10_000;
const MAX_IMPORT_LISTS = 500;
const MAX_LIST_NAME_LEN = 100;
const MAX_TASK_TITLE_LEN = 500;
const VALID_IMPORT_STATUSES = new Set(["active", "done"]);

export function validateThings3Import(
  input: unknown
): { ok: true; data: Things3ImportPayload } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }

  const obj = input as Record<string, unknown>;

  if (!Array.isArray(obj.lists)) {
    return { ok: false, error: "lists must be an array" };
  }
  if (!Array.isArray(obj.tasks)) {
    return { ok: false, error: "tasks must be an array" };
  }
  if (obj.tasks.length > MAX_IMPORT_TASKS) {
    return { ok: false, error: `Cannot import more than ${MAX_IMPORT_TASKS} tasks` };
  }
  if (obj.lists.length > MAX_IMPORT_LISTS) {
    return { ok: false, error: `Cannot import more than ${MAX_IMPORT_LISTS} lists` };
  }

  // Validate and normalize lists
  const lists: Things3ImportPayload["lists"] = [];
  for (const item of obj.lists) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Each list must be an object" };
    }
    const l = item as Record<string, unknown>;
    if (typeof l.name !== "string" || l.name.trim() === "") {
      return { ok: false, error: "Each list must have a non-empty name" };
    }
    if (typeof l.thingsUuid !== "string" || l.thingsUuid.trim() === "") {
      return { ok: false, error: "Each list must have a thingsUuid" };
    }
    lists.push({
      name: l.name.trim().slice(0, MAX_LIST_NAME_LEN),
      thingsUuid: l.thingsUuid.trim(),
    });
  }

  // Validate and normalize tasks (skip empty titles instead of failing)
  const tasks: Things3ImportPayload["tasks"] = [];
  for (const item of obj.tasks) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Each task must be an object" };
    }
    const t = item as Record<string, unknown>;
    if (typeof t.title !== "string") {
      return { ok: false, error: "Each task must have a title string" };
    }
    const title = t.title.trim().slice(0, MAX_TASK_TITLE_LEN);
    if (title === "") continue; // skip empty titles

    if (typeof t.status !== "string" || !VALID_IMPORT_STATUSES.has(t.status)) {
      return { ok: false, error: `Invalid task status: ${String(t.status)}` };
    }

    const task: Things3ImportPayload["tasks"][number] = {
      title,
      status: t.status as "active" | "done",
    };

    if (typeof t.notes === "string" && t.notes.trim() !== "") {
      task.notes = t.notes;
    }
    if (typeof t.dueDate === "string" && !isNaN(Date.parse(t.dueDate))) {
      task.dueDate = t.dueDate;
    }
    if (typeof t.completedAt === "string" && !isNaN(Date.parse(t.completedAt))) {
      task.completedAt = t.completedAt;
    }
    if (typeof t.createdAt === "string" && !isNaN(Date.parse(t.createdAt))) {
      task.createdAt = t.createdAt;
    }
    if (typeof t.thingsProjectUuid === "string" && t.thingsProjectUuid.trim() !== "") {
      task.thingsProjectUuid = t.thingsProjectUuid.trim();
    }

    tasks.push(task);
  }

  return { ok: true, data: { lists, tasks } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm vitest run packages/business/src/__tests__/things3-import-validation.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/index.ts packages/business/src/__tests__/things3-import-validation.test.ts
git commit -m "feat(business): add Things 3 import payload validation"
```

---

### Task 3: Add API Import Route

**Files:**
- Create: `apps/api/src/routes/import.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/import.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("POST /import/things3", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Import User");
    token = user.token;
  });

  it("imports lists and tasks in a single transaction", async () => {
    const res = await authRequest("/import/things3", token, {
      method: "POST",
      body: JSON.stringify({
        lists: [
          { name: "Work", thingsUuid: "proj-1" },
          { name: "Personal", thingsUuid: "proj-2" },
        ],
        tasks: [
          { title: "Buy milk", status: "active" },
          { title: "Ship feature", status: "active", thingsProjectUuid: "proj-1" },
          {
            title: "Old task",
            status: "done",
            completedAt: "2024-01-15T10:00:00.000Z",
            thingsProjectUuid: "proj-2",
          },
          {
            title: "With due date",
            status: "active",
            dueDate: "2024-06-15",
            thingsProjectUuid: "proj-1",
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.lists).toBe(2);
    expect(body.tasks).toBe(4);
  });

  it("sets source to 'Things 3' on imported items", async () => {
    const res = await authRequest("/things?source=Things%203", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((t: any) => t.source === "Things 3")).toBe(true);
  });

  it("maps thingsProjectUuid to correct listId", async () => {
    const listsRes = await authRequest("/lists", token);
    const lists = (await listsRes.json()) as any[];
    const workList = lists.find((l: any) => l.name === "Work");
    expect(workList).toBeDefined();

    const tasksRes = await authRequest(`/things?listId=${workList.id}`, token);
    const tasks = (await tasksRes.json()) as any[];
    const featureTask = tasks.find((t: any) => t.title === "Ship feature");
    expect(featureTask).toBeDefined();
  });

  it("handles completed tasks with completedAt", async () => {
    const res = await authRequest("/things?status=done&source=Things%203", token);
    const tasks = (await res.json()) as any[];
    const oldTask = tasks.find((t: any) => t.title === "Old task");
    expect(oldTask).toBeDefined();
    expect(oldTask.isCompleted).toBe(true);
    expect(oldTask.completedAt).toBeDefined();
  });

  it("rejects empty payload", async () => {
    const res = await authRequest("/import/things3", token, {
      method: "POST",
      body: JSON.stringify(null),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated request", async () => {
    const res = await authRequest("/import/things3", "bad-token", {
      method: "POST",
      body: JSON.stringify({ lists: [], tasks: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("deduplicates list names by appending a number", async () => {
    // "Work" and "Personal" already exist from the first test
    const res = await authRequest("/import/things3", token, {
      method: "POST",
      body: JSON.stringify({
        lists: [{ name: "Work", thingsUuid: "proj-dup" }],
        tasks: [],
      }),
    });
    expect(res.status).toBe(201);

    const listsRes = await authRequest("/lists", token);
    const lists = (await listsRes.json()) as any[];
    const workLists = lists.filter((l: any) => l.name.startsWith("Work"));
    expect(workLists.length).toBe(2);
    expect(workLists.some((l: any) => l.name === "Work (2)")).toBe(true);
  });

  it("handles tasks with no project (inbox items)", async () => {
    const res = await authRequest("/things?source=Things%203", token);
    const tasks = (await res.json()) as any[];
    const inboxTask = tasks.find((t: any) => t.title === "Buy milk");
    expect(inboxTask).toBeDefined();
    expect(inboxTask.listId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm vitest run apps/api/src/__tests__/import.test.ts`
Expected: FAIL — route not found (404)

- [ ] **Step 3: Implement the import route**

Create `apps/api/src/routes/import.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateThings3Import } from "@brett/business";

const importRoutes = new Hono<AuthEnv>();

importRoutes.use("*", authMiddleware);

importRoutes.post("/things3", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateThings3Import(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { lists, tasks } = validation.data;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Get existing list names for this user (for dedup)
    const existingLists = await tx.list.findMany({
      where: { userId: user.id },
      select: { name: true, sortOrder: true },
    });
    const existingNames = new Set(existingLists.map((l) => l.name));
    const maxSortOrder = existingLists.reduce((max, l) => Math.max(max, l.sortOrder), -1);

    // 2. Create lists, deduplicating names
    const uuidToListId = new Map<string, string>();
    let sortOrder = maxSortOrder + 1;

    for (const list of lists) {
      let name = list.name;
      if (existingNames.has(name)) {
        let counter = 2;
        while (existingNames.has(`${list.name} (${counter})`)) {
          counter++;
        }
        name = `${list.name} (${counter})`;
      }
      existingNames.add(name);

      const created = await tx.list.create({
        data: {
          name,
          colorClass: "bg-blue-400",
          sortOrder: sortOrder++,
          userId: user.id,
        },
      });
      uuidToListId.set(list.thingsUuid, created.id);
    }

    // 3. Create tasks
    let taskCount = 0;
    for (const task of tasks) {
      const listId = task.thingsProjectUuid
        ? uuidToListId.get(task.thingsProjectUuid) ?? null
        : null;

      await tx.item.create({
        data: {
          type: "task",
          title: task.title,
          notes: task.notes ?? null,
          source: "Things 3",
          status: task.status,
          dueDate: task.dueDate ? new Date(task.dueDate) : null,
          dueDatePrecision: task.dueDate ? "day" : null,
          completedAt: task.completedAt ? new Date(task.completedAt) : null,
          createdAt: task.createdAt ? new Date(task.createdAt) : undefined,
          listId,
          userId: user.id,
        },
      });
      taskCount++;
    }

    return { lists: lists.length, tasks: taskCount };
  });

  return c.json(result, 201);
});

export { importRoutes };
```

- [ ] **Step 4: Mount the route in app.ts**

Add to `apps/api/src/app.ts`:

Import at top:
```typescript
import { importRoutes } from "./routes/import.js";
```

Add after the weather route mount (before `startCronJobs()`):
```typescript
app.route("/import", importRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm vitest run apps/api/src/__tests__/import.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/import.ts apps/api/src/app.ts apps/api/src/__tests__/import.test.ts
git commit -m "feat(api): add POST /import/things3 bulk import endpoint"
```

---

### Task 4: Add Things 3 SQLite Reader in Electron Main Process

**Files:**
- Create: `apps/desktop/electron/things3.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/package.json` (add `better-sqlite3` dependency)

- [ ] **Step 1: Install better-sqlite3**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import/apps/desktop && pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3`

- [ ] **Step 2: Create the Things 3 reader module**

Create `apps/desktop/electron/things3.ts`:

```typescript
import path from "path";
import os from "os";
import fs from "fs";
import Database from "better-sqlite3";
import type {
  Things3ImportPayload,
  Things3ScanResult,
} from "@brett/types";

const THINGS_DB_PATH = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "JLMPQHK86H.com.culturedcode.ThingsMac",
  "Things Database.thingsdatabase",
  "main.sqlite"
);

/**
 * Decode Things 3's packed binary date format.
 * Format: YYYYYYYYYYYMMMMDDDDD0000000 (11 bits year, 4 bits month, 5 bits day, 7 zero bits)
 */
function decodeThingsDate(value: number): string | undefined {
  if (!value || value === 0) return undefined;
  const day = (value >> 7) & 0x1f;
  const month = (value >> 12) & 0xf;
  const year = (value >> 16) & 0x7ff;
  if (year === 0 || month === 0 || day === 0) return undefined;
  // Return ISO date string (YYYY-MM-DD)
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Convert a Things 3 Unix timestamp (seconds) to ISO 8601 string */
function thingsTimestampToISO(ts: number | null): string | undefined {
  if (!ts || ts === 0) return undefined;
  return new Date(ts * 1000).toISOString();
}

interface ThingsTask {
  uuid: string;
  type: number;
  title: string;
  notes: string | null;
  status: number;
  trashed: number;
  creationDate: number;
  stopDate: number | null;
  deadline: number | null;
  project: string | null;
}

interface ThingsChecklist {
  uuid: string;
  title: string;
  status: number;
  task: string;
  index: number;
}

function openDatabase(): Database.Database {
  if (!fs.existsSync(THINGS_DB_PATH)) {
    throw new Error("Things 3 database not found. Is Things 3 installed?");
  }
  return new Database(THINGS_DB_PATH, { readonly: true, fileMustExist: true });
}

/** Build markdown checklist string from checklist items */
function buildChecklistMarkdown(items: ThingsChecklist[]): string {
  const sorted = [...items].sort((a, b) => a.index - b.index);
  return sorted
    .map((item) => {
      const checked = item.status === 3 ? "x" : " ";
      return `- [${checked}] ${item.title}`;
    })
    .join("\n");
}

export function scanThings3(): Things3ScanResult {
  const db = openDatabase();
  try {
    const projects = db
      .prepare("SELECT COUNT(*) as count FROM TMTask WHERE type = 1 AND trashed = 0")
      .get() as { count: number };
    const activeTasks = db
      .prepare("SELECT COUNT(*) as count FROM TMTask WHERE type = 0 AND trashed = 0 AND status = 0")
      .get() as { count: number };
    const completedTasks = db
      .prepare("SELECT COUNT(*) as count FROM TMTask WHERE type = 0 AND trashed = 0 AND status IN (2, 3)")
      .get() as { count: number };

    return {
      projects: projects.count,
      tasks: { active: activeTasks.count, completed: completedTasks.count },
    };
  } finally {
    db.close();
  }
}

export function readThings3(): Things3ImportPayload {
  const db = openDatabase();
  try {
    // Read all non-trashed projects
    const projects = db
      .prepare(
        "SELECT uuid, title FROM TMTask WHERE type = 1 AND trashed = 0 ORDER BY \"index\""
      )
      .all() as { uuid: string; title: string }[];

    // Read all non-trashed tasks (type=0, not trashed)
    const tasks = db
      .prepare(
        `SELECT uuid, title, notes, status, creationDate, stopDate, deadline, project
         FROM TMTask WHERE type = 0 AND trashed = 0
         ORDER BY "index"`
      )
      .all() as ThingsTask[];

    // Read all checklist items for non-trashed tasks
    const checklists = db
      .prepare(
        `SELECT ci.uuid, ci.title, ci.status, ci.task, ci."index"
         FROM TMChecklistItem ci
         INNER JOIN TMTask t ON ci.task = t.uuid
         WHERE t.type = 0 AND t.trashed = 0
         ORDER BY ci."index"`
      )
      .all() as ThingsChecklist[];

    // Group checklists by task uuid
    const checklistsByTask = new Map<string, ThingsChecklist[]>();
    for (const item of checklists) {
      const existing = checklistsByTask.get(item.task) ?? [];
      existing.push(item);
      checklistsByTask.set(item.task, existing);
    }

    // Map projects → lists
    const lists = projects.map((p) => ({
      name: p.title || "Untitled Project",
      thingsUuid: p.uuid,
    }));

    // Map tasks
    const mappedTasks = tasks.map((t) => {
      const status = t.status === 0 ? "active" : "done";
      let notes = t.notes ?? undefined;

      // Append checklist items as markdown
      const checklistItems = checklistsByTask.get(t.uuid);
      if (checklistItems && checklistItems.length > 0) {
        const checklistMd = buildChecklistMarkdown(checklistItems);
        notes = notes ? `${notes}\n\n${checklistMd}` : checklistMd;
      }

      return {
        title: t.title || "Untitled",
        notes,
        dueDate: t.deadline ? decodeThingsDate(t.deadline) : undefined,
        status: status as "active" | "done",
        completedAt: thingsTimestampToISO(t.stopDate),
        createdAt: thingsTimestampToISO(t.creationDate),
        thingsProjectUuid: t.project ?? undefined,
      };
    });

    return { lists, tasks: mappedTasks };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 3: Add IPC handlers in main.ts**

Add to `apps/desktop/electron/main.ts`, after the existing IPC handlers (after `clear-token` handler around line 70):

```typescript
import { scanThings3, readThings3 } from "./things3";

ipcMain.handle("things3:scan", () => {
  try {
    return scanThings3();
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle("things3:import", async (_event, apiUrl: string, authToken: string) => {
  try {
    const payload = readThings3();

    const res = await net.fetch(`${apiUrl}/import/things3`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).error || `Import failed with status ${res.status}`);
    }

    return await res.json();
  } catch (err: any) {
    return { error: err.message };
  }
});
```

- [ ] **Step 4: Expose IPC in preload.ts**

Update `apps/desktop/electron/preload.ts` to add the new methods:

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  storeToken: (token: string) => ipcRenderer.invoke("store-token", token),
  getToken: () => ipcRenderer.invoke("get-token"),
  clearToken: () => ipcRenderer.invoke("clear-token"),
  startGoogleOAuth: () => ipcRenderer.invoke("start-google-oauth"),
  things3Scan: () => ipcRenderer.invoke("things3:scan"),
  things3Import: (apiUrl: string, authToken: string) =>
    ipcRenderer.invoke("things3:import", apiUrl, authToken),
});
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/things3.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add Things 3 SQLite reader and IPC handlers"
```

---

### Task 5: Add Import Settings Section UI

**Files:**
- Create: `apps/desktop/src/settings/ImportSection.tsx`
- Modify: `apps/desktop/src/settings/SettingsPage.tsx`

- [ ] **Step 1: Create the ImportSection component**

Create `apps/desktop/src/settings/ImportSection.tsx`:

```typescript
import React, { useState } from "react";
import { Download, Check, Loader2, AlertCircle } from "lucide-react";
import { getApiUrl, getAuthHeaders } from "../api/client";
import type { Things3ScanResult, Things3ImportResult } from "@brett/types";

const electronAPI = (window as any).electronAPI as
  | {
      platform: string;
      things3Scan: () => Promise<Things3ScanResult | { error: string }>;
      things3Import: (
        apiUrl: string,
        authToken: string
      ) => Promise<Things3ImportResult | { error: string }>;
    }
  | undefined;

type ImportState =
  | { step: "idle" }
  | { step: "scanning" }
  | { step: "preview"; scan: Things3ScanResult }
  | { step: "importing" }
  | { step: "done"; result: Things3ImportResult; importedAt: string }
  | { step: "error"; message: string };

const STORAGE_KEY = "things3-import-completed";

function getStoredImport(userId: string): { importedAt: string; result: Things3ImportResult } | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeImportCompletion(userId: string, result: Things3ImportResult): string {
  const importedAt = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  localStorage.setItem(
    `${STORAGE_KEY}-${userId}`,
    JSON.stringify({ importedAt, result })
  );
  return importedAt;
}

export function ImportSection({ userId }: { userId: string }) {
  const stored = getStoredImport(userId);
  const [state, setState] = useState<ImportState>(
    stored
      ? { step: "done", result: stored.result, importedAt: stored.importedAt }
      : { step: "idle" }
  );

  // Only show on macOS in Electron
  if (!electronAPI || electronAPI.platform !== "darwin") return null;

  async function handleScan() {
    setState({ step: "scanning" });
    const result = await electronAPI!.things3Scan();
    if ("error" in result) {
      setState({ step: "error", message: result.error });
    } else {
      setState({ step: "preview", scan: result });
    }
  }

  async function handleImport() {
    setState({ step: "importing" });
    try {
      const apiUrl = getApiUrl();
      const headers = await getAuthHeaders();
      const token = headers["Authorization"]?.replace("Bearer ", "") ?? "";
      const result = await electronAPI!.things3Import(apiUrl, token);
      if ("error" in result) {
        setState({ step: "error", message: result.error });
      } else {
        const importedAt = storeImportCompletion(userId, result);
        setState({ step: "done", result, importedAt });
      }
    } catch (err: any) {
      setState({ step: "error", message: err.message || "Import failed" });
    }
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Import</h2>
          <p className="text-sm text-white/50">Import your tasks from other apps</p>
        </div>
      </div>

      {state.step === "idle" && (
        <button
          onClick={handleScan}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
        >
          <Download size={16} />
          Import from Things 3
        </button>
      )}

      {state.step === "scanning" && (
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Scanning Things 3...
        </div>
      )}

      {state.step === "preview" && (
        <div className="space-y-3">
          <div className="bg-white/5 rounded-lg p-4 text-sm text-white/70">
            Found <span className="text-white font-medium">{state.scan.projects}</span> project{state.scan.projects !== 1 ? "s" : ""}{" "}
            and <span className="text-white font-medium">{state.scan.tasks.active + state.scan.tasks.completed}</span> task{state.scan.tasks.active + state.scan.tasks.completed !== 1 ? "s" : ""}{" "}
            ({state.scan.tasks.active} active, {state.scan.tasks.completed} completed)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleImport}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm font-medium transition-colors"
            >
              <Download size={16} />
              Import
            </button>
            <button
              onClick={() => setState({ step: "idle" })}
              className="px-4 py-2 rounded-lg text-white/50 hover:text-white/70 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.step === "importing" && (
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Importing...
        </div>
      )}

      {state.step === "done" && (
        <div className="flex items-center gap-2 text-green-400/80 text-sm">
          <Check size={16} />
          Imported {state.result.lists} list{state.result.lists !== 1 ? "s" : ""} and{" "}
          {state.result.tasks} task{state.result.tasks !== 1 ? "s" : ""} from Things 3 on{" "}
          {state.importedAt}
        </div>
      )}

      {state.step === "error" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-red-400/80 text-sm">
            <AlertCircle size={16} />
            {state.message}
          </div>
          <button
            onClick={() => setState({ step: "idle" })}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ImportSection to SettingsPage**

Modify `apps/desktop/src/settings/SettingsPage.tsx`:

Add import at the top:
```typescript
import { ImportSection } from "./ImportSection";
import { useAuth } from "../auth/AuthContext";
```

Add `useAuth` inside the component to get the user ID:
```typescript
const { user } = useAuth();
```

Add `<ImportSection userId={user?.id ?? ""} />` between `<MemorySection />` and `<SignOutSection />`:

```tsx
<MemorySection />
<ImportSection userId={user?.id ?? ""} />
<SignOutSection />
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/settings/ImportSection.tsx apps/desktop/src/settings/SettingsPage.tsx
git commit -m "feat(desktop): add Things 3 import section in Settings"
```

---

### Task 6: Senior Principal Engineer Review

Run two review passes on the implementation.

- [ ] **Step 1: Senior Principal Engineer review**

Review all changed/created files for:
- DRY violations
- Simplification opportunities
- Testing gaps (edge cases, error paths)
- Maintainability concerns
- Over/under-engineering
- Weird issues or subtle bugs

Fix any findings inline.

- [ ] **Step 2: Paranoid Senior Security Engineer review**

Review all changed/created files for:
- Path traversal (SQLite file path)
- SQL injection (even with parameterized queries)
- Input validation completeness
- Data leakage between users
- Payload size limits / DoS vectors
- Auth bypass possibilities
- XSS via imported content (task titles, notes)
- SSRF or unexpected network access
- Electron IPC security (what the renderer can invoke)

Fix any findings inline.

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm test`
Expected: PASS

- [ ] **Step 4: Final typecheck**

Run: `cd /Users/brentbarkman/code/brett/.claude/worktrees/things3import && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit any review fixes**

```bash
git add -A
git commit -m "fix: address engineering and security review findings for Things 3 import"
```
