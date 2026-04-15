# Background Phase 2 — Glass & Scrim Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every content surface legible on any background by raising card opacity to `bg-black/40` and adding a single full-viewport radial vignette scrim layer, plus restructure the existing linear vignettes in `LivingBackground`.

**Architecture:** Introduce one new component (`BackgroundScrim`) that mounts between `LivingBackground` and app content. Modify `LivingBackground.tsx` to drop the bottom linear vignette and reduce the top. Globally replace `bg-black/30` → `bg-black/40` across all content-card surfaces (19 sites across 15 files).

**Tech Stack:** React 19 (with React Compiler — do NOT add useMemo/useCallback), Tailwind, Vite, Vitest for tests.

**Reference spec:** [`docs/superpowers/specs/2026-04-14-background-system-audit-design.md`](../specs/2026-04-14-background-system-audit-design.md) — Phase 2 section.

---

## File Structure

**New files:**
- `packages/ui/src/BackgroundScrim.tsx` — the radial vignette overlay component
- `packages/ui/src/__tests__/BackgroundScrim.test.tsx` — smoke test

**Modified files:**
- `packages/ui/src/index.ts` — export `BackgroundScrim`
- `packages/ui/src/LivingBackground.tsx` — restructure linear vignettes
- `apps/desktop/src/App.tsx` — mount `BackgroundScrim` above `LivingBackground`
- 15 files containing `bg-black/30 backdrop-blur-xl` → `bg-black/40 backdrop-blur-xl` (listed in Task 5)
- `docs/DESIGN_GUIDE.md` — update opacity reference if present

---

## Task 1: Create `BackgroundScrim` component

**Files:**
- Create: `packages/ui/src/BackgroundScrim.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/ui/src/BackgroundScrim.tsx

/**
 * Full-viewport radial vignette that sits between LivingBackground and
 * app content. Darkens the outer edges (especially the bottom-right where
 * there's no sidebar chrome) so glass cards have enough contrast with
 * whatever image or gradient is behind them.
 *
 * Centered at 30% from left / 45% from top to bias toward the content
 * area (sidebar lives on the left, content is slightly above center).
 *
 * Static by design — no animation. Ambient chrome.
 */
export function BackgroundScrim() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          "radial-gradient(ellipse at 30% 45%, transparent 0%, rgba(0,0,0,0.25) 75%)",
      }}
    />
  );
}
```

- [ ] **Step 2: Run typecheck to verify it compiles**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/exciting-chatelet
pnpm --filter @brett/ui typecheck
```

Expected: no errors.

---

## Task 2: Export `BackgroundScrim` from the UI package

**Files:**
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Find the existing LivingBackground export and add BackgroundScrim next to it**

```bash
grep -n "LivingBackground" packages/ui/src/index.ts
```

- [ ] **Step 2: Add the export**

In `packages/ui/src/index.ts`, add a line matching the existing pattern, e.g. if `LivingBackground` is exported as:

```typescript
export { LivingBackground } from "./LivingBackground";
```

Add directly below it:

```typescript
export { BackgroundScrim } from "./BackgroundScrim";
```

- [ ] **Step 3: Verify the export works**

```bash
pnpm --filter @brett/ui typecheck
pnpm --filter @brett/desktop typecheck
```

Expected: both pass.

---

## Task 3: Write a smoke test for `BackgroundScrim`

**Files:**
- Create: `packages/ui/src/__tests__/BackgroundScrim.test.tsx`

- [ ] **Step 1: Check how other UI tests are set up**

```bash
ls packages/ui/src/__tests__/ 2>/dev/null || ls packages/ui/__tests__/ 2>/dev/null
cat packages/ui/vitest.config.ts 2>/dev/null || cat packages/ui/package.json | grep -A2 '"test"'
```

- [ ] **Step 2: Write the failing test**

```tsx
// packages/ui/src/__tests__/BackgroundScrim.test.tsx

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BackgroundScrim } from "../BackgroundScrim";

