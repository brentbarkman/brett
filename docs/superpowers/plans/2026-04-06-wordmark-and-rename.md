# Wordmark & Assistant Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Style the LeftNav wordmark (Plus Jakarta Sans ExtraBold, gold gradient, cerulean breathing bar) and let users rename their AI assistant, replacing all ~40 hardcoded "Brett" strings in UI + system prompts.

**Architecture:** New `assistantName` field on User model flows through: Prisma → API → auth context → `useAssistantName()` hook → prop threading to UI components. System prompts become functions accepting the name. Wordmark is a new React component in BrettMark.tsx.

**Tech Stack:** Prisma, Hono, React, Plus Jakarta Sans font, CSS animations, TypeScript

---

### Task 1: Database — Add assistantName field

**Files:**
- Modify: `apps/api/prisma/schema.prisma:19-62` (User model)
- Create: `apps/api/prisma/migrations/YYYYMMDD_add_assistant_name/migration.sql` (via prisma migrate)

- [ ] **Step 1: Add field to Prisma schema**

In `apps/api/prisma/schema.prisma`, add after the `name` field (line 23):

```prisma
  assistantName   String   @default("Brett")  // 1-10 chars, user's custom AI name
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd apps/api && npx prisma migrate dev --name add_assistant_name
```

Expected: Migration created and applied. Prisma client regenerated.

- [ ] **Step 3: Verify migration**

Run:
```bash
cd apps/api && npx prisma studio
```

Check User table — `assistantName` column exists with default "Brett" on existing rows.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat: add assistantName field to User model"
```

---

### Task 2: Types — Add assistantName to AuthUser

**Files:**
- Modify: `packages/types/src/index.ts:10-16` (AuthUser interface)
- Modify: `apps/desktop/src/auth/AuthContext.tsx:29-36` (user mapping)

- [ ] **Step 1: Update AuthUser type**

In `packages/types/src/index.ts`, add `assistantName` to the `AuthUser` interface:

```typescript
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  assistantName: string;
  role?: string;
}
```

- [ ] **Step 2: Update AuthContext user mapping**

In `apps/desktop/src/auth/AuthContext.tsx`, update the user object construction (around line 29):

```typescript
const user: AuthUser | null = sessionData?.user
  ? {
      id: sessionData.user.id,
      email: sessionData.user.email,
      name: sessionData.user.name,
      avatarUrl: sessionData.user.image ?? null,
      assistantName: (sessionData.user as any).assistantName ?? "Brett",
    }
  : null;
```

Note: better-auth's session may not include custom fields by default. Check if `assistantName` comes through the session — if not, we'll need to fetch it from the `/users/me` endpoint and merge it. The `(as any)` cast is a temporary bridge; if the field isn't in the session, Task 3's API changes will provide it.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: Pass (the new field has no consumers yet).

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts apps/desktop/src/auth/AuthContext.tsx
git commit -m "feat: add assistantName to AuthUser type and auth context"
```

---

### Task 3: API — Expose and validate assistantName

**Files:**
- Modify: `apps/api/src/routes/users.ts:12-49` (GET /users/me response)
- Modify: `apps/api/src/routes/users.ts` (add PATCH handler or extend existing)

- [ ] **Step 1: Add assistantName to GET /users/me response**

In `apps/api/src/routes/users.ts`, add `assistantName` to the select and response in the GET `/` handler:

```typescript
select: {
  // ... existing fields ...
  assistantName: true,
}
```

And include it in the response object.

- [ ] **Step 2: Add PATCH /users/me handler for assistantName**

Add a new route (or extend the existing location PATCH) in `apps/api/src/routes/users.ts`:

```typescript
// Validation regex: letters, numbers, spaces, hyphens, apostrophes, 1-10 chars
const ASSISTANT_NAME_REGEX = /^[a-zA-Z0-9 '\-]{1,10}$/;

users.patch("/me", authMiddleware, async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json();

  const updates: Record<string, unknown> = {};

  if (body.assistantName !== undefined) {
    const trimmed = String(body.assistantName).trim();
    if (!trimmed || !ASSISTANT_NAME_REGEX.test(trimmed)) {
      return c.json({ error: "Assistant name must be 1-10 characters (letters, numbers, spaces, hyphens, apostrophes)" }, 400);
    }
    updates.assistantName = trimmed;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updates,
    select: { assistantName: true },
  });

  return c.json(user);
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/users.ts
git commit -m "feat: expose assistantName in GET /users/me and add PATCH /users/me"
```

---

### Task 4: Client hook — useAssistantName

**Files:**
- Create: `apps/desktop/src/api/assistant-name.ts`
- Modify: `apps/desktop/src/api/client.ts` (if needed — check if apiFetch is already exported)

- [ ] **Step 1: Create the hook**

Create `apps/desktop/src/api/assistant-name.ts`:

```typescript
import { useAuth } from "../auth/AuthContext";

/** Returns the user's custom assistant name, defaulting to "Brett". */
export function useAssistantName(): string {
  const { user } = useAuth();
  return user?.assistantName ?? "Brett";
}
```

- [ ] **Step 2: Create the mutation hook for settings**

In the same file, add the save mutation:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { useAuth } from "../auth/AuthContext";

export function useAssistantName(): string {
  const { user } = useAuth();
  return user?.assistantName ?? "Brett";
}

