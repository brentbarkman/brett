# Inbox Design Spec

## Problem

Brett has a virtual inbox concept (items with `listId = null`) but no dedicated inbox view. Users need a fast, keyboard-first interface to triage incoming items — assigning them to lists and setting due dates. The current UI has a hardcoded "Inbox" nav item that doesn't navigate anywhere.

## Design Decisions

### Data Model

- **Remove `inbox` from `ItemStatus` enum.** Status becomes: `active | snoozed | done | archived`
- **Inbox is purely derived:** `listId === null`
- **Default status for new items:** `active` (update Prisma `@default("inbox")` → `@default("active")`)
- Migration: update existing items with `status = "inbox"` to `status = "active"`
- Add `PATCH /things/bulk` endpoint for bulk triage operations:
  - Request: `{ ids: string[], updates: { listId?: string | null, dueDate?: string | null } }`
  - Validates all IDs belong to the authenticated user
  - All-or-nothing: if any ID is invalid, the entire batch fails
  - Max batch size: 100 items
  - Response: `{ updated: number }` (count of updated items)

### Inbox Display Logic

- **Visible items:** `listId IS NULL` AND (`dueDate IS NULL` OR `dueDate <= today`) AND `status NOT IN (done, archived, snoozed)` AND (`snoozedUntil IS NULL` OR `snoozedUntil <= now`)
- **Hidden items:** `listId IS NULL` AND `dueDate > today` — these are deferred in the inbox
- **Resurfacing:** Hidden items reappear when their due date arrives (visible in both Inbox and Today views)
- **Affordance:** A collapsible section at the bottom: "+ N items with future dates" to encourage categorization into lists

### Inbox View Layout

Flat list (Superhuman-style) replacing the main content area when "Inbox" is selected in the left nav.

**Components:**
- Header: "Inbox · N items" with quick-add input (`n` to focus)
- Item rows: checkbox (on hover/selection), type icon, title, source pill (muted text, e.g. "Scouts"), relative age ("2h ago", "3d ago" — computed from `createdAt`)
- Focused item: `bg-blue-500/15 border-blue-500/30` highlight
- Selected items: checkbox visible, subtle highlight
- Hidden items section: collapsible at bottom
- Empty state: "Inbox Zero" — checkmark icon + "You're all caught up" message, with quick-add below

**Quick-add behavior:** Pressing `n` focuses the input. On submit (Enter), creates an item with `type: "task"`, `status: "active"`, `listId: null`. New item appears at the top of the inbox list with a `sectionEnter` animation (matching existing pattern).

**All keyboard shortcuts are disabled when a text input or the combo popup has focus.** Shortcuts only fire when the inbox list has focus.

### Triage Interactions

#### Combo Triage Popup

Both `l` (list-first) and `d` (date-first) open the same combo popup, starting with the relevant picker:

**`l` flow:** List picker → (optional) date presets → confirm
**`d` flow:** Date presets → (optional) list picker → confirm

**List picker:**
- Type-to-filter list names
- Number keys (1-9) for quick selection
- Shows colored dots matching list `colorClass`
- Arrow keys + Enter to select

**Date presets:**
- `t` Today, `w` Tomorrow, `r` This Week (fuzzy), `n` Next Week (fuzzy), `m` Next Month
- `Backspace` Remove date

**Confirm outcomes (three cases):**
1. **List assigned** (with or without date) → item leaves inbox, slides out
2. **Future date only** (no list) → item hides from inbox default view, moves to hidden section
3. **Today/past date only** (no list) → item stays visible in inbox

- `Enter` skips the optional second step and confirms
- `Escape` cancels the entire popup (reverts any changes)

#### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑/↓` or `j/k` | Navigate focus |
| `x` | Toggle select on focused item |
| `Shift+↑/↓` | Extend selection |
| `⌘A` | Select all |
| `l` | Open combo popup (list-first) |
| `d` | Open combo popup (date-first) |
| `e` | Mark done — item slides out |
| `#` | Archive — item slides out |
| `Enter` | Open DetailPanel for full editing |
| `n` | Focus quick-add input |
| `Escape` | Close popup / deselect all |

All triage actions (l, d, e, #) apply to all selected items when multi-select is active, or to the focused item when nothing is selected.

#### Drag and Drop

- **Library:** `@dnd-kit/core` + `@dnd-kit/sortable`
- **Drag sources:** Inbox items (single or multi-selected)
- **Drop targets:** List names in LeftNav sidebar
- **Drag overlay:** Ghost card, slightly scaled down with rotation (~2deg) and elevated shadow. Count badge for multi-drag ("3 items")
- **Drop feedback:** Target list highlights with its `colorClass` at low opacity
- **On drop:** Assigns `listId`, items animate out (slide + fade, 300ms). No date set via drag — use keyboard for that.

### Animations

All animations use CSS keyframes and Tailwind transitions (no animation library). Following existing design system (DESIGN_GUIDE.md):

- **Item slide-out:** translateX(-100%) + opacity 0, 300ms, `cubic-bezier(0.4, 0, 1, 1)` (exit easing). Item is removed from DOM after animation completes (use `onAnimationEnd` callback). Remaining items reflow naturally.
- **Focus transition:** 200ms background/border color change via Tailwind `transition-colors duration-200`
- **Popup appear:** scale(0.95) → scale(1) + opacity, 200ms, `cubic-bezier(0.16, 1, 0.3, 1)` (enter easing)
- **Popup dismiss:** opacity 0, 150ms
- **Auto-advance focus:** After item slides out, focus moves to next item (or previous if at end), 150ms delay
- **New item enter:** Reuses existing `sectionEnter` keyframes (450ms, fade + slide up)

### Navigation Integration

- Clicking "Inbox" in LeftNav switches main content to InboxView
- LeftNav Inbox badge shows actual count of visible inbox items (not hardcoded)
- InboxView replaces the existing ThingsList/main content area
- DetailPanel still slides in from right when `Enter` is pressed on an item

## Out of Scope

- Reordering/sorting inbox items (default: newest first)
- Inline editing of item titles in the inbox list
- Snooze feature (`s` shortcut reserved for future — not wired up in v1)
- Calendar picker for specific dates (`p` shortcut reserved for future — preset dates only in v1)
- Mobile inbox experience
