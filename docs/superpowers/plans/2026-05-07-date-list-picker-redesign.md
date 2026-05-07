# Date & List Picker Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `TriagePopup` and `ScheduleRow`'s date dropdown with anchored `QuickDatePicker` / `QuickListPicker` popovers (chip column + scrollable continuous calendar / searchable list), and a `TriageQuickPicker` wrapper that morphs between them in the Inbox flow.

**Architecture:** Each picker is a self-contained React component in `packages/ui/src/`. They render as portals anchored to a passed `HTMLElement`. The global App-level rendering pattern is preserved — `App.tsx` still owns the active-picker state, but it now also tracks an anchor element and routes between three components (`QuickDatePicker`, `QuickListPicker`, `TriageQuickPicker`) instead of one universal `TriagePopup`. Each commit fires a callback immediately (no batching); the picker manages its own visibility.

**Tech Stack:** React 19, TypeScript, framer-motion (already a dep, used for morph transition), vitest + @testing-library/react for tests, Tailwind classes consistent with existing `TriagePopup` / `ScheduleRow` surfaces.

**Spec:** [`docs/superpowers/specs/2026-05-07-date-list-picker-redesign-design.md`](../specs/2026-05-07-date-list-picker-redesign-design.md)

---

## File Structure

**New files (all in `packages/ui/src/`):**
- `quickPicker/letters.ts` — letter ↔ preset mapping, single source of truth
- `quickPicker/useAnchoredPosition.ts` — small hook that returns `{ top, left, placement }` for a given anchor element + preferred placement, falling back through bottom-end → top-end → bottom-start → top-start
- `quickPicker/ScrollableCalendar.tsx` — continuous-scroll calendar grid
- `quickPicker/QuickDatePicker.tsx` — chip column + ScrollableCalendar in a portal popover
- `quickPicker/useSuggestedLists.ts` — returns the four list-chip slots (AI suggestions or recent)
- `quickPicker/QuickListPicker.tsx` — chip column + searchable list in a portal popover
- `quickPicker/TriageQuickPicker.tsx` — Inbox wrapper that shows date or list and morphs after first commit
- `quickPicker/index.ts` — barrel export
- `__tests__/quickPicker/letters.test.ts`
- `__tests__/quickPicker/useAnchoredPosition.test.tsx`
- `__tests__/quickPicker/ScrollableCalendar.test.tsx`
- `__tests__/quickPicker/QuickDatePicker.test.tsx`
- `__tests__/quickPicker/QuickListPicker.test.tsx`
- `__tests__/quickPicker/TriageQuickPicker.test.tsx`

**Modified:**
- `packages/ui/src/index.ts` — export the new pickers, drop `TriagePopup`
- `packages/ui/src/InboxView.tsx` — `onTriageOpen` now also passes an `HTMLElement` anchor; the focused row's DOM ref is captured
- `packages/ui/src/InboxItemRow.tsx` — accept and forward a ref so the parent can read its element
- `packages/ui/src/ThingsList.tsx` — same anchor passthrough; ThingCard ref forwarded
- `packages/ui/src/ThingCard.tsx` — accept and forward a ref
- `packages/ui/src/ScheduleRow.tsx` — replace the inline preset/date-input dropdown with `QuickDatePicker` rendered in the existing dropdown shell
- `apps/desktop/src/App.tsx` — extended `triageState` shape (adds `anchorEl`); render-fork between the three new picker components; `handleMoveToList` now drives a `list-only` mode anchored to the panel
- `apps/desktop/src/views/UpcomingView.tsx` — anchor passthrough
- `apps/desktop/src/views/ListView.tsx` — anchor passthrough (already same shape as ThingsList; same edits apply)
- `apps/desktop/src/views/TodayView.tsx` — already proxies through ThingsList; no edits beyond type propagation

**Removed (Task 13):**
- `packages/ui/src/TriagePopup.tsx`

---

## Pre-flight: How to run tests in this repo

All `quickPicker/*` tests run with `vitest` from the `@brett/ui` package:

```bash
pnpm --filter @brett/ui test            # all tests
pnpm --filter @brett/ui test -- letters # filter by name
```

Vitest config: `packages/ui/vitest.config.ts` (jsdom env, `vitest.setup.ts` adds jest-dom matchers). Run typecheck with:

```bash
pnpm --filter @brett/ui typecheck
pnpm typecheck                          # all packages
```

Each task ends with one commit so the history reads as TDD increments.

---

## Task 1 — Letter ↔ preset map (single source of truth)

**Files:**
- Create: `packages/ui/src/quickPicker/letters.ts`
- Test: `packages/ui/src/__tests__/quickPicker/letters.test.ts`

The new keyboard letters (`t / m / w / n / x` for Today / Tomorrow / This Week / Next Week / Next Month) live in one module. `QuickDatePicker` and any future surfaces import from here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/__tests__/quickPicker/letters.test.ts
import { describe, it, expect } from "vitest";
import { DATE_LETTER_TO_PRESET, DATE_PRESET_ORDER, DATE_PRESET_LABELS } from "../../quickPicker/letters";

