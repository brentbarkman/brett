# Date & List Picker Redesign

Date: 2026-05-07
Status: Design — awaiting approval

## Context

Setting a date or moving a task to a list on the desktop client is the highest-frequency interaction in the product, and it requires conscious thought every time. The user described it as "arduous and non-intuitive — I have to think when I look at it." The goal of this redesign is to make the flow run on autopilot.

Three concrete reasons the current flow breaks autopilot:

1. **Modal context switch.** `TriagePopup` is a full-screen overlay anchored to nothing. Every invocation centers on the screen and forces the eyes to leave the row that triggered it. There is no spatial continuity, so the picker cannot fade into muscle memory.
2. **No calendar grid by default.** Both `TriagePopup` and the detail panel's `ScheduleRow` show a list of text presets ("Today", "This Week", "Next Month") plus an `<input type="date">`. To get an actual calendar, the user has to click the input, which then defers to the OS-native picker. The calendar grid is one click away from the picker that is already open — the user's specific complaint.
3. **Hostile keyboard mnemonics.** The current letter bindings are `t / w / r / n / m` for Today / Tomorrow / This Week / Next Week / Next Month. `r` and `w` are not memorable, and the resolved date for each preset is never displayed, so the user has to translate every option through their head before committing.

This redesign replaces both `TriagePopup` and the date dropdown in `ScheduleRow` with a single anchored popover shape that has a calendar grid (or list) visible by default and obvious keyboard letters baked into the chip labels.

## Scope

**In scope:**
- A new shared popover (`QuickDatePicker`, `QuickListPicker`) with chip column + scrollable continuous calendar/searchable list
- Replace `TriagePopup` for the row-keyboard flow (`d` / `l` from a focused Inbox / Today / list row)
- Replace the date dropdown inside `ScheduleRow` (the "Due Date" card in `TaskDetailPanel`)
- Replace the "Move to List…" route from `OverflowMenu` with `QuickListPicker`
- New keyboard letters: `t / m / w / n / x` (Today / toMorrow / this Week / Next week / neXt month) for dates, `1 / 2 / 3 / 4` for list chips, `⌫` for clear, `esc` for cancel, `↵` for confirm
- Inbox-only transition flow: first commit morphs the popover content into the other picker

**Out of scope:**
- Reminder, recurrence, and other `ScheduleRow` rows (those keep their existing inline UX)
- The omnibar / Spotlight quick-add flow (today it routes to the detail panel after creation, which already inherits the new picker via `ScheduleRow`)
- iOS — the native iOS app uses different platform primitives and is not touched here
- Right-click context menus (none exist today; not adding them)
- Drag-and-drop date setting
- Natural-language typing input ("fri", "in 2 weeks") — option C from brainstorming v1; deferred

## Files Touched

**New components:**
- `packages/ui/src/QuickDatePicker.tsx` — anchored popover, chip column + scrollable calendar
- `packages/ui/src/QuickListPicker.tsx` — anchored popover, chip column + searchable list
- `packages/ui/src/TriageQuickPicker.tsx` — Inbox-only wrapper that swaps content between date and list after first commit
- `packages/ui/src/ScrollableCalendar.tsx` — continuous-scroll calendar grid used by `QuickDatePicker`

**New hooks:**
- `packages/ui/src/hooks/useSuggestedLists.ts` — returns the four list chips for `QuickListPicker` (AI-suggested when context is available, otherwise most-used by recent activity)

**New tests:**
- `packages/ui/src/__tests__/QuickDatePicker.test.tsx`
- `packages/ui/src/__tests__/QuickListPicker.test.tsx`
- `packages/ui/src/__tests__/TriageQuickPicker.test.tsx`
- `packages/ui/src/__tests__/ScrollableCalendar.test.tsx`