export function useUpdateAssistantName() {
  const { refetchUser } = useAuth();

  return useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 10) throw new Error("Name must be 1-10 characters");
      return apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ assistantName: trimmed }),
      });
    },
    onSuccess: () => {
      refetchUser();
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/api/assistant-name.ts
git commit -m "feat: add useAssistantName hook and update mutation"
```

---

### Task 5: Font — Bundle Plus Jakarta Sans

**Files:**
- Create: `apps/desktop/src/fonts/PlusJakartaSans-Bold.woff2`
- Create: `apps/desktop/src/fonts/PlusJakartaSans-ExtraBold.woff2`
- Modify: `apps/desktop/src/index.css:1-8` (add @font-face)

- [ ] **Step 1: Download font files**

Download Plus Jakarta Sans Bold (700) and ExtraBold (800) woff2 files from Google Fonts:

```bash
mkdir -p apps/desktop/src/fonts
curl -L "https://fonts.gstatic.com/s/plusjakartasans/v8/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_d0n9.woff2" -o apps/desktop/src/fonts/PlusJakartaSans-Bold.woff2
curl -L "https://fonts.gstatic.com/s/plusjakartasans/v8/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_KUn9.woff2" -o apps/desktop/src/fonts/PlusJakartaSans-ExtraBold.woff2
```

Note: The URLs above may change. If they 404, go to https://fonts.google.com/specimen/Plus+Jakarta+Sans, select Bold and ExtraBold, inspect the CSS to find current woff2 URLs. Alternatively, use `@fontsource/plus-jakarta-sans` npm package (same pattern as Switzer).

- [ ] **Step 2: Add @font-face declarations**

At the top of `apps/desktop/src/index.css`, after the Switzer imports, add:

```css
/* Plus Jakarta Sans — wordmark only */
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('./fonts/PlusJakartaSans-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('./fonts/PlusJakartaSans-ExtraBold.woff2') format('woff2');
  font-weight: 800;
  font-style: normal;
  font-display: swap;
}
```

- [ ] **Step 3: Verify font loads**

Run: `pnpm dev:desktop`
Open DevTools → Elements → Computed styles on any element. Confirm "Plus Jakarta Sans" is available in the font list.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/fonts/ apps/desktop/src/index.css
git commit -m "feat: bundle Plus Jakarta Sans for wordmark"
```

---

### Task 6: Wordmark component

**Files:**
- Modify: `packages/ui/src/BrettMark.tsx` (add Wordmark export)
- Modify: `packages/ui/src/index.ts` (export Wordmark)

- [ ] **Step 1: Add Wordmark component**

At the bottom of `packages/ui/src/BrettMark.tsx`, add:

```tsx
/**
 * Styled wordmark: assistant name in Plus Jakarta Sans ExtraBold,
 * metallic gold gradient, with cerulean underline bar.
 * Bar breathes when isWorking=true (1.4s cycle, matches BrettMark pulse).
 */
interface WordmarkProps {
  name: string;
  isWorking?: boolean;
  size?: number;
}

export function Wordmark({ name, isWorking = false, size = 19 }: WordmarkProps) {
  return (
    <div className="flex flex-col">
      <style>
        {`
          @keyframes wordmarkBreathe {
            0%, 100% { opacity: 0.45; }
            50% { opacity: 0.9; }
          }
        `}
      </style>
      <span
        className="font-extrabold truncate"
        style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: `${size}px`,
          letterSpacing: "0.03em",
          lineHeight: 1,
          background: "linear-gradient(180deg, #F5D96B, #D4A020)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          maxWidth: "140px",
        }}
      >
        {name}
      </span>
      <div
        className="rounded-full mt-[3px]"
        style={{
          height: "2.5px",
          width: "65%",
          background: "linear-gradient(90deg, #4682C3, #5A9AD6 70%, transparent 100%)",
          opacity: isWorking ? undefined : 0.55,
          animation: isWorking ? "wordmarkBreathe 1.4s ease-in-out infinite" : "none",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Export from index**

In `packages/ui/src/index.ts`, add to the BrettMark export line:

```typescript
export { BrettMark, ProductMark, Wordmark } from "./BrettMark";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/BrettMark.tsx packages/ui/src/index.ts
git commit -m "feat: add Wordmark component with gold gradient and cerulean breathing bar"
```

---

### Task 7: LeftNav — Wire up Wordmark

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx:3,109-117`

- [ ] **Step 1: Update LeftNav imports and props**

In `packages/ui/src/LeftNav.tsx`, update the import:

```typescript
import { ProductMark, Wordmark } from "./BrettMark";
```

Add to the LeftNav props interface (find it near the top of the file):

```typescript
assistantName?: string;
isAIWorking?: boolean;
```

- [ ] **Step 2: Replace wordmark rendering**

Replace the current header block (around lines 107-117):

```tsx
{/* Header */}
<div
  className={`flex items-center gap-2 mb-8 ${isCollapsed ? "justify-center" : "px-2"}`}
>
  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
    <ProductMark size={24} className="drop-shadow-[0_0_8px_rgba(232,185,49,0.4)]" />
  </div>
  {!isCollapsed && (
    <Wordmark name={assistantName ?? "Brett"} isWorking={isAIWorking} />
  )}
</div>
```

- [ ] **Step 3: Wire props from App.tsx**

In `apps/desktop/src/App.tsx`, find where `<LeftNav>` is rendered and add the new props:

```tsx
<LeftNav
  // ... existing props ...
  assistantName={assistantName}
  isAIWorking={omnibar.isStreaming}
/>
```

The `assistantName` variable comes from `useAssistantName()` called in App.tsx. Add the import and hook call near the other hooks at the top of the App component:

```typescript
import { useAssistantName } from "./api/assistant-name";
// ... inside the component:
const assistantName = useAssistantName();
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/LeftNav.tsx apps/desktop/src/App.tsx
git commit -m "feat: wire Wordmark into LeftNav with assistant name and working state"
```

---

### Task 8: UI string replacement — Omnibar + SpotlightModal

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx` (add `assistantName` prop, replace ~4 strings)
- Modify: `packages/ui/src/SpotlightModal.tsx` (add `assistantName` prop, replace ~3 strings)
- Modify: `apps/desktop/src/App.tsx` (pass prop)

- [ ] **Step 1: Omnibar — add prop and replace strings**

In `packages/ui/src/Omnibar.tsx`, add to the `OmnibarProps` interface:

```typescript
assistantName?: string;
```

Destructure it in the component:

```typescript
assistantName = "Brett",
```

Replace all hardcoded "Brett" in user-facing strings:
- `"Ask Brett anything..."` → `` `Ask ${assistantName} anything...` ``
- `"Ask Brett: "` → `` `Ask ${assistantName}: ` ``
- `"Brett is thinking..."` → `` `${assistantName} is thinking...` ``
- `"unlock Brett's full capabilities"` → `` `unlock ${assistantName}'s full capabilities` ``
- `"Brett needs an AI provider to work his magic"` → `` `${assistantName} needs an AI provider. Set one up in Settings.` `` (gender-neutral)

- [ ] **Step 2: SpotlightModal — add prop and replace strings**

In `packages/ui/src/SpotlightModal.tsx`, add to the `SpotlightModalProps` interface:

```typescript
assistantName?: string;
```

Destructure with default:

```typescript
assistantName = "Brett",
```

Replace:
- `"Ask Brett anything..."` → `` `Ask ${assistantName} anything...` ``
- `"Ask Brett: "` → `` `Ask ${assistantName}: ` ``
- `"Brett is thinking..."` → `` `${assistantName} is thinking...` ``

- [ ] **Step 3: Pass prop from App.tsx**

In `apps/desktop/src/App.tsx`, pass `assistantName` to both Omnibar and SpotlightModal via their props objects:

```typescript
// In omnibarProps useMemo:
assistantName,

// In SpotlightModal render:
assistantName={assistantName}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Omnibar.tsx packages/ui/src/SpotlightModal.tsx apps/desktop/src/App.tsx
git commit -m "feat: replace hardcoded Brett in Omnibar and SpotlightModal"
```

---

### Task 9: UI string replacement — BrettThread + detail panels

**Files:**
- Modify: `packages/ui/src/BrettThread.tsx` (add prop, replace ~5 strings)
- Modify: `packages/ui/src/ContentDetailPanel.tsx` (replace 1 string)
- Modify: `packages/ui/src/CalendarEventDetailPanel.tsx` (replace 1 string)
- Modify: `packages/ui/src/CalendarTimeline.tsx` (replace 1 string)
- Modify: `packages/ui/src/DailyBriefing.tsx` (replace 1 string)
- Modify: `packages/ui/src/NotFoundView.tsx` (replace 1 string)

- [ ] **Step 1: BrettThread — add prop and replace strings**

In `packages/ui/src/BrettThread.tsx`, add `assistantName?: string` to props, destructure with default `"Brett"`.

Replace:
- `"Brett is working..."` → `` `${assistantName} is working...` ``
- `"Brett is thinking..."` → `` `${assistantName} is thinking...` ``
- `"Brett"` (header label) → `{assistantName}`
- `"Brett needs an AI provider to work his magic. Set one up in Settings."` → `` `${assistantName} needs an AI provider. Set one up in Settings.` ``
- `"Ask Brett anything..."` → `` `Ask ${assistantName} anything...` ``
- Any disabled-state placeholder referencing Brett → use `assistantName`

- [ ] **Step 2: Detail panels — replace Brett's Take labels**

In each of `ContentDetailPanel.tsx`, `CalendarEventDetailPanel.tsx`:
- Add `assistantName?: string` prop, destructure with default `"Brett"`
- Replace `"Brett's Take"` → `` `${assistantName}'s Take` ``

In `CalendarTimeline.tsx`:
- Add `assistantName?: string` prop
- Replace `title="Brett's Take available"` → `` title={`${assistantName}'s Take available`} ``

- [ ] **Step 3: DailyBriefing and NotFoundView**

In `DailyBriefing.tsx`:
- Add `assistantName?: string` prop
- Replace the AI provider message to use `{assistantName}`

In `NotFoundView.tsx`:
- Add `assistantName?: string` prop
- Replace `"Brett doesn't know this place either."` → `` `${assistantName} doesn't know this place either.` ``

- [ ] **Step 4: Thread prop through from App.tsx and DetailPanel**

In `apps/desktop/src/App.tsx`, pass `assistantName` to all components that need it. Trace the prop chain:
- `App.tsx` → `DetailPanel` → `TaskDetailPanel` / `ContentDetailPanel` / `CalendarEventDetailPanel` → `BrettThread`
- `App.tsx` → `DailyBriefing`
- `App.tsx` → `NotFoundView` (if rendered from App)
- `App.tsx` → `CalendarTimeline` (via CalendarPage or sidebar)

Add `assistantName` prop to the `DetailPanel` component interface and pass it through to child panels.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/BrettThread.tsx packages/ui/src/ContentDetailPanel.tsx packages/ui/src/CalendarEventDetailPanel.tsx packages/ui/src/CalendarTimeline.tsx packages/ui/src/DailyBriefing.tsx packages/ui/src/NotFoundView.tsx packages/ui/src/DetailPanel.tsx packages/ui/src/TaskDetailPanel.tsx apps/desktop/src/App.tsx
git commit -m "feat: replace hardcoded Brett in threads, detail panels, and remaining UI"
```

---

### Task 10: System prompts — parameterize assistant name

**Files:**
- Modify: `packages/ai/src/context/system-prompts.ts` (constants → functions)
- Modify: `packages/ai/src/context/assembler.ts` (pass name to prompt functions)
- Modify: `packages/ai/src/memory/facts.ts` (pass name to prompt function)
- Modify: `packages/ai/src/index.ts` (update exports)
- Modify: `packages/ai/src/skills/explain-feature.ts` (parameterize descriptions)

- [ ] **Step 1: Convert prompts to functions**

In `packages/ai/src/context/system-prompts.ts`:

```typescript
// Replace each constant export with a function:

export function getSystemPrompt(assistantName: string): string {
  return `You are ${assistantName}, a personal productivity assistant. Direct, efficient, no filler. Use tools to act, then respond with the result.
// ... rest of BRETT_SYSTEM_PROMPT body unchanged ...` + SECURITY_BLOCK;
}

export function getBriefingPrompt(assistantName: string): string {
  return `You are ${assistantName} generating a daily briefing. Direct, specific, no filler. You have opinions about what matters.
// ... rest of BRIEFING_SYSTEM_PROMPT body unchanged ...` + SECURITY_BLOCK;
}

export function getBrettsTakePrompt(assistantName: string): string {
  return `You are ${assistantName} generating a brief observation about an item or event. Be genuinely useful in 1-3 sentences. Prefer fewer sentences when there is less to say.
// ... rest of BRETTS_TAKE_SYSTEM_PROMPT body unchanged ...` + SECURITY_BLOCK;
}

export function getFactExtractionPrompt(assistantName: string): string {
  return `Extract facts about the user from this conversation between a user and ${assistantName}. These facts will be stored and used to personalize future interactions.
// ... rest of FACT_EXTRACTION_PROMPT body unchanged ...` + SECURITY_BLOCK;
}
```

Keep `SECURITY_BLOCK` and `SCOUT_CREATION_PROMPT` as constants (unchanged).

- [ ] **Step 2: Update assembler to pass name**

In `packages/ai/src/context/assembler.ts`:

Update imports:
```typescript
import {
  getSystemPrompt,
  SCOUT_CREATION_PROMPT,
  getBriefingPrompt,
  getBrettsTakePrompt,
} from "./system-prompts.js";
```

Add `assistantName` to all context interfaces:
```typescript
interface OmnibarContext {
  // ... existing fields ...
  assistantName?: string;
}
// Same for BrettThreadContext, BriefingContext, BrettsTakeContext
```

Update each assembler function to use the new functions:
```typescript
// assembleOmnibar (line 214):
const system = getSystemPrompt(input.assistantName ?? "Brett") + scoutBlock + ...

// assembleBrettThread (line 312):
const system = getSystemPrompt(input.assistantName ?? "Brett") + ...

// assembleBriefing (line 349):
const system = getBriefingPrompt(input.assistantName ?? "Brett") + ...

// assembleBrettsTake (line 602):
const system = getBrettsTakePrompt(input.assistantName ?? "Brett") + ...
```

- [ ] **Step 3: Update facts.ts**

In `packages/ai/src/memory/facts.ts`, update the import and usage:

```typescript
import { getFactExtractionPrompt } from "../context/system-prompts.js";

// At the callsite (around line 69):
system: getFactExtractionPrompt(assistantName ?? "Brett"),
```

Add `assistantName` parameter to the `extractFacts` function signature and thread it from the caller.

- [ ] **Step 4: Update exports**

In `packages/ai/src/index.ts`, update the exports to use the new function names:

```typescript
export {
  getSystemPrompt,
  getBriefingPrompt,
  getBrettsTakePrompt,
  getFactExtractionPrompt,
  SCOUT_CREATION_PROMPT,
} from "./context/system-prompts.js";
```

- [ ] **Step 5: Update explain-feature.ts**

In `packages/ai/src/skills/explain-feature.ts`, make the descriptions parameterized:

```typescript
function getFeatureExplanations(assistantName: string): Record<string, string> {
  return {
    inbox: "The Inbox holds items that haven't been assigned to a list or given a due date. It's your triage zone — items land here first, then you organize them.",
    today: "The Today view shows tasks due today plus any overdue items. It's your daily focus — everything that needs attention right now.",
    upcoming: "The Upcoming view shows items with future due dates, grouped by time period. Use it to see what's coming up this week, next week, and beyond.",
    lists: "Lists are custom collections for organizing items by project, area, or category. Create as many as you need. Items can belong to one list.",
    calendar: `The Calendar shows your Google Calendar events integrated into ${assistantName}. You can see your schedule, RSVP to events, and add private notes.`,
    brett: `${assistantName} is your AI assistant. Ask questions, create tasks, search your items, or get a briefing on your day. ${assistantName} learns your patterns over time.`,
    content: `Content items let you save articles, videos, tweets, and other web content. ${assistantName} automatically extracts metadata and previews when you save a URL.`,
    snooze: "Snoozing hides an item until a specific date. It will reappear in your views when the snooze period ends. Great for 'not now, but later' items.",
    "brett's take": `${assistantName}'s Take is an AI-generated observation about a task or event — context, suggestions, or things to consider. It appears on item details.`,
    shortcuts: `Use Cmd+K (or Ctrl+K) to open the command bar. From there you can quickly search, create tasks, navigate, and talk to ${assistantName}.`,
  };
}
```

Update the skill's execute method to accept `assistantName` from context and pass it to the function.

- [ ] **Step 6: Thread assistantName through API routes**

In each API route that calls `assembleContext`, read the assistant name from the user record and include it in the context input:

```typescript
// Example in brett-intelligence.ts:
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { assistantName: true, /* ... */ },
});

