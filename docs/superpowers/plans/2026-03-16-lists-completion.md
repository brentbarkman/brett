# Lists Feature Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the lists feature — add routing, list detail page, archiving, and navigation integration.

**Architecture:** Replace the `activeView` state machine with react-router-dom MemoryRouter. Extract Today view into its own component. Build a new ListView component for `/lists/:id`. Add archive/unarchive API endpoints and wire them through client hooks to LeftNav.

**Tech Stack:** react-router-dom (MemoryRouter), Hono API, Prisma, React Query, Tailwind CSS, @dnd-kit

**Spec:** `docs/superpowers/specs/2026-03-16-lists-completion-design.md`

---

## Chunk 1: Backend — Data Model, Archive API, Tests

### Task 1: Add `archivedAt` to List model

**Files:**
- Modify: `apps/api/prisma/schema.prisma:66-78`
- Modify: `packages/types/src/index.ts:153-160`

- [ ] **Step 1: Add archivedAt to Prisma schema**

In `apps/api/prisma/schema.prisma`, add `archivedAt` field to the `List` model after `sortOrder`:

```prisma
model List {
  id         String    @id @default(cuid())
  name       String
  colorClass String   @default("bg-gray-500")
  sortOrder  Int      @default(0)
  archivedAt DateTime?
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  items      Item[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([userId, name])
}
```

- [ ] **Step 2: Run migration**

Run: `cd apps/api && pnpm prisma migrate dev --name add_list_archived_at`
Expected: Migration created and applied successfully.

- [ ] **Step 3: Add `archivedAt` to NavList type**

In `packages/types/src/index.ts`, update the `NavList` interface:

```typescript
export interface NavList {
  id: string;
  name: string;
  count: number;
  completedCount: number;
  colorClass: string;
  sortOrder: number;
  archivedAt?: string | null;
}
```

- [ ] **Step 4: Update GET /lists response mapper**

In `apps/api/src/routes/lists.ts`, update the `GET /` response mapper (line 32) to include `archivedAt`:

```typescript
return c.json(
  userLists.map((l) => ({
    id: l.id,
    name: l.name,
    colorClass: l.colorClass,
    count: l._count.items,
    completedCount: l.items.length,
    sortOrder: l.sortOrder,
    archivedAt: l.archivedAt?.toISOString() ?? null,
  }))
);
```

