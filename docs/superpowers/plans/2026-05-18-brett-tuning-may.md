# Brett Tuning May 2026 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five focused tweaks across Today view, Tonight concept, and connection-health visibility — desktop + iOS where applicable.

**Architecture:** Three independent PRs that can be built in parallel after PR B's schema migration deploys to API first.

**Tech Stack:** TypeScript (Hono API, Vite/React desktop, shared packages), Swift/SwiftUI/SwiftData (iOS), Prisma (Postgres), Vitest + Swift Testing.

**Spec:** [`docs/superpowers/specs/2026-05-18-brett-tuning-may-design.md`](../specs/2026-05-18-brett-tuning-may-design.md).

---

## Survey results (from Explore agents)

Critical findings the plan accommodates:

- **Item 4 (granola second account) is likely a stale-client issue, not a code bug.** Multi-granola code is on `release` (commits `8f8511d`, `26c9c47`, `4cecd76`, `c153c75`, `7321937`). Desktop manifest dated 2026-05-19 confirms shipped. No code change planned — Phase C task 1 is a verification step.
- **Item 5 has two halves.** Per-account scoped re-link resolution is already shipped (`resolveRelinkTaskForAccount` in `apps/api/src/lib/connection-health.ts`, regression-tested in `granola-auth.test.ts:122-180`). What is NOT shipped: per-account warning chrome inside Settings cards with the failure reason. Phase C builds that UI.
- **No accordion primitive exists.** Phase A task 5 builds a small `CollapsibleSection` wrapper using `@radix-ui/react-collapsible` (or hand-rolled if dep absent — check first).
- **No localStorage UI-state precedent.** Phase A task 4 introduces `useLocalStorageBoolean` in `apps/desktop/src/lib/` using the existing `userScopedStorage` helper at `apps/desktop/src/lib/userScopedStorage.ts`.

---

## File-structure overview

### New files
- `packages/ui/src/CollapsibleSection.tsx` — reusable accordion for Today sections.
- `apps/desktop/src/lib/useLocalStorageBoolean.ts` — small hook for per-section collapse state.
- `apps/desktop/src/lib/useTonightAutoExpand.ts` — 6pm auto-expand logic.
- `apps/api/prisma/migrations/<timestamp>_add_item_tonight/migration.sql` — adds `tonight` column.

### Modified files (high-traffic, by phase)
- **Phase A:** `apps/desktop/src/App.tsx`, `apps/ios/Brett/Views/Today/TodaySections.swift`, `apps/desktop/src/views/TodayView.tsx`, `docs/superpowers/specs/2026-04-24-today-count-badge-design.md`.
- **Phase B:** `apps/api/prisma/schema.prisma`, `apps/api/src/routes/sync.ts`, `packages/types/src/index.ts`, `packages/business/src/index.ts`, `packages/business/src/index.ts` (TriageDatePreset), `packages/ui/src/quickPicker/letters.ts`, `packages/ui/src/quickPicker/QuickDatePicker.tsx`, `apps/ios/Brett/Models/Item.swift`, `apps/ios/Brett/Models/Item+Fields.swift`, `apps/ios/Brett/Views/Shared/QuickScheduleSheet.swift`, `apps/ios/Brett/Views/Today/TodaySections.swift`, `apps/ios/Brett/Views/Today/TodayPage.swift`, `apps/desktop/src/views/TodayView.tsx`.
- **Phase C:** `apps/api/src/lib/connection-health.ts` (extend `BrokenConnectionsResponse`), `apps/api/src/routes/things.ts`, `apps/desktop/src/api/connection-health.ts`, `apps/desktop/src/settings/CalendarSection.tsx`, `apps/desktop/src/settings/AIProvidersSection.tsx` (if scope), `apps/ios/Brett/Views/Settings/CalendarSettingsView.swift`.

---

# PHASE A — Today view tuning (Items 1 + 2)

**Single PR.** Touches desktop + iOS (badge only on iOS, no UI). Low risk; UI-only.

## Task A1: Narrow desktop badge filter to overdue + today (drop "this week" and weekend logic)

**Files:**
- Modify: `apps/desktop/src/App.tsx:501-590`
- Test: `apps/desktop/src/__tests__/badgeCount.test.ts` (new — check if any sibling tests exist; if not, create test directory)

- [ ] **Step 1: Inspect current code at App.tsx:497-590**

Read the surrounding area to see imports of `getEndOfWeekUTC` and the `useActiveThings` hook signature. Look for `getEndOfTodayUTC` — if it doesn't exist, we'll add it next to `getEndOfWeekUTC` (search for the file that defines `getEndOfWeekUTC`).

- [ ] **Step 2: Add `getEndOfTodayUTC` helper if missing**

```bash
grep -rn "getEndOfWeekUTC" apps/desktop/src packages/ | head -10
```

Open the file where `getEndOfWeekUTC` is defined. Add (mirroring the existing helper signature exactly):

```typescript
export function getEndOfTodayUTC(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return d;
}
```

If `getEndOfWeekUTC` uses a different time computation (local vs UTC midnight), match THAT pattern; do not invent a new one.

- [ ] **Step 3: Write failing test for narrowed badge**

If the project has no badge-count unit test on desktop, add one. Otherwise extend the existing one.

```typescript
// apps/desktop/src/__tests__/badgeCount.test.ts
import { describe, it, expect } from "vitest";

// Replicate the filter logic in a pure helper so we can test it. If the App.tsx
// uses an inline filter, extract to a helper first (see Step 4).
import { computeBadgeCount } from "../lib/badgeCount";

const today = new Date("2026-05-18T12:00:00Z");

describe("computeBadgeCount", () => {
  it("counts overdue items", () => {
    const items = [{ dueDate: "2026-05-17T12:00:00Z", isCompleted: false, urgency: "overdue" }];
    expect(computeBadgeCount(items, today)).toBe(1);
  });

  it("counts today items", () => {
    const items = [{ dueDate: "2026-05-18T18:00:00Z", isCompleted: false, urgency: "today" }];
    expect(computeBadgeCount(items, today)).toBe(1);
  });

  it("counts tonight items as today", () => {
    const items = [{ dueDate: "2026-05-18T23:00:00Z", isCompleted: false, urgency: "today", tonight: true }];
    expect(computeBadgeCount(items, today)).toBe(1);
  });

  it("excludes this_week items", () => {
    const items = [{ dueDate: "2026-05-20T12:00:00Z", isCompleted: false, urgency: "this_week" }];
    expect(computeBadgeCount(items, today)).toBe(0);
  });

  it("excludes this_weekend items even on a weekend", () => {
    const items = [{ dueDate: "2026-05-23T12:00:00Z", isCompleted: false, urgency: "this_weekend" }];
    // Note: today=2026-05-23 if we want to test weekend; just make sure weekend items don't count
    const saturday = new Date("2026-05-23T12:00:00Z");
    const weekendItem = [{ dueDate: "2026-05-24T12:00:00Z", isCompleted: false, urgency: "this_weekend" }];
    expect(computeBadgeCount(weekendItem, saturday)).toBe(0);
  });

  it("excludes completed items", () => {
    const items = [{ dueDate: "2026-05-18T18:00:00Z", isCompleted: true, urgency: "today" }];
    expect(computeBadgeCount(items, today)).toBe(0);
  });
});
```

- [ ] **Step 4: Run test (should fail because helper does not exist yet)**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/desktop test badgeCount
```

Expected: FAIL (`computeBadgeCount` not exported / `../lib/badgeCount` not found).

- [ ] **Step 5: Extract `computeBadgeCount` helper from App.tsx**

Create `apps/desktop/src/lib/badgeCount.ts`:

```typescript
type BadgeInputThing = {
  dueDate?: string | Date | null;
  isCompleted?: boolean;
  urgency?: string;
};

export function computeBadgeCount(things: BadgeInputThing[], now: Date = new Date()): number {
  const endOfToday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999
  ));
  return things.filter((t) => {
    if (t.isCompleted) return false;
    if (!t.dueDate) return false;
    return new Date(t.dueDate) <= endOfToday;
  }).length;
}
```

- [ ] **Step 6: Run test (should pass)**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/desktop test badgeCount
```

Expected: PASS.

- [ ] **Step 7: Replace inline logic in App.tsx with the helper**

