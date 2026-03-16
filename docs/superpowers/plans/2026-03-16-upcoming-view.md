# Upcoming View Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Upcoming view showing future items grouped by time sections, and simplify the inbox to exclude dated items.

**Architecture:** New `dueAfter` API filter, `groupUpcomingThings` pure function in `@brett/business`, `UpcomingView` component using shared `ItemListShell`/`ThingCard`/`useListKeyboardNav` primitives, coordinated inbox simplification removing hidden items.

**Tech Stack:** Hono API, Prisma, React Query, @brett/business, @brett/ui shared components

**Spec:** `docs/superpowers/specs/2026-03-16-upcoming-view-design.md`

---

## Chunk 1: API + Business Logic

### Task 1: Add `dueAfter` query param to GET /things

**Files:**
- Modify: `apps/api/src/routes/things.ts:22-42`
- Modify: `apps/desktop/src/api/things.ts:9-29`
- Test: `apps/api/src/__tests__/things.test.ts`

- [ ] **Step 1: Write failing test**

Add to `apps/api/src/__tests__/things.test.ts`:

```typescript
describe("GET /things?dueAfter", () => {
  let daToken: string;

  beforeAll(async () => {
    const user = await createTestUser("DueAfter User");
    daToken = user.token;

    // Create items with different due dates
    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Past", dueDate: "2026-03-10T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Today", dueDate: "2026-03-16T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Future", dueDate: "2026-03-20T00:00:00Z", dueDatePrecision: "day" }),
    });
  });

  it("filters items with dueDate after the given date", async () => {
    const res = await authRequest("/things?dueAfter=2026-03-16T00:00:00Z", daToken);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Future");
  });

  it("works with dueBefore for date range", async () => {
    const res = await authRequest("/things?dueAfter=2026-03-09T00:00:00Z&dueBefore=2026-03-17T00:00:00Z", daToken);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(2);
    const titles = body.map((t: any) => t.title).sort();
    expect(titles).toEqual(["Past", "Today"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test`
Expected: New tests fail (dueAfter not implemented).

- [ ] **Step 3: Implement dueAfter filter**

In `apps/api/src/routes/things.ts`, update the GET `/` handler. Replace lines 24-32:

```typescript
things.get("/", async (c) => {
  const user = c.get("user");
  const { listId, type, status, source, dueBefore, dueAfter, completedAfter } = c.req.query();

  const where: Record<string, unknown> = { userId: user.id };
  if (listId) where.listId = listId;
  if (type) where.type = type;
  if (status) where.status = status;
  if (source) where.source = source;
  if (dueBefore && dueAfter) {
    where.dueDate = { gt: new Date(dueAfter), lte: new Date(dueBefore) };
  } else if (dueBefore) {
    where.dueDate = { lte: new Date(dueBefore) };
  } else if (dueAfter) {
    where.dueDate = { gt: new Date(dueAfter) };
  }
  if (completedAfter) where.completedAt = { gte: new Date(completedAfter) };
```

- [ ] **Step 4: Add dueAfter to client ThingsFilters and buildQuery**

In `apps/desktop/src/api/things.ts`, add `dueAfter` to the `ThingsFilters` interface:

```typescript
interface ThingsFilters {
  listId?: string;
  type?: string;
  status?: string;
  source?: string;
  dueBefore?: string;
  dueAfter?: string;
  completedAfter?: string;
}
```

And in `buildQuery`, add: `if (filters.dueAfter) params.set("dueAfter", filters.dueAfter);`

- [ ] **Step 5: Run tests**

Run: `cd apps/api && pnpm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/things.ts apps/api/src/__tests__/things.test.ts apps/desktop/src/api/things.ts
git commit -m "feat: add dueAfter query param to GET /things"
```

---

### Task 2: Simplify inbox API — remove hidden items, exclude dated items

**Files:**
- Modify: `apps/api/src/routes/things.ts:87-137` (GET /things/inbox)
- Modify: `packages/types/src/index.ts:134-138` (InboxResponse)
- Modify: `apps/desktop/src/api/things.ts:104-112` (useInboxThings)
- Test: `apps/api/src/__tests__/things.test.ts`

- [ ] **Step 1: Write failing test**

Add to `apps/api/src/__tests__/things.test.ts`:

