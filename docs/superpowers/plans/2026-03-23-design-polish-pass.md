# Design Polish Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the new design persona and judgment heuristics from DESIGN_GUIDE.md across the app — removing noise, adding personality, improving animations, and adding inline confirmation and actionable tooltips.

**Architecture:** Pure frontend changes across `packages/ui/src/` and `apps/desktop/src/`. No backend, no API changes, no new dependencies. All changes are React component edits, CSS animation additions, and copy rewrites.

**Tech Stack:** React, TypeScript, Tailwind CSS, CSS keyframes, lucide-react

**Design Reference:** Read `docs/DESIGN_GUIDE.md` — especially the "Design Persona & Judgment Heuristics" section — before starting any task.

---

## File Map

| File | Changes |
|------|---------|
| `packages/ui/src/TaskDetailPanel.tsx` | Remove List/Source badges |
| `packages/ui/src/ContentDetailPanel.tsx` | Remove List/Source badges |
| `packages/ui/src/ThingCard.tsx` | Remove metadata subtitle line, add staleness tooltip |
| `packages/ui/src/ThingsEmptyState.tsx` | Rewrite all empty state copy with Brett's voice |
| `packages/ui/src/InboxView.tsx` | Rewrite inbox empty state copy |
| `apps/desktop/src/views/UpcomingView.tsx` | Rewrite upcoming empty state copy |
| `apps/desktop/src/views/NotFoundView.tsx` | Rewrite 404 with Brett's dry wit (no emojis) |
| `packages/ui/src/ContentPreview.tsx` | Rewrite error state to be clinical with escalation path |
| `packages/ui/src/animations.css` | Add Things 3-style swoosh completion animation |
| `packages/ui/src/ThingCard.tsx` | Wire up swoosh completion animation |
| `packages/ui/src/SectionHeader.tsx` | Refine typography from mono uppercase to refined sans |
| `packages/ui/src/OverflowMenu.tsx` | Add inline delete confirmation (transform pattern) |
| `packages/ui/src/StaleTooltip.tsx` | NEW — actionable tooltip for stale items |

---

### Task 1: Remove List/Source badges from detail panels

**Files:**
- Modify: `packages/ui/src/TaskDetailPanel.tsx:163-171`
- Modify: `packages/ui/src/ContentDetailPanel.tsx:164-172`

These metadata badges ("List: Inbox", "Source: Brett") duplicate information the user already knows from the list they clicked from.

- [ ] **Step 1: Remove metadata badges from TaskDetailPanel**

In `packages/ui/src/TaskDetailPanel.tsx`, delete the entire metadata badges block (the `<div className="flex flex-wrap gap-2">` containing "List: ..." and "Source: ...").

```tsx
// DELETE this entire block (lines 163-171):
{/* Metadata badges */}
<div className="flex flex-wrap gap-2">
  <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70 cursor-pointer hover:bg-white/10 transition-colors">
    List: {detail.list}
  </div>
  <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/40">
    Source: {detail.source}
  </div>
</div>
```

- [ ] **Step 2: Remove metadata badges from ContentDetailPanel**

In `packages/ui/src/ContentDetailPanel.tsx`, delete the same block (lines 164-172):

```tsx
// DELETE this entire block:
{/* Metadata badges */}
<div className="flex flex-wrap gap-2">
  <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70 cursor-pointer hover:bg-white/10 transition-colors">
    List: {detail.list}
  </div>
  <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/40">
    Source: {detail.source}
  </div>
</div>
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: All tasks successful, no errors.

- [ ] **Step 4: Visual verification**

Open the app, click a task in Today view — detail panel should show: type label, title, schedule row, notes, etc. No "List:" or "Source:" pills.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/TaskDetailPanel.tsx packages/ui/src/ContentDetailPanel.tsx
git commit -m "fix: remove duplicative List/Source badges from detail panels"
```

---