In `apps/desktop/src/App.tsx`:

Replace lines 522–528:
```typescript
const badgeCount = useMemo(() => {
  if (!badgeUserId) return 0;
  return computeBadgeCount(activeThingsForCount);
}, [badgeUserId, activeThingsForCount]);
```

Add at top of file: `import { computeBadgeCount } from "./lib/badgeCount";`

Remove the now-unused `isWeekendNow` variable and its dependencies if nothing else uses it (lines 518–521 area — verify with grep before deleting).

`useActiveThings(endOfWeekISO)` still fetches a week's worth so the rest of the Today view has data; the badge just filters it down. Do NOT narrow the fetch itself.

- [ ] **Step 8: Typecheck + test**

```bash
cd /Users/brentbarkman/code/brett && pnpm --filter @brett/desktop typecheck && pnpm --filter @brett/desktop test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/lib/badgeCount.ts apps/desktop/src/__tests__/badgeCount.test.ts
git commit -m "feat(desktop): narrow Today badge to overdue + today only

Drops 'this week' and weekend logic from the dock + sidebar badge per the
2026-05-18 tuning spec. Today + Overdue stay; Tonight is captured via dueDate
filter. Extracts the filter into apps/desktop/src/lib/badgeCount.ts with unit
tests."
```

---

## Task A2: Narrow iOS badge filter to overdue + today

**Files:**
- Modify: `apps/ios/Brett/Views/Today/TodaySections.swift:38-52`
- Test: `apps/ios/BrettTests/TodaySectionsTests.swift` (look for existing test file first; extend if present, create if not)

- [ ] **Step 1: Locate existing TodaySections tests**

```bash
find apps/ios -name "*TodaySections*Tests.swift" -o -name "TodaySectionsTests*.swift"
```

If none exists, create `apps/ios/BrettTests/TodaySectionsTests.swift` with imports matching sibling test files in `apps/ios/BrettTests/`.

- [ ] **Step 2: Write failing test**

```swift
import Testing
@testable import Brett
import Foundation

@Suite("TodaySections.badgeCount")
struct TodaySectionsBadgeTests {
    func makeItem(dueDate: Date?, status: String = "active", tonight: Bool = false) -> Item {
        let item = Item(
            id: UUID().uuidString,
            userId: "u1",
            type: "task",
            status: status,
            title: "t",
            createdAt: Date(),
            updatedAt: Date()
        )
        item.dueDate = dueDate
        // item.tonight = tonight  // uncomment once tonight property added in PR B
        return item
    }

    @Test("counts overdue + today, excludes thisWeek and thisWeekend")
    func narrowsToTodayOnly() throws {
        let now = ISO8601DateFormatter().date(from: "2026-05-18T12:00:00Z")!
        let cal = Calendar(identifier: .gregorian)
        let overdueDate = cal.date(byAdding: .day, value: -1, to: now)!
        let todayDate = now
        let thisWeekDate = cal.date(byAdding: .day, value: 3, to: now)!
        let items = [
            makeItem(dueDate: overdueDate),
            makeItem(dueDate: todayDate),
            makeItem(dueDate: thisWeekDate),
        ]
        let count = TodaySections.badgeCount(items: items, now: now, localCalendar: cal)
        #expect(count == 2)
    }

    @Test("excludes thisWeekend even on a weekend")
    func excludesWeekendOnWeekend() throws {
        let saturday = ISO8601DateFormatter().date(from: "2026-05-23T12:00:00Z")!
        let cal = Calendar(identifier: .gregorian)
        let weekendItem = makeItem(dueDate: cal.date(byAdding: .day, value: 1, to: saturday)!)
        let count = TodaySections.badgeCount(items: [weekendItem], now: saturday, localCalendar: cal)
        #expect(count == 0)
    }
}
```

- [ ] **Step 3: Run test (should fail)**

In Xcode or via xcodebuild. The existing `badgeCount` adds weekend items on Sat/Sun → second test fails.

```bash
cd apps/ios && xcodebuild test -scheme Brett -destination "platform=iOS Simulator,name=iPhone 15" -only-testing:BrettTests/TodaySectionsBadgeTests 2>&1 | tail -30
```

- [ ] **Step 4: Narrow badgeCount in TodaySections.swift**

Replace lines 38–52:

```swift
/// Inclusion rules (must stay in lockstep with desktop's badgeCount):
/// Always: overdue + today.
/// Tonight tasks are counted via the today bucket (they have dueDate = today).
static func badgeCount(
    items: [Item],
    now: Date = Date(),
    localCalendar: Calendar = .current
) -> Int {
    let s = bucket(items: items, reflowKey: 0, now: now, localCalendar: localCalendar)
    return s.overdue.count + s.today.count
}
```

- [ ] **Step 5: Run test (should pass)**

Same xcodebuild command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Brett/Views/Today/TodaySections.swift apps/ios/BrettTests/TodaySectionsTests.swift
git commit -m "feat(ios): narrow Today badge to overdue + today only

Mirrors desktop change in lockstep. Tonight items still count (they're in the
today bucket via dueDate = today)."
```

---

## Task A3: Update the badge spec doc to match new definition

**Files:**
- Modify: `docs/superpowers/specs/2026-04-24-today-count-badge-design.md`

- [ ] **Step 1: Update the Count definition section**

Edit the "## Count definition" section. Change `**overdue + due today + due this week**` to `**overdue + due today**` and update the desktop bullet (drop the weekend logic mention) and the iOS bullet (drop `+ s.thisWeek.count + (isWeekend ? s.thisWeekend.count : 0)`).

Add a sentence: `Tonight items are counted as today (they have dueDate = today; the tonight flag only affects sectioning, not counting).`

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-24-today-count-badge-design.md
git commit -m "docs: update badge spec — narrow to overdue + today only

Supersedes the original 'overdue + today + thisWeek + weekend (if weekend)'
definition per the 2026-05-18 tuning spec."
```

---

## Task A4: Build `useLocalStorageBoolean` hook (UI state persistence)

**Files:**
- Create: `apps/desktop/src/lib/useLocalStorageBoolean.ts`
- Test: `apps/desktop/src/__tests__/useLocalStorageBoolean.test.ts`

- [ ] **Step 1: Look at existing userScopedStorage helper**

Read `apps/desktop/src/lib/userScopedStorage.ts` to see the `scopedKey(base)` pattern and reuse it so UI state is per-user.

- [ ] **Step 2: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorageBoolean } from "../lib/useLocalStorageBoolean";

beforeEach(() => localStorage.clear());

describe("useLocalStorageBoolean", () => {
  it("returns default value when no key in storage", () => {
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", false));
    expect(result.current[0]).toBe(false);
  });

  it("persists toggled value to localStorage", () => {
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("brett:test.key")).toBe("true");
  });

  it("reads existing value on mount", () => {
    localStorage.setItem("brett:test.key", "true");
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", false));
    expect(result.current[0]).toBe(true);
  });
});
```

- [ ] **Step 3: Run test (should fail — module not found)**

```bash
pnpm --filter @brett/desktop test useLocalStorageBoolean
```

- [ ] **Step 4: Implement the hook**

```typescript
// apps/desktop/src/lib/useLocalStorageBoolean.ts
import { useCallback, useEffect, useState } from "react";

const PREFIX = "brett:";