describe("BackgroundScrim", () => {
  it("renders an aria-hidden absolute full-viewport overlay", () => {
    const { container } = render(<BackgroundScrim />);
    const div = container.firstChild as HTMLDivElement;

    expect(div).toBeTruthy();
    expect(div.getAttribute("aria-hidden")).toBe("true");
    expect(div.className).toContain("absolute");
    expect(div.className).toContain("inset-0");
    expect(div.className).toContain("pointer-events-none");
  });

  it("has a radial-gradient background centered at 30%/45%", () => {
    const { container } = render(<BackgroundScrim />);
    const div = container.firstChild as HTMLDivElement;

    expect(div.style.background).toContain("radial-gradient");
    expect(div.style.background).toContain("30% 45%");
    expect(div.style.background).toContain("rgba(0, 0, 0, 0.25)");
  });
});
```

Note: JSDOM normalizes `rgba(0,0,0,0.25)` → `rgba(0, 0, 0, 0.25)` with spaces. The test uses the normalized form.

- [ ] **Step 3: Run the test**

```bash
cd packages/ui && pnpm test BackgroundScrim.test
```

Expected: PASS (both tests).

- [ ] **Step 4: Commit**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/exciting-chatelet
git add packages/ui/src/BackgroundScrim.tsx packages/ui/src/__tests__/BackgroundScrim.test.tsx packages/ui/src/index.ts
git commit -m "$(cat <<'EOF'
feat(ui): add BackgroundScrim radial vignette component

Introduces a static full-viewport radial vignette that sits between
LivingBackground and app content. Biases darkening toward outer edges
so content cards have reliable contrast on any background image.

Part of Phase 2 (glass & scrim polish) in the background audit spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Mount `BackgroundScrim` in `App.tsx`

**Files:**
- Modify: `apps/desktop/src/App.tsx` (around line 33 for import, line 943 for mount)

- [ ] **Step 1: Add `BackgroundScrim` to the import from `@brett/ui`**

Find the existing `LivingBackground` import in `apps/desktop/src/App.tsx` (currently at line 33) and add `BackgroundScrim` to the same import block:

```tsx
import {
  // ...existing imports,
  LivingBackground,
  BackgroundScrim,
  // ...existing imports,
} from "@brett/ui";
```

- [ ] **Step 2: Mount `BackgroundScrim` directly after `LivingBackground`**

In `apps/desktop/src/App.tsx` around line 937-943, the current structure is:

```tsx
<div className="relative flex h-screen w-full overflow-hidden text-white font-sans bg-black">
  <LivingBackground
    imageUrl={background.imageUrl}
    nextImageUrl={background.nextImageUrl}
    isTransitioning={background.isTransitioning}
    gradient={background.gradient}
    nextGradient={background.nextGradient}
  />
```

Change to:

```tsx
<div className="relative flex h-screen w-full overflow-hidden text-white font-sans bg-black">
  <LivingBackground
    imageUrl={background.imageUrl}
    nextImageUrl={background.nextImageUrl}
    isTransitioning={background.isTransitioning}
    gradient={background.gradient}
    nextGradient={background.nextGradient}
  />
  <BackgroundScrim />
```

`BackgroundScrim` is `absolute inset-0` with no z-index, so it stacks naturally above `LivingBackground` (also `absolute inset-0 z-0`) but below the app shell (`.relative.z-10` at line 951).

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @brett/desktop typecheck
```

Expected: pass.

- [ ] **Step 4: Start the dev server and do a visual smoke test**

```bash
pnpm dev:desktop
```

Open the desktop app. Verify:
- Content cards are still visible
- Background images still show
- Edges of the viewport feel subtly darker (especially bottom-right)
- No visible banding or pixelation from the radial gradient

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): mount BackgroundScrim above LivingBackground

Adds the full-viewport radial vignette overlay to the main shell.
BackgroundScrim sits absolute inset-0 naturally above LivingBackground
(also absolute inset-0 z-0) and below the app content layer (z-10).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Raise content-card opacity from `bg-black/30` → `bg-black/40`

