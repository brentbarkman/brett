# Design Audit Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 20 design polish fixes from the comprehensive visual audit to bring Brett's UI from "nice dark app" to award-winning quality.

**Architecture:** All changes are frontend-only — CSS/styling updates, new lightweight components (Toast, EmptyState variants), and minor prop additions. No API changes, no data model changes. Changes span `packages/ui/src/` (shared components) and `apps/desktop/src/` (app-specific views/pages).

**Tech Stack:** React, Tailwind CSS, lucide-react, CSS keyframes

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/ui/src/InboxView.tsx` | Modify | Rich empty state (icon + copy + CTA) |
| `apps/desktop/src/views/UpcomingView.tsx` | Modify | Rich empty state |
| `apps/desktop/src/views/ListView.tsx` | Modify | Rich empty state |
| `apps/desktop/index.html` | Modify | Add favicon link tag |
| `apps/desktop/public/favicon.svg` | Create | SVG favicon |
| `packages/ui/src/LeftNav.tsx` | Modify | Active nav indicator, avatar colors, LISTS padding |
| `packages/ui/src/ThingCard.tsx` | Modify | Completed styling, hover lift |
| `packages/ui/src/Toast.tsx` | Create | Toast notification component |
| `packages/ui/src/index.ts` | Modify | Export Toast |
| `apps/desktop/src/App.tsx` | Modify | Mount ToastProvider |
| `packages/ui/src/ItemListShell.tsx` | Modify | Polish keyboard shortcut bar |
| `packages/ui/src/FilterPills.tsx` | Modify | Subtler active state |
| `packages/ui/src/ContentPreview.tsx` | Modify | Softer error state |
| `packages/ui/src/ContentDetailPanel.tsx` | Modify | Fix redundant CONTENT label |
| `packages/ui/src/BrettThread.tsx` | Modify | Hide (0) count |
| `packages/ui/src/QuickAddInput.tsx` | Modify | Context-aware placeholder |
| `apps/desktop/src/settings/SettingsPage.tsx` | Modify | Bottom padding |
| `apps/desktop/src/pages/CalendarPage.tsx` | Modify | Ghost header date numbers |
| `packages/ui/src/avatarColor.ts` | Create | Shared avatar color helper |
| `packages/ui/src/InboxItemRow.tsx` | Modify | Hover lift |

---

### Task 1: Favicon

**Files:**
- Create: `apps/desktop/public/favicon.svg`
- Modify: `apps/desktop/index.html`

- [ ] **Step 1: Create SVG favicon**

Create `apps/desktop/public/favicon.svg` — a simple "B" in a rounded blue square matching the Brett logo in the nav:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#3B82F6"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="system-ui,-apple-system,sans-serif" font-size="18" font-weight="700">B</text>
</svg>
```

- [ ] **Step 2: Add favicon to index.html**

In `apps/desktop/index.html`, add inside `<head>`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

- [ ] **Step 3: Verify** — Reload browser, check tab icon and no more 404 console error.

- [ ] **Step 4: Commit**

---

### Task 2: Empty States — Inbox, Upcoming, ListView

**Files:**
- Modify: `packages/ui/src/InboxView.tsx:357-365`
- Modify: `apps/desktop/src/views/UpcomingView.tsx:74-79`
- Modify: `apps/desktop/src/views/ListView.tsx:260-270`

Each empty state should follow the same pattern as ThingsEmptyState: icon in colored badge circle + heading + subtitle. No inline CTA needed (quick-add input is already above).

- [ ] **Step 1: Fix Inbox empty state**

Replace the bare text in `InboxView.tsx` (lines 357-365) with:

```tsx
{isEmpty && (
  <div className="flex flex-col items-center justify-center py-16 gap-4">
    <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
      <Inbox size={22} className="text-blue-400" />
    </div>
    <div className="text-center">
      <h3 className="text-white font-semibold text-base mb-1">Your triage zone</h3>
      <p className="text-white/40 text-sm leading-relaxed max-w-xs">
        Items land here first. Triage them to lists with due dates when you're ready.
      </p>
    </div>
  </div>
)}
```

Add `Inbox` to the lucide-react imports at the top of InboxView.tsx if not already imported.