describe("date picker letter map", () => {
  it("maps letters to presets in the spec'd order", () => {
    expect(DATE_LETTER_TO_PRESET).toEqual({
      t: "today",
      m: "tomorrow",
      w: "this_week",
      n: "next_week",
      x: "next_month",
    });
  });

  it("exposes preset order matching chip layout (top to bottom)", () => {
    expect(DATE_PRESET_ORDER).toEqual([
      "today", "tomorrow", "this_week", "next_week", "next_month",
    ]);
  });

  it("provides display labels for every preset", () => {
    expect(DATE_PRESET_LABELS.today).toBe("Today");
    expect(DATE_PRESET_LABELS.tomorrow).toBe("Tomorrow");
    expect(DATE_PRESET_LABELS.this_week).toBe("This Week");
    expect(DATE_PRESET_LABELS.next_week).toBe("Next Week");
    expect(DATE_PRESET_LABELS.next_month).toBe("Next Month");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brett/ui test -- letters`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// packages/ui/src/quickPicker/letters.ts
import type { TriageDatePreset } from "@brett/business";

export const DATE_LETTER_TO_PRESET: Record<string, TriageDatePreset> = {
  t: "today",
  m: "tomorrow",
  w: "this_week",
  n: "next_week",
  x: "next_month",
};

export const DATE_PRESET_ORDER: TriageDatePreset[] = [
  "today", "tomorrow", "this_week", "next_week", "next_month",
];

export const DATE_PRESET_LABELS: Record<TriageDatePreset, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This Week",
  next_week: "Next Week",
  next_month: "Next Month",
};

/** Reverse lookup: preset → letter (single character, lowercase). */
export const DATE_PRESET_TO_LETTER: Record<TriageDatePreset, string> = Object.fromEntries(
  Object.entries(DATE_LETTER_TO_PRESET).map(([letter, preset]) => [preset, letter]),
) as Record<TriageDatePreset, string>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brett/ui test -- letters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/quickPicker/letters.ts packages/ui/src/__tests__/quickPicker/letters.test.ts
git commit -m "feat(ui): add quick-picker letter↔preset map"
```

---

## Task 2 — `useAnchoredPosition` hook

**Files:**
- Create: `packages/ui/src/quickPicker/useAnchoredPosition.ts`
- Test: `packages/ui/src/__tests__/quickPicker/useAnchoredPosition.test.tsx`

The hook returns `{ top, left, placement }` based on `anchorEl.getBoundingClientRect()` and the popover's measured size. Re-runs on `resize` and on a passed `version` number so the caller can manually trigger reposition (e.g. when content morphs and the size changes).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/quickPicker/useAnchoredPosition.test.tsx
import React, { useRef } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useAnchoredPosition } from "../../quickPicker/useAnchoredPosition";

function Probe({ anchor, popoverWidth, popoverHeight }: {
  anchor: HTMLElement | null;
  popoverWidth: number;
  popoverHeight: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(anchor, ref, { preferred: "bottom-end" });
  return (
    <div
      ref={ref}
      data-testid="popover"
      style={{ width: popoverWidth, height: popoverHeight, position: "fixed", top: pos.top, left: pos.left }}
      data-placement={pos.placement}
    />
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

describe("useAnchoredPosition", () => {
  it("places popover at bottom-end of anchor when there is room below", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () => ({ top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(anchor);

    const { getByTestId } = render(<Probe anchor={anchor} popoverWidth={330} popoverHeight={300} />);
    const popover = getByTestId("popover");

    expect(popover.dataset.placement).toBe("bottom-end");
    // bottom-end: top = anchor.bottom + 4, left = anchor.right - popoverWidth
    expect(popover.style.top).toBe("144px");
    expect(popover.style.left).toBe("-30px"); // 300 - 330; clamping in step 4 below
  });

  it("flips to top-end when there isn't enough room below", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () => ({ top: 600, left: 800, right: 1000, bottom: 640, width: 200, height: 40, x: 800, y: 600, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(anchor);

    const { getByTestId } = render(<Probe anchor={anchor} popoverWidth={330} popoverHeight={300} />);
    const popover = getByTestId("popover");

    // Below has only 800-640=160px, popover is 300px — flip
    expect(popover.dataset.placement).toBe("top-end");
    expect(popover.style.top).toBe("296px"); // 600 - 300 - 4
  });

  it("clamps left coordinate so popover stays inside the viewport", () => {
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () => ({ top: 100, left: 0, right: 100, bottom: 140, width: 100, height: 40, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(anchor);

    const { getByTestId } = render(<Probe anchor={anchor} popoverWidth={330} popoverHeight={300} />);
    const popover = getByTestId("popover");

    // bottom-end would put left at 100-330=-230. Clamp to 8px gutter from edge.
    expect(parseFloat(popover.style.left)).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brett/ui test -- useAnchoredPosition`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// packages/ui/src/quickPicker/useAnchoredPosition.ts
import { useState, useLayoutEffect, type RefObject } from "react";

type Placement = "bottom-end" | "bottom-start" | "top-end" | "top-start";

export interface AnchoredPosition {
  top: number;
  left: number;
  placement: Placement;
}

const VIEWPORT_GUTTER = 8;
const ANCHOR_GAP = 4;

export function useAnchoredPosition(
  anchorEl: HTMLElement | null,
  popoverRef: RefObject<HTMLElement | null>,
  options: { preferred?: Placement; version?: number } = {},
): AnchoredPosition {
  const preferred = options.preferred ?? "bottom-end";
  const version = options.version ?? 0;
  const [pos, setPos] = useState<AnchoredPosition>({ top: -9999, left: -9999, placement: preferred });

  useLayoutEffect(() => {
    if (!anchorEl || !popoverRef.current) return;

    function compute(): AnchoredPosition {
      const anchor = anchorEl!.getBoundingClientRect();
      const popover = popoverRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let placement: Placement = preferred;
      const fitsBelow = anchor.bottom + ANCHOR_GAP + popover.height + VIEWPORT_GUTTER <= vh;
      const fitsAbove = anchor.top - ANCHOR_GAP - popover.height - VIEWPORT_GUTTER >= 0;

      if (placement.startsWith("bottom") && !fitsBelow && fitsAbove) {
        placement = placement.replace("bottom", "top") as Placement;
      } else if (placement.startsWith("top") && !fitsAbove && fitsBelow) {
        placement = placement.replace("top", "bottom") as Placement;
      }

      const top = placement.startsWith("bottom")
        ? anchor.bottom + ANCHOR_GAP
        : anchor.top - ANCHOR_GAP - popover.height;

      const rawLeft = placement.endsWith("end")
        ? anchor.right - popover.width
        : anchor.left;

      const left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(rawLeft, vw - popover.width - VIEWPORT_GUTTER),
      );

      return { top, left, placement };
    }

    function update() { setPos(compute()); }
    update();

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorEl, popoverRef, preferred, version]);

  return pos;
}
```

- [ ] **Step 4: Run test, fix the clamp expectation**

Run: `pnpm --filter @brett/ui test -- useAnchoredPosition`
Expected: PASS — including the third test where left is clamped to ≥ 8.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/quickPicker/useAnchoredPosition.ts packages/ui/src/__tests__/quickPicker/useAnchoredPosition.test.tsx
git commit -m "feat(ui): add useAnchoredPosition for picker popovers"
```

---

## Task 3 — `ScrollableCalendar` component

**Files:**
- Create: `packages/ui/src/quickPicker/ScrollableCalendar.tsx`
- Test: `packages/ui/src/__tests__/quickPicker/ScrollableCalendar.test.tsx`

Renders a fixed `S M T W T F S` weekday header (above the scroll area) and a vertical stack of `MonthGrid`s from `anchorDate − monthsBefore` to `anchorDate + monthsAfter`. Each `MonthGrid` has a sticky month label.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/quickPicker/ScrollableCalendar.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScrollableCalendar } from "../../quickPicker/ScrollableCalendar";

const MAY_7 = new Date(Date.UTC(2026, 4, 7));
const MAY_15 = new Date(Date.UTC(2026, 4, 15));

describe("ScrollableCalendar", () => {
  it("renders the weekday header above the scroll region", () => {
    render(<ScrollableCalendar anchorDate={MAY_7} highlightedDate={MAY_7} selectedDate={null} onHighlight={vi.fn()} onCommit={vi.fn()} monthsBefore={1} monthsAfter={1} />);
    const labels = screen.getAllByTestId("weekday-label").map(n => n.textContent);
    expect(labels).toEqual(["S","M","T","W","T","F","S"]);
  });

  it("renders months from anchorDate−monthsBefore to anchorDate+monthsAfter", () => {
    render(<ScrollableCalendar anchorDate={MAY_7} highlightedDate={MAY_7} selectedDate={null} onHighlight={vi.fn()} onCommit={vi.fn()} monthsBefore={1} monthsAfter={2} />);
    expect(screen.getByText("April 2026")).toBeInTheDocument();
    expect(screen.getByText("May 2026")).toBeInTheDocument();
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText("July 2026")).toBeInTheDocument();
  });

  it("marks the selected date with the selected class and today with the today class", () => {
    render(<ScrollableCalendar anchorDate={MAY_15} highlightedDate={MAY_15} selectedDate={MAY_15} onHighlight={vi.fn()} onCommit={vi.fn()} monthsBefore={0} monthsAfter={0} now={MAY_7} />);
    const selected = screen.getByTestId("day-2026-05-15");
    expect(selected.dataset.selected).toBe("true");

    const today = screen.getByTestId("day-2026-05-07");
    expect(today.dataset.today).toBe("true");
  });

  it("fires onCommit when a day cell is clicked", () => {
    const onCommit = vi.fn();
    render(<ScrollableCalendar anchorDate={MAY_7} highlightedDate={MAY_7} selectedDate={null} onHighlight={vi.fn()} onCommit={onCommit} monthsBefore={0} monthsAfter={0} now={MAY_7} />);
    fireEvent.click(screen.getByTestId("day-2026-05-09"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const passed = onCommit.mock.calls[0][0] as Date;
    expect(passed.toISOString().slice(0, 10)).toBe("2026-05-09");
  });

  it("fires onHighlight when a day cell is hovered", () => {
    const onHighlight = vi.fn();
    render(<ScrollableCalendar anchorDate={MAY_7} highlightedDate={MAY_7} selectedDate={null} onHighlight={onHighlight} onCommit={vi.fn()} monthsBefore={0} monthsAfter={0} now={MAY_7} />);
    fireEvent.mouseEnter(screen.getByTestId("day-2026-05-12"));
    expect(onHighlight).toHaveBeenCalled();
    const last = onHighlight.mock.calls.at(-1)![0] as Date;
    expect(last.toISOString().slice(0, 10)).toBe("2026-05-12");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brett/ui test -- ScrollableCalendar`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// packages/ui/src/quickPicker/ScrollableCalendar.tsx
import React, { useEffect, useMemo, useRef } from "react";

export interface ScrollableCalendarProps {
  anchorDate: Date;
  highlightedDate: Date;
  selectedDate: Date | null;
  onHighlight: (date: Date) => void;
  onCommit: (date: Date) => void;
  monthsBefore?: number;
  monthsAfter?: number;
  now?: Date; // injected for tests
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sameDay(a: Date, b: Date): boolean {
  return isoDay(a) === isoDay(b);
}

function buildMonths(anchor: Date, before: number, after: number): Date[] {
  const months: Date[] = [];
  const base = startOfMonth(anchor);
  for (let i = -before; i <= after; i++) {
    months.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1)));
  }
  return months;
}

function daysInMonth(m: Date): Date[] {
  const days: Date[] = [];
  const year = m.getUTCFullYear();
  const month = m.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    days.push(new Date(Date.UTC(year, month, day)));
  }
  return days;
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function ScrollableCalendar({
  anchorDate,
  highlightedDate,
  selectedDate,
  onHighlight,
  onCommit,
  monthsBefore = 12,
  monthsAfter = 24,
  now,
}: ScrollableCalendarProps) {
  const today = now ?? new Date();
  const months = useMemo(
    () => buildMonths(anchorDate, monthsBefore, monthsAfter),
    [anchorDate, monthsBefore, monthsAfter],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRowRef = useRef<HTMLDivElement>(null);

  // Scroll anchor row into view on mount (and when anchorDate changes).
  useEffect(() => {
    if (anchorRowRef.current && scrollRef.current) {
      const top = anchorRowRef.current.offsetTop - 32; // a bit of room above
      scrollRef.current.scrollTo({ top, behavior: "auto" });
    }
  }, [anchorDate]);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 gap-0.5 px-1 pb-1 border-b border-white/5">
        {WEEKDAYS.map((w, i) => (
          <div key={i} data-testid="weekday-label" className="text-center text-[8px] text-white/45">{w}</div>
        ))}
      </div>
      <div ref={scrollRef} className="relative max-h-[240px] overflow-y-auto px-1 pt-1" style={{ scrollbarWidth: "thin" }}>
        {months.map((m) => (
          <MonthGrid
            key={isoDay(m)}
            month={m}
            highlightedDate={highlightedDate}
            selectedDate={selectedDate}
            today={today}
            anchorDate={anchorDate}
            anchorRowRef={anchorRowRef}
            onHighlight={onHighlight}
            onCommit={onCommit}
          />
        ))}
        <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[rgba(20,20,22,0.95)] to-transparent" />
      </div>
    </div>
  );
}

function MonthGrid({
  month, highlightedDate, selectedDate, today, anchorDate, anchorRowRef, onHighlight, onCommit,
}: {
  month: Date;
  highlightedDate: Date;
  selectedDate: Date | null;
  today: Date;
  anchorDate: Date;
  anchorRowRef: React.RefObject<HTMLDivElement | null>;
  onHighlight: (d: Date) => void;
  onCommit: (d: Date) => void;
}) {
  const days = useMemo(() => daysInMonth(month), [month]);
  const firstWeekday = month.getUTCDay(); // 0..6
  const blanks = Array.from({ length: firstWeekday });
  const isAnchorMonth = month.getUTCFullYear() === anchorDate.getUTCFullYear() && month.getUTCMonth() === anchorDate.getUTCMonth();

  return (
    <div ref={isAnchorMonth ? anchorRowRef : undefined}>
      <div className="sticky top-0 z-10 bg-[rgba(20,20,22,0.96)] py-1 text-[10px] font-semibold text-white tracking-wide">
        {MONTH_LABEL_FORMATTER.format(month)}
      </div>
      <div className="grid grid-cols-7 gap-0.5 pb-1">
        {blanks.map((_, i) => <div key={`blank-${i}`} />)}
        {days.map((d) => {
          const iso = isoDay(d);
          const isSelected = !!selectedDate && sameDay(d, selectedDate);
          const isHighlighted = sameDay(d, highlightedDate);
          const isToday = sameDay(d, today);
          return (
            <button
              key={iso}
              type="button"
              data-testid={`day-${iso}`}
              data-selected={isSelected ? "true" : "false"}
              data-highlighted={isHighlighted ? "true" : "false"}
              data-today={isToday ? "true" : "false"}
              onMouseEnter={() => onHighlight(d)}
              onClick={() => onCommit(d)}
              className={[
                "text-[10px] rounded-[3px] py-0.5 text-center cursor-pointer outline-none",
                isSelected ? "bg-brett-gold/30 text-brett-gold font-semibold"
                  : isHighlighted ? "bg-white/10 text-white"
                  : "text-white/85 hover:bg-white/5",
                isToday && !isSelected ? "ring-1 ring-brett-gold/60 ring-inset ring-dashed" : "",
              ].join(" ")}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brett/ui test -- ScrollableCalendar`
Expected: PASS for all five assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/quickPicker/ScrollableCalendar.tsx packages/ui/src/__tests__/quickPicker/ScrollableCalendar.test.tsx
git commit -m "feat(ui): add ScrollableCalendar continuous-scroll grid"
```

---

## Task 4 — `QuickDatePicker` component

**Files:**
- Create: `packages/ui/src/quickPicker/QuickDatePicker.tsx`
- Test: `packages/ui/src/__tests__/quickPicker/QuickDatePicker.test.tsx`

Renders the chip column + ScrollableCalendar in a portal, anchored to `anchorEl`. Exposes the keyboard model from the spec.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/quickPicker/QuickDatePicker.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickDatePicker } from "../../quickPicker/QuickDatePicker";

const MAY_7 = new Date(Date.UTC(2026, 4, 7)); // Wednesday

function renderPicker(overrides: Partial<React.ComponentProps<typeof QuickDatePicker>> = {}) {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () => ({ top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(anchor);

  const onCommit = vi.fn();
  const onCancel = vi.fn();

  render(
    <QuickDatePicker
      anchorEl={anchor}
      initialDate={null}
      now={MAY_7}
      onCommit={onCommit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { anchor, onCommit, onCancel };
}

describe("QuickDatePicker", () => {
  it("renders the five preset chips with letters and resolved dates", () => {
    renderPicker();
    expect(screen.getByTestId("chip-today")).toHaveTextContent("Today");
    expect(screen.getByTestId("chip-today")).toHaveTextContent("Wed · May 7");
    expect(screen.getByTestId("chip-tomorrow")).toHaveTextContent("Tomorrow");
    expect(screen.getByTestId("chip-this_week")).toHaveTextContent("This Week");
    expect(screen.getByTestId("chip-next_week")).toHaveTextContent("Next Week");
    expect(screen.getByTestId("chip-next_month")).toHaveTextContent("Next Month");

    expect(screen.getByTestId("chip-today")).toHaveTextContent("T");
    expect(screen.getByTestId("chip-tomorrow")).toHaveTextContent("M");
    expect(screen.getByTestId("chip-this_week")).toHaveTextContent("W");
    expect(screen.getByTestId("chip-next_week")).toHaveTextContent("N");
    expect(screen.getByTestId("chip-next_month")).toHaveTextContent("X");
  });

  it("commits today when 't' is pressed", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "t" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString()).toBe("2026-05-07T00:00:00.000Z");
  });

  it("commits via uppercase letter as well", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "M" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString()).toBe("2026-05-08T00:00:00.000Z");
  });

  it("clears the date on Backspace and Delete", () => {
    const { onCommit } = renderPicker({ initialDate: MAY_7 });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(onCommit).toHaveBeenLastCalledWith(null);

    onCommit.mockClear();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it("calls onCancel on Escape and does not commit", () => {
    const { onCommit, onCancel } = renderPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the highlighted day when Enter is pressed", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "ArrowRight" }); // highlight May 8
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString().slice(0, 10)).toBe("2026-05-08");
  });

  it("commits when a calendar day is clicked", () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByTestId("day-2026-05-12"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const date = onCommit.mock.calls[0][0] as Date;
    expect(date.toISOString().slice(0, 10)).toBe("2026-05-12");
  });

  it("highlights the existing date on open when initialDate is set", () => {
    renderPicker({ initialDate: new Date(Date.UTC(2026, 4, 20)) });
    expect(screen.getByTestId("day-2026-05-20").dataset.selected).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brett/ui test -- QuickDatePicker`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// packages/ui/src/quickPicker/QuickDatePicker.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeTriageResult, type TriageDatePreset } from "@brett/business";
import { ScrollableCalendar } from "./ScrollableCalendar";
import { useAnchoredPosition } from "./useAnchoredPosition";
import { DATE_LETTER_TO_PRESET, DATE_PRESET_ORDER, DATE_PRESET_LABELS, DATE_PRESET_TO_LETTER } from "./letters";

export interface QuickDatePickerProps {
  anchorEl: HTMLElement | null;
  initialDate: Date | null;
  onCommit: (date: Date | null) => void;
  onCancel: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
  now?: Date;            // injected in tests
  visible?: boolean;     // for the morph case in TriageQuickPicker; defaults true
}

const SUBLABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function presetSublabel(preset: TriageDatePreset, now: Date): string {
  const result = computeTriageResult(preset, now);
  const date = new Date(result.dueDate);
  if (preset === "this_week") {
    const fri = new Date(date);
    // computeTriageResult returns the next Sunday; show Fri before that as the "by" label
    fri.setUTCDate(fri.getUTCDate() - 2);
    return `by ${SUBLABEL_FORMATTER.format(fri)}`;
  }
  return SUBLABEL_FORMATTER.format(date);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

export function QuickDatePicker({
  anchorEl,
  initialDate,
  onCommit,
  onCancel,
  placement = "bottom-end",
  now,
  visible = true,
}: QuickDatePickerProps) {
  const today = useMemo(() => {
    const base = now ?? new Date();
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  }, [now]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(anchorEl, popoverRef, { preferred: placement });

  const [highlighted, setHighlighted] = useState<Date>(initialDate ?? today);

  const commitPreset = useCallback((preset: TriageDatePreset) => {
    const result = computeTriageResult(preset, now ?? new Date());
    onCommit(new Date(result.dueDate));
  }, [onCommit, now]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (key === "escape") { e.preventDefault(); onCancel(); return; }
      if (key === "backspace" || key === "delete") { e.preventDefault(); onCommit(null); return; }

      if (key in DATE_LETTER_TO_PRESET) {
        e.preventDefault();
        commitPreset(DATE_LETTER_TO_PRESET[key]);
        return;
      }

      if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((d) => addDays(d, 7)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((d) => addDays(d, -7)); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); setHighlighted((d) => addDays(d, 1)); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); setHighlighted((d) => addDays(d, -1)); return; }
      if (e.key === "PageDown") {
        e.preventDefault();
        setHighlighted((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())));
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        setHighlighted((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate())));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onCommit(highlighted);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, highlighted, commitPreset, onCommit, onCancel]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: 330 }}
      className="z-50 flex gap-2 rounded-xl border border-white/8 bg-[rgba(20,20,22,0.96)] p-2 shadow-2xl backdrop-blur-2xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ChipColumn
        initialDate={initialDate}
        now={today}
        onCommitPreset={commitPreset}
        onClear={() => onCommit(null)}
      />
      <div className="w-[185px] border-l border-white/5 pl-2">
        <ScrollableCalendar
          anchorDate={initialDate ?? today}
          highlightedDate={highlighted}
          selectedDate={initialDate}
          onHighlight={setHighlighted}
          onCommit={onCommit}
          now={today}
        />
      </div>
    </div>,
    document.body,
  );
}

function ChipColumn({
  initialDate, now, onCommitPreset, onClear,
}: {
  initialDate: Date | null;
  now: Date;
  onCommitPreset: (p: TriageDatePreset) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex w-[128px] flex-col gap-1">
      {DATE_PRESET_ORDER.map((preset) => {
        const isCurrent = !!initialDate && computeTriageResult(preset, now).dueDate.slice(0, 10) === initialDate.toISOString().slice(0, 10);
        return (
          <button
            key={preset}
            type="button"
            data-testid={`chip-${preset}`}
            onClick={() => onCommitPreset(preset)}
            className={[
              "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left",
              isCurrent ? "bg-brett-gold/20 border border-brett-gold/35"
                : "border border-transparent bg-white/[0.025] hover:bg-white/5",
            ].join(" ")}
          >
            <span className={[
              "flex h-3.5 w-3.5 items-center justify-center rounded text-[8px] font-semibold",
              isCurrent ? "bg-brett-gold/30 text-brett-gold" : "bg-white/10 text-white/70",
            ].join(" ")}>
              {DATE_PRESET_TO_LETTER[preset].toUpperCase()}
            </span>
            <span className="flex-1">
              <span className={["block text-[10px] font-medium", isCurrent ? "text-white" : "text-white/85"].join(" ")}>
                {DATE_PRESET_LABELS[preset]}
              </span>
              <span className={["block text-[8px]", isCurrent ? "text-brett-gold/70" : "text-white/40"].join(" ")}>
                {presetSublabel(preset, now)}
              </span>
            </span>
          </button>
        );
      })}
      <div className="mt-1 border-t border-white/5 pt-1">
        <button
          type="button"
          data-testid="chip-clear"
          onClick={onClear}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-white/5"
        >
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-white/5 text-[8px] text-white/50">⌫</span>
          <span className="text-[10px] text-white/55">No date</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @brett/ui test -- QuickDatePicker`
Expected: PASS — all eight assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/quickPicker/QuickDatePicker.tsx packages/ui/src/__tests__/quickPicker/QuickDatePicker.test.tsx
git commit -m "feat(ui): add QuickDatePicker"
```

---

## Task 5 — `useSuggestedLists` hook

**Files:**
- Create: `packages/ui/src/quickPicker/useSuggestedLists.ts`
- Test: `packages/ui/src/__tests__/quickPicker/useSuggestedLists.test.tsx`

Returns up to four lists in priority order, plus a `mode` indicating whether the chips are AI-suggested or recent. Pure function — caller passes in `lists`, `aiSuggestions`, and `recentListIds`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/quickPicker/useSuggestedLists.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { NavList } from "@brett/types";
import { useSuggestedLists } from "../../quickPicker/useSuggestedLists";

const lists: NavList[] = [
  { id: "1", name: "Board Memo", colorClass: "bg-amber-400" } as NavList,
  { id: "2", name: "Q2 Planning", colorClass: "bg-blue-400" } as NavList,
  { id: "3", name: "Family", colorClass: "bg-emerald-400" } as NavList,
  { id: "4", name: "Reading", colorClass: "bg-orange-400" } as NavList,
  { id: "5", name: "Investing", colorClass: "bg-violet-400" } as NavList,
];

describe("useSuggestedLists", () => {
  it("returns AI suggestions when present, in order, mode='suggested'", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({
        lists,
        aiSuggestions: [{ listId: "5", listName: "Investing", similarity: 0.9 }, { listId: "3", listName: "Family", similarity: 0.7 }],
        recentListIds: ["1", "2"],
      }),
    );
    expect(result.current.mode).toBe("suggested");
    expect(result.current.chips.map((l) => l.id)).toEqual(["5", "3"]);
  });

  it("falls back to recent when AI suggestions are empty, mode='recent'", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({ lists, aiSuggestions: [], recentListIds: ["3", "1", "2"] }),
    );
    expect(result.current.mode).toBe("recent");
    expect(result.current.chips.map((l) => l.id)).toEqual(["3", "1", "2"]);
  });

  it("caps at four chips even with more inputs", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({ lists, aiSuggestions: [], recentListIds: ["1", "2", "3", "4", "5"] }),
    );
    expect(result.current.chips.length).toBe(4);
  });

  it("filters out unknown list IDs (stale references)", () => {
    const { result } = renderHook(() =>
      useSuggestedLists({ lists, aiSuggestions: [], recentListIds: ["1", "999"] }),
    );
    expect(result.current.chips.map((l) => l.id)).toEqual(["1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brett/ui test -- useSuggestedLists`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// packages/ui/src/quickPicker/useSuggestedLists.ts
import { useMemo } from "react";
import type { NavList } from "@brett/types";

interface AiSuggestion {
  listId: string;
  listName: string;
  similarity: number;
}

interface Args {
  lists: NavList[];
  aiSuggestions: AiSuggestion[] | undefined;
  recentListIds: string[];
}

interface Result {
  chips: NavList[];
  mode: "suggested" | "recent" | "empty";
}

const MAX_CHIPS = 4;

export function useSuggestedLists({ lists, aiSuggestions, recentListIds }: Args): Result {
  return useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l]));

    if (aiSuggestions && aiSuggestions.length > 0) {
      const chips = aiSuggestions
        .map((s) => byId.get(s.listId))
        .filter((l): l is NavList => !!l)
        .slice(0, MAX_CHIPS);
      if (chips.length > 0) return { chips, mode: "suggested" };
    }

    const chips = recentListIds
      .map((id) => byId.get(id))
      .filter((l): l is NavList => !!l)
      .slice(0, MAX_CHIPS);

    return { chips, mode: chips.length > 0 ? "recent" : "empty" };
  }, [lists, aiSuggestions, recentListIds]);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @brett/ui test -- useSuggestedLists`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/quickPicker/useSuggestedLists.ts packages/ui/src/__tests__/quickPicker/useSuggestedLists.test.tsx
git commit -m "feat(ui): add useSuggestedLists hook"
```

---

## Task 6 — `QuickListPicker` component

**Files:**
- Create: `packages/ui/src/quickPicker/QuickListPicker.tsx`
- Test: `packages/ui/src/__tests__/quickPicker/QuickListPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/quickPicker/QuickListPicker.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NavList } from "@brett/types";
import { QuickListPicker } from "../../quickPicker/QuickListPicker";

const lists: NavList[] = [
  { id: "a", name: "Board Memo", colorClass: "bg-amber-400" } as NavList,
  { id: "b", name: "Q2 Planning", colorClass: "bg-blue-400" } as NavList,
  { id: "c", name: "Family", colorClass: "bg-emerald-400" } as NavList,
  { id: "d", name: "Reading", colorClass: "bg-orange-400" } as NavList,
  { id: "e", name: "Investing", colorClass: "bg-violet-400" } as NavList,
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof QuickListPicker>> = {}) {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () => ({ top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(anchor);
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <QuickListPicker
      anchorEl={anchor}
      initialListId={null}
      lists={lists}
      suggestedListIds={["a", "b", "c", "d"]}
      suggestionMode="suggested"
      onCommit={onCommit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onCommit, onCancel };
}

describe("QuickListPicker", () => {
  it("renders four chips with numbers", () => {
    renderPicker();
    expect(screen.getByTestId("chip-list-a")).toHaveTextContent("Board Memo");
    expect(screen.getByTestId("chip-list-a")).toHaveTextContent("1");
    expect(screen.getByTestId("chip-list-d")).toHaveTextContent("4");
  });

  it("commits a list when its number is pressed", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "2" });
    expect(onCommit).toHaveBeenCalledWith("b");
  });

  it("commits a list when a chip is clicked", () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByTestId("chip-list-c"));
    expect(onCommit).toHaveBeenCalledWith("c");
  });

  it("clears with the No-list chip", () => {
    const { onCommit } = renderPicker();
    fireEvent.click(screen.getByTestId("chip-list-clear"));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("filters list rows live as the user types in the search input", () => {
    renderPicker();
    const search = screen.getByPlaceholderText(/Search lists/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "fam" } });
    expect(screen.getByTestId("row-list-c")).toBeInTheDocument();
    expect(screen.queryByTestId("row-list-a")).not.toBeInTheDocument();
  });

  it("cancels on Escape", () => {
    const { onCancel } = renderPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Enter commits the highlighted row in the right column", () => {
    const { onCommit } = renderPicker();
    fireEvent.keyDown(window, { key: "ArrowDown" }); // first row highlighted
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(typeof onCommit.mock.calls[0][0]).toBe("string");
  });

  it("shows the 'Suggested ✦' header when mode is suggested", () => {
    renderPicker();
    expect(screen.getByText(/Suggested/i)).toBeInTheDocument();
  });

  it("shows 'Recent' header when mode is recent", () => {
    renderPicker({ suggestionMode: "recent" });
    expect(screen.getByText(/Recent/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brett/ui test -- QuickListPicker`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// packages/ui/src/quickPicker/QuickListPicker.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import type { NavList } from "@brett/types";
import { useAnchoredPosition } from "./useAnchoredPosition";

export interface QuickListPickerProps {
  anchorEl: HTMLElement | null;
  initialListId: string | null;
  lists: NavList[];
  suggestedListIds: string[];
  suggestionMode: "suggested" | "recent" | "empty";
  onCommit: (listId: string | null) => void;
  onCancel: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
  visible?: boolean;
}

export function QuickListPicker({
  anchorEl, initialListId, lists, suggestedListIds, suggestionMode,
  onCommit, onCancel, placement = "bottom-end", visible = true,
}: QuickListPickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(anchorEl, popoverRef, { preferred: placement });

  const chips = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l]));
    return suggestedListIds.map((id) => byId.get(id)).filter((l): l is NavList => !!l).slice(0, 4);
  }, [lists, suggestedListIds]);

  const sortedAll = useMemo(
    () => [...lists].sort((a, b) => a.name.localeCompare(b.name)),
    [lists],
  );

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return sortedAll;
    const q = search.toLowerCase();
    return sortedAll.filter((l) => l.name.toLowerCase().includes(q));
  }, [sortedAll, search]);

  const [highlightIdx, setHighlightIdx] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) searchRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      // Number 1-4 for chip — only when search is empty (otherwise it's a digit input)
      if (search === "" && /^[1-4]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (chips[idx]) { e.preventDefault(); onCommit(chips[idx].id); return; }
      }
      if (e.key === "Backspace" && search === "") { e.preventDefault(); onCommit(null); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(-1, i - 1)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIdx >= 0 && filtered[highlightIdx]) { onCommit(filtered[highlightIdx].id); return; }
        if (filtered.length === 1) { onCommit(filtered[0].id); return; }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, search, chips, filtered, highlightIdx, onCommit, onCancel]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: 330 }}
      className="z-50 flex gap-2 rounded-xl border border-white/8 bg-[rgba(20,20,22,0.96)] p-2 shadow-2xl backdrop-blur-2xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Chip column */}
      <div className="flex w-[128px] flex-col gap-1">
        <div className="flex items-center gap-1 px-2 pb-1 text-[8px] uppercase tracking-wider text-white/45">
          {suggestionMode === "suggested" && <><Sparkles size={8} className="text-brett-gold/60" /> Suggested</>}
          {suggestionMode === "recent" && <>Recent</>}
        </div>
        {chips.map((list, i) => {
          const isCurrent = list.id === initialListId;
          return (
            <button
              key={list.id}
              type="button"
              data-testid={`chip-list-${list.id}`}
              onClick={() => onCommit(list.id)}
              className={[
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left",
                isCurrent ? "bg-brett-gold/20 border border-brett-gold/35"
                  : "border border-transparent bg-white/[0.025] hover:bg-white/5",
              ].join(" ")}
            >
              <span className={[
                "flex h-3.5 w-3.5 items-center justify-center rounded text-[8px] font-semibold",
                isCurrent ? "bg-brett-gold/30 text-brett-gold" : "bg-white/10 text-white/70",
              ].join(" ")}>
                {i + 1}
              </span>
              <span className={`h-1.5 w-1.5 rounded-full ${list.colorClass}`} />
              <span className="flex-1 truncate text-[10px] text-white/85">{list.name}</span>
            </button>
          );
        })}
        <div className="mt-1 border-t border-white/5 pt-1">
          <button
            type="button"
            data-testid="chip-list-clear"
            onClick={() => onCommit(null)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-white/5"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-white/5 text-[8px] text-white/50">⌫</span>
            <span className="text-[10px] text-white/55">No list</span>
          </button>
        </div>
      </div>

      {/* Search + scroll column */}
      <div className="flex w-[185px] flex-col border-l border-white/5 pl-2">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search lists…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setHighlightIdx(-1); }}
          className="rounded-md border border-white/8 bg-black/40 px-2 py-1 text-[10px] text-white placeholder:text-white/40 outline-none mb-1"
        />
        <div className="sticky top-0 z-10 bg-[rgba(20,20,22,0.96)] py-1 text-[10px] font-semibold text-white tracking-wide">All lists</div>
        <div className="relative max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {filtered.map((list, i) => {
            const isHighlighted = i === highlightIdx;
            const isSelected = list.id === initialListId;
            return (
              <button
                key={list.id}
                type="button"
                data-testid={`row-list-${list.id}`}
                onMouseEnter={() => setHighlightIdx(i)}
                onClick={() => onCommit(list.id)}
                className={[
                  "flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left",
                  isSelected ? "bg-brett-gold/15"
                    : isHighlighted ? "bg-white/5" : "hover:bg-white/[0.03]",
                ].join(" ")}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${list.colorClass}`} />
                <span className="flex-1 truncate text-[10px] text-white/85">{list.name}</span>
              </button>
            );
          })}
          <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[rgba(20,20,22,0.95)] to-transparent" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @brett/ui test -- QuickListPicker`
Expected: PASS — all assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/quickPicker/QuickListPicker.tsx packages/ui/src/__tests__/quickPicker/QuickListPicker.test.tsx
git commit -m "feat(ui): add QuickListPicker"
```

---

## Task 7 — `TriageQuickPicker` (Inbox morph wrapper)

**Files:**
- Create: `packages/ui/src/quickPicker/TriageQuickPicker.tsx`
- Test: `packages/ui/src/__tests__/quickPicker/TriageQuickPicker.test.tsx`

Wraps both pickers. On first commit, fires `onCommitDate`/`onCommitList` immediately and morphs to the other picker. On second commit, fires the second `onCommit*` and `onClose`. On Escape at any step, fires `onClose` (the step-1 commit was already persisted by its callback, so this is fine).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/quickPicker/TriageQuickPicker.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NavList } from "@brett/types";
import { TriageQuickPicker } from "../../quickPicker/TriageQuickPicker";

const MAY_7 = new Date(Date.UTC(2026, 4, 7));
const lists: NavList[] = [
  { id: "a", name: "Board Memo", colorClass: "bg-amber-400" } as NavList,
  { id: "b", name: "Q2 Planning", colorClass: "bg-blue-400" } as NavList,
];

function renderTriage(startWith: "date" | "list") {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () => ({ top: 100, left: 100, right: 300, bottom: 140, width: 200, height: 40, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(anchor);
  const onCommitDate = vi.fn();
  const onCommitList = vi.fn();
  const onClose = vi.fn();
  render(
    <TriageQuickPicker
      anchorEl={anchor}
      initialDate={null}
      initialListId={null}
      lists={lists}
      suggestedListIds={["a", "b"]}
      suggestionMode="suggested"
      startWith={startWith}
      now={MAY_7}
      onCommitDate={onCommitDate}
      onCommitList={onCommitList}
      onClose={onClose}
    />,
  );
  return { onCommitDate, onCommitList, onClose };
}

describe("TriageQuickPicker", () => {
  it("startWith='date' → press T → onCommitDate fires, then list picker is shown", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("date");
    expect(screen.getByTestId("chip-today")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "t" });
    expect(onCommitDate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // After the morph, the list picker is rendered
    expect(screen.getByTestId("chip-list-a")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1" });
    expect(onCommitList).toHaveBeenCalledWith("a");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("startWith='list' → press 1 → onCommitList fires, date picker shown next", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("list");
    expect(screen.getByTestId("chip-list-a")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1" });
    expect(onCommitList).toHaveBeenCalledWith("a");
    expect(onClose).not.toHaveBeenCalled();

    expect(screen.getByTestId("chip-today")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "m" });
    expect(onCommitDate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape during step 1 closes without any commit", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("date");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCommitDate).not.toHaveBeenCalled();
    expect(onCommitList).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape during step 2 closes — step-1 commit is NOT rolled back (caller already persisted)", () => {
    const { onCommitDate, onCommitList, onClose } = renderTriage("date");
    fireEvent.keyDown(window, { key: "t" });
    expect(onCommitDate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCommitList).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brett/ui test -- TriageQuickPicker`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// packages/ui/src/quickPicker/TriageQuickPicker.tsx
import React, { useState } from "react";
import type { NavList } from "@brett/types";
import { QuickDatePicker } from "./QuickDatePicker";
import { QuickListPicker } from "./QuickListPicker";

export interface TriageQuickPickerProps {
  anchorEl: HTMLElement | null;
  initialDate: Date | null;
  initialListId: string | null;
  lists: NavList[];
  suggestedListIds: string[];
  suggestionMode: "suggested" | "recent" | "empty";
  startWith: "date" | "list";
  onCommitDate: (date: Date | null) => void;
  onCommitList: (listId: string | null) => void;
  onClose: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
  now?: Date;
}

export function TriageQuickPicker(props: TriageQuickPickerProps) {
  const { startWith } = props;
  const [step, setStep] = useState<"date" | "list">(startWith);
  const [committed, setCommitted] = useState<{ date: boolean; list: boolean }>({ date: false, list: false });

  const handleDateCommit = (date: Date | null) => {
    props.onCommitDate(date);
    if (committed.list || step !== startWith) {
      props.onClose();
      return;
    }
    setCommitted((c) => ({ ...c, date: true }));
    setStep("list");
  };

  const handleListCommit = (listId: string | null) => {
    props.onCommitList(listId);
    if (committed.date || step !== startWith) {
      props.onClose();
      return;
    }
    setCommitted((c) => ({ ...c, list: true }));
    setStep("date");
  };

  return (
    <>
      <QuickDatePicker
        anchorEl={props.anchorEl}
        initialDate={props.initialDate}
        onCommit={handleDateCommit}
        onCancel={props.onClose}
        placement={props.placement}
        now={props.now}
        visible={step === "date"}
      />
      <QuickListPicker
        anchorEl={props.anchorEl}
        initialListId={props.initialListId}
        lists={props.lists}
        suggestedListIds={props.suggestedListIds}
        suggestionMode={props.suggestionMode}
        onCommit={handleListCommit}
        onCancel={props.onClose}
        placement={props.placement}
        visible={step === "list"}
      />
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @brett/ui test -- TriageQuickPicker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/quickPicker/TriageQuickPicker.tsx packages/ui/src/__tests__/quickPicker/TriageQuickPicker.test.tsx
git commit -m "feat(ui): add TriageQuickPicker morph wrapper"
```

---

## Task 8 — Barrel + index export

**Files:**
- Create: `packages/ui/src/quickPicker/index.ts`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Write barrel**

```ts
// packages/ui/src/quickPicker/index.ts
export { QuickDatePicker } from "./QuickDatePicker";
export type { QuickDatePickerProps } from "./QuickDatePicker";
export { QuickListPicker } from "./QuickListPicker";
export type { QuickListPickerProps } from "./QuickListPicker";
export { TriageQuickPicker } from "./TriageQuickPicker";
export type { TriageQuickPickerProps } from "./TriageQuickPicker";
export { useSuggestedLists } from "./useSuggestedLists";
```

- [ ] **Step 2: Add the new exports to package index, leave TriagePopup until Task 13**

In `packages/ui/src/index.ts`, after the existing `TriagePopup` export, add:

```ts
export { QuickDatePicker, QuickListPicker, TriageQuickPicker, useSuggestedLists } from "./quickPicker";
export type { QuickDatePickerProps, QuickListPickerProps, TriageQuickPickerProps } from "./quickPicker";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @brett/ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/quickPicker/index.ts packages/ui/src/index.ts
git commit -m "feat(ui): export quick-picker components from @brett/ui"
```

---

## Task 9 — Forward refs from `InboxItemRow` and `ThingCard`

**Files:**
- Modify: `packages/ui/src/InboxItemRow.tsx`
- Modify: `packages/ui/src/ThingCard.tsx`

The pickers anchor to the focused row's DOM element. The simplest path is to assign a per-row ref keyed by `thing.id` from the parent, then look it up at trigger time. Each row stores its element via `onElementRef` callback.

- [ ] **Step 1: Add `onElementRef` prop to `InboxItemRow`**

In `packages/ui/src/InboxItemRow.tsx`:

```tsx
interface InboxItemRowProps {
  // ...existing...
  /** Called with the row's DOM element so the parent can anchor a popover to it. */
  onElementRef?: (el: HTMLDivElement | null) => void;
}
```

In the component, augment the `ref` callback already on the outer `<div>`:

```tsx
ref={(node) => {
  setNodeRef(node);
  rowRef.current = node;
  onElementRef?.(node);
}}
```

(Make sure to destructure `onElementRef` in the component args.)

- [ ] **Step 2: Same for `ThingCard.tsx`**

Add the same `onElementRef?: (el: HTMLDivElement | null) => void;` prop and forward it from the outermost element ref. Read the file first; if `ThingCard` already uses a `ref` callback, augment it; if it doesn't have one, add a new outer ref.

- [ ] **Step 3: Typecheck and run existing tests to make sure nothing regressed**

```bash
pnpm --filter @brett/ui typecheck
pnpm --filter @brett/ui test
```

Expected: no errors, all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/InboxItemRow.tsx packages/ui/src/ThingCard.tsx
git commit -m "feat(ui): forward DOM element from row components for popover anchoring"
```

---

## Task 10 — Plumb anchor element through `onTriageOpen`

**Files:**
- Modify: `packages/ui/src/InboxView.tsx`
- Modify: `packages/ui/src/ThingsList.tsx`
- Modify: `apps/desktop/src/views/UpcomingView.tsx`
- Modify: `apps/desktop/src/views/ListView.tsx`
- Modify: `apps/desktop/src/views/TodayView.tsx`

Extend the callback shape from:

```ts
onTriageOpen?: (mode: "list-first" | "date-first" | "list-only" | "date-only", ids: string[], thing?: ...) => void;
```

to:

```ts
onTriageOpen?: (
  mode: "list-first" | "date-first" | "list-only" | "date-only",
  ids: string[],
  thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null },
  anchorEl?: HTMLElement | null,
) => void;
```

Each row consumer maintains a `Map<string, HTMLDivElement>` of row id → element via `onElementRef`. When `l` or `d` is pressed, look up the focused thing's id in the map and pass that element to `onTriageOpen`.

- [ ] **Step 1: Update `InboxView.tsx`**

Add a ref map and wire up `onElementRef` on `InboxItemRow`:

```tsx
const rowEls = useRef<Map<string, HTMLDivElement>>(new Map());

// In the keyboard handler, replace:
//   onTriageOpen?.("list-first", ids, singleThing ? { ... } : undefined);
// with:
const anchor = singleThing ? rowEls.current.get(singleThing.id) ?? null : null;
onTriageOpen?.("list-first", ids, singleThing ? { listId: singleThing.listId, dueDate: singleThing.dueDate, dueDatePrecision: singleThing.dueDatePrecision } : undefined, anchor);

// In the InboxItemRow JSX, pass:
onElementRef={(el) => {
  if (el) rowEls.current.set(thing.id, el);
  else rowEls.current.delete(thing.id);
}}
```

Update the `onTriageOpen` prop type at the top of the file to include the optional fourth `anchorEl` arg.

- [ ] **Step 2: Update `ThingsList.tsx`**

Same pattern: add `rowEls = useRef<Map<string, HTMLDivElement>>(new Map())`, wire `onElementRef` on each `ThingCard`, pass `rowEls.current.get(focusedThing.id) ?? null` as the fourth argument in the `l`/`d` branches of `onExtraKey`.

- [ ] **Step 3: Update view files**

In `apps/desktop/src/views/UpcomingView.tsx`, `ListView.tsx`, `TodayView.tsx`: just propagate the new `anchorEl?: HTMLElement | null` argument through the `onTriageOpen` type. Most of these views forward to `ThingsList` and don't construct the call site themselves; only `UpcomingView.tsx` and `ListView.tsx` have their own keyboard handlers — apply the same pattern there.

- [ ] **Step 4: Typecheck and run existing tests**

```bash
pnpm --filter @brett/ui typecheck
pnpm --filter @brett/desktop typecheck
pnpm --filter @brett/ui test
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/InboxView.tsx packages/ui/src/ThingsList.tsx apps/desktop/src/views/UpcomingView.tsx apps/desktop/src/views/ListView.tsx apps/desktop/src/views/TodayView.tsx
git commit -m "feat(desktop): plumb anchor element through onTriageOpen"
```

---

## Task 11 — Render the new pickers from `App.tsx`

**Files:**
- Modify: `apps/desktop/src/App.tsx`

Replace the `<TriagePopup …>` render block with branched rendering between `TriageQuickPicker`, `QuickDatePicker`, and `QuickListPicker`. Extend `triageState` to carry the anchor element and to derive recent list IDs.

- [ ] **Step 1: Extend triageState shape**

Around line 254:

```tsx
const [triageState, setTriageState] = useState<{
  mode: "list-first" | "date-first" | "list-only" | "date-only";
  ids: string[];
  currentListId?: string | null;
  currentDueDate?: string | null;
  currentDueDatePrecision?: "day" | "week" | null;
  anchorEl?: HTMLElement | null;
} | null>(null);
```

- [ ] **Step 2: Update `handleTriageOpen` to capture the anchor**

```tsx
const handleTriageOpen = (
  mode: "list-first" | "date-first" | "list-only" | "date-only",
  ids: string[],
  thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null },
  anchorEl?: HTMLElement | null,
) => {
  setTriageState({
    mode, ids,
    currentListId: thing?.listId,
    currentDueDate: thing?.dueDate,
    currentDueDatePrecision: thing?.dueDatePrecision,
    anchorEl: anchorEl ?? null,
  });
};
```

- [ ] **Step 3: Compute recent list IDs from the user's `things`**

Place once near the other `useMemo`s in `App.tsx`:

```tsx
const recentListIds = React.useMemo(() => {
  // Things sorted by createdAt desc. Take unique listIds in that order, top 4.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of things ?? []) {
    if (!t.listId || seen.has(t.listId)) continue;
    seen.add(t.listId);
    out.push(t.listId);
    if (out.length >= 8) break;
  }
  return out;
}, [things]);
```

(`things` is already in scope via `useThings`. If it isn't or it's named differently in App.tsx, use whatever array of `Thing` is available.)

- [ ] **Step 4: Replace the render block**

Replace lines around 1523-1538 (the existing TriagePopup render):

```tsx
{triageState && triageState.anchorEl && (() => {
  const initialDate = triageState.currentDueDate ? new Date(triageState.currentDueDate) : null;
  const suggestedListIds = listSuggestionsData?.suggestions?.length
    ? listSuggestionsData.suggestions.map((s) => s.listId)
    : recentListIds;
  const suggestionMode: "suggested" | "recent" | "empty" =
    listSuggestionsData?.suggestions?.length ? "suggested" : (recentListIds.length > 0 ? "recent" : "empty");

  if (triageState.mode === "list-first" || triageState.mode === "date-first") {
    return (
      <TriageQuickPicker
        anchorEl={triageState.anchorEl}
        initialDate={initialDate}
        initialListId={triageState.currentListId ?? null}
        lists={lists}
        suggestedListIds={suggestedListIds}
        suggestionMode={suggestionMode}
        startWith={triageState.mode === "list-first" ? "list" : "date"}
        onCommitDate={(date) => handleInboxTriage(triageState.ids, { dueDate: date ? date.toISOString() : null, dueDatePrecision: date ? "day" : null })}
        onCommitList={(listId) => handleInboxTriage(triageState.ids, { listId })}
        onClose={() => setTriageState(null)}
      />
    );
  }

  if (triageState.mode === "date-only") {
    return (
      <QuickDatePicker
        anchorEl={triageState.anchorEl}
        initialDate={initialDate}
        onCommit={(date) => {
          handleInboxTriage(triageState.ids, { dueDate: date ? date.toISOString() : null, dueDatePrecision: date ? "day" : null });
          setTriageState(null);
        }}
        onCancel={() => setTriageState(null)}
      />
    );
  }

  // list-only
  return (
    <QuickListPicker
      anchorEl={triageState.anchorEl}
      initialListId={triageState.currentListId ?? null}
      lists={lists}
      suggestedListIds={suggestedListIds}
      suggestionMode={suggestionMode}
      onCommit={(listId) => {
        handleInboxTriage(triageState.ids, { listId });
        setTriageState(null);
      }}
      onCancel={() => setTriageState(null)}
    />
  );
})()}
```

Remove the import of `TriagePopup` from the App.tsx imports list and add:

```tsx
import { QuickDatePicker, QuickListPicker, TriageQuickPicker } from "@brett/ui";
```

(Leave the `TriagePopup` *file* alone for now — it's removed in Task 13.)

- [ ] **Step 5: Add a click-outside listener that closes the picker**

After the existing `useEffect` that listens for `Escape` (search for `triageState` around line 833), add a sibling effect — or extend the existing one — that calls `setTriageState(null)` on `mousedown` outside the picker. The pickers' root divs already `stopPropagation` on `mousedown`, so a `document.mousedown` listener works:

```tsx
useEffect(() => {
  if (!triageState) return;
  const handler = () => setTriageState(null);
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, [triageState]);
```

- [ ] **Step 6: Smoke test**

```bash
pnpm --filter @brett/desktop typecheck
pnpm dev:desktop
```

Manually: focus an Inbox row → press `d` → date picker appears anchored under the row. Click outside → closes. Press `t` → date persisted, list picker morphs in. Press `1` → list persisted, popover closes. Repeat with `l`. Verify Today (`d` on a row) shows date picker only with no morph.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(desktop): render quick pickers anchored to row"
```

---

## Task 12 — `ScheduleRow` uses `QuickDatePicker`

**Files:**
- Modify: `packages/ui/src/ScheduleRow.tsx`

Replace the inline `DropdownOption`-list date dropdown with `QuickDatePicker` rendered inside the existing `<ScheduleCard>` shell. Anchor element is the card's button. The other two cards (Reminder, Recurrence) are unaffected.

- [ ] **Step 1: Capture the card button as anchor and switch to QuickDatePicker**

In `ScheduleRow.tsx`, the Due Date `<ScheduleCard>` block currently renders `DATE_PRESETS.map(...)` plus a `No date` row. Replace its render-prop with the new picker:

```tsx
import { QuickDatePicker } from "./quickPicker";

// inside the Due Date ScheduleCard:
<ScheduleCard
  icon={<Calendar size={16} />}
  label="Due Date"
  value={dueDateLabel ?? (dueDate ? "Set" : undefined)}
  renderPicker={(anchorEl, close) => (
    <QuickDatePicker
      anchorEl={anchorEl}
      initialDate={dueDate ? new Date(dueDate) : null}
      onCommit={(date) => {
        onUpdateDueDate(date ? date.toISOString() : null, "day");
        close();
      }}
      onCancel={close}
      placement="bottom-start"
    />
  )}
/>
```

- [ ] **Step 2: Refactor `ScheduleCard` to support `renderPicker`**

`ScheduleCard` currently accepts `children: (close: () => void) => React.ReactNode` and renders the children inside a positioned `<div>` below the button. The new pattern needs the card to expose its button as the anchor element to the picker:

```tsx
interface ScheduleCardProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  /** Legacy: renders content inside the card's own dropdown div (for Reminder, Recurrence). */
  children?: (close: () => void) => React.ReactNode;
  /** New: renders a portal-anchored picker. The card just owns open state; positioning is the picker's job. */
  renderPicker?: (anchorEl: HTMLButtonElement | null, close: () => void) => React.ReactNode;
}

function ScheduleCard({ icon, label, value, children, renderPicker }: ScheduleCardProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  useClickOutside(ref, close, open && !!children);

  return (
    <div ref={ref} className="relative flex-1">
      <button
        ref={buttonRef}
        onClick={() => setOpen((prev) => !prev)}
        className="…(unchanged classes)…"
      >
        {/* existing content */}
      </button>

      {/* Legacy children dropdown (Reminder, Recurrence) */}
      {open && children && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 overflow-hidden z-10">
          {children(close)}
        </div>
      )}

      {/* New portal-anchored picker (Due Date) */}
      {open && renderPicker && renderPicker(buttonRef.current, close)}
    </div>
  );
}
```

For the Reminder and Recurrence cards, leave the `children` prop pattern as-is — they don't need the redesign in this scope.

- [ ] **Step 3: Drop the old `DATE_PRESETS`, `DropdownOption`, `isPresetActive`, and `getUTCDatePrefix` helpers**

These were only used by the Due Date dropdown. Remove them from `ScheduleRow.tsx`. (The Reminder and Recurrence cards still use `DropdownOption` — keep that one. Remove only the date-related helpers.)

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @brett/ui typecheck
```

- [ ] **Step 5: Smoke test**

In `pnpm dev:desktop`, open a task's detail panel → click "Due Date" → `QuickDatePicker` appears anchored to the card. Pick a preset or click a calendar day. Click outside → closes. Reminder and Recurrence dropdowns still work as before.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/ScheduleRow.tsx
git commit -m "feat(ui): ScheduleRow uses QuickDatePicker for due date"
```

---

## Task 13 — Remove `TriagePopup`

**Files:**
- Delete: `packages/ui/src/TriagePopup.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/desktop/src/App.tsx` (already removed in Task 11; this just confirms)

- [ ] **Step 1: Remove the export and the file**

Edit `packages/ui/src/index.ts`: delete the line `export { TriagePopup } from "./TriagePopup";`.

```bash
rm packages/ui/src/TriagePopup.tsx
```

- [ ] **Step 2: Confirm no remaining imports**

```bash
grep -rn "TriagePopup" packages/ apps/desktop/src/ apps/admin/ 2>/dev/null
```

Expected: no matches. If any remain, remove them.

- [ ] **Step 3: Final typecheck + tests**

```bash
pnpm typecheck
pnpm --filter @brett/ui test
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/index.ts packages/ui/src/TriagePopup.tsx
git commit -m "refactor(ui): remove TriagePopup (replaced by QuickDatePicker/QuickListPicker)"
```

---

## Task 14 — Manual smoke test pass

This is the last task; no code changes, just verification. Run `pnpm dev:full` and verify each surface end-to-end. Tick each line as you go.

- [ ] **Inbox row, `d` shortcut.** Focus a row, press `d`. Date picker appears anchored to the row. Press `t` — task gets today's date AND the list picker morphs in. Press `1` — task gets list 1. Popover closes. Look at the row: both fields updated.
- [ ] **Inbox row, `l` shortcut.** Focus a row, press `l`. List picker appears. Press `2`. Date picker morphs in. Press `m`. Popover closes. Row updated.
- [ ] **Inbox row, Escape after first commit.** Focus a row with no date or list. Press `d`, then `t` (commits today). Then `Escape` — popover closes. Row should now have today's date but still no list.
- [ ] **Today row, `d` shortcut.** Focus a row, press `d`. Date picker appears. Pick a date by clicking. Popover closes. NO list picker morph.
- [ ] **Today row, `l` shortcut.** Focus a row, press `l`. List picker only. Pick. Closes. NO date picker morph.
- [ ] **Detail panel Due Date.** Open a task, click the "Due Date" card. Date picker appears anchored to the card. Pick a preset. Card label updates.
- [ ] **Detail panel "Move to List…".** Open a task, click "⋯" → "Move to List…". List picker appears. Pick a list. Detail panel updates.
- [ ] **Click-outside dismissal.** Open any picker, click the page background. Picker closes without committing.
- [ ] **Calendar scroll.** Open the date picker. Scroll the calendar — months scroll continuously, sticky month label rides the top.
- [ ] **Anchor on existing date.** Open a task that already has a due date in two months. Press `d` from a row showing that task. Calendar opens scrolled to that date, gold-filled.
- [ ] **Viewport flip.** Focus the bottom-most row in a long list. Press `d`. Picker appears *above* the row instead of below.

If any line fails, file an issue and address before merging.

---

## Self-Review Checklist (run after writing all tasks)

- [x] **Spec coverage.** Each spec section is covered by a task — letters (T1), anchored position (T2), ScrollableCalendar (T3), QuickDatePicker (T4), useSuggestedLists (T5), QuickListPicker (T6), TriageQuickPicker (T7), exports (T8), row refs (T9), callback plumbing (T10), App render (T11), ScheduleRow (T12), TriagePopup removal (T13), smoke test (T14).
- [x] **Placeholder scan.** No "TBD" / "TODO" / "implement later" / "similar to Task N" in any task body.
- [x] **Type consistency.** `QuickDatePickerProps`, `QuickListPickerProps`, `TriageQuickPickerProps` match between component definition and test renderings. `useAnchoredPosition` accepts `RefObject<HTMLElement | null>` consistently. `onTriageOpen` callback shape (with optional fourth `anchorEl` arg) matches between callsites and `App.tsx`'s handler.
- [x] **No new dependencies.** All work uses existing deps (React, framer-motion already in tree though not actually used here, lucide-react, vitest, testing-library).
- [x] **Migration is clean.** Task 13 confirms `TriagePopup` has no remaining importers via grep.