**Files (15 files, 19 sites):**

Packages/ui:
- `packages/ui/src/Skeleton.tsx:27`
- `packages/ui/src/ThingsEmptyState.tsx:49`
- `packages/ui/src/ThingsEmptyState.tsx:59`
- `packages/ui/src/CalendarTimeline.tsx:177`
- `packages/ui/src/CalendarTimeline.tsx:365`
- `packages/ui/src/ThingsList.tsx:112`
- `packages/ui/src/ItemListShell.tsx:15`
- `packages/ui/src/ScoutsRoster.tsx:44`
- `packages/ui/src/RecentFindingsPanel.tsx:29`
- `packages/ui/src/RecentFindingsPanel.tsx:50`
- `packages/ui/src/RecentFindingsPanel.tsx:62`
- `packages/ui/src/ScoutDetail.tsx:157`
- `packages/ui/src/ScoutDetail.tsx:179`

Apps/desktop:
- `apps/desktop/src/pages/CalendarPage.tsx:137`
- `apps/desktop/src/pages/CalendarPage.tsx:253`
- `apps/desktop/src/views/ListView.tsx:118`
- `apps/desktop/src/views/TodayView.tsx:190`
- `apps/desktop/src/views/NotFoundView.tsx:23`
- `apps/desktop/src/components/calendar/CalendarHeader.tsx:111`
- `apps/desktop/src/settings/SettingsComponents.tsx:20`

Code-comment reference (update for accuracy, not style):
- `apps/desktop/src/data/abstract-gradients.ts:8` — contains the comment "The glass surfaces (bg-black/30 backdrop-blur-xl)"; update to `bg-black/40`.

- [ ] **Step 1: Verify the full list with grep**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/exciting-chatelet
grep -rn "bg-black/30" packages/ui/src apps/desktop/src 2>/dev/null
```

Compare output against the list above. There should be exactly 20 matches (19 `bg-black/30 backdrop-blur-xl` + 1 comment in `abstract-gradients.ts`).

- [ ] **Step 2: Do the replacement — every content-card surface**

For each file in the list, change every `bg-black/30 backdrop-blur-xl` to `bg-black/40 backdrop-blur-xl`. Also change the comment in `abstract-gradients.ts`.

The Edit tool's `replace_all: true` can do this per-file. In order:

```
packages/ui/src/Skeleton.tsx
packages/ui/src/ThingsEmptyState.tsx
packages/ui/src/CalendarTimeline.tsx
packages/ui/src/ThingsList.tsx
packages/ui/src/ItemListShell.tsx
packages/ui/src/ScoutsRoster.tsx
packages/ui/src/RecentFindingsPanel.tsx
packages/ui/src/ScoutDetail.tsx
apps/desktop/src/pages/CalendarPage.tsx
apps/desktop/src/views/ListView.tsx
apps/desktop/src/views/TodayView.tsx
apps/desktop/src/views/NotFoundView.tsx
apps/desktop/src/components/calendar/CalendarHeader.tsx
apps/desktop/src/settings/SettingsComponents.tsx
apps/desktop/src/data/abstract-gradients.ts
```

For each, replace `bg-black/30` with `bg-black/40` using `replace_all: true`.

- [ ] **Step 3: Verify no `bg-black/30` remains in those files**

```bash
grep -rn "bg-black/30" packages/ui/src apps/desktop/src 2>/dev/null | wc -l
```

Expected: `0`.

Then check the broader codebase for any stragglers in other places (tests, storybook, etc.) that should NOT change:

```bash
grep -rn "bg-black/30" --include="*.ts" --include="*.tsx" . 2>/dev/null
```

If any matches appear in locations that are clearly not content cards (modal backdrops, test fixtures, overlays with legitimate different opacity), leave them alone and document.

- [ ] **Step 4: Audit hover states — interactive/elevated states should step up one notch**

Some components have `hover:bg-black/40` as an elevated state over `bg-black/30`. With the base moving to `bg-black/40`, the hover should step to `bg-black/50` to maintain contrast. Search for this pattern:

```bash
grep -rn "hover:bg-black/40\|hover:bg-black/30" packages/ui/src apps/desktop/src 2>/dev/null
```

For each match: if it was `hover:bg-black/40` paired with a `bg-black/30` base that is now `bg-black/40`, change the hover to `hover:bg-black/50`. If no pairing exists, leave it.

- [ ] **Step 5: Typecheck + run tests**

```bash
pnpm --filter @brett/ui typecheck
pnpm --filter @brett/desktop typecheck
pnpm --filter @brett/ui test --run
pnpm --filter @brett/desktop test --run
```

Expected: all green.

- [ ] **Step 6: Visual smoke test**

```bash
pnpm dev:desktop
```

Walk through these views with the dev server running:
- Today view
- Inbox
- Calendar
- A custom list
- Scouts roster + detail
- Settings

On each, cards should feel slightly more present against the background — not muddy, but more clearly "on top of" the image. If any card now looks like a solid-black brick (over-opaque), note it; otherwise proceed.

- [ ] **Step 7: Commit**

```bash
git add -A packages/ui/src apps/desktop/src
git commit -m "$(cat <<'EOF'
style(ui): raise content-card opacity bg-black/30 to /40

