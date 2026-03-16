# Upcoming View — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Scope:** New Upcoming view, inbox auto-removal of dated items, grouping logic

## Overview

A new "Upcoming" view that shows all future active items organized by time sections. Items auto-leave the inbox when a due date is assigned. Sits between Today and Inbox in the LeftNav.

## 1. Route & Navigation

- **Route:** `/upcoming`
- **LeftNav position:** Between Today and Inbox — Today, Upcoming, Inbox
- **Icon:** `Clock` from lucide-react
- **Badge:** Total count of upcoming active items
- **LeftNav prop:** Add `upcomingCount?: number` to `LeftNavProps` in `packages/ui/src/LeftNav.tsx`
- **Badge source:** `useUpcomingThings().data?.length ?? 0` computed in `App.tsx`, passed as prop

## 2. API Changes

### New query param on GET /things

Add `dueAfter` query param to the existing `GET /things` route in `apps/api/src/routes/things.ts`:
- `dueAfter=ISO` — returns items with `dueDate > value`
- Used by UpcomingView: `GET /things?status=active&dueAfter={endOfToday}`

**Implementation:** Extend the existing filter builder. When both `dueBefore` and `dueAfter` are present, merge into one Prisma `dueDate` filter: `{ gt: new Date(dueAfter), lte: new Date(dueBefore) }`. When only one is present, use the simple form. This avoids the current pattern where each filter overwrites `where.dueDate`.

Also add `dueAfter` to the `ThingsFilters` interface and `buildQuery` helper in `apps/desktop/src/api/things.ts` to follow the established pattern.

### Inbox query change

Update `GET /things/inbox` in `apps/api/src/routes/things.ts` to exclude items that have a due date set. The inbox should only contain items with no due date and no list — once you assign a date, the item is "processed."

Current visible items query has:
```
OR: [{ dueDate: null }, { dueDate: { lte: todayStart } }]
```

Change to:
```
dueDate: null
```

This means items with any due date (past, present, or future) no longer appear in the inbox. Past-due items show in Today (overdue). Today items show in Today. Future items show in Upcoming.

### Coordinated inbox changes (multi-package)

These changes must happen together:

1. **API:** `GET /things/inbox` — remove `hiddenCount` and `hidden` from response, simplify query to `dueDate: null`
2. **Types:** `InboxResponse` in `packages/types/src/index.ts` — remove `hiddenCount` and `hidden` fields
3. **Hook:** `useInboxThings` in `apps/desktop/src/api/things.ts` — remove `includeHidden` parameter
4. **App.tsx:** Remove `hiddenCount`, `hiddenThings` props passed to InboxView; simplify `useInboxThings()` call
5. **InboxView:** `packages/ui/src/InboxView.tsx` — remove `hiddenCount`, `hiddenThings` props from interface, remove hidden items disclosure section

## 3. Section Grouping Logic

Pure function in `@brett/business`: `groupUpcomingThings(things: Thing[], now: Date): UpcomingSection[]`

**All date arithmetic uses UTC** (consistent with `computeUrgency` and all other date logic in the codebase).

**Week boundaries use Sunday** as the end-of-week marker, consistent with `computeUrgency` in `@brett/business`.

### Section types (in order):

1. **Per-day sections for each of the next 7 days** — "Tomorrow", "Wednesday", "Thursday", etc. Only items with `dueDatePrecision: "day"` whose date matches that specific day. Only shown if items exist.

2. **"This Week"** — Items with `dueDatePrecision: "week"` whose due date falls within the current week's Sunday boundary. Only shown if items exist.

3. **"Next Week"** — Items with `dueDatePrecision: "week"` whose due date falls within next week's Sunday boundary. Only shown if items exist.

4. **Future weekly ranges** — "Mar 24 – 30", "Mar 31 – Apr 6", etc. Weeks run Monday–Sunday. Groups ALL items (any precision) whose due date falls in that week range. Generated dynamically — only as many sections as needed to cover the farthest due date. Only shown if items exist.

### Interface:

```typescript
interface UpcomingSection {
  label: string;
  things: Thing[];
}
```

### Edge cases:
- Items with `dueDatePrecision: "day"` in the next 7 days appear in per-day sections, NOT in weekly ranges
- Items with `dueDatePrecision: "week"` for this/next week appear in "This Week"/"Next Week", NOT in weekly ranges
- Items beyond next week with any precision appear in weekly range sections
- Empty sections are not returned
- Sections are ordered chronologically

## 4. UpcomingView Component

**File:** `apps/desktop/src/views/UpcomingView.tsx`

### Layout:
- Uses `ItemListShell` with header (Clock icon + "Upcoming" title)
- No `QuickAddInput` (you don't add items to Upcoming directly — assign dates elsewhere)
- Sections rendered inside the shell with section headers + ThingCards
- Same section header pattern as ListView: `font-mono text-xs uppercase tracking-wider` + divider line

### Props:
```typescript
interface UpcomingViewProps {
  onItemClick: (item: Thing) => void;
  onTriageOpen: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDatePrecision?: "day" | "week" | null }) => void;
}
```

### Data:
- Owns its own React Query hook: `useUpcomingThings()` in `apps/desktop/src/api/things.ts`
- Fetches `GET /things?status=active&dueAfter={endOfToday}`
- Query key: `["things", "upcoming"]`
- **Invalidation:** Existing mutation hooks already invalidate `["things"]` which covers `["things", "upcoming"]` via React Query prefix matching. No additional invalidation needed.

### Keyboard:
- `j`/`k` navigate across all sections (flat item list)
- `Enter` opens detail panel
- `e` toggles completion
- `l`/`d` triage shortcuts
- No `n` (no add input)

### Empty state:
- "Nothing upcoming" with subtitle "Assign due dates to items in your inbox or lists"

## 5. Client Hooks

### New hook: `useUpcomingThings()`

```typescript
export function useUpcomingThings() {
  const now = new Date();
  const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return useQuery({
    queryKey: ["things", "upcoming"],
    queryFn: () => apiFetch<Thing[]>(`/things?status=active&dueAfter=${todayEnd.toISOString()}`),
  });
}
```

Note: Uses `getUTCFullYear()` / `getUTCMonth()` / `getUTCDate()` for consistency with all other date arithmetic in the codebase.

### Badge count

`useUpcomingThings().data?.length ?? 0` in App.tsx, passed to LeftNav as `upcomingCount`.

## 6. Testing

### API Tests
- `GET /things?dueAfter=ISO` returns only items with dueDate > value
- `GET /things?dueBefore=X&dueAfter=Y` returns items in range
- `GET /things/inbox` no longer returns items with due dates
- Items with dueDate and no listId don't appear in inbox

### Business Logic Tests
- `groupUpcomingThings` correctly groups by day, week precision, and weekly ranges
- Empty input returns empty array
- Items beyond 7 days group into correct weekly ranges
- Weekly range labels are formatted correctly (Mon–Sun ranges)
- Sections are chronologically ordered
- Items with `dueDatePrecision: "day"` in next 7 days go to per-day sections not weekly ranges
- Items with `dueDatePrecision: "week"` for this/next week go to This Week/Next Week not weekly ranges
