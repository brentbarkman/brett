# Inline Scout Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the existing omnibar into the scouts roster page for inline scout creation, replacing the "New Scout" button → spotlight modal flow.

**Architecture:** Add a `placeholder` prop to Omnibar, pass omnibar props to ScoutsRoster (same pattern as TodayView), send `currentView: "scouts"` context so Brett defaults to scout creation intent.

**Tech Stack:** React, TypeScript, existing Omnibar component + useOmnibar hook

---

### Task 1: Add `placeholder` prop to Omnibar

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx`

- [ ] **Step 1: Add placeholder to props interface**

Add `placeholder?: string;` to `OmnibarProps` (after line 58).

- [ ] **Step 2: Destructure and use the prop**

Add `placeholder` to the destructured props. Replace the hardcoded placeholder string at line 370:

From:
```tsx
placeholder={forcedAction === "search" ? "Search..." : forcedAction === "create" ? "New task..." : hasAI ? "Ask Brett anything..." : "Create a task or search..."}
```

To:
```tsx
placeholder={placeholder ?? (forcedAction === "search" ? "Search..." : forcedAction === "create" ? "New task..." : hasAI ? "Ask Brett anything..." : "Create a task or search...")}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "feat: add optional placeholder prop to Omnibar"
```

---

### Task 2: Update ScoutsRoster to accept and render inline omnibar

**Files:**
- Modify: `packages/ui/src/ScoutsRoster.tsx`

- [ ] **Step 1: Import Omnibar and update props**

Add import and expand the props interface:

```tsx
import { Omnibar, type OmnibarProps } from "./Omnibar";

interface ScoutsRosterProps {
  scouts: Scout[];
  onSelectScout: (scout: Scout) => void;
  onNewScout?: () => void;  // keep as fallback
  isLoading?: boolean;
  omnibarProps?: OmnibarProps;
}
```

- [ ] **Step 2: Replace the "New Scout" button with inline omnibar**

In the header, replace the `<button onClick={onNewScout}>New Scout</button>` with nothing — remove it entirely. The omnibar goes below the header.

After the header `</div>`, before the loading skeleton, add:

```tsx
{/* Inline scout creation */}
{omnibarProps && (
  <Omnibar
    {...omnibarProps}
    placeholder="What do you want to monitor?"
  />
)}
```

- [ ] **Step 3: Update empty state**

Replace the empty state "Create your first Scout" button to focus the omnibar instead. Change `onClick={onNewScout}` to `onClick={omnibarProps?.onOpen}` and update the text:

```tsx
<button
  onClick={omnibarProps?.onOpen ?? onNewScout}
  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 transition-all duration-200 text-white text-[13px] font-semibold shadow-[0_0_16px_rgba(59,130,246,0.25)]"
>
  <Plus size={15} />
  Create your first Scout
</button>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ScoutsRoster.tsx
git commit -m "feat: embed inline omnibar in ScoutsRoster"
```

---

### Task 3: Wire omnibar props to ScoutsRoster in App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Create scouts-specific omnibar props**

Create a `scoutsOmnibarProps` memo similar to `omnibarProps` but with `currentView` forced to `"scouts"`. Right after the existing `omnibarProps` memo (around line 511), add:

```tsx
const scoutsOmnibarProps = useMemo(
  () => ({
    ...omnibarProps,
    isOpen: omnibar.isOpen && omnibar.mode === "bar",
    onSend: (text: string) => omnibar.send(text, "scouts"),
    onOpen: () => { omnibar.open("bar"); },
  }),
  [omnibarProps, omnibar.isOpen, omnibar.mode, omnibar.send, omnibar.open],
);
```

- [ ] **Step 2: Pass to ScoutsRoster**

Change the ScoutsRoster rendering (around line 855) from:

```tsx
<ScoutsRoster
  scouts={scouts}
  onSelectScout={handleSelectScout}
  onNewScout={handleNewScout}
  isLoading={isLoadingScouts}
/>
```

To:

```tsx
<ScoutsRoster
  scouts={scouts}
  onSelectScout={handleSelectScout}
  isLoading={isLoadingScouts}
  omnibarProps={scoutsOmnibarProps}
/>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: wire omnibar props to ScoutsRoster for inline creation"
```

---

### Task 4: Add scouts context to system prompt

**Files:**
- Modify: `packages/ai/src/context/system-prompts.ts`

- [ ] **Step 1: Add scouts page context**

In `BRETT_SYSTEM_PROMPT`, add after the Scout Creation section (before `## Format`):

```
## View Context
When the user is on the Scouts page (context: currentView = "scouts"), treat all messages as scout-related by default. If the user describes something to monitor or track, begin the scout creation flow immediately — don't ask "would you like me to create a scout?". They're already on the scouts page; the intent is clear.
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/context/system-prompts.ts
git commit -m "feat: add scouts page context hint to Brett system prompt"
```
