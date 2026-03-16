# Lists Feature Completion — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Routing, list detail page, archiving, navigation integration

## Context

The lists feature is ~80% complete. Backend (CRUD, reorder, tests), client hooks (React Query), and LeftNav UI (drag-to-reorder, progress rings, context menu, inline create) are all functional. The remaining work is:

1. Routing (replace `activeView` state with react-router-dom)
2. List detail page (the main view for a list's items)
3. Archiving (reversible, with item completion on archive)
4. Navigation and integration wiring

### Existing Code (do NOT rewrite)

- **Prisma schema:** `List` and `Item` models with full relations, indexes
- **API routes:** `apps/api/src/routes/lists.ts` — full CRUD + reorder; `things.ts` — list-aware create/update/filter
- **Business logic:** `packages/business/src/index.ts` — `validateCreateList()`, `itemToThing()`, `DEFAULT_LIST_NAME`
- **Types:** `packages/types/src/index.ts` — `NavList`, `CreateListInput`, `UpdateListInput`
- **Client hooks:** `apps/desktop/src/api/lists.ts` — `useLists()`, `useCreateList()`, `useUpdateList()`, `useDeleteList()`, `useReorderLists()`
- **LeftNav:** `packages/ui/src/LeftNav.tsx` — drag-to-reorder, progress rings, context menu (rename, delete), inline create
- **App:** `apps/desktop/src/App.tsx` — DnD context, drag overlay, delete confirmation, Today/Inbox/Settings views

All changes must be additive — surgical edits to existing files, new components for new functionality.

---

## 1. Routing

### Dependencies
- Add `react-router-dom` to `apps/desktop` (`pnpm add react-router-dom`)

### Decision
Replace the `activeView` state machine in App.tsx with **react-router-dom MemoryRouter**.

**Known issue resolved:** List clicks in LeftNav currently send `list:${id}` to `handleNavClick`, which silently ignores them. List navigation is non-functional. This change fixes it.

### Routes
| Path | Component | Description |
|------|-----------|-------------|
| `/today` | TodayView | Today view (default, initial entry) |
| `/inbox` | InboxView | Inbox view |
| `/settings` | SettingsPage | Settings page |
| `/lists/:id` | ListView | List detail page |

### Implementation

**`main.tsx`** — Wrap `<App />` in `<MemoryRouter initialEntries={["/today"]}>`.

**`App.tsx`** — Replace `activeView` state and conditional rendering with `<Routes>` / `<Route>` / `<Outlet>`. DnD context, drag state, shared mutations, and layout (LeftNav + calendar) stay at this level wrapping the outlet.

**`LeftNav.tsx`** — Replace `onNavClick` callback with a `navigate` function prop (keep LeftNav router-agnostic since it lives in the shared `@brett/ui` package). Replace `activeView` prop with a `currentPath` string prop. The consumer (App.tsx) passes `useNavigate()` and `useLocation().pathname` as props. List items call `navigate(\`/lists/${list.id}\`)`. Add `isActive` prop to `SortableListItem` with `bg-white/10 text-white` styling when the current path matches.

**MemoryRouter refresh behavior:** MemoryRouter does not survive page refresh — the app always starts at `/today`. This is acceptable for an Electron app where refresh is rare. Route persistence can be added later if needed via `sessionStorage`.

### What This Removes
- `ActiveView` type
- `activeView` state + `setActiveView`
- `handleNavClick` function
- Conditional rendering block (`activeView === "today" ? ... : ...`)

---

## 2. List Detail Page

### Component: `ListView`
New component rendered at `/lists/:id`. Uses `useParams()` to get the list ID.

### Layout
Same 3-column structure as Today: LeftNav (persistent) | Main Content (flex-1, max-w-3xl) | Calendar (300px right sidebar).

### Header
- **Color dot** — clickable, opens inline color palette popover
- **List name** — click to edit inline (contentEditable or input swap). Auto-focused in edit mode for newly created lists.
- **Item count** — muted badge showing total items (e.g., "3 items")

### Color Picker Popover
- Triggered by clicking the color dot in the header
- Small popover showing 8 preset color swatches mapped to `colorClass` values:
  - blue → `"bg-blue-500"`, red → `"bg-red-500"`, green → `"bg-green-500"`, purple → `"bg-purple-500"`
  - amber → `"bg-amber-500"`, pink → `"bg-pink-500"`, cyan → `"bg-cyan-500"`, orange → `"bg-orange-500"`
- Click swatch → `updateList({ colorClass })` → popover closes
- Dismiss: click outside or Escape

### Inline Add Row
- Positioned below header, above Active section
- Resting state: dashed border placeholder — "+ Add a thing..."
- Click to focus → text input appears → Enter to create
- Creates thing with `listId` set to current list, position 0 (top of list)
- Escape to cancel

### Content Sections
- **Active** — `font-mono uppercase` section header + ThingCards for items where `status !== "done"`
- **Done** — same section header + ThingCards for completed items, muted styling
- Uses the same `ThingCard` component as Today/Inbox (clickable for DetailPanel, draggable)

### Empty State
- When list has zero items: simple empty state ("No items in this list yet"), consistent with `ThingsEmptyState` pattern

### Archived List State
- If `list.archivedAt` is set, the detail page is **read-only**:
  - No inline add row
  - Header not editable (name and color locked)
  - Banner at top: "This list is archived" with "Unarchive" button
- Archive action: subtle icon button or text link in header area (for non-archived lists)

### React Query Hook
- `useListThings(listId)` — new hook in `apps/desktop/src/api/things.ts`
- Fetches `GET /things?listId=X`
- Query key: `["things", "list", listId]`
- Invalidated by the same mutations that invalidate `["things"]` (create, toggle, delete, bulk-update)

---

## 3. Archiving

### Data Model
Add to `List` model in Prisma:
```prisma
archivedAt DateTime?
```

A list is archived when `archivedAt` is not null.

### Type Changes
- `NavList` in `packages/types/src/index.ts` gains `archivedAt?: string | null`
- `GET /lists` response mapper must include `archivedAt` in the returned object

### Reorder Endpoint Change
The existing `PUT /lists/reorder` validates that all user lists are included in the `ids` array. With archiving, this must be scoped to only non-archived lists: `where: { userId: user.id, archivedAt: null }`. Archived lists retain their `sortOrder` but are excluded from reorder validation.

### API Endpoints

**`PATCH /lists/:id/archive`**
- Sets `archivedAt` to `new Date()`
- Bulk-updates all items in the list with `status !== "done"` to `status: "done"` AND `completedAt: new Date()` (consistent with toggle behavior)
- Returns `{ archivedAt, itemsCompleted: number }` (count used by confirmation dialog)
- Ownership check (404 if not found/not owned)

**`PATCH /lists/:id/unarchive`**
- Sets `archivedAt` to `null`
- Items stay as-is (done items are NOT reverted)
- Returns updated list
- Ownership check

**`GET /lists` changes:**
- Add optional `?archived=true|false` query parameter
- Default: `false` (returns only active lists — `archivedAt === null`)
- `?archived=true` returns only archived lists
- LeftNav fetches active lists by default, fetches archived lists separately when the section is expanded

### Confirmation Flow
- **Has incomplete items:** Confirmation dialog — "Archive '{name}'? {n} incomplete items will be marked as done." with Cancel / Archive buttons.
- **All items already done (or empty):** Archive immediately, no confirmation.

### Client Hooks
- `useArchiveList()` — calls `PATCH /lists/:id/archive`, invalidates `["lists"]` and `["things"]`
- `useUnarchiveList()` — calls `PATCH /lists/:id/unarchive`, invalidates `["lists"]`
- `useArchivedLists()` — calls `GET /lists?archived=true`, `queryKey: ["lists", "archived"]`

---

## 4. Navigation & Integration

### LeftNav Changes

**Active state detection:**
- Uses `useLocation()` to determine which nav item is active
- `/today` → Today highlighted
- `/inbox` → Inbox highlighted
- `/lists/:id` → matching list highlighted
- `/settings` → Settings highlighted (if shown in nav)

**Archived lists section:**
- Only rendered when `archivedLists.length > 0`
- Collapsed by default (local state)
- Section header: "Archived" with chevron icon (rotates on expand)
- Archived list items: muted styling (lower opacity, e.g., `opacity-50`)
- Context menu on archived lists: **Unarchive**, **Delete** (no Rename or Color — edit after unarchiving)

**Context menu on active lists:**
- Existing: Rename, Delete
- Add: **Archive**

### Drag-and-Drop
- Stays at `App` level, wrapping the `<Outlet>`
- Dragging ThingCard onto nav list → `bulkUpdate({ listId })` — no changes needed
- List reorder drag — no changes needed
- DnD wiring location moves from inline in App.tsx to wrapping the router outlet

### Delete List Behavior
- From list detail page or context menu
- Confirmation dialog if list has items (existing behavior)
- After deletion: `navigate("/today")`

### Archive from List Detail Page
- Subtle archive action in the header (icon button or text link)
- Same confirmation flow as context menu archive

---

## Testing

### API Tests (extend `lists.test.ts`)
- Archive list with incomplete items → items marked done, archivedAt set
- Archive list with all done items → archivedAt set, no item changes
- Unarchive list → archivedAt cleared, items unchanged
- GET /lists default excludes archived
- GET /lists?archived=true returns only archived
- Archive/unarchive ownership checks

### Desktop (manual verification)
- Navigate to list via LeftNav click
- Create thing via inline add row
- Edit list name inline
- Change list color via header dot
- Archive list → confirmation → archived section appears
- Unarchive list → moves back to active section
- Delete list from detail page → navigates to /today
- Drag thing from Today to list in nav
- Refresh always returns to /today (MemoryRouter limitation — accepted)