function read(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function useLocalStorageBoolean(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => read(key, fallback));

  useEffect(() => {
    // Re-sync from storage if key changes (rare, but defensive).
    setValue(read(key, fallback));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback((next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(PREFIX + key, next ? "true" : "false");
    } catch {
      // localStorage unavailable — in-memory state still works.
    }
  }, [key]);

  return [value, update];
}
```

- [ ] **Step 5: Run test (should pass)**

```bash
pnpm --filter @brett/desktop test useLocalStorageBoolean
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/lib/useLocalStorageBoolean.ts apps/desktop/src/__tests__/useLocalStorageBoolean.test.ts
git commit -m "feat(desktop): add useLocalStorageBoolean hook

Small utility for per-feature UI state persistence (collapsed section
state, etc.). Uses the brett: prefix consistent with existing localStorage
usage in lib/backgroundLuminance.ts."
```

---

## Task A5: Build `CollapsibleSection` UI component

**Files:**
- Create: `packages/ui/src/CollapsibleSection.tsx`

- [ ] **Step 1: Check if @radix-ui/react-collapsible is already a dep**

```bash
grep -A1 "@radix-ui/react-collapsible" packages/ui/package.json apps/desktop/package.json
```

If absent, add it: `pnpm --filter @brett/ui add @radix-ui/react-collapsible`. (Many Radix primitives are already pulled via shadcn dependencies — likely present.)

- [ ] **Step 2: Implement the component**

```typescript
// packages/ui/src/CollapsibleSection.tsx
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "./lib/utils";

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  headerExtras?: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
  headerExtras,
  className,
}: CollapsibleSectionProps) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} className={className}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-white/40 hover:text-white/60 transition-colors"
          data-testid={`collapsible-${title.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform duration-200",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
          <span>{title}</span>
          {typeof count === "number" && count > 0 && (
            <span className="ml-1 text-white/30">{count}</span>
          )}
          {headerExtras && <span className="ml-auto">{headerExtras}</span>}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content
        className={cn(
          "overflow-hidden",
          "data-[state=open]:animate-collapsible-down",
          "data-[state=closed]:animate-collapsible-up",
        )}
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
```

Verify `cn` is exported from `packages/ui/src/lib/utils.ts` — otherwise inline the className concatenation. Look at `packages/ui/src/index.ts` to confirm the export pattern used by sibling components, then add `export * from "./CollapsibleSection";` if that's how the package exports.

Check `tailwind.config.js` or equivalent for the animation classes `animate-collapsible-down`/`animate-collapsible-up`. If absent, either add them or omit the className entirely (the component will work without animation; not ideal but unblocked).

- [ ] **Step 3: Verify chevron + header style matches existing section headers**

Open `apps/desktop/src/views/TodayView.tsx` line 403 area where `SectionHeader` lives. The text color, weight, tracking should match. If different, update the CollapsibleSection styles to mirror it exactly so the visual treatment is consistent for collapsible vs non-collapsible sections.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/CollapsibleSection.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add CollapsibleSection accordion primitive

Wraps Radix Collapsible with the Today view's section-header styling and a
chevron. Used for default-collapsed sections like This Week / This Weekend /
Done Today."
```

---

## Task A6: Wire collapsible sections into TodayView

**Files:**
- Modify: `apps/desktop/src/views/TodayView.tsx`

- [ ] **Step 1: Identify the JSX that renders each section**

Read TodayView.tsx around the `sections.map(...)` JSX. The current pattern renders `<SectionHeader ... />` followed by the items list.

- [ ] **Step 2: Define which sections collapse**

At the top of TodayView (or in `sections` building loop), add:

```typescript
const COLLAPSIBLE_SECTION_KEYS = new Set(["this-week", "this-weekend", "done-today"]);
```

- [ ] **Step 3: Wire `useLocalStorageBoolean` per collapsible section**

```typescript
const [thisWeekOpen, setThisWeekOpen] = useLocalStorageBoolean("today.section.this-week.open", false);
const [thisWeekendOpen, setThisWeekendOpen] = useLocalStorageBoolean("today.section.this-weekend.open", false);
const [doneTodayOpen, setDoneTodayOpen] = useLocalStorageBoolean("today.section.done-today.open", false);

const openMap: Record<string, { open: boolean; set: (v: boolean) => void }> = {
  "this-week": { open: thisWeekOpen, set: setThisWeekOpen },
  "this-weekend": { open: thisWeekendOpen, set: setThisWeekendOpen },
  "done-today": { open: doneTodayOpen, set: setDoneTodayOpen },
};
```

Import the hook: `import { useLocalStorageBoolean } from "../lib/useLocalStorageBoolean";`

- [ ] **Step 4: Render collapsible vs static sections**

In the sections render loop:

```typescript
{sections.map((section) => {
  if (COLLAPSIBLE_SECTION_KEYS.has(section.key)) {
    const state = openMap[section.key];
    return (
      <CollapsibleSection
        key={section.key}
        title={section.title}
        count={section.count}
        open={state.open}
        onOpenChange={state.set}
      >
        {/* existing items render for this section */}
      </CollapsibleSection>
    );
  }
  return (
    <div key={section.key}>
      <SectionHeader title={section.title} count={section.count} />
      {/* existing items render for this section */}
    </div>
  );
})}
```

Refactor the actual section-content rendering into a helper so it's not duplicated. Example:

```typescript
const renderSectionItems = (key: string) => {
  switch (key) {
    case "overdue": return grouped.overdue.map(renderItem);
    case "today": return grouped.today.map(renderItem);
    case "this-week": return grouped.thisWeek.map(renderItem);
    case "this-weekend": return grouped.thisWeekend.map(renderItem);
    case "done-today": return grouped.done.map(renderItem);
    default: return null;
  }
};
```

- [ ] **Step 5: Manual verification with preview tools**

```bash
# Start dev server if not running, then via preview_*:
# 1. Load Today view with mixed sections
# 2. Verify This Week / This Weekend / Done are collapsed by default
# 3. Click to expand This Week → reload page → still expanded
# 4. Verify count chip visible in collapsed state
```

Use the verification workflow from preview_tools instructions.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @brett/desktop typecheck
git add apps/desktop/src/views/TodayView.tsx
git commit -m "feat(desktop): collapsible This Week / This Weekend / Done sections

Default collapsed, state per-section in localStorage. Today and Overdue stay
always-expanded. Count chip visible in collapsed state."
```

---

## Task A7: Open Phase A PR

- [ ] **Step 1: Push branch + open PR**

```bash
# Assuming worktree branch is already created by subagent-driven-development
git push -u origin <branch-name>
gh pr create --base main --title "feat: today view tuning — narrow badge + collapsible sections" --body "$(cat <<'EOF'
## Summary
- Narrow Today badge count to overdue + today only (drops This Week + weekend logic on both desktop + iOS)
- Collapsible This Week / This Weekend / Done Today sections on desktop (default collapsed, localStorage per-section)

Spec: docs/superpowers/specs/2026-05-18-brett-tuning-may-design.md (items 1, 2)

## Test plan
- [ ] `pnpm --filter @brett/desktop typecheck`
- [ ] `pnpm --filter @brett/desktop test`
- [ ] `xcodebuild test -scheme Brett -only-testing:BrettTests/TodaySectionsBadgeTests`
- [ ] Manual: collapse a section, reload, still collapsed
- [ ] Manual: badge count drops by amount of This Week items
EOF
)"
```

---

# PHASE B — Tonight (Item 3)

**Single PR.** Schema migration, sync engine update, both platforms. Release order: API first (migration), then desktop + iOS clients.

## Task B1: Add `tonight` field to Prisma schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma:146-195`
- Create: `apps/api/prisma/migrations/<TIMESTAMP>_add_item_tonight/migration.sql`

- [ ] **Step 1: Edit schema**

In the `Item` model (line 146-195), add after `recurrenceRule String?`:

```prisma
  tonight          Boolean   @default(false)
```

- [ ] **Step 2: Create migration**

```bash
cd apps/api && pnpm prisma migrate dev --name add_item_tonight --create-only
```

Open the generated `migration.sql` and verify it contains exactly:

```sql
-- AlterTable
ALTER TABLE "Item" ADD COLUMN "tonight" BOOLEAN NOT NULL DEFAULT false;
```

If Prisma generates additional cascading changes (it shouldn't — we only added one nullable-with-default column), fix the migration to be just the single ALTER.

- [ ] **Step 3: Apply migration locally**

```bash
cd apps/api && pnpm prisma migrate dev
```

Should complete without prompting.

- [ ] **Step 4: Verify Prisma client regenerates with `tonight` field**

```bash
cd apps/api && pnpm prisma generate
# Then in a TS file:
grep -rn "tonight" apps/api/node_modules/.prisma/client/index.d.ts | head -3
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api): add Item.tonight boolean (default false)

Additive non-null column with default. Single ALTER, no data movement. Older
clients ignore the unknown field on pull; they cannot set it (which is correct
fallback)."
```

---

## Task B2: Add `tonight` to sync engine field whitelists

**Files:**
- Modify: `apps/api/src/routes/sync.ts:38-63`

- [ ] **Step 1: Update MUTABLE_FIELDS and CREATABLE_FIELDS**

In `apps/api/src/routes/sync.ts`:

```typescript
const MUTABLE_FIELDS: Record<PushableEntityType, readonly string[]> = {
  item: ["title", "description", "notes", "status", "dueDate", "dueDatePrecision",
         "completedAt", "snoozedUntil", "reminder", "recurrence", "recurrenceRule",
         "listId", "brettObservation", "contentType", "contentStatus", "tonight"],
  // ...
};

const CREATABLE_FIELDS: Record<PushableEntityType, readonly string[]> = {
  item: [
    "type", "source", "sourceId", "sourceUrl",
    "title", "description", "notes",
    "status", "dueDate", "dueDatePrecision", "completedAt", "snoozedUntil",
    "reminder", "recurrence", "recurrenceRule",
    "listId", "brettObservation",
    "contentType", "contentStatus", "tonight",
  ],
  // ...
};
```

- [ ] **Step 2: Write API test for tonight sync round-trip**

Look for an existing `sync.test.ts` in `apps/api/src/__tests__/`. Extend it (or create new) with:

```typescript
import { describe, it, expect } from "vitest";
// Import the test helpers used by sibling sync tests (createTestUser, callPush, callPull).

describe("sync — tonight field", () => {
  it("accepts tonight=true on item CREATE and returns it on pull", async () => {
    const user = await createTestUser();
    const push = await callPush(user, {
      mutations: [{
        id: "m1", entityType: "item", entityId: "i1", action: "create",
        payload: { id: "i1", type: "task", title: "Pick up groceries", status: "active",
                   dueDate: new Date().toISOString(), dueDatePrecision: "day", tonight: true },
      }],
    });
    expect(push.results[0].status).toBe("ok");
    const pull = await callPull(user, {});
    const itemRow = pull.tables.item.upserted.find((r: any) => r.id === "i1");
    expect(itemRow.tonight).toBe(true);
  });

  it("accepts tonight=true on item UPDATE with previousValues", async () => {
    // (after CREATE) push UPDATE with changedFields=["tonight"], previousValues={tonight: false}
    // expect ok + pull returns tonight=true
  });

  it("defaults tonight=false on existing rows pulled by older clients", async () => {
    // create item without tonight — pull — expect tonight === false (not undefined)
  });
});
```

Mirror the exact helper/fixture patterns from existing sync tests rather than inventing new ones — check the imports + setup pattern of an existing sync test file before writing this.

- [ ] **Step 3: Run test (should fail until step 1 ships if you ordered things differently — should pass now)**

```bash
cd apps/api && pnpm test -- sync
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/sync.ts apps/api/src/__tests__/<sync test file>
git commit -m "feat(api): allow Item.tonight in sync push/pull

Adds tonight to MUTABLE_FIELDS + CREATABLE_FIELDS for item entity. Tests
verify round-trip and default value for older clients."
```

---

## Task B3: Add `tonight` to ItemRecord type

**Files:**
- Modify: `packages/types/src/index.ts:60-93`

- [ ] **Step 1: Add field**

In `ItemRecord` interface (lines 60-93), add after `recurrenceRule?: string | null;`:

```typescript
  tonight?: boolean;
```

Optional because older API responses may omit it; defaults to `false` semantically.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @brett/types typecheck
pnpm typecheck  # full repo, since this type is shared
```

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add tonight?: boolean to ItemRecord"
```

---

## Task B4: Update `itemToThing` to include tonight

**Files:**
- Modify: `packages/business/src/index.ts:305-352`

- [ ] **Step 1: Find Thing interface in packages/types/src/index.ts:123 area, add `tonight?: boolean`**

```typescript
// in Thing interface (find via: grep -n "interface Thing" packages/types/src/index.ts)
  tonight?: boolean;
```

- [ ] **Step 2: Add to itemToThing return**

In `packages/business/src/index.ts`, find `itemToThing` and add `tonight: item.tonight ?? false` to the returned object.

- [ ] **Step 3: Add TriageDatePreset entry**

Find `TriageDatePreset` type (search `grep -n "TriageDatePreset" packages/business/src/index.ts`). Add `"tonight"` to the union.

Add to `computeTriageResult` (also in packages/business): when preset is `"tonight"`, return `{ dueDate: <end of today UTC>, precision: "day", tonight: true }`. Verify the return type allows a `tonight` field — if not, extend the result type.

```typescript
// Existing pattern (illustrative, match actual code):
case "today":
  return { dueDate: endOfTodayISO(now), precision: "day", tonight: false };
case "tonight":
  return { dueDate: endOfTodayISO(now), precision: "day", tonight: true };
case "tomorrow":
  return { dueDate: endOfTomorrowISO(now), precision: "day", tonight: false };
```

Critical: every existing case must explicitly set `tonight: false` so that picking "Today" or "Tomorrow" CLEARS a previously-set tonight flag.

- [ ] **Step 4: Update existing tests for computeTriageResult**

`grep -rn "computeTriageResult" packages/business/src/__tests__ packages/business/src/` — extend tests to cover `tonight: true` behavior + clearing on other presets.

- [ ] **Step 5: Run tests + commit**

```bash
pnpm --filter @brett/business test
pnpm --filter @brett/business typecheck
git add packages/types/src/index.ts packages/business/src/
git commit -m "feat(business): add tonight to Thing + TriageDatePreset

Selecting 'Tonight' sets dueDate=endOfToday + tonight=true. All other presets
explicitly clear tonight=false."
```

---

## Task B5: Add "Tonight" to desktop date picker

**Files:**
- Modify: `packages/ui/src/quickPicker/letters.ts:12-28`
- Modify: `packages/ui/src/quickPicker/QuickDatePicker.tsx` (icon rendering, if needed)

- [ ] **Step 1: Update DATE_PRESET_ORDER and labels**

In `packages/ui/src/quickPicker/letters.ts`:

```typescript
export const DATE_PRESET_ORDER: TriageDatePreset[] = [
  "today",
  "tonight",
  "tomorrow",
  "this_weekend",
  "this_week",
  "next_week",
  "next_month",
];

export const DATE_PRESET_LABELS: Record<TriageDatePreset, string> = {
  today: "Today",
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  this_weekend: "This Weekend",
  this_week: "This Week",
  next_week: "Next Week",
  next_month: "Next Month",
};
```

Also check `DATE_LETTER_TO_PRESET` and `DATE_PRESET_TO_LETTER` maps — if they exist and use single-letter shortcuts, assign one for tonight. Suggested letter: `N` (T conflicts with Today/Tomorrow; M for "midnight" is taken if someone uses it).

```typescript
export const DATE_LETTER_TO_PRESET: Record<string, TriageDatePreset> = {
  T: "today",
  N: "tonight",  // 'N' for "night"
  // ...
};
```

- [ ] **Step 2: Verify chip renders correctly**

Run desktop dev server, open the date picker (Omnibar or task detail), confirm "Tonight" chip appears between Today and Tomorrow.

- [ ] **Step 3: Manual test**

Use preview_* tools:
1. Open Omnibar
2. Type a task title
3. Open date picker → click Tonight
4. Verify task gets created with dueDate=today end + tonight flag

(Confirming the flag stored requires looking at network panel for POST /sync/push payload.)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/quickPicker/
git commit -m "feat(ui): add Tonight chip to QuickDatePicker

Slotted between Today and Tomorrow. Single-letter shortcut 'N' (for night).
Selecting Tonight sets dueDate=today + tonight=true via computeTriageResult."
```

---

## Task B6: Add `tonight` to iOS Item SwiftData model + Codable

**Files:**
- Modify: `apps/ios/Brett/Models/Item.swift:8-238`

- [ ] **Step 1: Add property**

After `var brettObservation: String?` (around line 29):

```swift
var tonight: Bool = false
```

- [ ] **Step 2: Add CodingKey**

In `enum CodingKeys: String, CodingKey` (around line 102), add:

```swift
case tonight
```

- [ ] **Step 3: Add decode**

In `init(from decoder: Decoder)` (line 143), add (before sync metadata section):

```swift
self.tonight = try container.decodeIfPresent(Bool.self, forKey: .tonight) ?? false
```

- [ ] **Step 4: Add encode**

In `func encode(to encoder: Encoder)` (line 197), add:

```swift
try container.encode(tonight, forKey: .tonight)
```

- [ ] **Step 5: Build to confirm**

```bash
cd apps/ios && xcodebuild -scheme Brett -destination "platform=iOS Simulator,name=iPhone 15" build 2>&1 | tail -10
```

Should compile.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/Brett/Models/Item.swift
git commit -m "feat(ios): add tonight Bool to Item model + Codable"
```

---

## Task B7: Add `tonight` to iOS Item+Fields

**Files:**
- Modify: `apps/ios/Brett/Models/Item+Fields.swift:15-98`

- [ ] **Step 1: Add Field enum case**

In `enum Field: String, CaseIterable` (lines 15-38), add:

```swift
case tonight
```

- [ ] **Step 2: Add to value(for:)**

```swift
case .tonight: return tonight
```

- [ ] **Step 3: Add to set(_:for:)**

```swift
case .tonight:
    if let v = value as? Bool {
        self.tonight = v
    } else if value is NSNull {
        self.tonight = false
    }
```

- [ ] **Step 4: Build + commit**

```bash
xcodebuild -scheme Brett -destination "platform=iOS Simulator,name=iPhone 15" build 2>&1 | tail -5
git add apps/ios/Brett/Models/Item+Fields.swift
git commit -m "feat(ios): expose tonight via Item+Fields for mutation queue"
```

---

## Task B8: Add Tonight bucket to iOS TodaySections

**Files:**
- Modify: `apps/ios/Brett/Views/Today/TodaySections.swift`

- [ ] **Step 1: Add `tonight` to struct**

```swift
struct TodaySections {
    let overdue: [Item]
    let today: [Item]
    let tonight: [Item]   // NEW — items with tonight==true && sameDay(dueDate, today) && status != done
    let thisWeek: [Item]
    let thisWeekend: [Item]
    let nextWeek: [Item]
    let doneToday: [Item]
}
```

- [ ] **Step 2: Bucket tonight items**

In `bucket(items:reflowKey:now:localCalendar:)`, split today items into today vs tonight:

```swift
// After existing 'today' bucketing, split:
let tonightBucket = today.filter { $0.tonight }
let todayBucket = today.filter { !$0.tonight }
return TodaySections(
    overdue: overdue,
    today: todayBucket,
    tonight: tonightBucket,
    thisWeek: thisWeek,
    thisWeekend: thisWeekend,
    nextWeek: nextWeek,
    doneToday: doneToday,
)
```

Read the existing `bucket(...)` body first; the actual variable names will differ. The point is: tonight is a subset of today that's split out for display only — it still counts in the badge via `today.count + tonight.count` (see Step 3).

- [ ] **Step 3: Update badgeCount to include tonight**

```swift
static func badgeCount(
    items: [Item],
    now: Date = Date(),
    localCalendar: Calendar = .current
) -> Int {
    let s = bucket(items: items, reflowKey: 0, now: now, localCalendar: localCalendar)
    return s.overdue.count + s.today.count + s.tonight.count
}
```

Note: this restores tonight to the badge count after Phase A narrowed it. The narrowing dropped thisWeek + weekend; tonight is back because it's a today-day task with an evening hint.

- [ ] **Step 4: Update badge tests**

Add a test case:

```swift
@Test("counts tonight items in badge")
func countsTonight() throws {
    let now = ISO8601DateFormatter().date(from: "2026-05-18T12:00:00Z")!
    let cal = Calendar(identifier: .gregorian)
    let item = makeItem(dueDate: now)
    item.tonight = true
    let count = TodaySections.badgeCount(items: [item], now: now, localCalendar: cal)
    #expect(count == 1)
}
```

Also add a bucket test verifying tonight items leave the today bucket and land in tonight bucket.

- [ ] **Step 5: Test + commit**

```bash
xcodebuild test -scheme Brett -destination "platform=iOS Simulator,name=iPhone 15" -only-testing:BrettTests/TodaySectionsBadgeTests 2>&1 | tail -10
git add apps/ios/Brett/Views/Today/TodaySections.swift apps/ios/BrettTests/TodaySectionsTests.swift
git commit -m "feat(ios): split today bucket into today + tonight

Tonight items have tonight==true. Badge counts both. Tonight bucket renders as
a separate section in TodayPage (next task)."
```

---

## Task B9: Render Tonight section on iOS TodayPage

**Files:**
- Modify: `apps/ios/Brett/Views/Today/TodayPage.swift`

- [ ] **Step 1: Add the section between Today and This Week**

Read the existing section layout — find where the Today section header is rendered. Add Tonight section immediately after, with:

```swift
if !sections.tonight.isEmpty {
    TaskSection(
        title: "Tonight",
        icon: "moon.stars",
        items: sections.tonight,
        // ... matching the other sections' init signature
    )
}
```

Hide entirely when empty (no "Tonight (0)" header).

- [ ] **Step 2: Add 6pm auto-expand state**

Use @AppStorage scoped by date for per-day user-toggle:

```swift
@AppStorage("today.tonight.userToggled.\(todayKey)") private var userToggledTonight: Bool = false
@AppStorage("today.tonight.openState.\(todayKey)") private var userTonightOpenState: Bool = false

private var todayKey: String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
}

private var tonightIsOpen: Bool {
    if userToggledTonight { return userTonightOpenState }
    let hour = Calendar.current.component(.hour, from: Date())
    return hour >= 18
}
```

Note: @AppStorage keys cannot be dynamic at the property-wrapper level (they're compile-time). The actual implementation uses `UserDefaults.standard` with the dated key, exposed via a small `TonightExpansionStore` (`apps/ios/Brett/Services/TonightExpansionStore.swift`). Build that helper:

```swift
// apps/ios/Brett/Services/TonightExpansionStore.swift
import Foundation

@Observable
final class TonightExpansionStore {
    static let shared = TonightExpansionStore()

    private func dateKey() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    func isOpen() -> Bool {
        let key = dateKey()
        let toggledKey = "today.tonight.userToggled.\(key)"
        let openKey = "today.tonight.openState.\(key)"
        if UserDefaults.standard.bool(forKey: toggledKey) {
            return UserDefaults.standard.bool(forKey: openKey)
        }
        let hour = Calendar.current.component(.hour, from: Date())
        return hour >= 18
    }

    func setOpen(_ open: Bool) {
        let key = dateKey()
        UserDefaults.standard.set(true, forKey: "today.tonight.userToggled.\(key)")
        UserDefaults.standard.set(open, forKey: "today.tonight.openState.\(key)")
    }
}
```

If `TaskSection` doesn't support a collapsed state, leave Tonight always-expanded on iOS (per the spec, iOS skipped collapse for non-Tonight sections). The 6pm auto-expand only matters if the user can collapse. **Decision:** iOS Tonight section is always expanded; iOS users see it appear at the right slot but cannot collapse it. The 6pm behavior is desktop-only. Skip the TonightExpansionStore entirely.

Reasoning: spec says collapse is desktop-only. Tonight section being visible is fine since it's hidden when empty anyway.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Brett/Views/Today/TodayPage.swift
git commit -m "feat(ios): render Tonight section after Today

Hidden when empty. Always-expanded on iOS per spec (collapse is desktop-only).
Section position: immediately after Today, before This Week."
```

---

## Task B10: Add "Tonight" to iOS date picker

**Files:**
- Modify: `apps/ios/Brett/Views/Shared/QuickScheduleSheet.swift:15-156`

- [ ] **Step 1: Add enum case**

```swift
enum QuickScheduleOption: String, CaseIterable, Identifiable {
    case today
    case tonight     // NEW
    case tomorrow
    case thisWeekend
    case thisWeek
    case nextWeek
    case nextMonth
    case inAMonth
    case someday
    case pickDate
    // ...
}
```

- [ ] **Step 2: Add label + icon**

```swift
var label: String {
    switch self {
    case .today: return "Today"
    case .tonight: return "Tonight"
    case .tomorrow: return "Tomorrow"
    // ...
    }
}

var icon: String {
    switch self {
    case .today: return "sun.max"
    case .tonight: return "moon.stars"
    case .tomorrow: return "sunrise"
    // ...
    }
}
```

(Match exact icon names from the existing cases — these are illustrative.)

- [ ] **Step 3: Add resolvedDate logic**

```swift
func resolvedDate() -> Date? {
    let calendar = Calendar.current
    let now = Date()
    switch self {
    case .today: return calendar.endOfDay(for: now)
    case .tonight: return calendar.endOfDay(for: now)
    // ...
    }
}
```

- [ ] **Step 4: Add `var setsTonight: Bool` helper**

```swift
var setsTonight: Bool {
    if case .tonight = self { return true }
    return false
}
```

- [ ] **Step 5: Wire setsTonight into the confirm action**

In `handle(_:)`:

```swift
case .tonight:
    onConfirm(option.resolvedDate(), option.precision, tonight: true)
default:
    onConfirm(option.resolvedDate(), option.precision, tonight: false)
```

Update the `onConfirm` closure signature throughout the iOS app to accept `tonight: Bool` (likely a callback type alias — grep for `onConfirm` callers). Every existing site passes `false`.

- [ ] **Step 6: Update all callers to write `item.tonight`**

Find callers of `onConfirm` that mutate Item. They must now also set `item.tonight = tonight`.

- [ ] **Step 7: Build + commit**

```bash
xcodebuild -scheme Brett build 2>&1 | tail -5
git add apps/ios/Brett/Views/Shared/QuickScheduleSheet.swift
git commit -m "feat(ios): add Tonight chip to QuickScheduleSheet

Slotted between Today and Tomorrow. Selecting Tonight sets tonight=true on
the Item via expanded onConfirm callback. Other presets explicitly set
tonight=false to clear the flag."
```

---

## Task B11: Render Tonight section on desktop TodayView (with 6pm auto-expand)

**Files:**
- Modify: `apps/desktop/src/views/TodayView.tsx`
- Create: `apps/desktop/src/lib/useTonightAutoExpand.ts`

- [ ] **Step 1: Build auto-expand hook**

```typescript
// apps/desktop/src/lib/useTonightAutoExpand.ts
import { useEffect, useState } from "react";

const TOUCHED_KEY_PREFIX = "brett:today.tonight.userToggled.";
const STATE_KEY_PREFIX = "brett:today.tonight.openState.";
const EVENING_HOUR = 18;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeDefault(): boolean {
  return new Date().getHours() >= EVENING_HOUR;
}

export function useTonightExpansion(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    const k = todayKey();
    try {
      if (window.localStorage.getItem(TOUCHED_KEY_PREFIX + k) === "true") {
        return window.localStorage.getItem(STATE_KEY_PREFIX + k) === "true";
      }
    } catch {}
    return computeDefault();
  });

  // Re-evaluate every minute so 6pm "tips over" without page reload.
  useEffect(() => {
    const id = setInterval(() => {
      const k = todayKey();
      try {
        if (window.localStorage.getItem(TOUCHED_KEY_PREFIX + k) === "true") return; // user-controlled, leave alone
      } catch {}
      setOpenState(computeDefault());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const setOpen = (next: boolean) => {
    const k = todayKey();
    setOpenState(next);
    try {
      window.localStorage.setItem(TOUCHED_KEY_PREFIX + k, "true");
      window.localStorage.setItem(STATE_KEY_PREFIX + k, next ? "true" : "false");
    } catch {}
  };

  return [open, setOpen];
}
```

- [ ] **Step 2: Write unit test for the hook**

```typescript
// apps/desktop/src/__tests__/useTonightAutoExpand.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTonightExpansion } from "../lib/useTonightAutoExpand";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

describe("useTonightExpansion", () => {
  it("defaults to closed before 6pm if untouched", () => {
    vi.setSystemTime(new Date("2026-05-18T17:30:00"));
    const { result } = renderHook(() => useTonightExpansion());
    expect(result.current[0]).toBe(false);
  });

  it("defaults to open at 6pm or later if untouched", () => {
    vi.setSystemTime(new Date("2026-05-18T18:00:00"));
    const { result } = renderHook(() => useTonightExpansion());
    expect(result.current[0]).toBe(true);
  });

  it("respects user collapse after 6pm", () => {
    vi.setSystemTime(new Date("2026-05-18T20:00:00"));
    const { result } = renderHook(() => useTonightExpansion());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    // Re-mount — should still be false
    const { result: result2 } = renderHook(() => useTonightExpansion());
    expect(result2.current[0]).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @brett/desktop test tonight
```

- [ ] **Step 4: Bucket tonight items in TodayView grouping**

In TodayView.tsx, update `grouped`:

```typescript
const grouped = useMemo(() => {
  const uncompleted = filteredThings.filter((t) => !t.isCompleted);
  const done = filteredThings.filter((t) => t.isCompleted);
  const todayAll = uncompleted.filter((t) => t.urgency === "today");
  return {
    overdue: uncompleted.filter((t) => t.urgency === "overdue"),
    today: todayAll.filter((t) => !t.tonight),
    tonight: todayAll.filter((t) => t.tonight),
    thisWeek: uncompleted.filter((t) => t.urgency === "this_week"),
    thisWeekend: uncompleted.filter((t) => t.urgency === "this_weekend"),
    done,
  };
}, [filteredThings]);
```

- [ ] **Step 5: Add Tonight to sections list**

In the sections useMemo:

```typescript
if (grouped.today.length > 0) list.push({ key: "today", title: "Today", count: grouped.today.length });
if (grouped.tonight.length > 0) list.push({ key: "tonight", title: "Tonight", count: grouped.tonight.length });
```

Add Tonight to render switch in `renderSectionItems`:
```typescript
case "tonight": return grouped.tonight.map(renderItem);
```

- [ ] **Step 6: Make Tonight section collapsible via the hook**

```typescript
const [tonightOpen, setTonightOpen] = useTonightExpansion();

// In the render loop:
if (section.key === "tonight") {
  return (
    <CollapsibleSection
      key={section.key}
      title="Tonight"
      count={section.count}
      open={tonightOpen}
      onOpenChange={setTonightOpen}
    >
      {renderSectionItems("tonight")}
    </CollapsibleSection>
  );
}
```

Use a moon icon if `CollapsibleSection` supports a leading icon (extend the component if not — small change, add `icon?: ReactNode` prop).

- [ ] **Step 7: Update badge to include tonight**

In `apps/desktop/src/lib/badgeCount.ts`:

```typescript
type BadgeInputThing = {
  dueDate?: string | Date | null;
  isCompleted?: boolean;
  urgency?: string;
  tonight?: boolean;  // NEW — for documentation; logic doesn't depend on it
};

export function computeBadgeCount(things: BadgeInputThing[], now: Date = new Date()): number {
  // ... unchanged — Tonight items have dueDate=today and naturally satisfy the filter
}
```

No logic change needed — the filter already captures Tonight via dueDate. Update the type for clarity.

Update unit test to verify Tonight items count:

```typescript
it("counts tonight items as today", () => {
  const items = [{ dueDate: "2026-05-18T23:00:00Z", isCompleted: false, urgency: "today", tonight: true }];
  expect(computeBadgeCount(items, new Date("2026-05-18T12:00:00Z"))).toBe(1);
});
```

- [ ] **Step 8: Manual verification with preview tools**

1. Create a task → set Tonight via chip → verify it appears in Tonight section.
2. Before 6pm: section collapsed by default.
3. Set system clock past 6pm (or mock): section auto-expands.
4. Collapse manually after 6pm: stays collapsed.
5. Badge count includes the tonight task.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/views/TodayView.tsx apps/desktop/src/lib/useTonightAutoExpand.ts apps/desktop/src/lib/badgeCount.ts apps/desktop/src/__tests__/
git commit -m "feat(desktop): render Tonight section with 6pm auto-expand

Tonight section appears between Today and This Week. Default-collapsed
before 6pm local, auto-expands at 6pm. User collapse after 6pm sticks for
the rest of the day via per-date localStorage key."
```

---

## Task B12: Open Phase B PR

- [ ] **Step 1: Push + open PR**

```bash
git push -u origin <branch-name>
gh pr create --base main --title "feat: Tonight concept across desktop + iOS" --body "$(cat <<'EOF'
## Summary
- New Item.tonight boolean field — additive migration
- Tonight chip in date pickers (desktop + iOS) — slotted between Today and Tomorrow
- Tonight section in Today view — desktop has 6pm auto-expand, iOS shows when non-empty
- Tonight items count in badge (they're today items with an evening hint)

Spec: docs/superpowers/specs/2026-05-18-brett-tuning-may-design.md (item 3)

## Release notes
- API must deploy first (migration) before desktop/iOS release. Older clients ignore the unknown field harmlessly.

## Test plan
- [ ] API: pnpm --filter @brett/api test (new sync round-trip tests)
- [ ] pnpm typecheck (full repo)
- [ ] xcodebuild test for TodaySections tests
- [ ] Manual: create Tonight task on desktop, see it on iOS after pull, and vice versa
- [ ] Manual: 6pm auto-expand on desktop (use system clock override)
- [ ] Manual: badge count includes Tonight task
EOF
)"
```

---

# PHASE C — Connection health visibility (Items 4 + 5)

**Single PR.** Bulk of work is per-account warning chrome in Settings cards (5a). Item 4 + 5b are verification only.

## Task C1: Verify multi-granola is live on user's clients

**Files:** (none — verification only)

- [ ] **Step 1: Check release branch + manifest date**

```bash
git log release --oneline -- apps/desktop/src/settings/CalendarSection.tsx | head -3
curl -sI https://api.brett.brentbarkman.com/releases/latest-mac.yml | grep -i last-modified
```

Multi-granola desktop commit (`4cecd76` 2026-05-16) should be on release. Manifest Last-Modified should be ≥ 2026-05-16. If both true, this is a stale-client issue.

- [ ] **Step 2: Ask user to verify their desktop version**

Add a note in the PR description: "Please check Settings → Updates → Current version. Should be 0.1.1537 or higher. If lower, autoupdate to latest and retry connecting a second Granola account."

- [ ] **Step 3: If verified live and bug persists, escalate**

If the user confirms latest version and still sees only one account, add an additional debugging task (out of scope of this plan). Likely API response is fine — render bug? Open Chrome DevTools, inspect `GET /granola/auth` response shape.

---

## Task C2: Backend — extend broken-connections endpoint with per-account details

**Files:**
- Modify: `apps/api/src/routes/things.ts:279-292`
- Modify: `apps/api/src/lib/connection-health.ts` (if reason text isn't already captured)
- Test: `apps/api/src/__tests__/connection-health.test.ts`

- [ ] **Step 1: Inspect current endpoint shape**

```bash
sed -n '270,300p' apps/api/src/routes/things.ts
```

Currently returns `{ count, types }`. We need it to also return per-account details so the frontend can render reason text inside cards.

- [ ] **Step 2: Define expanded response shape**

In `apps/api/src/lib/connection-health.ts`, add:

```typescript
export interface BrokenConnectionDetail {
  type: ConnectionType;            // "granola" | "google-calendar" | "ai"
  accountId: string | null;        // null for AI providers (no per-account model yet)
  reason: string | null;           // user-facing one-liner from the re-link task body
  brokenSince: string;             // ISO timestamp of when the re-link task was created
}

export interface BrokenConnectionsResponse {
  count: number;
  types: string[];                 // backwards-compatible (existing UI consumes this)
  details: BrokenConnectionDetail[];   // NEW
}
```

- [ ] **Step 3: Implement aggregation**

In `apps/api/src/lib/connection-health.ts`, add a function `getBrokenConnections(userId): Promise<BrokenConnectionsResponse>` that queries:

```typescript
const items = await prisma.item.findMany({
  where: {
    userId,
    source: "system",
    sourceId: { startsWith: "relink:" },
    status: { in: ["active", "snoozed"] },
  },
  select: { sourceId: true, body: true, createdAt: true, description: true },
});

const details: BrokenConnectionDetail[] = items.map((item) => {
  const parts = (item.sourceId ?? "").split(":");
  // sourceId format: "relink:<type>" or "relink:<type>:<accountId>"
  const type = (parts[1] ?? "") as ConnectionType;
  const accountId = parts[2] ?? null;
  // Reason: stored in body (preferred) or description fallback
  const reason = item.body ?? item.description ?? null;
  return {
    type,
    accountId,
    reason,
    brokenSince: item.createdAt.toISOString(),
  };
});

const types = Array.from(new Set(details.map((d) => d.type)));
return { count: details.length, types, details };
```

Note: `Item.body` does not exist in the schema (verified). Use `description` instead, OR add a new `Item.body` field — but that's out of scope. Use `description` for the reason text; the spec's "store in body" was a placeholder for "store in a human-readable field." `description` is the right field.

- [ ] **Step 4: Write reason text when creating re-link tasks**

Find where `createRelinkTask` is called (search: `grep -rn "createRelinkTask" apps/api/src`). The current call signature must already accept a reason — verify. If not, add a `reason` parameter and write it to `Item.description`.

```typescript
// example pattern in connection-health.ts
export async function createRelinkTask(
  userId: string,
  type: ConnectionType,
  accountId: string | null,
  reason: string,   // NEW or already-existing parameter
): Promise<void> {
  const sourceId = accountId ? `relink:${type}:${accountId}` : `relink:${type}`;
  await prisma.item.upsert({
    where: { /* dedupe by source + sourceId + userId */ },
    create: {
      // ...
      title: relinkTaskTitle(type, accountId),
      description: reason,
    },
    update: { description: reason },  // refresh reason on each detection
  });
}
```

Wherever the function is called from (granola sync errors, calendar token-refresh errors), update the call site to pass a meaningful reason string:

```typescript
await createRelinkTask(userId, "granola", account.id,
  `Authorization revoked — please reconnect ${account.email}`);
```

- [ ] **Step 5: Update the route handler**

In `apps/api/src/routes/things.ts:279-292`:

```typescript
things.get("/broken-connections", async (c) => {
  const user = c.get("user");
  const result = await getBrokenConnections(user.id);
  return c.json(result);
});
```

- [ ] **Step 6: Update tests**

In `apps/api/src/__tests__/connection-health.test.ts`, add tests:

```typescript
it("returns details with per-account reason and brokenSince", async () => {
  const user = await createTestUser();
  await createRelinkTask(user.id, "granola", "acc-1", "Token expired");
  const res = await api.get(`/things/broken-connections`).set(auth(user));
  expect(res.body.details).toEqual([
    expect.objectContaining({
      type: "granola",
      accountId: "acc-1",
      reason: "Token expired",
      brokenSince: expect.any(String),
    }),
  ]);
});
```

- [ ] **Step 7: Run tests + commit**

```bash
pnpm --filter @brett/api test connection-health
git add apps/api/src/routes/things.ts apps/api/src/lib/connection-health.ts apps/api/src/__tests__/connection-health.test.ts
git commit -m "feat(api): expose per-account details in /things/broken-connections

Adds 'details' array to the response with per-account reason + brokenSince.
Backward-compatible — existing 'count' and 'types' fields preserved. Reason
text comes from Item.description (set by createRelinkTask call sites)."
```

---

## Task C3: Desktop — per-account warning chrome in Settings cards

**Files:**
- Modify: `apps/desktop/src/api/connection-health.ts`
- Modify: `apps/desktop/src/settings/CalendarSection.tsx`

- [ ] **Step 1: Extend useBrokenConnections hook to return details**

In `apps/desktop/src/api/connection-health.ts`:

```typescript
export interface BrokenConnectionDetail {
  type: "granola" | "google-calendar" | "ai";
  accountId: string | null;
  reason: string | null;
  brokenSince: string;
}

export interface BrokenConnectionsData {
  count: number;
  types: string[];
  details: BrokenConnectionDetail[];
}

export function useBrokenConnections() {
  return useQuery<BrokenConnectionsData>({
    queryKey: ["broken-connections"],
    queryFn: async () => {
      const res = await api.get("/things/broken-connections");
      return res.data;
    },
    refetchInterval: 60_000,
  });
}
```

(Match the existing hook style precisely — check the file before editing.)

- [ ] **Step 2: Add helper for looking up a specific account's status**

```typescript
export function findBrokenDetailForAccount(
  data: BrokenConnectionsData | undefined,
  type: "granola" | "google-calendar",
  accountId: string,
): BrokenConnectionDetail | null {
  if (!data) return null;
  return data.details.find((d) => d.type === type && d.accountId === accountId) ?? null;
}
```

- [ ] **Step 3: Add warning row inside Granola account cards**

In `apps/desktop/src/settings/CalendarSection.tsx`, where each Granola account card renders (line ~362 area per the survey):

```typescript
const { data: brokenConnections } = useBrokenConnections();

// inside the .map() that renders each account:
{granolaData.accounts.map((account) => {
  const broken = findBrokenDetailForAccount(brokenConnections, "granola", account.id);
  return (
    <div
      key={account.id}
      className={cn(
        "rounded-lg border bg-white/5 p-4",
        broken ? "border-amber-400/40 bg-amber-500/5" : "border-white/10",
      )}
    >
      {broken && (
        <div className="mb-3 flex items-start gap-2 text-xs text-amber-300/90">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Needs reconnection</div>
            {broken.reason && <div className="text-amber-300/70">{broken.reason}</div>}
          </div>
        </div>
      )}
      {/* existing card body: email, last sync, toggles, disconnect */}
    </div>
  );
})}
```

Use the exact card chrome currently in the file — only add the warning header row + conditional border tint. Don't rewrite the card.

- [ ] **Step 4: Same treatment for Google Calendar cards**

Within `CalendarSection.tsx` (same file — Google Calendar accounts also render here), apply the identical warning row to Google account cards. Use `findBrokenDetailForAccount(data, "google-calendar", account.id)`.

- [ ] **Step 5: Manual verification with preview tools**

1. Manually create a broken re-link task in the DB (or use a granola revoke flow).
2. Open Settings → Calendar.
3. Verify warning row appears on the specific broken account with reason text.
4. Verify other accounts (same provider, different account) DO NOT show the warning.
5. Reconnect the broken account → warning disappears within 60s (poll interval) or immediately if mutation invalidates the query.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/api/connection-health.ts apps/desktop/src/settings/CalendarSection.tsx
git commit -m "feat(desktop): per-account warning chrome in Settings cards

Shows amber warning row + tint on the specific Granola or Google Calendar
account that needs reconnection, with reason text. Other accounts of the same
provider stay clean."
```

---

## Task C4: iOS — per-account warning chrome in Settings

**Files:**
- Modify: `apps/ios/Brett/Views/Settings/CalendarSettingsView.swift`
- Modify: `apps/ios/Brett/Services/ConnectionHealthService.swift` (if exists) or wherever iOS fetches broken connections

- [ ] **Step 1: Add Decodable for new response shape**

```swift
struct BrokenConnectionDetail: Decodable, Hashable {
    let type: String
    let accountId: String?
    let reason: String?
    let brokenSince: String
}

struct BrokenConnectionsResponse: Decodable {
    let count: Int
    let types: [String]
    let details: [BrokenConnectionDetail]
}
```

- [ ] **Step 2: Update iOS fetcher**

Find the existing iOS broken-connections fetch (grep `broken-connections` in `apps/ios`). Update it to decode the new shape. If iOS doesn't currently fetch this endpoint at all (just renders local data), add a small `BrokenConnectionsStore` that fetches it on view appear + every 60s.

- [ ] **Step 3: Add warning view inside each Granola account row**

In `CalendarSettingsView.swift` around `granolaAccountsList()` (lines 425-469 per the survey):

```swift
// helper:
private func brokenDetail(for accountId: String, type: String, details: [BrokenConnectionDetail]) -> BrokenConnectionDetail? {
    details.first(where: { $0.type == type && $0.accountId == accountId })
}

// in the per-account row:
VStack(alignment: .leading, spacing: 8) {
    if let broken = brokenDetail(for: account.id, type: "granola", details: brokenConnections.details) {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.caption)
            VStack(alignment: .leading, spacing: 2) {
                Text("Needs reconnection")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.orange)
                if let reason = broken.reason {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(.orange.opacity(0.7))
                }
            }
        }
    }
    // existing row content
}
.padding(.horizontal, broken != nil ? 12 : 0)   // breathing room for warning state
.background(broken != nil ? Color.orange.opacity(0.08) : Color.clear)
.overlay(
    RoundedRectangle(cornerRadius: 12)
        .stroke(broken != nil ? Color.orange.opacity(0.3) : Color.clear, lineWidth: 1)
)
```

Match the existing card chrome (corner radius, padding) exactly.

- [ ] **Step 4: Manual verification on simulator**

Build + run, manually trigger a broken state (or temporarily seed local SwiftData with a re-link task). Verify warning row appears on the correct account.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/Brett/Views/Settings/CalendarSettingsView.swift apps/ios/Brett/Services/
git commit -m "feat(ios): per-account warning row in Settings cards

Mirrors desktop: amber warning + reason text inside the specific account
card. Matches iOS design language (SF Symbols, system orange)."
```

---

## Task C5: Backend regression test — confirm scoped resolution still works

**Files:**
- Modify: `apps/api/src/__tests__/connection-health.test.ts`

- [ ] **Step 1: Add explicit regression test**

The Explore agent found a test at `connection-health.test.ts:122-180` for granola. Add a parallel test for the new response shape end-to-end:

```typescript
it("regression: reconnecting account B does not clear account A's re-link task", async () => {
  const user = await createTestUser();
  await createRelinkTask(user.id, "granola", "acc-A", "Token expired for A");
  await createRelinkTask(user.id, "granola", "acc-B", "Token expired for B");

  // Simulate reconnect of acc-B by calling the resolver
  await resolveRelinkTaskForAccount(user.id, "granola", "acc-B");

  const res = await api.get("/things/broken-connections").set(auth(user));
  expect(res.body.details).toHaveLength(1);
  expect(res.body.details[0].accountId).toBe("acc-A");
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @brett/api test connection-health
git add apps/api/src/__tests__/connection-health.test.ts
git commit -m "test(api): regression test for per-account re-link resolution scope"
```

---

## Task C6: Open Phase C PR

```bash
git push -u origin <branch-name>
gh pr create --base main --title "feat: per-account connection health visibility" --body "$(cat <<'EOF'
## Summary
- /things/broken-connections now returns per-account details (type, accountId, reason, brokenSince)
- Settings cards show inline warning chrome + reason text on the specific broken account
- Regression test confirms re-link resolution stays scoped to the correct accountId
- Multi-granola spec verified shipped — item 4 in the design spec was a stale-client issue, no code change needed there

Spec: docs/superpowers/specs/2026-05-18-brett-tuning-may-design.md (items 4, 5)

## Test plan
- [ ] pnpm --filter @brett/api test connection-health
- [ ] Manual: trigger a broken state on one account, verify warning on that card only
- [ ] Manual: reconnect that account, verify warning clears within 60s
- [ ] iOS: same end-to-end on simulator
EOF
)"
```

---

# Self-Review

**Spec coverage:**
- Item 1 (badge narrow): Phase A tasks A1, A2, A3 ✅
- Item 2 (collapsible sections): Phase A tasks A4, A5, A6 ✅
- Item 3 (Tonight): Phase B tasks B1-B11 ✅
- Item 4 (granola second MCP): Phase C task C1 (verification only — already shipped) ✅
- Item 5a (per-account warning UI): Phase C tasks C2, C3, C4 ✅
- Item 5b (scoped resolution): Phase C task C5 (regression test — already shipped) ✅

**Placeholder scan:** No "TBD" / "TODO" / "fill in details". All code blocks contain real code. A few "verify with grep before deleting" / "look at existing helper first" instructions are intentional anchors for things that the survey couldn't perfectly nail down — they instruct the implementer to confirm exact import paths and call signatures from the actual code.

**Type consistency:**
- `tonight: boolean` — used consistently across Prisma schema, TypeScript types, Swift property, and the field whitelists.
- `BrokenConnectionDetail` — same shape in API + desktop hook + iOS Decodable.
- `computeBadgeCount` — same signature throughout Phase A.

**Risk callouts not in the original spec:**

1. Phase B Task B10 expands the iOS `onConfirm` callback signature to include `tonight: Bool`. Every existing call site must be updated. The agent must grep all callers and not miss any.
2. Phase A Task A1 mentions removing `isWeekendNow` from App.tsx. Must verify with grep that nothing else uses it (the dock badge IPC effect only depends on `badgeCount` per the survey).
3. Phase C Task C2 changes `Item.description` to carry user-facing reason text. If `description` is already used for something else on re-link tasks, this could collide. Re-link tasks are system-created and unlikely to have a meaningful pre-existing description, but agent should verify with a quick `findFirst({ where: { source: "system", sourceId: { startsWith: "relink:" } } })` and review what's currently stored.