### Task 2: Remove metadata subtitle from ThingCard list rows

**Files:**
- Modify: `packages/ui/src/ThingCard.tsx:159-170`

The metadata line showing "Inbox · Brett" or "www.example.com" under each title is noise — the list context is obvious from the view you're in.

- [ ] **Step 1: Remove metadata row from ThingCard**

In `packages/ui/src/ThingCard.tsx`, delete the metadata `<div>` below the title (lines 159-170):

```tsx
// DELETE these lines inside the <div className="flex-1 min-w-0">:
<div className="flex items-center gap-2 mt-0.5">
  <span className={`text-xs truncate ${thing.isCompleted ? "text-white/20" : "text-white/40"}`}>
    {thing.type === "content"
      ? (thing.contentDomain ?? thing.source)
      : `${thing.list} · ${thing.source}`}
  </span>
  {thing.stalenessDays && (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-white/5">
      No update in {thing.stalenessDays} days
    </span>
  )}
</div>
```

Note: The staleness indicator is being moved to an actionable tooltip in Task 8. Don't worry about losing it here.

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`

- [ ] **Step 3: Visual verification**

Open Today view — each card should show only: toggle icon, title, urgency badge. No subtitle line. Cards should feel cleaner and more compact.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ThingCard.tsx
git commit -m "fix: remove metadata subtitle from ThingCard for cleaner density"
```

---

### Task 3: Rewrite empty states with Brett's personality

**Files:**
- Modify: `packages/ui/src/ThingsEmptyState.tsx` (all completed, filter mismatch, brand new)
- Modify: `packages/ui/src/InboxView.tsx:357-370` (inbox empty)
- Modify: `apps/desktop/src/views/UpcomingView.tsx:74-86` (upcoming empty)

Every empty state must be contextual, personality-forward, and smoothly integrated per the design guide.

- [ ] **Step 1: Rewrite ThingsEmptyState — all completed**

In `packages/ui/src/ThingsEmptyState.tsx`, replace the "all completed" content (lines 31-44):

```tsx
// REPLACE the content inside allCompleted block:
<div className="flex flex-col items-center text-center gap-4">
  <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
    <CheckCircle size={22} className="text-green-400" />
  </div>
  <div>
    <h3 className="text-white font-semibold text-base mb-1">
      Cleared.
    </h3>
    <p className="text-white/40 text-sm leading-relaxed max-w-sm">
      Nothing left. Go build something or enjoy the quiet.
    </p>
  </div>
  <InlineTaskAdd lists={lists} onAdd={onAddTask} placeholder="What's next?" />
</div>
```

- [ ] **Step 2: Rewrite ThingsEmptyState — filter mismatch**

Replace the filter mismatch headings/descriptions (lines 67-75):

For content filter:
- Heading: `"No content saved"`
- Description: `"Paste a link to save something worth reading later."`

For task filter:
- Heading: `"No tasks yet"`
- Description: `"Add one, or switch to All to see everything."`

- [ ] **Step 3: Rewrite ThingsEmptyState — brand new user**

Replace the "Everything is a Thing" content (lines 94-99):

```tsx
<h3 className="text-white font-semibold text-base mb-2">
  Start here
</h3>
<p className="text-white/40 text-sm leading-relaxed max-w-md">
  Tasks, links, articles — everything goes in one place.
  Add your first one below.
</p>
```

- [ ] **Step 4: Rewrite Inbox empty state**

In `packages/ui/src/InboxView.tsx`, replace lines 363-367:

```tsx
<h3 className="text-white font-semibold text-base mb-1">Inbox zero</h3>
<p className="text-white/40 text-sm leading-relaxed max-w-xs">
  Nothing to triage. Add something or let Brett find things for you.
</p>
```

- [ ] **Step 5: Rewrite Upcoming empty state**

In `apps/desktop/src/views/UpcomingView.tsx`, replace lines 80-83:

```tsx
<h3 className="text-white font-semibold text-base mb-1">Clear skies ahead</h3>
<p className="text-white/40 text-sm leading-relaxed max-w-xs">
  Nothing scheduled. Set due dates on items to plan your week.
</p>
```

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm typecheck`

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/ThingsEmptyState.tsx packages/ui/src/InboxView.tsx apps/desktop/src/views/UpcomingView.tsx
git commit -m "feat: rewrite empty states with Brett's personality"
```

---

### Task 4: Rewrite 404 page and error states

**Files:**
- Modify: `apps/desktop/src/views/NotFoundView.tsx` (full rewrite)
- Modify: `packages/ui/src/ContentPreview.tsx:56-84` (error state)

404 should have Brett's dry wit. Error states should be clinical with an escalation path.

- [ ] **Step 1: Rewrite NotFoundView**

Replace `apps/desktop/src/views/NotFoundView.tsx` entirely:

```tsx
import React from "react";
import { useNavigate } from "react-router-dom";

const messages = [
  { title: "Nothing here", subtitle: "This page doesn't exist. Probably never did." },
  { title: "Dead end", subtitle: "Brett doesn't know this place either." },
  { title: "Page not found", subtitle: "Check the URL or head back to something real." },
];

export function NotFoundView() {
  const navigate = useNavigate();
  const msg = messages[Math.floor(Math.random() * messages.length)];

  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8 text-center max-w-sm">
        <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-white/30 text-sm font-mono">404</span>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">{msg.title}</h1>
        <p className="text-sm text-white/40 mb-6">{msg.subtitle}</p>
        <button
          onClick={() => navigate("/today")}
          className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 hover:text-blue-300 border border-blue-500/20 text-sm font-medium transition-colors"
        >
          Back to Today
        </button>
      </div>
    </div>
  );
}
```

Key changes: No emojis. Dry, direct copy. Monospace "404" in a subtle circle instead of emoji. "Back to Today" instead of "Take me home".

- [ ] **Step 2: Rewrite ContentPreview error state**

In `packages/ui/src/ContentPreview.tsx`, replace the `ErrorState` function (lines 56-84):

```tsx
function ErrorState({ sourceUrl, onRetry }: { sourceUrl?: string; onRetry?: () => void }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-400/70" />
        <span className="text-sm text-white/50 font-medium">Preview unavailable</span>
      </div>
      {sourceUrl && isSafeHref(sourceUrl) && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400/70 hover:text-blue-400 transition-colors truncate block"
        >
          Open original →
        </a>
      )}
      <div className="flex items-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
          >
            <RefreshCw size={12} />
            Try again
          </button>
        )}
        <span className="text-[10px] text-white/25">
          If this persists, ask Brett to report it.
        </span>
      </div>
    </div>
  );
}
```