**Modified:**
- `packages/ui/src/InboxView.tsx` — `d` / `l` shortcut handlers route to `TriageQuickPicker` instead of `TriagePopup`
- `packages/ui/src/ThingsList.tsx` — `d` / `l` shortcut handlers route to `QuickDatePicker` / `QuickListPicker` (no transition)
- `packages/ui/src/ListView.tsx` — same as `ThingsList`
- `packages/ui/src/InboxItemRow.tsx` — anchor ref forwarded so popover can attach to the row
- `packages/ui/src/ThingCard.tsx` — anchor ref forwarded so popover can attach to the card
- `packages/ui/src/ScheduleRow.tsx` — replace the inline preset list + date input with `QuickDatePicker` rendered inside the existing dropdown shell
- `packages/ui/src/TaskDetailPanel.tsx` — wire `OverflowMenu`'s "Move to List…" callback to open `QuickListPicker` anchored to the panel header

**Removed:**
- `packages/ui/src/TriagePopup.tsx` — fully replaced. No external consumers outside this package; the removal is a clean cut.

## Visual Anatomy

Both popovers share a single skeleton — that is the whole point.

```
┌──────────────────────────────────────┐
│  ▌ chip column (5 rows + clear)   │  ← left: 5 preset chips, ⌫ clear
│  ▌                                │
│  ▌                                │
│  ▌                                │
│  ▌                                │
│  ▌                                │
│  ▌──────                          │
│  ▌  ⌫                             │
└──────────────────────────────────────┘
       ↑                ↑
   chip column    scrollable area
   (~128 px)      (~185 px)
```

- Anchored to the originating element (focused row, "Due Date" card, or "Move to list" menu item) with floating-ui-style placement, falling back from `bottom-end` → `top-end` → `bottom-start` based on viewport room.
- Width: chip column ~128 px, scrollable area ~185 px, total ~330 px including 8 px gutter and 8 px padding.
- Surface: `rgba(20,20,22,0.96)` with `backdrop-filter: blur(20px)`, 1 px border at `rgba(255,255,255,0.08)`, 12 px corner radius, large soft drop shadow. Matches existing dropdown surfaces.
- Soft fades at top and bottom of the scrollable area to indicate more content above/below.
- Thin gold scroll indicator on the right edge of the scrollable area.

### Date popover (`QuickDatePicker`)

**Left column — five preset chips, top to bottom:**

| Letter | Label | Resolved-date sub-label (live) |
|---|---|---|
| `T` | Today | `Wed · May 7` |
| `M` | Tomorrow | `Thu · May 8` |
| `W` | This Week | `by Fri May 8` (or just `Fri` if today is already Fri/Sat/Sun) |
| `N` | Next Week | `Mon May 11` |
| `X` | Next Month | `Mon Jun 1` |

Each chip displays the letter in a small mono badge inside the chip, the human label, and the resolved date underneath. The currently-selected chip (i.e. the one matching the current due date, if any) renders with the gold-highlighted state. Below a hairline divider: `⌫ No date`.

**Right column — continuous scrollable calendar:**
- Weekday header `S M T W T F S` is pinned to the top of the column (does not scroll).
- Below it, months are stacked vertically. Each month begins with a sticky month label (`May 2026`), CSS `position: sticky; top: 0` so the label rides the top of the visible area as the month scrolls past.
- Days are 7-column grid cells; previous/next-month spillover days are blanked (not rendered as ghosted days) — the grid only contains real days for that month.
- Today's cell has a 1 px gold dashed outline. The currently-selected date (if any) is filled gold.
- On open, scroll position is anchored to **today** when the task has no date set, and to the **task's current due date** when one is set. Scroll behavior is `auto` (no animation) on initial mount and `smooth` for keyboard-driven scrolls.

### List popover (`QuickListPicker`)