Improves legibility of content cards on bright backgrounds. Base
surfaces step up one notch from /30 to /40; hover states where
applicable step from /40 to /50 to preserve interactive hierarchy.

Applied to 19 card surfaces across 14 files in packages/ui and
apps/desktop. Also updates the code comment in abstract-gradients.ts
for accuracy.

Part of Phase 2 (glass & scrim polish) in the background audit spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Restructure `LivingBackground` linear vignettes

**Files:**
- Modify: `packages/ui/src/LivingBackground.tsx` (lines 72-73)

- [ ] **Step 1: Make the change**

In `packages/ui/src/LivingBackground.tsx`, the current readability overlays block (lines 69-75) is:

```tsx
{/* Readability overlays — only for images, not solid colors */}
{!useGradients && (
  <>
    <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />
    <div className="absolute inset-y-0 left-0 w-[312px] bg-gradient-to-r from-black/60 to-transparent pointer-events-none" />
  </>
)}
```

Change to:

```tsx
{/* Readability overlays — only for images, not solid colors.
 *
 * Linear gradients here complement BackgroundScrim (mounted above
 * LivingBackground in App.tsx) which provides the full-viewport radial
 * darkening. These linears serve purposes the radial doesn't:
 *
 * - Top gradient: contrast behind the macOS traffic-light window chrome
 *   (reduced from to-black/40 → to-black/30 now that the scrim sits on top)
 * - Left gradient: darkens behind the fixed sidebar nav (unchanged)
 *
 * Bottom gradient removed — the radial scrim handles bottom-edge
 * darkening and doubling up muddied night scenes.
 */}
{!useGradients && (
  <>
    <div className="absolute inset-x-0 top-0 h-[40%] bg-gradient-to-b from-black/30 to-transparent pointer-events-none" />
    <div className="absolute inset-y-0 left-0 w-[312px] bg-gradient-to-r from-black/60 to-transparent pointer-events-none" />
  </>
)}
```