const context = await assembleContext({
  type: "omnibar",
  userId,
  assistantName: user?.assistantName ?? "Brett",
  // ... rest of input
}, prisma);
```

Apply the same pattern to all routes that call `assembleContext` or `extractFacts`.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/context/system-prompts.ts packages/ai/src/context/assembler.ts packages/ai/src/memory/facts.ts packages/ai/src/index.ts packages/ai/src/skills/explain-feature.ts apps/api/src/routes/
git commit -m "feat: parameterize assistant name in system prompts and AI context"
```

---

### Task 11: Settings UI — assistant name input

**Files:**
- Modify: `apps/desktop/src/settings/ProfileSection.tsx`

- [ ] **Step 1: Add assistant name field to ProfileSection**

In `apps/desktop/src/settings/ProfileSection.tsx`, add state and the save handler for the assistant name:

```typescript
import { useAssistantName, useUpdateAssistantName } from "../api/assistant-name";
import { Wordmark } from "@brett/ui";

// Inside the component:
const currentAssistantName = useAssistantName();
const [assistantNameInput, setAssistantNameInput] = useState(currentAssistantName);
const updateAssistantName = useUpdateAssistantName();
const isAssistantNameDirty = assistantNameInput.trim() !== currentAssistantName;

async function handleAssistantNameSave() {
  try {
    await updateAssistantName.mutateAsync(assistantNameInput);
    setMessage({ type: "success", text: "Assistant name updated" });
  } catch (err: unknown) {
    setMessage({
      type: "error",
      text: err instanceof Error ? err.message : "Failed to update",
    });
  }
}
```