- [ ] **Step 2: Fix Upcoming empty state**

Replace the bare text in `UpcomingView.tsx` (lines 74-79) with:

```tsx
{allItems.length === 0 && (
  <div className="flex flex-col items-center justify-center py-16 gap-4">
    <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
      <Clock size={22} className="text-white/40" />
    </div>
    <div className="text-center">
      <h3 className="text-white font-semibold text-base mb-1">Nothing on the horizon</h3>
      <p className="text-white/40 text-sm leading-relaxed max-w-xs">
        Assign due dates to items in your inbox or lists to see them here.
      </p>
    </div>
  </div>
)}
```

Ensure `Clock` is imported from lucide-react.

- [ ] **Step 3: Fix ListView empty state**

Replace the bare text in `ListView.tsx` (lines 261-270) with:

```tsx
{!isLoading && things.length === 0 && (
  <div className="flex flex-col items-center justify-center py-16 gap-4">
    <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
      <Sparkles size={22} className="text-white/40" />
    </div>
    <div className="text-center">
      <h3 className="text-white font-semibold text-base mb-1">Nothing here yet</h3>
      <p className="text-white/40 text-sm leading-relaxed max-w-xs">
        {isArchived ? "This list has been archived." : "Add tasks or save links to start building this list."}
      </p>
    </div>
  </div>
)}
```

Ensure `Sparkles` is imported from lucide-react.

- [ ] **Step 4: Verify** — Navigate to each view (Inbox, Upcoming, empty list) and confirm the rich empty states render.

- [ ] **Step 5: Commit**

---

### Task 3: Active Nav Indicator

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx:537-568` (NavItem function)
- Modify: `packages/ui/src/LeftNav.tsx:357-367` (SortableListItem active state)

The NavItem button uses `rounded-lg` — adding `border-l-2` directly would clip inside the rounded corners and look broken. Instead, use a positioned pseudo-element via Tailwind's `before:` utilities for a clean left accent bar. Apply the same treatment to SortableListItem for visual consistency.

- [ ] **Step 1: Add pseudo-element accent to active NavItem**

In the NavItem function (lines 537-568), update the button element. Add `relative` to the base classes, then use `before:` pseudo-element for the accent:

```tsx
<button
  onClick={onClick}
  className={`
    flex items-center w-full rounded-lg transition-colors duration-200 group relative
    ${isCollapsed ? "justify-center p-2.5" : "px-2 py-1.5 gap-3"}
    ${isActive
      ? "bg-white/10 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-blue-500 before:rounded-full"
      : "text-white/60 hover:bg-white/5 hover:text-white/90"
    }
  `}