Rationale for the changes:
1. Dropped bottom gradient entirely.
2. Top gradient: was `from-black/40 via-transparent to-black/60` covering full height; now `from-black/30 to-transparent` covering only top 40%. This keeps macOS traffic-light contrast without darkening the content area.
3. Left sidebar gradient: unchanged.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @brett/ui typecheck
```

Expected: pass.

- [ ] **Step 3: Visual smoke test — night scene check**

```bash
pnpm dev:desktop
```

In Settings → Background, pin a night-scene image (one of the darkest ones available). The content area should NOT feel muddy or crushed. The top 40% should have subtle darkening behind the traffic-light buttons. Bottom half should be clean, with darkening coming only from the radial scrim.

Then pin a bright-sky image. Verify traffic-light contrast is acceptable.

**If the night scene feels too dark:** tune the radial scrim peak opacity in `BackgroundScrim.tsx` down from `0.25` to `0.20`. Re-test.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/LivingBackground.tsx
git commit -m "$(cat <<'EOF'
style(ui): restructure LivingBackground linear vignettes

Drop the full-height bottom-darkening linear gradient (now handled by
BackgroundScrim's radial vignette) and reduce the top gradient to
cover only the top 40% at to-black/30, just enough for macOS traffic-
light button contrast. Left sidebar scrim unchanged.

Prevents linear+radial compounding that muddied night scenes.

Part of Phase 2 (glass & scrim polish) in the background audit spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `docs/DESIGN_GUIDE.md` if it references opacity values

**Files:**
- Modify: `docs/DESIGN_GUIDE.md` (if it contains `bg-black/30`)

- [ ] **Step 1: Check the design guide for opacity references**

```bash
grep -n "bg-black/30\|bg-black/40" docs/DESIGN_GUIDE.md 2>/dev/null
```

- [ ] **Step 2: Update any `bg-black/30` references to `bg-black/40`**

Use Edit with `replace_all: true` on `docs/DESIGN_GUIDE.md`.

If the guide describes the opacity philosophy (e.g., "content cards sit at 30% opacity"), update the prose to match: "content cards sit at 40% opacity, with a full-viewport radial scrim providing edge darkening."

- [ ] **Step 3: Commit (only if anything changed)**

```bash
git add docs/DESIGN_GUIDE.md
git commit -m "$(cat <<'EOF'
docs: update DESIGN_GUIDE for bg-black/40 content cards

Aligns the design guide with the Phase 2 scrim + opacity update.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

If nothing changed, skip this step.

---

## Task 8: Final verification matrix

**No code changes; pure verification.**

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev:desktop
```

- [ ] **Step 2: Walk the 5-background matrix**

For each of the 5 background categories below, pin one image in Settings → Background → (pin mode) and verify legibility across all primary views:

| Category | How to find | What to check |
|---|---|---|
| Bright afternoon sky | Afternoon / Light-day pool | Cards visible, text readable without squinting |
| Dark forest / night | Night or Golden-hour packed pool | Not muddy, no crushed blacks |
| Golden-hour warm | Golden-hour pool | Glass cards don't disappear into warm tones |
| Bright abstract gradient | Abstract → light tier | Same as bright sky — cards present, readable |
| Night abstract | Abstract → night segment | Not muddy |

Views to check on each: Today, Inbox, Calendar, a list, Scouts, Settings.

Any view where text is hard to read or a card disappears is a failure — note the specific view + background combination.

- [ ] **Step 3: Summary check**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green.

- [ ] **Step 4: Update memory — mark the readability fix as shipped**

```bash
# This is conceptual — the actual update is to the memory file.
# Memory file: /Users/brentbarkman/.claude/projects/-Users-brentbarkman-code-brett/memory/project_background_readability.md
# The "Fix plan (approved but not yet implemented)" section should be removed or
# marked as SHIPPED with the current date (2026-04-14), and the file should
# reflect current state (bg-black/40 + radial scrim).
```

---

## Self-Review — Spec Coverage

Spec Phase 2 section requires:
- ✅ Bump content-card opacity `bg-black/30` → `bg-black/40` → Task 5
- ✅ Full-viewport radial vignette scrim, static → Task 1 + Task 4
- ✅ Drop bottom linear vignette → Task 6
- ✅ Reduce top linear vignette from `to-black/40` to `to-black/30` → Task 6
- ✅ Keep left sidebar scrim → Task 6 (unchanged)
- ✅ Interactive/hover states step up one notch (`/40` → `/50`) → Task 5 Step 4
- ✅ Verify night scene doesn't over-dim → Task 6 Step 3 + Task 8
- ✅ Verification matrix (bright sky, dark forest, golden hour, night, abstract) → Task 8

No gaps.