Also update the `POST /lists` response (line 79) to include `archivedAt: null` and the `PATCH /lists/:id` response (line 149) to include `archivedAt: existing.archivedAt?.toISOString() ?? null`.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/ packages/types/src/index.ts apps/api/src/routes/lists.ts
git commit -m "feat: add archivedAt field to List model and NavList type"
```

---

### Task 2: Add archived filter to GET /lists and scope reorder

**Files:**
- Modify: `apps/api/src/routes/lists.ts:12-41` (GET /lists)
- Modify: `apps/api/src/routes/lists.ts:86-124` (PUT /lists/reorder)
- Test: `apps/api/src/__tests__/lists.test.ts`

- [ ] **Step 1: Write failing tests for archived filter**

Add to `apps/api/src/__tests__/lists.test.ts`, a new `describe("archive filtering")` block:

```typescript
describe("archive filtering", () => {
  let archiveToken: string;
  let activeListId: string;
  let archivedListId: string;

  beforeAll(async () => {
    const user = await createTestUser("Archive Filter User");
    archiveToken = user.token;

    // Create an active list
    const res1 = await authRequest("/lists", archiveToken, {
      method: "POST",
      body: JSON.stringify({ name: "Active List" }),
    });
    activeListId = ((await res1.json()) as any).id;

    // Create a list and archive it directly via Prisma (not the API endpoint,
    // which doesn't exist until Task 3)
    const res2 = await authRequest("/lists", archiveToken, {
      method: "POST",
      body: JSON.stringify({ name: "Archived List" }),
    });
    archivedListId = ((await res2.json()) as any).id;

    // Archive directly in the database
    const { prisma } = await import("../lib/prisma.js");
    await prisma.list.update({
      where: { id: archivedListId },
      data: { archivedAt: new Date() },
    });
  });

  it("GET /lists defaults to non-archived only", async () => {
    const res = await authRequest("/lists", archiveToken);
    const body = (await res.json()) as any[];
    expect(body.every((l: any) => l.archivedAt === null)).toBe(true);
    expect(body.find((l: any) => l.id === activeListId)).toBeDefined();
    expect(body.find((l: any) => l.id === archivedListId)).toBeUndefined();
  });

  it("GET /lists?archived=true returns only archived", async () => {
    const res = await authRequest("/lists?archived=true", archiveToken);
    const body = (await res.json()) as any[];
    expect(body.every((l: any) => l.archivedAt !== null)).toBe(true);
    expect(body.find((l: any) => l.id === archivedListId)).toBeDefined();
    expect(body.find((l: any) => l.id === activeListId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pnpm test`
Expected: The new tests fail (archive endpoint doesn't exist yet, and GET /lists doesn't filter).

- [ ] **Step 3: Add archived filter to GET /lists**

In `apps/api/src/routes/lists.ts`, update the `GET /` handler:

```typescript
lists.get("/", async (c) => {
  const user = c.get("user");
  const archived = c.req.query("archived");

  const where: Record<string, unknown> = { userId: user.id };
  if (archived === "true") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
  }

  const userLists = await prisma.list.findMany({
    where,
    include: {
      _count: {
        select: {
          items: true,
        },
      },
      items: {
        where: { status: "done" },
        select: { id: true },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  return c.json(
    userLists.map((l) => ({
      id: l.id,
      name: l.name,
      colorClass: l.colorClass,
      count: l._count.items,
      completedCount: l.items.length,
      sortOrder: l.sortOrder,
      archivedAt: l.archivedAt?.toISOString() ?? null,
    }))
  );
});
```

- [ ] **Step 4: Scope reorder to non-archived lists**

In `apps/api/src/routes/lists.ts`, update the `PUT /reorder` handler. Change the `userLists` query (line 96) to exclude archived:

```typescript
const userLists = await prisma.list.findMany({
  where: { userId: user.id, archivedAt: null },
  select: { id: true },
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && pnpm test`
Expected: All tests pass. The archive filter tests use direct Prisma calls so they don't depend on the archive endpoint.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/lists.ts apps/api/src/__tests__/lists.test.ts
git commit -m "feat: add archived filter to GET /lists, scope reorder to active lists"
```

---

### Task 3: Add archive and unarchive API endpoints

**Files:**
- Modify: `apps/api/src/routes/lists.ts`
- Test: `apps/api/src/__tests__/lists.test.ts`

- [ ] **Step 1: Write failing tests for archive/unarchive**

Add to `apps/api/src/__tests__/lists.test.ts`:

```typescript
describe("PATCH /lists/:id/archive", () => {
  let archToken: string;

  beforeAll(async () => {
    const user = await createTestUser("Archive User");
    archToken = user.token;
  });

  it("archives a list and marks incomplete items as done", async () => {
    // Create a list with items
    const listRes = await authRequest("/lists", archToken, {
      method: "POST",
      body: JSON.stringify({ name: "To Archive" }),
    });
    const list = (await listRes.json()) as any;

    // Create 2 active items in the list
    await authRequest("/things", archToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Item 1", listId: list.id }),
    });
    await authRequest("/things", archToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Item 2", listId: list.id }),
    });

    // Archive
    const res = await authRequest(`/lists/${list.id}/archive`, archToken, {
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.archivedAt).toBeTruthy();
    expect(body.itemsCompleted).toBe(2);

    // Verify items are done
    const thingsRes = await authRequest(`/things?listId=${list.id}`, archToken);
    const things = (await thingsRes.json()) as any[];
    expect(things.every((t: any) => t.isCompleted)).toBe(true);
  });

  it("archives list with all done items without completing any", async () => {
    const listRes = await authRequest("/lists", archToken, {
      method: "POST",
      body: JSON.stringify({ name: "All Done List" }),
    });
    const list = (await listRes.json()) as any;

    // Create and complete an item
    const itemRes = await authRequest("/things", archToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Done Item", listId: list.id }),
    });
    const item = (await itemRes.json()) as any;
    await authRequest(`/things/${item.id}/toggle`, archToken, { method: "PATCH" });

    const res = await authRequest(`/lists/${list.id}/archive`, archToken, {
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.itemsCompleted).toBe(0);
  });

  it("returns 404 for non-existent list", async () => {
    const res = await authRequest("/lists/fake-id/archive", archToken, {
      method: "PATCH",
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /lists/:id/unarchive", () => {
  let unarchToken: string;

  beforeAll(async () => {
    const user = await createTestUser("Unarchive User");
    unarchToken = user.token;
  });

  it("unarchives a list, items stay as-is", async () => {
    const listRes = await authRequest("/lists", unarchToken, {
      method: "POST",
      body: JSON.stringify({ name: "To Unarchive" }),
    });
    const list = (await listRes.json()) as any;

    // Archive first
    await authRequest(`/lists/${list.id}/archive`, unarchToken, {
      method: "PATCH",
    });

    // Unarchive
    const res = await authRequest(`/lists/${list.id}/unarchive`, unarchToken, {
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.archivedAt).toBeNull();
  });

  it("returns 404 for non-existent list", async () => {
    const res = await authRequest("/lists/fake-id/unarchive", unarchToken, {
      method: "PATCH",
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pnpm test`
Expected: New archive/unarchive tests fail.

- [ ] **Step 3: Implement archive endpoint**

Add to `apps/api/src/routes/lists.ts`, **AFTER the `PUT /reorder` route and BEFORE the existing `PATCH /:id` route**. This ordering is critical — Hono matches routes in registration order, so `/:id/archive` must be registered before `/:id` or it will never match.

```typescript
// PATCH /lists/:id/archive — archive list, mark incomplete items done
lists.patch("/:id/archive", async (c) => {
  const user = c.get("user");
  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const now = new Date();

  const [, updateResult] = await prisma.$transaction([
    prisma.list.update({
      where: { id: existing.id },
      data: { archivedAt: now },
    }),
    prisma.item.updateMany({
      where: { listId: existing.id, status: { not: "done" } },
      data: { status: "done", completedAt: now },
    }),
  ]);

  return c.json({
    archivedAt: now.toISOString(),
    itemsCompleted: updateResult.count,
  });
});
```

- [ ] **Step 4: Implement unarchive endpoint**

Add to `apps/api/src/routes/lists.ts`, right after the archive endpoint (still before `PATCH /:id`):

```typescript
// PATCH /lists/:id/unarchive — unarchive list, items stay as-is
lists.patch("/:id/unarchive", async (c) => {
  const user = c.get("user");
  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const list = await prisma.list.update({
    where: { id: existing.id },
    data: { archivedAt: null },
    include: {
      _count: { select: { items: true } },
      items: { where: { status: "done" }, select: { id: true } },
    },
  });

  return c.json({
    id: list.id,
    name: list.name,
    colorClass: list.colorClass,
    count: list._count.items,
    completedCount: list.items.length,
    sortOrder: list.sortOrder,
    archivedAt: list.archivedAt?.toISOString() ?? null,
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd apps/api && pnpm test`
Expected: All tests pass, including the archive filter tests from Task 2.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/lists.ts apps/api/src/__tests__/lists.test.ts
git commit -m "feat: add archive/unarchive API endpoints with tests"
```

---

## Chunk 2: Client Hooks + Routing Setup

### Task 4: Add archive/unarchive client hooks and useListThings

**Files:**
- Modify: `apps/desktop/src/api/lists.ts`
- Modify: `apps/desktop/src/api/things.ts`

- [ ] **Step 1: Add archive hooks to lists.ts**

In `apps/desktop/src/api/lists.ts`, add these hooks after `useReorderLists`:

```typescript
export function useArchiveList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ archivedAt: string; itemsCompleted: number }>(`/lists/${id}/archive`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["things"] });
    },
  });
}

export function useUnarchiveList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<NavList>(`/lists/${id}/unarchive`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useArchivedLists() {
  return useQuery({
    queryKey: ["lists", "archived"],
    queryFn: () => apiFetch<NavList[]>("/lists?archived=true"),
  });
}
```

- [ ] **Step 2: Add useListThings to things.ts**

In `apps/desktop/src/api/things.ts`, add after `useDoneThings`:

```typescript
/** Things belonging to a specific list */
export function useListThings(listId: string) {
  return useQuery({
    queryKey: ["things", "list", listId],
    queryFn: () => apiFetch<Thing[]>(`/things?listId=${listId}`),
    enabled: !!listId,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/api/lists.ts apps/desktop/src/api/things.ts
git commit -m "feat: add archive/unarchive hooks and useListThings"
```

---

### Task 5: Install react-router-dom and set up MemoryRouter

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/main.tsx`

- [ ] **Step 1: Install react-router-dom**

Run: `cd apps/desktop && pnpm add react-router-dom`

- [ ] **Step 2: Wrap App in MemoryRouter**

Update `apps/desktop/src/main.tsx`:

```typescript
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard } from "./auth/AuthGuard";
import { LoginPage } from "./auth/LoginPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGuard fallback={<LoginPage />}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/today"]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthGuard>
    </AuthProvider>
  </React.StrictMode>
);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json apps/desktop/src/main.tsx pnpm-lock.yaml
git commit -m "feat: install react-router-dom, wrap App in MemoryRouter"
```

---

### Task 6: Extract TodayView from App.tsx

Extract the Today view rendering logic into its own component so App.tsx can use route-based rendering.

**Files:**
- Create: `apps/desktop/src/views/TodayView.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Create TodayView component**

Create `apps/desktop/src/views/TodayView.tsx`. This extracts the today-specific state and rendering from App.tsx:

```typescript
import React, { useState } from "react";
import type { Thing, CalendarEvent, NavList } from "@brett/types";
import {
  Omnibar,
  MorningBriefing,
  UpNextCard,
  FilterPills,
  ThingsList,
  ThingsEmptyState,
  CrossFade,
  TriagePopup,
} from "@brett/ui";
import { useActiveThings, useDoneThings, useCreateThing, useToggleThing } from "../api/things";
import { mockEvents, mockBriefingItems } from "../data/mockData";

interface TodayViewProps {
  lists: NavList[];
  onItemClick: (item: Thing | CalendarEvent) => void;
  onTriageOpen: (mode: "list-first" | "date-first", ids: string[]) => void;
  triagePopup: React.ReactNode | null;
}

export function TodayView({ lists, onItemClick, onTriageOpen, triagePopup }: TodayViewProps) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [isBriefingVisible, setIsBriefingVisible] = useState(true);

  const createThing = useCreateThing();
  const toggleThing = useToggleThing();

  // Compute date boundaries for today view queries
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayOfWeek = todayStart.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const endOfWeek = new Date(todayStart.getTime() + daysUntilSunday * 86400000);
  const dueBefore = endOfWeek.toISOString();
  const completedAfter = todayStart.toISOString();

  const { data: activeThings = [], isLoading: activeLoading } = useActiveThings(dueBefore);
  const { data: doneThings = [], isLoading: doneLoading } = useDoneThings(completedAfter);
  const things = [...activeThings, ...doneThings];
  const thingsLoading = activeLoading || doneLoading;

  const handleToggle = (id: string) => {
    toggleThing.mutate(id);
  };

  const handleAddTask = (title: string, listId: string | null) => {
    const now = new Date();
    const todayISO = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString();
    createThing.mutate(
      { type: "task", title, listId: listId ?? undefined, dueDate: todayISO, dueDatePrecision: "day" },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  const handleAddContent = (url: string, title: string, listId: string | null) => {
    createThing.mutate(
      { type: "content", title, sourceUrl: url, listId: listId ?? undefined },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  // Server provides the right date range; client just applies type filter
  const filteredThings = things.filter((thing) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Tasks") return thing.type === "task";
    if (activeFilter === "Content") return thing.type === "content";
    return true;
  });

  const upNextEvent = mockEvents.find((e) => e.id === "e2");

  // Determine which state the things area is in for cross-fade
  const allCompleted = filteredThings.length > 0 && filteredThings.every((t) => t.isCompleted);
  const isEmpty = filteredThings.length === 0;
  const thingsStateKey = thingsLoading
    ? "loading"
    : isEmpty
      ? "empty"
      : "has-things";

  const thingsContent = thingsLoading ? (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
      <div className="text-center text-white/40 text-sm">
        Loading...
      </div>
    </div>
  ) : isEmpty ? (
    <ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere={things.length > 0} allCompleted={false} lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />
  ) : allCompleted ? (
    <ThingsList
      things={filteredThings}
      lists={lists}
      onItemClick={onItemClick}
      onToggle={handleToggle}
      onAdd={handleAddTask}
      onTriageOpen={onTriageOpen}
      header={<ThingsEmptyState activeFilter={activeFilter} hasThingsElsewhere allCompleted inline lists={lists} onAddTask={handleAddTask} onAddContent={handleAddContent} />}
    />
  ) : (
    <ThingsList things={filteredThings} lists={lists} onItemClick={onItemClick} onToggle={handleToggle} onAdd={handleAddTask} onTriageOpen={onTriageOpen} />
  );

  return (
    <>
      <Omnibar />

      {isBriefingVisible && (
        <MorningBriefing
          items={mockBriefingItems}
          onDismiss={() => setIsBriefingVisible(false)}
        />
      )}

      {upNextEvent && (
        <UpNextCard
          event={upNextEvent}
          onClick={() => onItemClick(upNextEvent)}
        />
      )}

      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 px-4 py-3">
        <FilterPills
          activeFilter={activeFilter}
          onSelectFilter={setActiveFilter}
        />
      </div>

      <CrossFade stateKey={thingsStateKey} exitMs={180} enterMs={280}>
        {thingsContent}
      </CrossFade>

      {/* Triage popup for today view */}
      {triagePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          {triagePopup}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TodayView extracts cleanly**

Check that App.tsx's today rendering logic (lines ~91-94, 143-158, 263-301, 376-403, 438-447) maps to TodayView. The following are moved OUT of App.tsx:
- `activeFilter` state
- `isBriefingVisible` state
- Date boundary computation (`dueBefore`, `completedAfter`)
- `useActiveThings`, `useDoneThings` queries
- `handleAddTask`, `handleAddContent` handlers
- `filteredThings`, `thingsStateKey`, `thingsContent` logic

The following stay in App.tsx (shared across views):
- `selectedItem` / `isDetailOpen` / `handleItemClick` / `handleCloseDetail`
- `triageState` / triage handlers
- `deleteListConfirm` state
- DnD context / drag handlers
- List mutations (create, update, delete, reorder)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/views/TodayView.tsx apps/desktop/src/App.tsx
git commit -m "refactor: extract TodayView from App.tsx"
```

---

### Task 7: Wire up route-based rendering in App.tsx

Replace `activeView` state with `<Routes>` in App.tsx.

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Replace activeView with Routes**

Rewrite App.tsx to use `Routes` / `Route`. Key changes:

1. Add imports: `import { Routes, Route, useNavigate, useLocation } from "react-router-dom";`
2. Import `TodayView` from `./views/TodayView`
3. Remove: `type ActiveView`, `activeView` state, `handleNavClick`
4. Add: `const navigate = useNavigate();` and `const location = useLocation();`
5. Replace `activeView === "inbox"` conditional with route-based rendering
6. Pass `navigate` and `location.pathname` to LeftNav instead of `activeView` and `onNavClick`

Use a **flat single `<Routes>`** — do NOT nest `<Routes>` components. The shared main + calendar layout is extracted into a small `MainLayout` wrapper:

```tsx
// Small layout wrapper — defined at module level or inline
function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-hide py-2">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          {children}
        </div>
      </main>
      <div className="w-[300px] flex-shrink-0 py-2">
        <CalendarTimeline events={mockEvents} onEventClick={handleItemClick} />
      </div>
    </>
  );
}
```

The main return becomes:

```tsx
<DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
  <div className="relative flex h-screen w-full overflow-hidden text-white font-sans bg-black">
    {/* Background + vignette (unchanged) */}
    ...

    <div className="relative z-10 flex w-full h-full gap-4 p-4 pl-0">
      <LeftNav
        isCollapsed={isDetailOpen}
        lists={lists}
        user={user}
        currentPath={location.pathname}
        navigate={navigate}
        inboxCount={inboxCount}
        onCreateList={(name) => createList.mutate({ name })}
        onRenameList={(id, name) => updateList.mutate({ id, name })}
        onDeleteList={(id) => {
          const list = lists.find((l) => l.id === id);
          if (list && list.count > 0) {
            setDeleteListConfirm({ id, name: list.name, count: list.count });
          } else {
            deleteList.mutate(id);
          }
        }}
        onReorderLists={(ids) => reorderLists.mutate(ids)}
      />

      <Routes>
        <Route path="/settings" element={
          <SettingsPage onBack={() => navigate("/today")} />
        } />
        <Route path="/today" element={
          <MainLayout>
            <TodayView
              lists={lists}
              onItemClick={handleItemClick}
              onTriageOpen={handleTriageOpen}
              triagePopup={triageState ? (
                <TriagePopup mode={triageState.mode} lists={lists} onConfirm={handleTriageConfirm} onCancel={handleTriageCancel} />
              ) : null}
            />
          </MainLayout>
        } />
        <Route path="/inbox" element={
          <MainLayout>
            <InboxView
              things={inboxData?.visible ?? []}
              hiddenCount={inboxData?.hiddenCount ?? 0}
              hiddenThings={inboxData?.hidden}
              lists={lists}
              onItemClick={handleItemClick}
              onToggle={handleToggle}
              onArchive={handleInboxArchive}
              onAdd={handleInboxAdd}
              onTriage={handleInboxTriage}
              onTriageOpen={handleTriageOpen}
              triagePopup={triageState ? (
                <TriagePopup mode={triageState.mode} lists={lists} onConfirm={handleTriageConfirm} onCancel={handleTriageCancel} />
              ) : undefined}
            />
          </MainLayout>
        } />
        <Route path="/lists/:id" element={
          <MainLayout>
            <div className="text-white/40 text-sm p-4">List view placeholder</div>
          </MainLayout>
        } />
      </Routes>
    </div>

    {/* Detail panel, drag overlay, confirm dialog (unchanged) */}
    ...
  </div>
</DndContext>
```

**Note on incompleteCount:** Since the today-specific queries moved to TodayView, App.tsx no longer has `things`. Pass `incompleteCount={0}` for now — this is a cosmetic badge and can be restored later with a lightweight count query. Add a `// TODO: restore incompleteCount with a lightweight query` comment.

**Note on handleToggle:** Keep `handleToggle` in App.tsx — it's still needed by InboxView. TodayView creates its own local version internally.

**Note on inbox fetch:** The `useInboxThings` call should stay in App.tsx since it's needed for DnD overlay context too. The `includeHidden` parameter should be based on `location.pathname === "/inbox"` instead of `activeView === "inbox"`.

- [ ] **Step 2: Verify the app still works**

Run: `pnpm dev:desktop` (or `pnpm dev:full`)
Expected: Today view and Inbox view render correctly via routing. List clicks in LeftNav will not yet work (LeftNav props not updated yet).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: Errors in LeftNav props (expected — will fix in Task 8).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: replace activeView state with react-router-dom Routes"
```

---

### Task 8: Update LeftNav props for routing

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx`
- Modify: `apps/desktop/src/App.tsx` (if needed for prop adjustments)

- [ ] **Step 1: Update LeftNavProps interface**

In `packages/ui/src/LeftNav.tsx`, update the props:

```typescript
interface LeftNavProps {
  isCollapsed: boolean;
  lists: NavList[];
  user?: LeftNavUser | null;
  incompleteCount?: number;
  /** Current route path (e.g., "/today", "/lists/abc123") */
  currentPath?: string;
  /** Navigation function — called with target path */
  navigate?: (path: string) => void;
  inboxCount?: number;
  onCreateList?: (name: string) => void;
  onRenameList?: (id: string, newName: string) => void;
  onDeleteList?: (id: string) => void;
  onReorderLists?: (orderedIds: string[]) => void;
}
```

Remove: `activeView`, `onNavClick`, `onAvatarClick`.

- [ ] **Step 2: Update LeftNav component body**

Update the destructured props and replace all `onNavClick` usages with `navigate`:

```typescript
export function LeftNav({
  isCollapsed,
  lists,
  user,
  incompleteCount,
  currentPath = "/today",
  navigate,
  inboxCount,
  onCreateList,
  onRenameList,
  onDeleteList,
  onReorderLists,
}: LeftNavProps) {
```

Update NavItem clicks:
- Today: `onClick={() => navigate?.("/today")}`, `isActive={currentPath === "/today"}`
- Inbox: `onClick={() => navigate?.("/inbox")}`, `isActive={currentPath === "/inbox"}`
- Avatar: `onClick={() => navigate?.("/settings")}`

Update SortableListItem:
- Pass `isActive={currentPath === \`/lists/${list.id}\`}` to each SortableListItem
- `onClick={() => navigate?.(\`/lists/${list.id}\`)}`

- [ ] **Step 3: Add isActive prop to SortableListItem**

Update the SortableListItem function signature to accept `isActive`:

```typescript
function SortableListItem({
  list,
  isCollapsed,
  isActive,
  onClick,
  onRename,
  onDelete,
}: {
  list: NavList;
  isCollapsed: boolean;
  isActive?: boolean;
  onClick?: () => void;
  onRename?: (id: string, newName: string) => void;
  onDelete?: (id: string) => void;
}) {
```

Update the button className to include active styling:

```tsx
<button
  onClick={onClick}
  className={`
    flex items-center w-full rounded-lg transition-colors duration-200 group
    ${isCollapsed ? "justify-center p-2.5" : "px-2 py-1.5 gap-2.5"}
    ${
      isOver
        ? `${dropHighlight} border border-white/20 text-white`
        : isActive
          ? "bg-white/10 text-white"
          : "text-white/60 hover:bg-white/5 hover:text-white/90"
    }
  `}
```

- [ ] **Step 4: Update App.tsx to pass new props**

In `apps/desktop/src/App.tsx`, update the LeftNav usage:

```tsx
<LeftNav
  isCollapsed={isDetailOpen}
  lists={lists}
  user={user}
  currentPath={location.pathname}
  navigate={navigate}
  inboxCount={inboxCount}
  onCreateList={(name) => createList.mutate({ name })}
  onRenameList={(id, name) => updateList.mutate({ id, name })}
  onDeleteList={(id) => { /* same as before */ }}
  onReorderLists={(ids) => reorderLists.mutate(ids)}
/>
```

- [ ] **Step 5: Typecheck and verify**

Run: `pnpm typecheck`
Expected: No errors.

Run: `pnpm dev:full`
Expected: Clicking Today, Inbox, Settings in LeftNav navigates correctly. Clicking a list shows the placeholder. Active list is highlighted.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/LeftNav.tsx apps/desktop/src/App.tsx
git commit -m "feat: update LeftNav to use navigate/currentPath props for routing"
```

---

## Chunk 3: ListView Component

### Task 9: Create ListView with header and content sections

**Files:**
- Create: `apps/desktop/src/views/ListView.tsx`
- Modify: `apps/desktop/src/App.tsx` (replace placeholder route)
- Modify: `packages/ui/src/index.ts` (if adding shared components)

- [ ] **Step 1: Create ListView component**

Create `apps/desktop/src/views/ListView.tsx`:

```typescript
import React, { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Archive } from "lucide-react";
import type { Thing, CalendarEvent, NavList } from "@brett/types";
import { ThingsList, ThingsEmptyState } from "@brett/ui";
import { useListThings, useCreateThing, useToggleThing } from "../api/things";
import { useLists, useUpdateList, useArchiveList, useUnarchiveList } from "../api/lists";

const COLOR_OPTIONS = [
  { label: "Blue", value: "bg-blue-500", hex: "#3b82f6" },
  { label: "Red", value: "bg-red-500", hex: "#ef4444" },
  { label: "Green", value: "bg-green-500", hex: "#22c55e" },
  { label: "Purple", value: "bg-purple-500", hex: "#a855f7" },
  { label: "Amber", value: "bg-amber-500", hex: "#f59e0b" },
  { label: "Pink", value: "bg-pink-500", hex: "#ec4899" },
  { label: "Cyan", value: "bg-cyan-500", hex: "#06b6d4" },
  { label: "Orange", value: "bg-orange-500", hex: "#f97316" },
];

const colorMap: Record<string, string> = {
  "bg-blue-500": "#3b82f6",
  "bg-green-500": "#22c55e",
  "bg-purple-500": "#a855f7",
  "bg-amber-500": "#f59e0b",
  "bg-red-500": "#ef4444",
  "bg-pink-500": "#ec4899",
  "bg-cyan-500": "#06b6d4",
  "bg-orange-500": "#f97316",
};

interface ListViewProps {
  lists: NavList[];
  archivedLists?: NavList[];
  onItemClick: (item: Thing) => void;
}

export function ListView({ lists, archivedLists = [], onItemClick }: ListViewProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Search both active and archived lists
  const list = lists.find((l) => l.id === id) ?? archivedLists.find((l) => l.id === id);

  const { data: things = [], isLoading } = useListThings(id!);
  const updateList = useUpdateList();
  const createThing = useCreateThing();
  const toggleThing = useToggleThing();
  const archiveList = useArchiveList();
  const unarchiveList = useUnarchiveList();

  // Inline name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Color picker
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Inline add
  const [isAdding, setIsAdding] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const isArchived = !!list?.archivedAt;

  // Focus name input when editing
  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  // Focus add input
  useEffect(() => {
    if (isAdding) {
      addInputRef.current?.focus();
    }
  }, [isAdding]);

  // Close color picker on outside click
  useEffect(() => {
    if (!showColorPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColorPicker]);

  // Close color picker on Escape
  useEffect(() => {
    if (!showColorPicker) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowColorPicker(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showColorPicker]);

  if (!list) {
    // List not found — possibly deleted or wrong ID
    return (
      <div className="text-white/40 text-sm p-8 text-center">
        List not found.{" "}
        <button onClick={() => navigate("/today")} className="text-blue-400 hover:text-blue-300">
          Go to Today
        </button>
      </div>
    );
  }

  const activeThings = things.filter((t) => !t.isCompleted);
  const doneThings = things.filter((t) => t.isCompleted);

  const handleNameSubmit = () => {
    const name = editName.trim();
    if (name && name !== list.name) {
      updateList.mutate({ id: list.id, name });
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleNameSubmit();
    if (e.key === "Escape") {
      setEditName(list.name);
      setIsEditingName(false);
    }
  };

  const handleColorSelect = (colorClass: string) => {
    updateList.mutate({ id: list.id, colorClass });
    setShowColorPicker(false);
  };

  const handleAddSubmit = () => {
    const title = addTitle.trim();
    if (title) {
      createThing.mutate(
        { type: "task", title, listId: list.id },
        { onError: (err) => console.error("Failed to create thing:", err) }
      );
    }
    setAddTitle("");
    setIsAdding(false);
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddSubmit();
    if (e.key === "Escape") {
      setAddTitle("");
      setIsAdding(false);
    }
  };

  const handleToggle = (thingId: string) => {
    toggleThing.mutate(thingId);
  };

  const handleAddForList = (title: string, _listId: string | null) => {
    createThing.mutate(
      { type: "task", title, listId: list.id },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  const dotColor = colorMap[list.colorClass] ?? "rgba(255,255,255,0.4)";

  return (
    <>
      {/* Archived banner */}
      {isArchived && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-amber-400/80">This list is archived</span>
          <button
            onClick={() => unarchiveList.mutate(list.id)}
            className="text-sm text-amber-400 hover:text-amber-300 font-medium transition-colors"
          >
            Unarchive
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        {/* Color dot */}
        <div className="relative" ref={colorPickerRef}>
          <button
            onClick={() => !isArchived && setShowColorPicker(!showColorPicker)}
            className={`w-4 h-4 rounded-full flex-shrink-0 transition-transform ${!isArchived ? "hover:scale-110 cursor-pointer" : "cursor-default"}`}
            style={{ backgroundColor: dotColor }}
          />
          {showColorPicker && (
            <div className="absolute top-full left-0 mt-2 z-50 bg-black/80 backdrop-blur-2xl rounded-lg border border-white/15 p-2 flex gap-1.5 shadow-xl">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => handleColorSelect(c.value)}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${list.colorClass === c.value ? "ring-2 ring-white/50 ring-offset-1 ring-offset-black" : ""}`}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                />
              ))}
            </div>
          )}
        </div>

        {/* List name */}
        {isEditingName && !isArchived ? (
          <input
            ref={nameInputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={handleNameSubmit}
            className="text-xl font-semibold text-white bg-transparent border-none outline-none flex-1"
          />
        ) : (
          <h1
            onClick={() => {
              if (!isArchived) {
                setEditName(list.name);
                setIsEditingName(true);
              }
            }}
            className={`text-xl font-semibold text-white ${!isArchived ? "cursor-text" : ""}`}
          >
            {list.name}
          </h1>
        )}

        {/* Item count */}
        <span className="text-xs text-white/40 font-medium">
          {list.count} {list.count === 1 ? "item" : "items"}
        </span>

        {/* Archive action (non-archived only) */}
        {!isArchived && (
          <button
            onClick={() => archiveList.mutate(list.id)}
            className="ml-auto text-white/30 hover:text-white/60 transition-colors p-1 rounded hover:bg-white/5"
            title="Archive list"
          >
            <Archive size={16} />
          </button>
        )}
      </div>

      {/* Inline add row (non-archived only) */}
      {!isArchived && (
        isAdding ? (
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5">
            <input
              ref={addInputRef}
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={handleAddKeyDown}
              onBlur={handleAddSubmit}
              placeholder="What needs to be done?"
              className="w-full bg-transparent border-none outline-none text-sm text-white placeholder:text-white/30"
            />
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full text-left bg-transparent border border-dashed border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/30 hover:text-white/50 hover:border-white/20 transition-colors"
          >
            + Add a thing...
          </button>
        )
      )}

      {/* Content */}
      {isLoading ? (
        <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
          <div className="text-center text-white/40 text-sm">Loading...</div>
        </div>
      ) : things.length === 0 ? (
        <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
          <div className="text-center text-white/40 text-sm">
            No items in this list yet
          </div>
        </div>
      ) : (
        <>
          {activeThings.length > 0 && (
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2">
                Active
              </h3>
              <ThingsList
                things={activeThings}
                lists={lists}
                onItemClick={onItemClick}
                onToggle={handleToggle}
                onAdd={handleAddForList}
              />
            </div>
          )}
          {doneThings.length > 0 && (
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2">
                Done
              </h3>
              <ThingsList
                things={doneThings}
                lists={lists}
                onItemClick={onItemClick}
                onToggle={handleToggle}
                onAdd={handleAddForList}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire ListView into App.tsx routes**

In `apps/desktop/src/App.tsx`, replace the placeholder route:

```typescript
import { ListView } from "./views/ListView";

// In the Routes:
<Route path="/lists/:id" element={
  <MainLayout>
    <ListView lists={lists} archivedLists={archivedLists} onItemClick={handleItemClick} />
  </MainLayout>
} />
```

**Note:** `archivedLists` won't exist in App.tsx until Task 11 adds the hook. For now, omit the prop — the default is `[]`. Task 11 will add it.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors (or minor issues to fix).

- [ ] **Step 4: Manual verification**

Run: `pnpm dev:full`
Expected:
- Click a list in LeftNav → navigates to list detail page
- Header shows list name + color dot + item count
- Click color dot → picker appears, select color → updates
- Click name → inline edit, Enter to save, Escape to cancel
- Click "+ Add a thing..." → input appears, type + Enter → item created in list
- Active/Done sections render with ThingCards
- Click item → DetailPanel opens
- Archived list shows banner + no add row + read-only header

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/ListView.tsx apps/desktop/src/App.tsx
git commit -m "feat: add ListView component with header, color picker, inline add, active/done sections"
```

---

## Chunk 4: LeftNav Archive Integration

### Task 10: Add archive/unarchive to LeftNav context menu

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx`

- [ ] **Step 1: Add onArchiveList prop to LeftNavProps**

```typescript
interface LeftNavProps {
  // ... existing props ...
  onArchiveList?: (id: string) => void;
  onUnarchiveList?: (id: string) => void;
  /** Archived lists for the collapsible section */
  archivedLists?: NavList[];
}
```

- [ ] **Step 2: Add Archive to SortableListItem context menu**

In the SortableListItem component, add `onArchive` prop and an Archive menu item between Rename and Delete:

```typescript
function SortableListItem({
  list,
  isCollapsed,
  isActive,
  onClick,
  onRename,
  onDelete,
  onArchive,
}: {
  // ... existing props ...
  onArchive?: (id: string) => void;
}) {
```

In the context menu dropdown, add between Rename and Delete:

```tsx
{onArchive && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      setShowMenu(false);
      onArchive(list.id);
    }}
    className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
  >
    Archive
  </button>
)}
```

- [ ] **Step 3: Pass onArchive to SortableListItem**

In the LeftNav lists map:

```tsx
<SortableListItem
  key={list.id}
  list={list}
  isCollapsed={isCollapsed}
  isActive={currentPath === `/lists/${list.id}`}
  onClick={() => navigate?.(`/lists/${list.id}`)}
  onRename={onRenameList}
  onDelete={onDeleteList}
  onArchive={onArchiveList}
/>
```

- [ ] **Step 4: Add archived lists section**

After the `SortableContext` div in LeftNav, add the archived section:

```tsx
{/* Archived lists section */}
{!isCollapsed && archivedLists && archivedLists.length > 0 && (
  <ArchivedListsSection
    lists={archivedLists}
    currentPath={currentPath}
    navigate={navigate}
    onUnarchive={onUnarchiveList}
    onDelete={onDeleteList}
  />
)}
```

Create the `ArchivedListsSection` component within LeftNav.tsx:

```typescript
function ArchivedListsSection({
  lists,
  currentPath,
  navigate,
  onUnarchive,
  onDelete,
}: {
  lists: NavList[];
  currentPath: string;
  navigate?: (path: string) => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 px-2 mb-2 text-white/30 hover:text-white/50 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-xs uppercase tracking-wider font-semibold">
          Archived
        </span>
      </button>
      {isExpanded && (
        <div className="space-y-1">
          {lists.map((list) => (
            <ArchivedListItem
              key={list.id}
              list={list}
              isActive={currentPath === `/lists/${list.id}`}
              onClick={() => navigate?.(`/lists/${list.id}`)}
              onUnarchive={onUnarchive}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

Create `ArchivedListItem` (simpler than SortableListItem — no drag, different menu):

```typescript
function ArchivedListItem({
  list,
  isActive,
  onClick,
  onUnarchive,
  onDelete,
}: {
  list: NavList;
  isActive?: boolean;
  onClick?: () => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuButtonRef.current && !menuButtonRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const dotColor = colorMap[list.colorClass] ?? "rgba(255,255,255,0.4)";

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`
          flex items-center w-full rounded-lg transition-colors duration-200 px-2 py-1.5 gap-2.5 opacity-50
          ${isActive ? "bg-white/10 text-white opacity-100" : "text-white/60 hover:bg-white/5 hover:text-white/90"}
        `}
      >
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: dotColor }}
        />
        <span className="text-sm font-medium flex-1 text-left truncate">{list.name}</span>
        {(onUnarchive || onDelete) && (
          <button
            ref={menuButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 transition-all p-0.5 rounded hover:bg-white/10 flex-shrink-0"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 z-50 bg-black/60 backdrop-blur-2xl rounded-lg border border-white/10 py-1 min-w-[120px] shadow-xl"
        >
          {onUnarchive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onUnarchive(list.id);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              Unarchive
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDelete(list.id);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

**Required changes:**
1. Add `ChevronRight` to the lucide-react imports at the top of LeftNav.tsx (line 2).
2. Move the `colorMap` object from inside `ProgressDot` to module scope (above all component functions) so both `ProgressDot` and `ArchivedListItem` can reference it.
3. Add `"bg-gray-500": "rgba(255,255,255,0.4)"` to `colorMap` so the default color renders correctly.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: Errors in App.tsx (new props not passed yet — fixed in Task 11).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/LeftNav.tsx
git commit -m "feat: add archive/unarchive to LeftNav context menu and archived section"
```

---

### Task 11: Wire archive actions in App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add archive hooks and confirmation dialog**

In App.tsx, add imports and hooks:

```typescript
import { useLists, useCreateList, useUpdateList, useDeleteList, useReorderLists, useArchiveList, useUnarchiveList, useArchivedLists } from "./api/lists";
```

Add hooks inside the component:

```typescript
const archiveList = useArchiveList();
const unarchiveList = useUnarchiveList();
const { data: archivedLists = [] } = useArchivedLists();
```

Add archive confirmation state:

```typescript
const [archiveListConfirm, setArchiveListConfirm] = useState<{
  id: string;
  name: string;
  incompleteCount: number;
} | null>(null);
```

- [ ] **Step 2: Create handleArchiveList function**

```typescript
const handleArchiveList = (id: string) => {
  const list = [...lists, ...archivedLists].find((l) => l.id === id);
  if (!list) return;

  const incompleteCount = list.count - list.completedCount;
  if (incompleteCount > 0) {
    setArchiveListConfirm({ id, name: list.name, incompleteCount });
  } else {
    archiveList.mutate(id);
    if (location.pathname === `/lists/${id}`) {
      navigate("/today");
    }
  }
};
```

- [ ] **Step 3: Pass new props to LeftNav**

```tsx
<LeftNav
  isCollapsed={isDetailOpen}
  lists={lists}
  archivedLists={archivedLists}
  user={user}
  currentPath={location.pathname}
  navigate={navigate}
  inboxCount={inboxCount}
  onCreateList={(name) => createList.mutate({ name })}
  onRenameList={(id, name) => updateList.mutate({ id, name })}
  onDeleteList={(id) => {
    const list = [...lists, ...archivedLists].find((l) => l.id === id);
    if (list && list.count > 0) {
      setDeleteListConfirm({ id, name: list.name, count: list.count });
    } else {
      deleteList.mutate(id);
      if (location.pathname === `/lists/${id}`) {
        navigate("/today");
      }
    }
  }}
  onArchiveList={handleArchiveList}
  onUnarchiveList={(id) => unarchiveList.mutate(id)}
  onReorderLists={(ids) => reorderLists.mutate(ids)}
/>
```

- [ ] **Step 4: Add archive confirmation dialog**

After the existing delete confirmation dialog:

```tsx
{archiveListConfirm && (
  <ConfirmDialog
    title={`Archive "${archiveListConfirm.name}"?`}
    description={`${archiveListConfirm.incompleteCount} incomplete item${archiveListConfirm.incompleteCount === 1 ? "" : "s"} will be marked as done.`}
    confirmLabel="Archive"
    variant="default"
    onConfirm={() => {
      archiveList.mutate(archiveListConfirm.id);
      if (location.pathname === `/lists/${archiveListConfirm.id}`) {
        navigate("/today");
      }
      setArchiveListConfirm(null);
    }}
    onCancel={() => setArchiveListConfirm(null)}
  />
)}
```

- [ ] **Step 5: Also handle archive from ListView**

The ListView already calls `archiveList.mutate()` directly — but it doesn't show a confirmation dialog. Update ListView to accept an `onArchive` prop instead:

In `apps/desktop/src/views/ListView.tsx`, add `onArchiveList` to the existing props interface:

```typescript
interface ListViewProps {
  lists: NavList[];
  archivedLists?: NavList[];
  onItemClick: (item: Thing) => void;
  onArchiveList?: (id: string) => void;
}
```

Replace the direct `archiveList.mutate(list.id)` call with `onArchiveList?.(list.id)`. Remove the `useArchiveList` import since it's now handled by the parent.

In App.tsx, update the route to pass all needed props:

```tsx
<Route path="/lists/:id" element={
  <MainLayout>
    <ListView lists={lists} archivedLists={archivedLists} onItemClick={handleItemClick} onArchiveList={handleArchiveList} />
  </MainLayout>
} />
```

- [ ] **Step 6: Typecheck and verify**

Run: `pnpm typecheck`
Expected: No errors.

Run: `pnpm dev:full`
Expected:
- Right-click list → Archive → confirmation if incomplete items → list moves to archived section
- Archived section appears in nav, collapsed by default
- Expand → see archived lists with muted styling
- Click archived list → see detail page with banner
- Unarchive from banner or context menu → moves back to active
- Delete from detail page → navigates to /today

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/views/ListView.tsx
git commit -m "feat: wire archive actions with confirmation dialog and nav integration"
```

---

### Task 12: Final typecheck, cleanup, and verification

**Files:**
- All modified files

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: No errors across the entire monorepo.

- [ ] **Step 2: Run API tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Manual end-to-end verification**

Run: `pnpm dev:full`

Verify:
- [ ] Navigate to Today view (default)
- [ ] Navigate to Inbox view
- [ ] Navigate to Settings
- [ ] Click a list → list detail page with header, add row, items
- [ ] Edit list name inline
- [ ] Change list color via dot
- [ ] Add item via inline add row
- [ ] Toggle item completion
- [ ] Click item → DetailPanel opens
- [ ] Archive list with incomplete items → confirmation → archived
- [ ] Archived section appears in LeftNav
- [ ] Expand archived section → see list
- [ ] Click archived list → read-only detail page with banner
- [ ] Unarchive from banner → moves back
- [ ] Delete list from context menu → navigates to /today
- [ ] Drag item from Today to list in LeftNav
- [ ] Reorder lists via drag in LeftNav
- [ ] Active list highlighted in LeftNav

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete lists feature — routing, detail page, archiving, nav integration"
```