**Left column — four preset chips:**
- Header label `Suggested ✦` in a tiny uppercase row above the chips when AI suggestions are present; otherwise the header reads `Recent`.
- Four chips, numbered `1`–`4`. Each shows the number in a mono badge, a 5 px colored dot for the list color, and the list name. The currently-selected chip (i.e. the list the task currently belongs to, if any of the four) renders gold-highlighted.
- Below a hairline divider: `⌫ No list`.

**Right column — searchable list of all lists:**
- A search input is pinned to the top, replacing the role the weekday header plays in the date picker. Placeholder reads `Search lists…`. Typing filters the list below in real time.
- Below the input, a sticky `All lists` header (mirrors the calendar's sticky month label).
- Each list row: 5 px colored dot + list name + open-task count, padded for click. Hovered or keyboard-highlighted row gets a subtle background tint.

The list rendered in the right column **excludes** the system "Inbox" pseudo-list (an item already has an implicit Inbox state when it has no list) and **excludes** completed-only lists. It is sorted alphabetically.

## Behavior

### Where the popover opens

| Surface | Trigger | Anchor |
|---|---|---|
| Inbox row | `d` or `l` on focused row | The row itself, `bottom-end` placement |
| Today / list row | `d` or `l` on focused row | The card itself, `bottom-end` placement |
| Task detail panel — Due Date card | Click the "Due Date" card | The card, `bottom-start` placement (replaces existing dropdown) |
| Task detail panel — overflow menu | Click "Move to List…" | The overflow menu trigger, `bottom-end` placement |

In all cases the popover commits in place and dismisses on Escape, click-outside, or focus loss.

### Date-picker keyboard

- `T` / `M` / `W` / `N` / `X` — commit the corresponding preset and close. Capital letters in the spec; lowercase letters work too — the handler is case-insensitive. No modifier required, no Enter required.
- `↑ ↓` — move the highlighted day in the calendar by one week.
- `← →` — move the highlighted day by one day.
- `Page Up` / `Page Down` — move the highlighted day by one month.
- `Enter` — commit whatever day is currently highlighted in the calendar grid. If a chip was hovered/highlighted instead, commit that chip.
- `Backspace` / `Delete` — clear the date and close.
- `Esc` — cancel without committing.
- Wheel / trackpad — scroll the calendar.
- Click — clicking any calendar day commits and closes; clicking any chip commits and closes.

The calendar always has a highlighted day (defaults to today on open, or the existing date if set). Letter shortcuts always commit immediately — they do **not** require Enter.

### List-picker keyboard

- `1` / `2` / `3` / `4` — commit the corresponding chip and close.
- Any other printable key — focus jumps to the search input (if not already focused) and the keystroke is appended; the right column filters live.
- `↑ ↓` — move the highlighted list row in the right column.
- `Enter` — commit the highlighted row (chip or filtered list row).
- `Backspace` / `Delete` — when the search input is empty, clear the list and close. When the search input has content, normal text-deletion.
- `Esc` — cancel without committing.

The list always has a highlighted row (defaults to the first chip on open, or the chip matching the current list if applicable).

### Inbox transition rule

This is the single behavioral fork between Inbox and everywhere else:

- **Inbox:** `TriageQuickPicker` is the entry point. Opens with the picker matching the trigger key — `l` opens list-first, `d` opens date-first. The first commit fires `onCommit` immediately for that field; the popover then morphs in place (same anchor, same dimensions) into the other picker so the user can set the second field. The second commit fires `onCommit` for that field and closes the popover. `Esc` during step 2 cancels only step 2 — the step 1 commit has already been persisted, so the user keeps whatever they set first. This avoids the "I picked a date but bailed on the list and now I have neither" foot-gun.
- **Today, custom lists, detail panel:** `QuickDatePicker` and `QuickListPicker` are used directly. First commit closes the popover. To set the other field, the user explicitly opens the other picker — by design, since the item has already been triaged once.

The morph is implemented as a content swap inside a single popover root with a 180 ms cross-fade and a 100 ms layout shift if the column widths differ (they don't, by spec). The popover's anchor element does not change. The transition is non-blocking: a second commit during the morph still commits to the new picker.

### Resolved-date semantics for chips

These match the existing `TriagePopup` semantics so we don't re-litigate what "This Week" means:

- **Today**: today, local time.
- **Tomorrow**: today + 1 day.
- **This Week**: end-of-week (Friday) of the current week, treated as a soft "by Friday." If today is Fri/Sat/Sun, this falls back to the next Friday. The label sub-text adapts (`by Fri` vs. `Fri May 8`).
- **Next Week**: Monday of next week.
- **Next Month**: 1st of next month.

The sub-label under each chip is computed live in the user's locale + timezone using the same date utilities as `TriagePopup` today.

### Suggested-lists logic (`useSuggestedLists`)

Returns up to four list IDs in priority order. Implementation:

1. If the AI suggestion endpoint has fresh suggestions for this task (already used by `TriagePopup`), use those. Surface label `Suggested ✦`.
2. Otherwise, return the four most recently-used lists for the current user, ranked by `lastTaskAddedAt`. Surface label `Recent`.
3. If the user has fewer than four total lists, the column simply renders fewer chips and the divider + `No list` row sits directly below the last chip.

The chip slots are stable across the popover's open lifetime — even if a new AI suggestion arrives mid-interaction, it does not reshuffle the chips.

## Component contracts

```ts
// QuickDatePicker.tsx
type QuickDatePickerProps = {
  anchorEl: HTMLElement | null;
  initialDate: Date | null;          // existing due date, or null
  onCommit: (date: Date | null) => void;  // null = cleared
  onCancel: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
};

// QuickListPicker.tsx
type QuickListPickerProps = {
  anchorEl: HTMLElement | null;
  initialListId: string | null;
  onCommit: (listId: string | null) => void;
  onCancel: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
};

// TriageQuickPicker.tsx
type TriageQuickPickerProps = {
  anchorEl: HTMLElement | null;
  initialDate: Date | null;
  initialListId: string | null;
  startWith: "date" | "list";        // determined by the trigger key
  onCommitDate: (date: Date | null) => void;     // fires on first or second step, whenever date is committed
  onCommitList: (listId: string | null) => void; // fires on first or second step, whenever list is committed
  onClose: () => void;                            // fires on second commit OR cancel; does NOT roll back prior commits
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
};

// ScrollableCalendar.tsx — internal to QuickDatePicker but separately tested
type ScrollableCalendarProps = {
  anchorDate: Date;                   // initial scroll anchor
  highlightedDate: Date;              // currently keyboard-highlighted day
  selectedDate: Date | null;          // existing selection (gold fill)
  onHighlight: (date: Date) => void;
  onCommit: (date: Date) => void;     // single-click or Enter on a day
  monthsBefore?: number;              // default 12
  monthsAfter?: number;               // default 24
};
```

The pickers do not own the persistence call — they only emit `onCommit`. The caller (InboxView, ThingsList, ScheduleRow, TaskDetailPanel) is responsible for the API mutation. This mirrors how `TriagePopup` works today.

## Animation & polish

- Open: 120 ms fade-in + 6 px upward translate. No scale.
- Close: 80 ms fade-out, no translate.
- Inbox morph: 180 ms cross-fade between picker bodies. Chip column and scroll column both swap content; the outer popover frame does not animate.
- Hover/focus transitions on chips and rows: 100 ms ease-out.
- Calendar smooth-scroll on keyboard movement: 150 ms ease-out.

These match the existing dropdown animation timing in `ScheduleRow` and other popover surfaces, so the new picker doesn't read as a foreign element.

## Tests

Each component file gets one matching test file. Coverage targets:

**`QuickDatePicker.test.tsx`**
- Renders five chips with correct resolved-date sub-labels for a fixed clock
- Letter shortcuts (`t`, `m`, `w`, `n`, `x` — both cases) commit and call `onCommit` with the correct resolved date
- Backspace clears (commits `null`)
- Esc calls `onCancel` and not `onCommit`
- Calendar keyboard nav: `↑ ↓ ← →` move the highlight; `Enter` commits the highlighted day
- Click on a calendar day commits that day
- Initial scroll position anchors to `initialDate` when set, else to today
- Selected date renders with the gold fill state; today renders with the gold dashed outline

**`QuickListPicker.test.tsx`**
- Renders chips from `useSuggestedLists` (mocked) with correct numbers and color dots
- Number shortcuts `1`–`4` commit and call `onCommit` with the correct list ID
- Typing in search filters the right column
- `↑ ↓` and `Enter` commit the highlighted row
- Backspace with empty search clears (commits `null`); backspace with non-empty search deletes one character
- Esc cancels
- Header label is `Suggested ✦` when AI suggestions are present and `Recent` when falling back

**`TriageQuickPicker.test.tsx`**
- `startWith="list"` opens the list picker; first commit calls `onCommitList`; popover morphs into date picker; second commit calls `onCommitDate` and `onClose`
- `startWith="date"` opens the date picker; first commit calls `onCommitDate`; popover morphs into list picker; second commit calls `onCommitList` and `onClose`
- Esc during step 1 calls `onClose` with no `onCommit*` calls
- Esc during step 2 calls `onClose` but the step-1 `onCommit*` has already fired and is not rolled back

**`ScrollableCalendar.test.tsx`**
- Renders months from `anchorDate - monthsBefore` to `anchorDate + monthsAfter`
- Sticky month header: month label of the topmost visible month is sticky-positioned
- `highlightedDate` cell has the highlight class; `selectedDate` cell has the selected class; today has the today class
- `onCommit` fires on click of a day cell and on Enter when that day is highlighted

**Integration:**
- `InboxView`: pressing `d` on a focused row opens `TriageQuickPicker` anchored to that row; the row keeps focus visible behind the popover
- `ThingsList`: pressing `d` on a focused card opens `QuickDatePicker` (no transition)
- `ScheduleRow`: clicking the "Due Date" card opens `QuickDatePicker` inside the existing dropdown shell
- `TaskDetailPanel`: clicking "Move to List…" in the overflow menu opens `QuickListPicker` anchored to the menu trigger

The existing `TriagePopup.test.tsx` is removed alongside its component.

## Migration & rollout

This is a hard cut. There is no feature flag and no parallel old/new path. Rationale:
- The new pickers are strict supersets of `TriagePopup`'s functionality (every preset, every shortcut, plus the calendar grid).
- The keyboard letter remap (`t/w/r/n/m` → `t/m/w/n/x`) is a learning curve for one user (the only production user today is the project owner), and the new letters are deliberately more obvious.
- A flag would mean maintaining both pickers and re-running the autopilot brittleness in parallel.

Release notes (built into the next version's notes panel) call out:
> "Date and list shortcuts updated. Press `d` or `l` from any row to see the new picker, with the calendar visible by default and clearer letters: `t / m / w / n / x` for today, tomorrow, this week, next week, next month."

## Open considerations (non-blocking)

These are intentional follow-ups, not gaps in this spec:

- **Right-click menu** to set date/list with a click. Not in scope; mention only as future work if usage data shows the keyboard path isn't enough for some flows.
- **Natural-language typing input** (option C from brainstorming v1) — type "fri" or "in 2 weeks". Deferred. The scrollable calendar covers most typing-replaceable cases.
- **Multi-select** date/list editing across selected items. The current keyboard shortcuts in `InboxView` already imply a multi-row mental model; if multi-select on rows lands later, both pickers can accept an array of items without API changes (the caller batches the mutation).
- **iOS parity** — this is desktop-only by scope. The iOS app already uses platform-native date pickers and a different list-move sheet; bringing parity is its own design pass.