```typescript
it("GET /things/inbox excludes items with due dates", async () => {
  const user = await createTestUser("Inbox Dated User");

  // Create item with due date but no list
  await authRequest("/things", user.token, {
    method: "POST",
    body: JSON.stringify({ type: "task", title: "Dated No List", dueDate: "2026-03-20T00:00:00Z", dueDatePrecision: "day" }),
  });
  // Create item with no date and no list
  await authRequest("/things", user.token, {
    method: "POST",
    body: JSON.stringify({ type: "task", title: "No Date No List" }),
  });

  const res = await authRequest("/things/inbox", user.token);
  const body = (await res.json()) as any;
  expect(body.visible.length).toBe(1);
  expect(body.visible[0].title).toBe("No Date No List");
});
```

- [ ] **Step 2: Simplify GET /things/inbox**

Replace the entire inbox handler in `apps/api/src/routes/things.ts`:

```typescript
// GET /things/inbox — items with no due date and no list
things.get("/inbox", async (c) => {
  const user = c.get("user");
  const now = new Date();

  const items = await prisma.item.findMany({
    where: {
      userId: user.id,
      listId: null,
      dueDate: null,
      status: { notIn: ["done", "archived", "snoozed"] },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    include: { list: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  return c.json({
    visible: items.map((item) => itemToThing(item)),
  });
});
```

- [ ] **Step 3: Simplify InboxResponse type**

In `packages/types/src/index.ts`, update:

```typescript
export interface InboxResponse {
  visible: Thing[];
}
```

- [ ] **Step 4: Simplify useInboxThings hook**

In `apps/desktop/src/api/things.ts`, replace `useInboxThings`:

```typescript
export function useInboxThings() {
  return useQuery({
    queryKey: ["inbox"],
    queryFn: () => apiFetch<InboxResponse>("/things/inbox"),
  });
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && pnpm test`
Expected: All tests pass (some existing inbox tests may need updating if they relied on hiddenCount).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: Errors in App.tsx and InboxView.tsx (they still reference old props). Fix in Task 3.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/things.ts packages/types/src/index.ts apps/desktop/src/api/things.ts apps/api/src/__tests__/things.test.ts
git commit -m "feat: simplify inbox to exclude dated items, remove hidden section"
```

---

### Task 3: Update InboxView and App.tsx for simplified inbox

**Files:**
- Modify: `packages/ui/src/InboxView.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Remove hidden props from InboxView**

In `packages/ui/src/InboxView.tsx`:
- Remove `hiddenCount` and `hiddenThings` from `InboxViewProps`
- Remove from destructured props
- Remove `showHidden` state
- Remove the hidden items disclosure section (the `{hiddenCount > 0 && ...}` block near the bottom)

- [ ] **Step 2: Update App.tsx**