Key changes: "Preview unavailable" (clinical). Source link becomes "Open original →" (actionable). Escalation path: "If this persists, ask Brett to report it." No cute language.

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/views/NotFoundView.tsx packages/ui/src/ContentPreview.tsx
git commit -m "fix: rewrite 404 and error states — dry wit, clinical errors"
```

---

### Task 5: Things 3-style swoosh completion animation

**Files:**
- Modify: `packages/ui/src/animations.css` (add new keyframes)
- Modify: `packages/ui/src/ThingCard.tsx` (wire up swoosh animation)

Current completion: green pulse ring, item stays in place. Target: check pops, then row compresses vertically with a satisfying slide and fades. Must not block rapid-fire completion of multiple items.

- [ ] **Step 1: Add swoosh keyframes to animations.css**

Append to `packages/ui/src/animations.css`:

```css
/* Things 3-style swoosh — row compresses and fades after check pop */
@keyframes swooshOut {
  0% {
    max-height: 56px;
    opacity: 1;
    transform: translateX(0);
    margin-bottom: 8px;
  }
  40% {
    opacity: 0.5;
    transform: translateX(12px);
  }
  100% {
    max-height: 0;
    opacity: 0;
    transform: translateX(24px);
    margin-bottom: 0;
    padding-top: 0;
    padding-bottom: 0;
  }
}
```

- [ ] **Step 2: Wire up swoosh animation in ThingCard**

In `packages/ui/src/ThingCard.tsx`, modify the completion flow:

1. Add a `swooshing` state (separate from `completing`):

```tsx
const [swooshing, setSwooshing] = useState(false);
```

2. Update the `handleToggleClick` callback to chain: check pop (400ms) → swoosh (350ms) → call onToggle:

```tsx
const handleToggleClick = useCallback(
  (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggle || completing || swooshing) return;

    if (!thing.isCompleted) {
      setCompleting(true);
      timerRef.current = setTimeout(() => {
        setCompleting(false);
        setSwooshing(true);
        // After swoosh animation, fire the actual toggle
        timerRef.current = setTimeout(() => {
          onToggle(thing.id);
          setSwooshing(false);
        }, 350);
      }, 500);
    } else {
      onToggle(thing.id);
    }
  },
  [onToggle, thing.id, thing.isCompleted, completing, swooshing],
);
```

3. Apply swoosh animation style to the outer `<div>`:

```tsx
style={swooshing ? {
  animation: "swooshOut 350ms cubic-bezier(0.4, 0, 1, 1) forwards",
  overflow: "hidden",
  pointerEvents: "none" as const,
} : undefined}
```

4. Add `swooshing` to the dependency check: `if (!onToggle || completing || swooshing) return;`

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`

- [ ] **Step 4: Visual verification**

Open Today view, complete a task. Expected behavior:
1. Check icon pops (400ms)
2. Row slides right slightly, compresses vertically, and fades out (350ms)
3. Row removed from DOM after animation
4. Completing multiple tasks rapidly should work — each gets its own animation

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/animations.css packages/ui/src/ThingCard.tsx
git commit -m "feat: Things 3-style swoosh completion animation"
```

---

### Task 6: Refine section header typography

**Files:**
- Modify: `packages/ui/src/SectionHeader.tsx`

Current `font-mono uppercase tracking-wider` feels like a developer tool. Shift toward SF Pro neutrality — sans-serif, subtle small-caps feel, lighter weight.

- [ ] **Step 1: Update SectionHeader typography**

In `packages/ui/src/SectionHeader.tsx`, replace the heading className:

```tsx
// FROM:
<h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold flex-shrink-0">

// TO:
<h3 className="text-[11px] uppercase tracking-widest text-white/30 font-medium flex-shrink-0">
```

Changes:
- `font-mono` → system sans (inherits from body) — less developer-tool
- `text-xs` (12px) → `text-[11px]` — slightly smaller for elegance
- `tracking-wider` → `tracking-widest` — more air between letters, closer to small-caps feel
- `text-white/40` → `text-white/30` — slightly more recessive, the content is the star
- `font-semibold` → `font-medium` — lighter weight, less shouty

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`

- [ ] **Step 3: Visual verification**

Open Today view — section headers ("TODAY", "DONE TODAY") should feel more refined and recessive. They should organize without demanding attention.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/SectionHeader.tsx
git commit -m "refactor: refine section header typography — less developer-tool, more editorial"
```

---

### Task 7: Actionable staleness tooltip

**Files:**
- Create: `packages/ui/src/StaleTooltip.tsx`
- Modify: `packages/ui/src/ThingCard.tsx` (add tooltip trigger)

Tooltips should suggest action, not just describe state. A stale item gets "This has been sitting for 14 days. Complete it or delete it."

- [ ] **Step 1: Create StaleTooltip component**

Create `packages/ui/src/StaleTooltip.tsx`:

```tsx
import React, { useState } from "react";

interface StaleTooltipProps {
  days: number;
  children: React.ReactNode;
}