- [ ] **Step 2: Add the UI field**

After the Email field (around line 101), add:

```tsx
{/* Assistant name */}
<div className="mb-4">
  <label
    htmlFor="settings-assistant-name"
    className="block text-xs text-white/50 mb-1.5"
  >
    Assistant name
  </label>
  <div className="flex items-center gap-3">
    <input
      id="settings-assistant-name"
      type="text"
      value={assistantNameInput}
      onChange={(e) => {
        if (e.target.value.length <= 10) setAssistantNameInput(e.target.value);
      }}
      maxLength={10}
      placeholder="Brett"
      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-brett-gold/50 focus:ring-1 focus:ring-brett-gold/50 focus:outline-none"
    />
    <Wordmark name={assistantNameInput.trim() || "Brett"} size={16} />
  </div>
  <p className="text-[10px] text-white/30 mt-1">{assistantNameInput.length}/10</p>
</div>
```

- [ ] **Step 3: Update the save button to handle both fields**

Modify the save button to handle both name and assistant name:

```tsx
<button
  onClick={async () => {
    if (isDirty) await handleSave();
    if (isAssistantNameDirty) await handleAssistantNameSave();
  }}
  disabled={(!isDirty && !isAssistantNameDirty) || saving || updateAssistantName.isPending}
  className="bg-brett-gold text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brett-gold-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
>
  {(saving || updateAssistantName.isPending) ? "Saving..." : "Save changes"}
</button>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: Pass.

- [ ] **Step 5: Visual test**

Run: `pnpm dev:desktop`
Navigate to Settings → Profile. Verify:
- Assistant name input appears with live Wordmark preview
- Character counter shows correctly
- Can't type more than 10 chars
- Save button enables when name changes
- Saving updates the LeftNav wordmark immediately

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/settings/ProfileSection.tsx
git commit -m "feat: add assistant name setting with live wordmark preview"
```

---

### Task 12: Final typecheck + visual verification

**Files:** None (verification only)

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: All packages pass.

- [ ] **Step 2: Visual verification checklist**

Run: `pnpm dev:desktop` and verify:

1. **LeftNav wordmark** — gold gradient text, cerulean underline at 55% opacity
2. **Wordmark breathing** — trigger AI streaming (ask a question), confirm underline breathes
3. **Omnibar** — placeholder shows custom name, "thinking" shows custom name
4. **⌘K Spotlight** — same as omnibar
5. **Brett's Take** — label shows custom name
6. **BrettThread** — header, thinking, error states all show custom name
7. **Settings** — rename works, updates everywhere instantly
8. **404 page** — shows custom name
9. **Collapsed nav** — only shows ProductMark, no wordmark (unchanged)

- [ ] **Step 3: Test with different names**

In Settings, try: "Jarvis", "Ada", "O'Brien", "AI", single char "M", max length "Maximilian" (10 chars). Verify layout doesn't break.

- [ ] **Step 4: Commit any fixes**

If any issues found, fix and commit.