>
```

- [ ] **Step 2: Apply same accent to SortableListItem**

In SortableListItem (lines 357-367), update the active state similarly. Add `relative` and the `before:` accent:

```tsx
${
  isOver
    ? `${dropHighlight} border border-white/20 text-white`
    : isActive
      ? "bg-white/10 text-white border border-transparent relative before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-blue-500 before:rounded-full"
      : "text-white/60 hover:bg-white/5 hover:text-white/90 border border-transparent"
}
```

- [ ] **Step 3: Verify** — Check that the active nav item (e.g., "Today") shows a blue left accent bar that sits cleanly inside the rounded corners, and switching between views moves it. Also verify that clicking a list in the left nav shows the same accent.

- [ ] **Step 4: Commit**

---

### Task 4: Completed Task Styling

**Files:**
- Modify: `packages/ui/src/ThingCard.tsx:97,150-158,173-184`

- [ ] **Step 1: Reduce completed card opacity and mute badge**

In ThingCard.tsx:

Line 97 — change completed opacity from `opacity-50` to `opacity-60` (slightly more visible but still clearly muted):
```tsx
${thing.isCompleted && !completing ? "opacity-60" : "opacity-100"}
```

Lines 150-158 — the title already uses `text-white/40` when completed, which is good. Keep as-is.

Lines 173-184 — mute the urgency badge when completed. Wrap the badge rendering:
```tsx
<div className="flex-shrink-0 flex items-center gap-2">
  {thing.dueDateLabel ? (
    <div
      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
        thing.isCompleted
          ? "bg-white/5 text-white/30 border border-white/5"
          : getUrgencyColor()
      }`}
    >
      {thing.dueDateLabel}
    </div>
  ) : (
    <div className="w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
      <Calendar size={14} className="text-white/30" />
    </div>
  )}
</div>
```

- [ ] **Step 2: Verify** — Complete a task on Today view. Confirm badge is muted gray, text is dimmed with strikethrough.

- [ ] **Step 3: Commit**

---

### Task 5: Card Hover Lift

**Files:**
- Modify: `packages/ui/src/ThingCard.tsx:88-99`

- [ ] **Step 1: Add translateY lift on hover**

In the card's className (lines 88-99), add the hover lift to the non-completing, non-focused state:

```tsx
${completing
  ? "bg-green-500/[0.03] border-green-500/15"
  : isFocused
    ? "bg-white/10 border-blue-500/30"
    : "bg-white/5 hover:bg-white/10 hover:-translate-y-[1px] hover:shadow-lg border-white/5 hover:border-white/10"
}
```

Also ensure `transition-all` is on the card (it already is at line 90).

- [ ] **Step 2: Apply same hover lift to InboxItemRow**

In `packages/ui/src/InboxItemRow.tsx` (lines 82-91), add `hover:-translate-y-[1px] hover:shadow-lg` to the default (non-focused, non-selected) hover state:

```tsx
// Default state (line ~89):
"border border-transparent hover:bg-white/[0.06] hover:-translate-y-[1px] hover:shadow-lg"
```

- [ ] **Step 3: Verify** — Hover over task cards on Today and Inbox. Confirm the subtle lift + shadow effect on both.

- [ ] **Step 4: Commit**

---

### Task 6: Keyboard Shortcut Bar Polish

**Files:**
- Modify: `packages/ui/src/ItemListShell.tsx:26-31`

- [ ] **Step 1: Restyle the keyboard hints bar**

Replace lines 26-31 with a container that has a glass background and styled key hints:

```tsx
{hints && hints.length > 0 && (
  <div className="flex items-center justify-center gap-3 text-[10px] text-white/30 font-mono bg-black/20 backdrop-blur-sm rounded-lg px-4 py-2 mx-auto w-fit">
    {hints.map((hint) => {
      // Split hint into key and description (e.g., "j/k navigate" → "j/k" + "navigate")
      const spaceIdx = hint.indexOf(" ");
      if (spaceIdx === -1) return <span key={hint}>{hint}</span>;
      const key = hint.slice(0, spaceIdx);
      const desc = hint.slice(spaceIdx + 1);
      return (
        <span key={hint} className="flex items-center gap-1">
          <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-white/50 text-[10px]">{key}</kbd>
          <span>{desc}</span>
        </span>
      );
    })}
  </div>
)}
```

- [ ] **Step 2: Verify** — Check the keyboard bar on Today view and Inbox with items. Keys should appear as little styled kbd elements.

- [ ] **Step 3: Commit**

---

### Task 7: Filter Pills — Subtler Active State

**Files:**
- Modify: `packages/ui/src/FilterPills.tsx:22-25`

Note: `FilterPills` (used in TodayView's main content) is distinct from `TypeFilter` (used in Inbox/Upcoming/List headers). `TypeFilter` already has subtle styling (`bg-white/10 text-white/80` active state) — no changes needed there. Only `FilterPills` needs toning down.

- [ ] **Step 1: Change active pill from bright blue to subtle white**

Replace the active/inactive classes (lines 22-25):

```tsx
${
  isActive
    ? "bg-white/15 text-white border border-white/20"
    : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/80"
}
```

- [ ] **Step 2: Verify** — Check Today view. The "All" pill should be a subtle white highlight, not a bright blue button.

- [ ] **Step 3: Commit**

---

### Task 8: Content Error State — Softer Styling

**Files:**
- Modify: `packages/ui/src/ContentPreview.tsx:56-84`

- [ ] **Step 1: Soften the error state colors**

Replace the ErrorState function's container styling (line 58):

```tsx
<div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
  <div className="flex items-center gap-2">
    <AlertTriangle size={16} className="text-amber-400/70" />
    <span className="text-sm text-white/50 font-medium">Couldn't load preview</span>
  </div>
```

Change the icon color from `text-red-400` to `text-amber-400/70` and the text from `text-red-400` to `text-white/50`. This keeps it informative without the alarming red.

- [ ] **Step 2: Verify** — Open the content detail panel for the example.com item. Error state should be muted glass, not bright red.

- [ ] **Step 3: Commit**

---

### Task 9: Detail Panel — Fix Redundant Type Label

**Files:**
- Modify: `packages/ui/src/ContentDetailPanel.tsx:105-108`

- [ ] **Step 1: Change top-left label from "CONTENT" to "DETAIL"**

In ContentDetailPanel.tsx, find the type label section (around line 105-108). Change the text from "Content" to "Detail" but keep the amber color (per the design guide's "color as category" principle — amber = content):

```tsx
// From:
<span className="font-mono text-xs uppercase tracking-wider text-amber-400 font-semibold">
  Content
</span>

// To:
<span className="font-mono text-xs uppercase tracking-wider text-amber-400 font-semibold">
  Detail
</span>
```

This removes the redundant "CONTENT" double-labeling while preserving the color signal that tells users this is a content item.

- [ ] **Step 2: Verify** — Open a content detail panel. Top-left should say "DETAIL" in amber. The content type badge below the title still carries the type information.

- [ ] **Step 3: Commit**

---

### Task 10: Brett Thread — Hide Zero Count

**Files:**
- Modify: `packages/ui/src/BrettThread.tsx:126-128`

- [ ] **Step 1: Conditionally show count**

Change line 127 from:

```tsx
Brett Thread ({totalCount ?? messages.length})
```

To:

```tsx
Brett Thread{(totalCount ?? messages.length) > 0 ? ` (${totalCount ?? messages.length})` : ""}
```

- [ ] **Step 2: Verify** — Open a task detail with no Brett messages. Thread header should say "Brett Thread" without "(0)".

- [ ] **Step 3: Commit**

---

### Task 11: Settings Page Bottom Padding

**Files:**
- Modify: `apps/desktop/src/settings/SettingsPage.tsx:15-16`

- [ ] **Step 1: Add bottom padding**

Change line 16 from:

```tsx
<div className="max-w-xl mx-auto w-full space-y-5 px-4">
```

To:

```tsx
<div className="max-w-xl mx-auto w-full space-y-5 px-4 pb-12">
```

- [ ] **Step 2: Verify** — Scroll to bottom of Settings. Delete account card should have generous spacing below it.

- [ ] **Step 3: Commit**

---

### Task 12: LISTS Section Label Padding

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx:159`

- [ ] **Step 1: Increase left padding on LISTS label**

The Lists section header already has `px-2` (line 159). Increase to `px-3` to match the nav item indentation:

```tsx
<div className="flex items-center justify-between px-3 mb-3">
```

- [ ] **Step 2: Verify** — Check that "LISTS" label aligns better with the nav items above.

- [ ] **Step 3: Commit**

---

### Task 13: Profile Avatar Deterministic Colors

**Files:**
- Create: `packages/ui/src/avatarColor.ts` (shared helper)
- Modify: `packages/ui/src/index.ts` (export helper)
- Modify: `packages/ui/src/LeftNav.tsx:239-244`
- Modify: `apps/desktop/src/settings/ProfileSection.tsx:51-56`

Extract the color helper to a shared module so both LeftNav and ProfileSection can use it without duplication.

- [ ] **Step 1: Create shared avatar color helper**

Create `packages/ui/src/avatarColor.ts`:

```tsx
const AVATAR_COLORS = [
  "bg-blue-500/30 text-blue-300",
  "bg-purple-500/30 text-purple-300",
  "bg-green-500/30 text-green-300",
  "bg-amber-500/30 text-amber-300",
  "bg-pink-500/30 text-pink-300",
  "bg-cyan-500/30 text-cyan-300",
  "bg-indigo-500/30 text-indigo-300",
  "bg-rose-500/30 text-rose-300",
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
```

- [ ] **Step 2: Export from packages/ui**

Add to `packages/ui/src/index.ts`:
```tsx
export { getAvatarColor } from "./avatarColor";
```

- [ ] **Step 3: Use in LeftNav avatar**

In `packages/ui/src/LeftNav.tsx`, import `getAvatarColor` from `./avatarColor` and replace lines 240-244:

```tsx
<div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${getAvatarColor(user.name || user.email)}`}>
  <span className="text-[10px] font-bold">
    {(user.name || user.email)[0].toUpperCase()}
  </span>
</div>
```

- [ ] **Step 4: Use in ProfileSection avatar**

In `apps/desktop/src/settings/ProfileSection.tsx`, import `getAvatarColor` from `@brett/ui` and replace lines 52-56:

```tsx
<div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ${getAvatarColor(user?.name || user?.email || "?")}`}>
  <span className="text-xl font-bold">
    {(user?.name || user?.email || "?")[0].toUpperCase()}
  </span>
</div>
```

- [ ] **Step 5: Verify** — Check left nav footer and Settings page. Avatar should have a colored background (deterministic per user name).

- [ ] **Step 6: Commit**

---

### Task 14: Calendar Ghost Header — Add Date Numbers

**Files:**
- Modify: `apps/desktop/src/pages/CalendarPage.tsx:136-143`

- [ ] **Step 1: Add date numbers to ghost week header**

Replace the ghost header (lines 136-143). The ghost calendar already knows about `todayDow`, so compute actual dates:

```tsx
{/* Week header — ghost with real dates */}
<div className="flex border-b border-white/10">
  <div className="w-14 flex-shrink-0" />
  {ghostDays.map((day, i) => {
    // Compute actual date for this column
    const now = new Date();
    const currentDow = now.getDay();
    const diff = i - currentDow;
    const date = new Date(now);
    date.setDate(date.getDate() + diff);
    const dayNum = date.getDate();
    const isToday = i === todayDow;

    return (
      <div key={day} className={`flex-1 py-2 text-center ${i < 6 ? "border-r border-white/5" : ""}`}>
        <div className={`text-[10px] font-medium uppercase tracking-wider ${isToday ? "text-white/60" : "text-white/30"}`}>
          {day}
        </div>
        <div className={`text-lg font-semibold mt-0.5 ${
          isToday
            ? "text-blue-400"
            : "text-white/20"
        }`}>
          {dayNum}
        </div>
      </div>
    );
  })}
</div>
```

- [ ] **Step 2: Verify** — Navigate to Calendar page (without connected calendar). Should show day names AND date numbers, with today highlighted in blue.

- [ ] **Step 3: Commit**

---

### Task 15: Toast Notification System

**Files:**
- Create: `packages/ui/src/Toast.tsx`
- Modify: `packages/ui/src/index.ts` (add export)
- Modify: `apps/desktop/src/App.tsx` (mount ToastContainer)
- Modify: various view files to call `showToast()` on mutations

This is the largest task. Build a minimal, zero-dependency toast component matching the glass aesthetic.

- [ ] **Step 1: Create Toast component**

Create `packages/ui/src/Toast.tsx`:

```tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle, X } from "lucide-react";

interface Toast {
  id: string;
  message: string;
  type?: "success" | "info";
}

let addToastFn: ((message: string, type?: "success" | "info") => void) | null = null;

export function showToast(message: string, type: "success" | "info" = "info") {
  addToastFn?.(message, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((message: string, type: "success" | "info" = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 2500);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 shadow-xl"
          style={{ animation: "toastEnter 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
        >
          {toast.type === "success" && (
            <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
          )}
          <span className="text-sm text-white/90 font-medium whitespace-nowrap">{toast.message}</span>
        </div>
      ))}
      <style>{`
        @keyframes toastEnter {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Export from packages/ui**

Add to `packages/ui/src/index.ts`:
```tsx
export { ToastContainer, showToast } from "./Toast";
```

- [ ] **Step 3: Mount ToastContainer in App.tsx**

In `apps/desktop/src/App.tsx`, import and render `<ToastContainer />` at the root level (after the router, before closing div):

```tsx
import { ToastContainer } from "@brett/ui";

// Inside the App return, at the end:
<ToastContainer />
```

- [ ] **Step 4: Add toast calls to key mutations**

All mutation handlers are in `apps/desktop/src/App.tsx`. Import `showToast` from `@brett/ui` and add calls:

- **`handleToggle` (line 342-344):** After `toggleThing.mutate(id)`, the toggle is optimistic. We need to know if it was completing or uncompleting. The simplest approach: don't toast on toggle (it already has the visual checkPop animation as feedback). Skip this one.

- **`handleDeleteThing` (line 378-381):** Add after `deleteThing.mutate(id)`:
  ```tsx
  showToast("Item deleted", "info");
  ```

- **`onCreateList` callback (line ~527):** In the `createList.mutate({ name }, { ... })` call, add `onSuccess`:
  ```tsx
  createList.mutate({ name }, {
    onSuccess: () => showToast("List created", "info"),
  })
  ```

- **`handleInboxArchive` (line 361-363):** Add after `bulkUpdate.mutate(...)`:
  ```tsx
  showToast(`${ids.length} item${ids.length > 1 ? "s" : ""} archived`, "info");
  ```

Keep it minimal — only toast on destructive or structural actions, not every add. The toggle animation is already sufficient feedback for completions.

- [ ] **Step 5: Verify** — Complete a task, add an item, create a list. Confirm glass pill toasts appear at bottom center and auto-dismiss.

- [ ] **Step 6: Commit**

---

### Task 16: Quick-Add Contextual Placeholder

**Files:**
- Modify: `packages/ui/src/ThingsList.tsx:110` — where QuickAddInput is rendered for Today/Upcoming
- Modify: `packages/ui/src/ThingsList.tsx:8-22` — add `activeFilter` to props

`QuickAddInput` already accepts a `placeholder` prop. `ThingsList` renders QuickAddInput at line 110 with a hardcoded `"Add a task..."`. Thread the active filter through so the placeholder is dynamic.

- [ ] **Step 1: Add activeFilter prop to ThingsList**

In `packages/ui/src/ThingsList.tsx`, add `activeFilter?: string` to the `ThingsListProps` interface, and use it when rendering QuickAddInput:

```tsx
// In ThingsListProps interface:
activeFilter?: string;

// Line 110 — change:
<QuickAddInput ref={quickAddRef} placeholder={activeFilter === "Content" ? "Paste a link..." : "Add a task..."} onAdd={(title) => onAdd(title, lists[0]?.id ?? null)} onAddContent={onAddContent} />
```

- [ ] **Step 2: Pass activeFilter from TodayView**

In `apps/desktop/src/views/TodayView.tsx`, find where `ThingsList` is rendered and pass `activeFilter={typeFilter}` (or whatever the filter state variable is called in that view). The filter state is likely from a `useState<FilterType>`.

- [ ] **Step 3: Verify** — Switch to Content filter on Today view. Quick-add should say "Paste a link..."

- [ ] **Step 4: Commit**

---

### Task 17: Minor Polish Bundle

Group the remaining small fixes:

**Files:**
- Modify: `packages/ui/src/ThingCard.tsx:159-164` — metadata line for completed items
- Modify: `packages/ui/src/ContentDetailPanel.tsx` — type badge area

- [ ] **Step 1: Mute metadata on completed ThingCards**

In ThingCard.tsx, the metadata line (lines 159-164) should dim when completed. Change:

```tsx
<span className={`text-xs truncate ${thing.isCompleted ? "text-white/20" : "text-white/40"}`}>
```

- [ ] **Step 2: Verify** — Check completed items in Done Today section. Metadata should be even dimmer than active items.

- [ ] **Step 3: Commit**

---

### Task 18: Typecheck

- [ ] **Step 1: Run `pnpm typecheck`** and fix any TypeScript errors introduced by the above changes.

- [ ] **Step 2: Commit any fixes.**

---

## Execution Notes

- **No tests needed for pure CSS/styling changes.** Visual verification via browser is the appropriate validation.
- **Tasks 1-14 are independent** and can be parallelized across subagents.
- **Task 15 (Toast)** touches multiple files and should run after other tasks to avoid merge conflicts.
- **Task 18 (Typecheck)** must run last as a final gate.