export function StaleTooltip({ days, children }: StaleTooltipProps) {
  const [visible, setVisible] = useState(false);

  const getMessage = () => {
    if (days >= 14) return `${days} days untouched. Do something or delete it.`;
    if (days >= 7) return `Sitting here for ${days} days. Still relevant?`;
    return `No updates in ${days} days.`;
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-black/80 backdrop-blur-xl border border-white/10 shadow-xl z-50 whitespace-nowrap">
          <span className="text-[11px] text-white/70">{getMessage()}</span>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-black/80 border-r border-b border-white/10 rotate-45 -mt-1" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add staleness indicator to ThingCard**

In `packages/ui/src/ThingCard.tsx`:

1. Import: `import { StaleTooltip } from "./StaleTooltip";`

2. Add a subtle staleness dot next to the title (inside `<div className="flex-1 min-w-0">`), after the `<h4>` title element:

```tsx
<div className="flex-1 min-w-0 flex items-center gap-2">
  <h4
    className={`text-sm font-medium truncate transition-all duration-300 ${
      thing.isCompleted || completing
        ? "line-through text-white/40"
        : "text-white"
    }`}
  >
    {thing.title}
  </h4>
  {thing.stalenessDays && !thing.isCompleted && (
    <StaleTooltip days={thing.stalenessDays}>
      <div className="w-1.5 h-1.5 rounded-full bg-amber-500/60 flex-shrink-0" />
    </StaleTooltip>
  )}
</div>
```

Note: This replaces the old metadata subtitle line (already removed in Task 2). The staleness indicator is now a subtle amber dot that reveals an actionable tooltip on hover.

- [ ] **Step 3: Export StaleTooltip from index**

In `packages/ui/src/index.ts`, add: `export { StaleTooltip } from "./StaleTooltip";`

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm typecheck`

- [ ] **Step 5: Visual verification**

Open Today view — stale items should show a small amber dot next to the title. Hovering should show a tooltip with actionable copy like "14 days untouched. Do something or delete it."

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/StaleTooltip.tsx packages/ui/src/ThingCard.tsx packages/ui/src/index.ts
git commit -m "feat: actionable staleness tooltips with Brett's personality"
```

---

### Task 8: Inline delete confirmation in OverflowMenu

**Files:**
- Modify: `packages/ui/src/OverflowMenu.tsx`

Delete should use the inline transformation pattern (the calendar disconnect pattern is the gold standard). Click Delete → row transforms to "Delete this? [Confirm] [Cancel]" in the same space.

- [ ] **Step 1: Add inline confirmation to OverflowMenu**

Replace `packages/ui/src/OverflowMenu.tsx` with:

```tsx
import React, { useState, useRef } from "react";
import { MoreHorizontal, Trash2, Copy, ArrowRight, Link2 } from "lucide-react";
import { useClickOutside } from "./useClickOutside";

interface OverflowMenuProps {
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToList: () => void;
  onCopyLink: () => void;
}

export function OverflowMenu({
  onDelete,
  onDuplicate,
  onMoveToList,
  onCopyLink,
}: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => { setIsOpen(false); setConfirming(false); });

  const items: {
    icon: typeof Copy;
    label: string;
    action: () => void;
    danger?: boolean;
  }[] = [
    { icon: Copy, label: "Duplicate", action: onDuplicate },
    { icon: ArrowRight, label: "Move to List\u2026", action: onMoveToList },
    { icon: Link2, label: "Copy Link", action: onCopyLink },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 shadow-xl z-10 py-1">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.action();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-white/80 hover:bg-white/10"
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}

          {/* Delete with inline confirmation */}
          <div className="border-t border-white/5 mt-1 pt-1">
            {confirming ? (
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-xs text-red-400">Delete this?</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      onDelete();
                      setIsOpen(false);
                      setConfirming(false);
                    }}
                    className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/20 hover:bg-red-500/30 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-2 py-0.5 rounded text-xs font-medium text-white/40 hover:text-white/60 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-red-400 hover:bg-red-500/10"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

Key changes:
- Delete is separated with a subtle divider
- Clicking Delete transforms that row into "Delete this? [Delete] [Cancel]"
- Confirm button is red, cancel is ghost
- Clicking outside or Cancel reverts to normal state

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`

- [ ] **Step 3: Visual verification**

Open a detail panel, click the overflow menu (⋯), click Delete. The delete row should transform into a confirmation. Click Cancel — it should revert. Click Delete again then Confirm — the item should be deleted.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/OverflowMenu.tsx
git commit -m "feat: inline delete confirmation — transform pattern, no modals"
```

---

## Future Recommendations (not implemented here)

These are documented in `docs/DESIGN_GUIDE.md` under "Design Persona & Judgment Heuristics" and should each be planned separately. Each is a standalone feature that needs its own brainstorming + plan.

### 1. Dynamic Backgrounds / Data-as-Art
**Priority:** High — this is the Apple Weather differentiator
**Scope:** The background should not be static. Source different images and have them shift based on:
- Time of day (warm tones at sunset, cool/dark at night, crisp at dawn)
- Season and weather (integrate with existing weather data in the omnibar)
- Workload (calm day = more breathing room, packed day = denser, more focused feel)
**Key decision:** Whether backgrounds are local assets, API-sourced (Unsplash?), or generative. Consider performance — background changes should be smooth crossfades, never jarring.

### 2. Time-of-Day Personality System
**Priority:** High — core to Brett's character
**Scope:** Brett's voice and energy should shift throughout the day:
- **Morning:** Energetic, forward-looking. "Here's what's ahead."
- **Afternoon:** Focused, supportive. Progress-aware.
- **Evening:** Chill, reflective. "You got through a lot today."
- **Late night:** Minimal, calm. Don't be loud.
**Affects:** Morning briefing tone, empty state copy, greeting copy, Brett's Take observations. Requires a time-aware copy system (not hardcoded strings — a function that takes time + context and returns appropriate copy).

### 3. Zen Mode
**Priority:** Medium — distinct visual mode, not a settings toggle
**Scope:** A holistic visual transformation: softer fonts, Japanese-inspired aesthetic, rounder edges, more pastel colors. Think: the app takes a breath. This is a MODE, not a theme — it changes the entire feel, not just colors.
**Key decision:** How to enter/exit. Keyboard shortcut? Menu option? Automatic based on time?

### 4. Font Size / Density Preferences
**Priority:** Medium — power user feature
**Scope:** User setting for compact / comfortable / spacious density. Affects spacing scale, font sizes, card padding. NOT typeface switching (that's a design decision, not a user setting).
**Implementation:** CSS custom properties on `:root` that scale the spacing/type system. A single `--density` variable that cascades through the design tokens.

### 5. Context-Aware Empty States
**Priority:** Medium — extends the personality system
**Scope:** Empty states should be aware of WHY they're empty and respond differently:
- Fresh start (no completed tasks): "Nothing but focus today. Let's get it."
- Earned empty (completed 8 tasks through 6 hours of meetings): "Nice work — you got 8 things done while getting through 6 hours of meetings. Have a glass of wine, you earned it."
- Requires: completion count tracking, calendar event awareness, time-of-day context.
**Depends on:** Time-of-day personality system (#2), calendar integration data.

### 6. Things 3-Style Swoosh Cascade
**Priority:** Low — polish item
**Scope:** When rapid-fire completion freeze lifts, items should cascade out one by one (staggered 50ms each) instead of disappearing in one batch. On mobile (future): combine with haptic feedback.
**Current state:** Deferred toggle batch works. The visual exit is abrupt (items just disappear). Adding a staggered slide-out cascade would make it feel premium.