In `apps/desktop/src/App.tsx`:
- Change `useInboxThings(location.pathname === "/inbox")` to just `useInboxThings()`
- Remove `hiddenCount` and `hiddenThings` props from `<InboxView>`
- Update `inboxCount` to use the simplified response: `const inboxCount = inboxData?.visible.length ?? 0;` (already correct)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/InboxView.tsx apps/desktop/src/App.tsx
git commit -m "refactor: remove hidden items from InboxView, simplify inbox props"
```

---

### Task 4: Implement groupUpcomingThings in @brett/business

**Files:**
- Modify: `packages/business/src/index.ts`
- Test: `packages/business/src/__tests__/business.test.ts`

- [ ] **Step 1: Add UpcomingSection type**

In `packages/types/src/index.ts`, add:

```typescript
export interface UpcomingSection {
  label: string;
  things: Thing[];
}
```

- [ ] **Step 2: Write tests**

Add to `packages/business/src/__tests__/business.test.ts`. Use `NOW = new Date("2026-03-13T12:00:00Z")` (Friday) which is already defined in the test file:

```typescript
describe("groupUpcomingThings", () => {
  // NOW is Friday March 13, 2026
  // Next 7 days: Sat 14, Sun 15, Mon 16, Tue 17, Wed 18, Thu 19, Fri 20
  // This week ends Sunday March 15
  // Next week ends Sunday March 22

  function makeThing(overrides: Partial<Thing> = {}): Thing {
    return {
      id: "t-" + Math.random().toString(36).slice(2),
      type: "task",
      title: "Test",
      list: "Inbox",
      listId: null,
      status: "active",
      source: "Brett",
      urgency: "later",
      isCompleted: false,
      ...overrides,
    };
  }

  it("returns empty array for empty input", () => {
    expect(groupUpcomingThings([], NOW)).toEqual([]);
  });

  it("groups day-precision items into per-day sections for next 7 days", () => {
    const things = [
      makeThing({ title: "Sat task", dueDate: "2026-03-14T00:00:00Z", dueDatePrecision: "day" }),
      makeThing({ title: "Mon task", dueDate: "2026-03-16T00:00:00Z", dueDatePrecision: "day" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    expect(sections[0].label).toBe("Tomorrow");
    expect(sections[0].things[0].title).toBe("Sat task");
    expect(sections[1].label).toBe("Monday");
    expect(sections[1].things[0].title).toBe("Mon task");
  });

  it("groups week-precision items into This Week / Next Week", () => {
    const things = [
      makeThing({ title: "This wk", dueDate: "2026-03-15T00:00:00Z", dueDatePrecision: "week" }),
      makeThing({ title: "Next wk", dueDate: "2026-03-22T00:00:00Z", dueDatePrecision: "week" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    expect(sections.find((s) => s.label === "This Week")?.things[0].title).toBe("This wk");
    expect(sections.find((s) => s.label === "Next Week")?.things[0].title).toBe("Next wk");
  });

  it("groups far-future items into weekly ranges", () => {
    const things = [
      makeThing({ title: "Far out", dueDate: "2026-04-01T00:00:00Z", dueDatePrecision: "day" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    // April 1 is a Wednesday — falls in Mon Mar 30 – Sun Apr 5 range
    const last = sections[sections.length - 1];
    expect(last.label).toMatch(/Mar 30.*Apr 5/);
    expect(last.things[0].title).toBe("Far out");
  });

  it("sections are chronologically ordered", () => {
    const things = [
      makeThing({ title: "Next wk", dueDate: "2026-03-22T00:00:00Z", dueDatePrecision: "week" }),
      makeThing({ title: "Tomorrow", dueDate: "2026-03-14T00:00:00Z", dueDatePrecision: "day" }),
      makeThing({ title: "This wk", dueDate: "2026-03-15T00:00:00Z", dueDatePrecision: "week" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    const labels = sections.map((s) => s.label);
    expect(labels.indexOf("Tomorrow")).toBeLessThan(labels.indexOf("This Week"));
    expect(labels.indexOf("This Week")).toBeLessThan(labels.indexOf("Next Week"));
  });

  it("does not include day-precision items in weekly ranges if within 7 days", () => {
    const things = [
      makeThing({ title: "Day item", dueDate: "2026-03-16T00:00:00Z", dueDatePrecision: "day" }),
    ];
    const sections = groupUpcomingThings(things, NOW);
    expect(sections.length).toBe(1);
    expect(sections[0].label).toBe("Monday");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/business && pnpm test`
Expected: Tests fail (groupUpcomingThings doesn't exist).

- [ ] **Step 4: Implement groupUpcomingThings**

Add to `packages/business/src/index.ts`:

```typescript
import type { UpcomingSection } from "@brett/types";

function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 86400000;

export function groupUpcomingThings(things: Thing[], now: Date = new Date()): UpcomingSection[] {
  if (things.length === 0) return [];

  const todayMs = utcDayStart(now);
  const sections: UpcomingSection[] = [];
  const placed = new Set<string>();

  // 1. Per-day sections for next 7 days (day-precision only)
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let offset = 1; offset <= 7; offset++) {
    const dayMs = todayMs + offset * DAY_MS;
    const dayThings = things.filter((t) => {
      if (t.dueDatePrecision !== "day" || !t.dueDate) return false;
      return utcDayStart(new Date(t.dueDate)) === dayMs;
    });
    if (dayThings.length > 0) {
      const d = new Date(dayMs);
      const label = offset === 1 ? "Tomorrow" : dayNames[d.getUTCDay()];
      sections.push({ label, things: dayThings });
      dayThings.forEach((t) => placed.add(t.id));
    }
  }

  // 2. "This Week" — week-precision items for current week
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const thisWeekEndMs = todayMs + daysUntilSunday * DAY_MS;

  const thisWeekThings = things.filter((t) => {
    if (placed.has(t.id) || t.dueDatePrecision !== "week" || !t.dueDate) return false;
    const dueMs = utcDayStart(new Date(t.dueDate));
    return dueMs > todayMs && dueMs <= thisWeekEndMs;
  });
  if (thisWeekThings.length > 0) {
    sections.push({ label: "This Week", things: thisWeekThings });
    thisWeekThings.forEach((t) => placed.add(t.id));
  }

  // 3. "Next Week" — week-precision items for next week
  const nextWeekEndMs = thisWeekEndMs + 7 * DAY_MS;
  const nextWeekThings = things.filter((t) => {
    if (placed.has(t.id) || t.dueDatePrecision !== "week" || !t.dueDate) return false;
    const dueMs = utcDayStart(new Date(t.dueDate));
    return dueMs > thisWeekEndMs && dueMs <= nextWeekEndMs;
  });
  if (nextWeekThings.length > 0) {
    sections.push({ label: "Next Week", things: nextWeekThings });
    nextWeekThings.forEach((t) => placed.add(t.id));
  }

  // 4. Future weekly ranges (Mon-Sun) for remaining items
  const remaining = things.filter((t) => !placed.has(t.id) && t.dueDate);
  if (remaining.length > 0) {
    // Find the Monday after next week's Sunday
    const rangeStartMs = nextWeekEndMs + DAY_MS; // Monday after next week

    // Find farthest due date
    let maxDueMs = 0;
    remaining.forEach((t) => {
      const dueMs = utcDayStart(new Date(t.dueDate!));
      if (dueMs > maxDueMs) maxDueMs = dueMs;
    });

    // Generate weekly ranges from rangeStart to maxDue
    let weekStart = rangeStartMs;
    while (weekStart <= maxDueMs) {
      const weekEnd = weekStart + 6 * DAY_MS; // Sunday
      const weekThings = remaining.filter((t) => {
        const dueMs = utcDayStart(new Date(t.dueDate!));
        return dueMs >= weekStart && dueMs <= weekEnd;
      });
      if (weekThings.length > 0) {
        const startDate = new Date(weekStart);
        const endDate = new Date(weekEnd);
        const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        sections.push({ label: `${fmt(startDate)} – ${fmt(endDate)}`, things: weekThings });
      }
      weekStart += 7 * DAY_MS;
    }
  }

  return sections;
}
```

- [ ] **Step 5: Export UpcomingSection from types**

Make sure to add the import in business/index.ts and export from types.

- [ ] **Step 6: Run tests**

Run: `cd packages/business && pnpm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/index.ts packages/business/src/index.ts packages/business/src/__tests__/business.test.ts
git commit -m "feat: add groupUpcomingThings business logic with tests"
```

---

## Chunk 2: UI — UpcomingView + LeftNav + Routing

### Task 5: Add useUpcomingThings hook

**Files:**
- Modify: `apps/desktop/src/api/things.ts`

- [ ] **Step 1: Add hook**

After `useListThings` in `apps/desktop/src/api/things.ts`:

```typescript
/** Active items with due dates after today (for Upcoming view) */
export function useUpcomingThings() {
  const now = new Date();
  const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return useThings({ status: "active", dueAfter: todayEnd.toISOString() });
}
```

Note: Uses `useThings` (which uses `buildQuery`) rather than raw `apiFetch`, following the established pattern. The query key will be `["things", { status: "active", dueAfter: "..." }]` which is covered by the `["things"]` prefix invalidation.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/api/things.ts
git commit -m "feat: add useUpcomingThings hook"
```

---

### Task 6: Add Upcoming to LeftNav

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx`

- [ ] **Step 1: Add upcomingCount prop and Clock import**

In `packages/ui/src/LeftNav.tsx`:

Add `Clock` to the lucide-react import:
```typescript
import { Inbox, Calendar, Search, Plus, MoreHorizontal, GripVertical, ChevronRight, Clock } from "lucide-react";
```

Add to `LeftNavProps`:
```typescript
upcomingCount?: number;
```

Add to destructured props.

- [ ] **Step 2: Add Upcoming NavItem between Today and Inbox**

In the "Main Links" section, add between the Today and Inbox NavItems:

```tsx
<NavItem
  icon={<Clock size={18} />}
  label="Upcoming"
  badge={upcomingCount}
  isActive={currentPath === "/upcoming"}
  isCollapsed={isCollapsed}
  onClick={() => navigate?.("/upcoming")}
/>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/LeftNav.tsx
git commit -m "feat: add Upcoming nav item to LeftNav"
```

---

### Task 7: Create UpcomingView component

**Files:**
- Create: `apps/desktop/src/views/UpcomingView.tsx`

- [ ] **Step 1: Create component**

```typescript
import React from "react";
import { Clock } from "lucide-react";
import { ThingCard, ItemListShell, useListKeyboardNav, SkeletonListView } from "@brett/ui";
import type { Thing } from "@brett/types";
import { groupUpcomingThings } from "@brett/business";
import { useUpcomingThings } from "../api/things";

interface UpcomingViewProps {
  onItemClick: (item: Thing) => void;
  onTriageOpen: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDatePrecision?: "day" | "week" | null }) => void;
}

export function UpcomingView({ onItemClick, onTriageOpen }: UpcomingViewProps) {
  const { data: things = [], isLoading } = useUpcomingThings();
  const sections = groupUpcomingThings(things);

  // Flatten all items for keyboard nav
  const allItems = sections.flatMap((s) => s.things);

  const { focusedIndex, setFocusedIndex } = useListKeyboardNav({
    items: allItems,
    onItemClick,
    onToggle: undefined, // toggle handled via triage or detail panel
    onExtraKey: (e, focusedThing) => {
      if (!focusedThing || !onTriageOpen) return false;
      if (e.key === "l") {
        e.preventDefault();
        onTriageOpen("list-first", [focusedThing.id], focusedThing);
        return true;
      }
      if (e.key === "d") {
        e.preventDefault();
        onTriageOpen("date-first", [focusedThing.id], focusedThing);
        return true;
      }
      return false;
    },
  });

  const header = (
    <div className="flex items-center gap-3">
      <Clock size={20} className="text-white/50" />
      <h2 className="text-xl font-bold text-white">Upcoming</h2>
    </div>
  );

  const hints = allItems.length > 0
    ? ["j/k navigate", "l list", "d date", "e done"]
    : [];

  if (isLoading) {
    return <SkeletonListView />;
  }

  return (
    <ItemListShell header={header} hints={hints}>
      {/* Empty state */}
      {allItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-sm text-white/40">Nothing upcoming</p>
          <p className="text-xs text-white/20">Assign due dates to items in your inbox or lists</p>
        </div>
      )}

      {/* Sections */}
      {sections.map((section, sectionIdx) => {
        // Compute the flat index offset for this section
        let offset = 0;
        for (let i = 0; i < sectionIdx; i++) {
          offset += sections[i].things.length;
        }

        return (
          <div key={section.label} className={sectionIdx > 0 ? "mt-4" : ""}>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold flex-shrink-0">
                {section.label}
              </h3>
              <div className="h-px bg-white/10 flex-1" />
            </div>
            <div className="flex flex-col gap-2">
              {section.things.map((thing, i) => (
                <ThingCard
                  key={thing.id}
                  thing={thing}
                  onClick={() => onItemClick(thing)}
                  onFocus={() => setFocusedIndex(offset + i)}
                  isFocused={focusedIndex === offset + i}
                />
              ))}
            </div>
          </div>
        );
      })}
    </ItemListShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/views/UpcomingView.tsx
git commit -m "feat: add UpcomingView component with grouped sections"
```

---

### Task 8: Wire UpcomingView into App.tsx routes

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Import and add route**

Add imports:
```typescript
import { useUpcomingThings } from "./api/things";
import { UpcomingView } from "./views/UpcomingView";
```

Add the `useUpcomingThings` hook for the badge count:
```typescript
const { data: upcomingThings = [] } = useUpcomingThings();
```

Pass `upcomingCount` to LeftNav:
```tsx
upcomingCount={upcomingThings.length}
```

Add route between `/today` and `/inbox`:
```tsx
<Route path="/upcoming" element={
  <MainLayout onEventClick={handleItemClick}>
    <UpcomingView onItemClick={handleItemClick} onTriageOpen={handleTriageOpen} />
  </MainLayout>
} />
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Manual verification**

Run: `pnpm dev:full`
Expected:
- Upcoming appears between Today and Inbox in LeftNav
- Click Upcoming → shows upcoming items grouped by time sections
- Items with due dates no longer appear in inbox
- Badge shows count of upcoming items
- Keyboard nav works (j/k, Enter, l, d)
- Empty state shows when no upcoming items

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: wire UpcomingView into routes with badge count"
```
