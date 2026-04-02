# Brett's Take & Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up Brett's Take (pre-generated calendar event insights) and Brett Chat (on-demand AI conversation), clean up dead routes, and handle graceful AI-not-configured states.

**Architecture:** Pre-generation runs server-side after calendar sync, calling the existing orchestrator and storing results on the CalendarEvent record. Brett Chat is already wired end-to-end and needs verification + error handling improvements. Stub routes are deleted.

**Tech Stack:** Prisma (schema migration), Hono (API routes), React (UI components), Vitest (tests)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `apps/api/prisma/schema.prisma` | Add `brettObservation` + `brettObservationAt` to CalendarEvent |
| Create | `apps/api/src/services/brett-take-generator.ts` | Pre-generation logic: qualify events, call orchestrator, store results |
| Modify | `apps/api/src/services/calendar-sync.ts` | Hook pre-generation after sync completion |
| Modify | `apps/api/src/routes/brett-intelligence.ts` | Remove item-side Take endpoint, add `onDone` to event endpoint |
| Modify | `apps/api/src/routes/calendar.ts` | Return `brettObservation` + `brettObservationAt` in event detail |
| Delete | `apps/api/src/routes/brett.ts` | Remove stub routes entirely |
| Delete | `apps/desktop/src/api/bretts-take.ts` | Remove unused hook (pre-generation replaces it) |
| Modify | `apps/api/src/app.ts` | Remove stub route import + registration |
| Modify | `packages/ui/src/TaskDetailPanel.tsx` | Remove Brett's Take display |
| Modify | `packages/ui/src/CalendarTimeline.tsx` | Replace pulsing dot with sparkle icon for events with Takes |
| Modify | `packages/ui/src/BrettThread.tsx` | Add "AI not configured" inline message |
| Modify | `apps/desktop/src/App.tsx` | Update `hasBrettContext` to use `brettObservation`, pass error state to BrettThread |
| Modify | `packages/types/src/calendar.ts` | Ensure types match (already has `brettObservation` and `brettTakeGeneratedAt`) |
| Create | `apps/api/src/__tests__/brett-take-generator.test.ts` | Unit tests for qualification logic and pre-generation |
| Modify | `apps/api/src/__tests__/brett.test.ts` | Remove or repurpose (stub routes being deleted) |

---

### Task 1: Schema Migration — Add brettObservation to CalendarEvent

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (CalendarEvent model, around line 272-309)

- [ ] **Step 1: Add fields to CalendarEvent model**

In `apps/api/prisma/schema.prisma`, find the CalendarEvent model and add two fields before the relation fields:

```prisma
  brettObservation      String?   @db.Text
  brettObservationAt    DateTime?
```

Add them after `rawGoogleEvent Json?` and before `notes CalendarEventNote[]`.

- [ ] **Step 2: Generate and run migration**

```bash
cd /Users/brentbarkman/code/brett && pnpm db:migrate --name add-brett-observation-to-calendar-event
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify schema is correct**

```bash
cd /Users/brentbarkman/code/brett/apps/api && npx prisma validate
```

Expected: "Your schema is valid!"

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add brettObservation fields to CalendarEvent"
```

---

### Task 2: Delete Stub Routes

**Files:**
- Delete: `apps/api/src/routes/brett.ts`
- Modify: `apps/api/src/app.ts` (lines 9, 66)
- Delete or repurpose: `apps/api/src/__tests__/brett.test.ts`

- [ ] **Step 1: Remove brett.ts import and route registration from app.ts**

In `apps/api/src/app.ts`, remove:

```typescript
import { brett } from "./routes/brett.js";
```

And remove:

```typescript
app.route("/things", brett);
```

Note: Keep the other `/things` routes (`things`, `attachments`, `links`, `extract`) — only remove the `brett` one on line 66.

- [ ] **Step 2: Delete the stub route file**

```bash
rm /Users/brentbarkman/code/brett/apps/api/src/routes/brett.ts
```

- [ ] **Step 3: Check if brett.test.ts tests the stub routes**

Read `apps/api/src/__tests__/brett.test.ts`. If it only tests the stub routes (`/things/:itemId/brett`, `/things/:itemId/brett-take`), delete it. If it tests other Brett functionality, keep and update it.

```bash
rm /Users/brentbarkman/code/brett/apps/api/src/__tests__/brett.test.ts
```

- [ ] **Step 4: Remove item-side Take endpoint from brett-intelligence.ts**

In `apps/api/src/routes/brett-intelligence.ts`, remove the entire `POST /take/:itemId` handler (lines 170-226). Keep the `POST /take/event/:eventId` handler (lines 228-268).

- [ ] **Step 5: Delete unused useBrettsTake hook**

The `useBrettsTake` hook in `apps/desktop/src/api/bretts-take.ts` is not imported anywhere — it's dead code. Pre-generation replaces it entirely.

```bash
rm /Users/brentbarkman/code/brett/apps/desktop/src/api/bretts-take.ts
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors. If `validateCreateBrettMessage` from `@brett/business` is now unused, that's fine — it may be referenced elsewhere.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove stub Brett routes and item-side Take endpoint"
```

---

### Task 3: Update Calendar Event Detail API

**Files:**
- Modify: `apps/api/src/routes/calendar.ts` (lines 114-159)

- [ ] **Step 1: Add brettObservation to event detail response**

In `apps/api/src/routes/calendar.ts`, the `GET /events/:id` handler (line 114) currently doesn't return `brettObservation`. Add the two new fields to the response JSON.

Find the response object (line 129) and add after `recurringEventId`:

```typescript
    brettObservation: event.brettObservation ?? null,
    brettTakeGeneratedAt: event.brettObservationAt?.toISOString() ?? null,
```

No changes needed to the Prisma query — `brettObservation` and `brettObservationAt` are scalar fields on CalendarEvent, so they're included by default.

- [ ] **Step 2: Also add to the events list response if it exists**

Check the `GET /events` endpoint in the same file. If it returns a list of events, add `brettObservation` there too so the calendar timeline can check for Takes without a detail fetch.

In the events list endpoint, add `brettObservation: e.brettObservation ?? null` to each mapped event object.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors. The `CalendarEventDetail` type in `@brett/types` already has `brettObservation: string | null` and `brettTakeGeneratedAt: string | null`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/calendar.ts
git commit -m "feat(api): return brettObservation in calendar event detail response"
```

---

### Task 4: Pre-generation Service — Qualification Logic

**Files:**
- Create: `apps/api/src/services/brett-take-generator.ts`
- Create: `apps/api/src/__tests__/brett-take-generator.test.ts`

- [ ] **Step 1: Write failing tests for event qualification**

Create `apps/api/src/__tests__/brett-take-generator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { qualifiesForTake } from "../services/brett-take-generator.js";

describe("qualifiesForTake", () => {
  const base = {
    id: "evt-1",
    description: null as string | null,
    recurringEventId: null as string | null,
    brettObservation: null as string | null,
    brettObservationAt: null as Date | null,
    updatedAt: new Date("2026-04-01T10:00:00Z"),
  };

  it("rejects event with no description and no recurrence", () => {
    expect(qualifiesForTake(base, false)).toBe(false);
  });

  it("rejects event with short description (<=50 chars)", () => {
    expect(qualifiesForTake({ ...base, description: "Join: zoom.us/123" }, false)).toBe(false);
  });

  it("qualifies event with description >50 chars", () => {
    const longDesc = "This is a detailed meeting agenda discussing the quarterly roadmap and resource allocation.";
    expect(qualifiesForTake({ ...base, description: longDesc }, false)).toBe(true);
  });

  it("qualifies recurring event with prior transcript", () => {
    expect(qualifiesForTake({ ...base, recurringEventId: "rec-123" }, true)).toBe(true);
  });

  it("rejects recurring event without prior transcript", () => {
    expect(qualifiesForTake({ ...base, recurringEventId: "rec-123" }, false)).toBe(false);
  });
});

describe("needsGeneration", () => {
  // Import once implemented
  // import { needsGeneration } from "../services/brett-take-generator.js";

  it("needs generation when brettObservation is null", () => {
    expect(true).toBe(true); // placeholder — will be implemented with the function
  });

  it("needs generation when observation is stale (brettObservationAt < updatedAt)", () => {
    expect(true).toBe(true);
  });

  it("skips generation when observation is fresh", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/brentbarkman/code/brett && pnpm test -- --run apps/api/src/__tests__/brett-take-generator.test.ts
```

Expected: FAIL — `qualifiesForTake` is not defined.

- [ ] **Step 3: Implement qualification functions**

Create `apps/api/src/services/brett-take-generator.ts`:

```typescript
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { decryptToken } from "../lib/encryption.js";
import { getProvider, orchestrate } from "@brett/ai";
import { registry } from "../lib/ai-registry.js";
import type { AIProviderName } from "@brett/types";

const MIN_DESCRIPTION_LENGTH = 50;
const MAX_EVENTS_PER_CYCLE = 10;

interface EventForQualification {
  id: string;
  description: string | null;
  recurringEventId: string | null;
  brettObservation: string | null;
  brettObservationAt: Date | null;
  updatedAt: Date;
}

/**
 * Does this event have enough context to merit a Brett's Take?
 * @param hasPriorTranscript - whether a prior occurrence has a MeetingNote transcript
 */
export function qualifiesForTake(
  event: EventForQualification,
  hasPriorTranscript: boolean,
): boolean {
  // Criterion 1: meaningful description (>50 chars)
  if (event.description && event.description.length > MIN_DESCRIPTION_LENGTH) {
    return true;
  }
  // Criterion 2: recurring with prior transcript
  if (event.recurringEventId && hasPriorTranscript) {
    return true;
  }
  return false;
}

/**
 * Does this event need (re)generation of its Take?
 */
export function needsGeneration(event: EventForQualification): boolean {
  if (!event.brettObservation) return true;
  if (!event.brettObservationAt) return true;
  return event.brettObservationAt < event.updatedAt;
}
```

- [ ] **Step 4: Update tests with real imports and add needsGeneration tests**

Replace the `needsGeneration` placeholder tests with real ones:

```typescript
import { qualifiesForTake, needsGeneration } from "../services/brett-take-generator.js";

// ... (qualifiesForTake tests remain the same)

describe("needsGeneration", () => {
  const base = {
    id: "evt-1",
    description: "A long enough description for a meeting about quarterly planning and resource allocation.",
    recurringEventId: null as string | null,
    brettObservation: null as string | null,
    brettObservationAt: null as Date | null,
    updatedAt: new Date("2026-04-01T10:00:00Z"),
  };

  it("needs generation when brettObservation is null", () => {
    expect(needsGeneration(base)).toBe(true);
  });

  it("needs generation when brettObservationAt is null", () => {
    expect(needsGeneration({ ...base, brettObservation: "Some take" })).toBe(true);
  });

  it("needs generation when observation is stale", () => {
    expect(needsGeneration({
      ...base,
      brettObservation: "Old take",
      brettObservationAt: new Date("2026-04-01T08:00:00Z"), // before updatedAt
    })).toBe(true);
  });

  it("skips generation when observation is fresh", () => {
    expect(needsGeneration({
      ...base,
      brettObservation: "Fresh take",
      brettObservationAt: new Date("2026-04-01T12:00:00Z"), // after updatedAt
    })).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/brentbarkman/code/brett && pnpm test -- --run apps/api/src/__tests__/brett-take-generator.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/brett-take-generator.ts apps/api/src/__tests__/brett-take-generator.test.ts
git commit -m "feat(api): add Brett's Take qualification and staleness logic with tests"
```

---

### Task 5: Pre-generation Service — Orchestration Pipeline

**Files:**
- Modify: `apps/api/src/services/brett-take-generator.ts`

- [ ] **Step 1: Add the generatePendingTakes function**

Add to `apps/api/src/services/brett-take-generator.ts`:

```typescript
/**
 * Generate Brett's Takes for qualifying upcoming calendar events.
 * Called after calendar sync completes.
 * 
 * Budget: at most MAX_EVENTS_PER_CYCLE events per call, prioritized by startTime.
 */
export async function generatePendingTakes(userId: string): Promise<void> {
  // 1. Check user has active AI config
  const config = await prisma.userAIConfig.findFirst({
    where: { userId, isActive: true, isValid: true },
  });
  if (!config) return; // No AI provider — skip silently

  // 2. Fetch upcoming events in next 48 hours
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId,
      startTime: { gte: now, lte: in48h },
      status: { not: "cancelled" },
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      description: true,
      recurringEventId: true,
      brettObservation: true,
      brettObservationAt: true,
      updatedAt: true,
    },
  });

  // 3. For recurring events, batch-check which have prior transcripts
  const recurringIds = events
    .filter((e) => e.recurringEventId)
    .map((e) => e.recurringEventId!);

  const recurringWithTranscripts = new Set<string>();
  if (recurringIds.length > 0) {
    const priorWithTranscripts = await prisma.meetingNote.findMany({
      where: {
        userId,
        calendarEvent: {
          recurringEventId: { in: recurringIds },
          startTime: { lt: now },
        },
        transcript: { not: Prisma.DbNull },
      },
      select: {
        calendarEvent: {
          select: { recurringEventId: true },
        },
      },
      distinct: ["calendarEventId"],
    });
    for (const mn of priorWithTranscripts) {
      if (mn.calendarEvent?.recurringEventId) {
        recurringWithTranscripts.add(mn.calendarEvent.recurringEventId);
      }
    }
  }

  // 4. Filter to qualifying events that need generation
  const candidates = events.filter((e) => {
    const hasPriorTranscript = e.recurringEventId
      ? recurringWithTranscripts.has(e.recurringEventId)
      : false;
    return qualifiesForTake(e, hasPriorTranscript) && needsGeneration(e);
  });

  // 5. Cap at budget
  const toGenerate = candidates.slice(0, MAX_EVENTS_PER_CYCLE);

  if (toGenerate.length === 0) return;

  // 6. Set up AI provider
  let apiKey: string;
  try {
    apiKey = decryptToken(config.encryptedKey);
  } catch {
    return; // Key decryption failed — skip silently
  }
  const provider = getProvider(config.provider as AIProviderName, apiKey);
  const providerName = config.provider as AIProviderName;

  // 7. Generate Takes sequentially (avoid parallel to respect rate limits)
  for (const event of toGenerate) {
    try {
      await generateSingleTake(userId, event.id, provider, providerName);
    } catch (err) {
      console.error(`[brett-take-generator] Failed for event ${event.id}:`, err);
      // Continue with next event — don't let one failure block the rest
    }
  }
}

async function generateSingleTake(
  userId: string,
  eventId: string,
  provider: ReturnType<typeof getProvider>,
  providerName: AIProviderName,
): Promise<void> {
  const session = await prisma.conversationSession.create({
    data: {
      userId,
      source: "bretts_take",
      calendarEventId: eventId,
      modelTier: "small",
      modelUsed: "",
    },
  });

  const input = {
    type: "bretts_take" as const,
    userId,
    calendarEventId: eventId,
  };

  let content = "";
  let model = "";

  for await (const chunk of orchestrate({
    input,
    provider,
    providerName,
    prisma,
    registry,
    sessionId: session.id,
  })) {
    if (chunk.type === "text") {
      content += chunk.content;
    }
    if (chunk.type === "done" && chunk.model) {
      model = chunk.model;
    }
    if (chunk.type === "error") {
      console.error(`[brett-take-generator] Orchestrator error for event ${eventId}:`, chunk.message);
      return;
    }
  }

  // Store result
  if (content.trim()) {
    await Promise.all([
      prisma.calendarEvent.update({
        where: { id: eventId },
        data: {
          brettObservation: content,
          brettObservationAt: new Date(),
        },
      }),
      prisma.conversationSession.update({
        where: { id: session.id },
        data: { modelUsed: model },
      }),
      prisma.conversationMessage.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content,
        },
      }),
    ]);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors. Fix any import issues (ensure `orchestrate` is exported from `@brett/ai`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/brett-take-generator.ts
git commit -m "feat(api): implement Brett's Take pre-generation pipeline"
```

---

### Task 6: Hook Pre-generation into Calendar Sync

**Files:**
- Modify: `apps/api/src/services/calendar-sync.ts` (after lines 151-154 and 284-287)

- [ ] **Step 1: Import generatePendingTakes**

Add to the imports at the top of `apps/api/src/services/calendar-sync.ts`:

```typescript
import { generatePendingTakes } from "./brett-take-generator.js";
```

- [ ] **Step 2: Call after initialSync completes**

In the `initialSync` function, after the `publishSSE` call (around line 151-154), add:

```typescript
  // Fire-and-forget: generate Brett's Takes for qualifying upcoming events
  generatePendingTakes(account.userId).catch((err) =>
    console.error("[calendar-sync] Brett's Take generation failed:", err),
  );
```

- [ ] **Step 3: Call after incrementalSync completes**

In the `incrementalSync` function, after the `publishSSE` call (around line 284-287), add the same fire-and-forget call:

```typescript
  // Fire-and-forget: generate Brett's Takes for qualifying upcoming events
  generatePendingTakes(account.userId).catch((err) =>
    console.error("[calendar-sync] Brett's Take generation failed:", err),
  );
```

Place this BEFORE the `finally` block so it uses `account.userId` which is in scope.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/calendar-sync.ts
git commit -m "feat(api): hook Brett's Take pre-generation into calendar sync"
```

---

### Task 7: Fix Event Take Endpoint — Add onDone Callback

**Files:**
- Modify: `apps/api/src/routes/brett-intelligence.ts` (lines 228-268)

- [ ] **Step 1: Add onDone callback to event Take endpoint**

The `POST /take/event/:eventId` endpoint currently doesn't store the result. Add an `onDone` callback like the item endpoint had.

In `apps/api/src/routes/brett-intelligence.ts`, find the event Take endpoint (around line 261) and change the `buildStream` call from:

```typescript
    const { stream } = buildStream(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
    );
```

To:

```typescript
    const { stream } = buildStream(
      { input, provider, providerName, prisma, registry, sessionId: session.id },
      session.id,
      {
        onDone: (content) => {
          prisma.calendarEvent
            .update({
              where: { id: eventId },
              data: {
                brettObservation: content,
                brettObservationAt: new Date(),
              },
            })
            .catch((err: unknown) =>
              console.error("Failed to update event brettObservation:", err),
            );
        },
      },
    );
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/brett-intelligence.ts
git commit -m "fix(api): store brettObservation when event Take is generated via endpoint"
```

---

### Task 8: UI — Remove Brett's Take from TaskDetailPanel

**Files:**
- Modify: `packages/ui/src/TaskDetailPanel.tsx` (lines 256-269)

- [ ] **Step 1: Remove the Brett's Take display block**

In `packages/ui/src/TaskDetailPanel.tsx`, remove the entire block (lines 256-269):

```tsx
{/* Brett's Take */}
{detail.brettObservation && (
  <div className="bg-blue-500/10 border-l-2 border-blue-500 p-4 rounded-r-lg">
    <div className="flex items-center gap-2 mb-2">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
      <span className="text-xs font-mono uppercase text-blue-400 font-semibold">
        Brett's Take
      </span>
    </div>
    <p className="text-sm italic text-blue-300/90 leading-relaxed">
      &ldquo;{detail.brettObservation}&rdquo;
    </p>
  </div>
)}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors. The `brettObservation` field may still exist on the Thing type — that's fine, we're just not displaying it.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/TaskDetailPanel.tsx
git commit -m "fix(ui): remove Brett's Take display from task detail panel"
```

---

### Task 9: UI — Sparkle Icon on Calendar Event Cards

**Files:**
- Modify: `packages/ui/src/CalendarTimeline.tsx` (lines 548-550)
- Modify: `apps/desktop/src/App.tsx` (line 163)

- [ ] **Step 1: Replace pulsing dot with sparkle icon in CalendarTimeline**

In `packages/ui/src/CalendarTimeline.tsx`, find the `hasBrettContext` indicator (around line 548-550):

```tsx
{event.hasBrettContext && (
  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shadow-[0_0_5px_rgba(96,165,250,0.8)] mt-1" />
)}
```

Replace with a sparkle character:

```tsx
{event.hasBrettContext && (
  <span className="text-[10px] text-amber-400/60 leading-none mt-0.5" title="Brett's Take available">✦</span>
)}
```

- [ ] **Step 2: Wire hasBrettContext to brettObservation in App.tsx**

In `apps/desktop/src/App.tsx`, find where calendar events are mapped to `CalendarEventDisplay` objects (around line 163). Change:

```typescript
hasBrettContext: false,
```

To:

```typescript
hasBrettContext: !!r.brettObservation,
```

This requires that the events list API response now includes `brettObservation` (done in Task 3).

- [ ] **Step 3: Also update the events list API if needed**

Check if the events list endpoint in `apps/api/src/routes/calendar.ts` returns `brettObservation`. If not, add it in Task 3 Step 2. The field should be on the CalendarEvent record by default since it's a scalar field.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/CalendarTimeline.tsx apps/desktop/src/App.tsx
git commit -m "feat(ui): show sparkle icon on calendar events with Brett's Take"
```

---

### Task 10: UI — Graceful "AI Not Configured" in BrettThread

**Files:**
- Modify: `packages/ui/src/BrettThread.tsx`
- Modify: `apps/desktop/src/api/brett-chat.ts`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add aiConfigured prop to BrettThread**

In `packages/ui/src/BrettThread.tsx`, add a new prop to `BrettThreadProps`:

```typescript
interface BrettThreadProps {
  messages: BrettThreadMessage[];
  totalCount?: number;
  hasMore: boolean;
  onSend: (content: string) => void;
  onLoadMore: () => void;
  isSending?: boolean;
  isStreaming?: boolean;
  isLoadingMore?: boolean;
  aiConfigured?: boolean;  // Add this
  onOpenSettings?: () => void;  // Add this
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
}
```

- [ ] **Step 2: Show inline message when AI is not configured**

In the BrettThread component, above the input area (before the textarea `<div>`), add:

```tsx
{aiConfigured === false && (
  <div className="px-4 pb-2">
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
      <p className="text-xs text-amber-300/80">
        Connect an AI provider in{" "}
        <button
          onClick={onOpenSettings}
          className="text-amber-300 underline underline-offset-2 hover:text-amber-200 transition-colors"
        >
          Settings
        </button>
        {" "}to chat with Brett.
      </p>
    </div>
  </div>
)}
```

- [ ] **Step 3: Disable input when AI is not configured**

In the textarea, add `disabled={aiConfigured === false}` and update the placeholder:

```tsx
<textarea
  ref={textareaRef}
  value={inputValue}
  onChange={(e) => setInputValue(e.target.value)}
  onKeyDown={handleKeyDown}
  placeholder={aiConfigured === false ? "AI provider required" : "Ask Brett\u2026"}
  rows={1}
  disabled={aiConfigured === false}
  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 resize-none focus:border-blue-500/20 min-h-[36px] max-h-[100px] disabled:opacity-40 disabled:cursor-not-allowed"
/>
```

Also disable the send button when `aiConfigured === false`:

```tsx
disabled={!inputValue.trim() || isSending || isStreaming || aiConfigured === false}
```

- [ ] **Step 4: Detect AI config status in useBrettChat**

In `apps/desktop/src/api/brett-chat.ts`, the `sendMessage` function already calls the API which returns 403 when AI isn't configured. Add error detection:

Add state tracking at the top of the hook:

```typescript
const [aiNotConfigured, setAiNotConfigured] = useState(false);
```

In the `sendMessage` function, when the fetch fails with 403 and `error === "ai_not_configured"`, set this flag:

```typescript
// In the error handling of sendMessage, after the fetch:
if (!response.ok) {
  if (response.status === 403) {
    const errorBody = await response.json().catch(() => null);
    if (errorBody?.error === "ai_not_configured") {
      setAiNotConfigured(true);
      return;
    }
  }
  // ... existing error handling
}
```

Add `aiNotConfigured` to the return value:

```typescript
return {
  messages,
  totalCount: totalCount + streamingMessages.length,
  isStreaming,
  isLoading: historyQuery.isLoading,
  hasMore: historyQuery.hasNextPage ?? false,
  isLoadingMore: historyQuery.isFetchingNextPage,
  loadMore: historyQuery.fetchNextPage,
  sendMessage,
  aiNotConfigured,  // Add this
};
```

- [ ] **Step 5: Also check AI config status proactively**

Rather than waiting for the user to send a message and get a 403, check proactively. Add a simple query to `useBrettChat` that checks if AI is configured:

```typescript
const aiConfigQuery = useQuery({
  queryKey: ["ai-config-status"],
  queryFn: async () => {
    const res = await apiFetch("/ai/config");
    if (!res.ok) return { configured: false };
    const data = await res.json();
    return { configured: data.configs?.some((c: any) => c.isActive && c.isValid) ?? false };
  },
  staleTime: 60_000, // Cache for 1 minute
});
```

Then use this instead of the error-based detection:

```typescript
const aiConfigured = aiConfigQuery.data?.configured ?? true; // Default to true to avoid flash
```

Return `aiConfigured` instead of `aiNotConfigured`.

- [ ] **Step 6: Pass aiConfigured and onOpenSettings through App.tsx**

In `apps/desktop/src/App.tsx`, pass the new props through the DetailPanel to BrettThread. The exact wiring depends on how DetailPanel passes props — find where `BrettThread` props are assembled and add:

```typescript
aiConfigured={calendarBrett.aiConfigured}
onOpenSettings={() => {/* open settings modal to AI section */}}
```

For `onOpenSettings`, check how settings are opened elsewhere in App.tsx and reuse that pattern.

- [ ] **Step 7: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/BrettThread.tsx apps/desktop/src/api/brett-chat.ts apps/desktop/src/App.tsx
git commit -m "feat(ui): show graceful AI-not-configured message in Brett Chat"
```

---

### Task 11: Verify Brett Chat End-to-End

**Files:** No changes — verification only.

- [ ] **Step 1: Start dev environment**

```bash
cd /Users/brentbarkman/code/brett && pnpm dev:full
```

- [ ] **Step 2: Verify Brett Chat for tasks**

1. Open a task detail panel
2. Type a message in Brett Chat
3. Verify: streaming response appears, messages persist on reload

If broken, trace the error from the browser console → API logs → fix.

- [ ] **Step 3: Verify Brett Chat for calendar events**

1. Open a calendar event detail panel
2. Type a message in Brett Chat
3. Verify: streaming response appears, messages persist on reload

- [ ] **Step 4: Verify AI not configured state**

1. Remove AI config from Settings (or use a different user with no config)
2. Open a detail panel
3. Verify: BrettThread shows the "Connect an AI provider" message, input is disabled

- [ ] **Step 5: Verify Brett's Take pre-generation**

1. Ensure AI provider is configured
2. Trigger a calendar sync (disconnect/reconnect, or wait for periodic sync)
3. Check events in next 48 hours with descriptions >50 chars
4. Verify: `brettObservation` is populated on qualifying events
5. Verify: sparkle icon appears on event cards in CalendarTimeline

- [ ] **Step 6: Verify token accounting**

1. After a Take is generated, go to Settings → AI section
2. Expand "Usage" under the active provider
3. Verify: `bretts take` appears as a source with non-zero token counts

- [ ] **Step 7: Document any issues found**

If any step fails, create a follow-up fix task. Don't block the commit on verification — the code changes are already committed in prior tasks.

---

### Task 12: Enrich Assembler Context for Calendar Event Takes

**Files:**
- Modify: `packages/ai/src/context/assembler.ts` (lines 510-530)

The current assembler for `bretts_take` on calendar events only fetches basic event data. The spec requires it also include user's notes and prior meeting transcripts for recurring events.

- [ ] **Step 1: Enhance the calendar event query in assembleBrettsTake**

In `packages/ai/src/context/assembler.ts`, find the `bretts_take` calendar event query (around line 511) and expand it:

```typescript
  if (input.calendarEventId) {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: input.calendarEventId, userId: input.userId },
      select: {
        title: true,
        startTime: true,
        endTime: true,
        description: true,
        location: true,
        myResponseStatus: true,
        attendees: true,
        meetingLink: true,
        recurringEventId: true,
        notes: {
          where: { userId: input.userId },
          take: 1,
          select: { content: true },
        },
      },
    });
    if (event) {
      let contextParts = [formatCalendarEvent(event)];

      // Include user's notes if present
      if (event.notes[0]?.content) {
        contextParts.push(`\nUser's notes:\n${event.notes[0].content}`);
      }

      // For recurring events, include most recent prior transcript
      if (event.recurringEventId) {
        const priorMeeting = await prisma.meetingNote.findFirst({
          where: {
            userId: input.userId,
            calendarEvent: {
              recurringEventId: event.recurringEventId,
              startTime: { lt: event.startTime },
            },
          },
          orderBy: { meetingStartedAt: "desc" },
          select: { summary: true, transcript: true },
        });
        if (priorMeeting) {
          if (priorMeeting.summary) {
            contextParts.push(`\nPrevious meeting summary:\n${priorMeeting.summary}`);
          }
          // Use summary over full transcript to avoid blowing token budget
        }
      }

      dataContext = wrapUserData("calendar_event", contextParts.join("\n"));
    }
  }
```

Note: We use `summary` over the full `transcript` JSON to keep token usage reasonable (modelTier is "small").

- [ ] **Step 2: Typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/context/assembler.ts
git commit -m "feat(ai): enrich Brett's Take context with user notes and prior meeting summaries"
```

---

### Task 13: Final Typecheck and Test Run

**Files:** No changes — validation only.

- [ ] **Step 1: Full typecheck**

```bash
cd /Users/brentbarkman/code/brett && pnpm typecheck
```

Expected: No errors across all packages.

- [ ] **Step 2: Run all tests**

```bash
cd /Users/brentbarkman/code/brett && pnpm test
```

Expected: All tests pass. The deleted `brett.test.ts` should no longer run.

- [ ] **Step 3: Run the new tests specifically**

```bash
cd /Users/brentbarkman/code/brett && pnpm test -- --run apps/api/src/__tests__/brett-take-generator.test.ts
```

Expected: All qualification and staleness tests pass.

---

## Expert Review Notes

### Principal Software Engineer Review

**Concern 1: Prisma `transcript: { not: undefined }` filter in Task 5.**
Prisma's JSON field filtering doesn't work with `{ not: undefined }` — `undefined` is ignored by Prisma, making the filter a no-op. Use `{ not: Prisma.DbNull }` or `{ not: Prisma.JsonNull }` for JSON fields. The `transcript` field on `MeetingNote` is `Json?`, so the correct filter is:

```typescript
transcript: { not: Prisma.DbNull },
```

Import `Prisma` from `@prisma/client` at the top of `brett-take-generator.ts`.

**Concern 2: Sequential Take generation blocks the sync response.**
`generatePendingTakes` is called fire-and-forget (`.catch()`), which is correct — it won't block the sync completion SSE event. But each Take generation involves an LLM call (seconds each). With 10 events, that's potentially 30-60 seconds of sequential LLM calls on the same event loop. This is fine because it's fire-and-forget and Node handles I/O concurrently, but worth noting.

**Concern 3: Missing `Prisma.JsonNull` import.**
When checking `transcript: { not: Prisma.DbNull }`, ensure `Prisma` is imported. Add: `import { Prisma } from "@prisma/client";`

**Concern 4: `useBrettsTake` deletion safety.**
Verify no file imports `bretts-take.ts` before deleting. The grep confirms it's not imported anywhere, so deletion is safe.

### Paranoid Security Engineer Review

**Concern 1: Pre-generation uses decrypted user API keys server-side.**
This is inherent to the BYOK model and already happens in the existing `aiMiddleware`. The pre-generation code follows the exact same pattern: fetch encrypted key → decrypt → create provider → call LLM. The key never leaves the server process. **No new attack surface.**

**Concern 2: Calendar event data sent to third-party LLM APIs.**
The user's calendar descriptions, attendees, locations, and meeting transcripts are sent to whichever AI provider the user configured (Anthropic, OpenAI, Google). This is the same data exposure as Brett Chat. The user opted in by configuring their API key. **Acceptable — same trust model as existing features.**

**Concern 3: No authorization check in `generateSingleTake`.**
The function takes a `userId` and `eventId` but doesn't verify the event belongs to the user. However, `generatePendingTakes` queries events with `where: { userId }`, so only the user's own events are passed. The `assembleContext` function also queries with `userId`. **Defense in depth is adequate.**

**Concern 4: Rate limiting on pre-generation.**
The 10-events-per-cycle budget cap prevents runaway token usage, but there's no per-user daily cap. If a user has frequent syncs (webhooks fire often), they could generate many Takes per day. Consider: the webhook debounce (10s) + sync cooldown already limit frequency. Plus `needsGeneration` skips events with fresh Takes. **Acceptable for v1 — monitor via AIUsageLog.**

**Concern 5: Error messages don't leak API keys.**
The orchestrator already sanitizes errors via `sanitizeError()` (replaces `sk-*`, `key-*`, high-entropy strings with `[REDACTED]`). Pre-generation errors are caught and logged server-side only — they never reach the client. **No leak risk.**

### World-Class AI Engineer Review

**Concern 1: Model tier for Takes is "small" — is that sufficient?**
The assembler sets `modelTier: "small"` for `bretts_take`. This maps to the cheapest model tier. For a brief insight paragraph, this is appropriate — you don't need a frontier model for a 2-3 sentence observation. **Correct choice for cost/quality tradeoff.**

**Concern 2: No prompt caching for repeated event context.**
If the same event is regenerated (staleness), the system prompt + user facts are re-sent without caching. The orchestrator does support cache tokens (`cacheCreationTokens`, `cacheReadTokens`), but this depends on the provider supporting prompt caching (Anthropic does, OpenAI/Google vary). **No action needed — the existing orchestrator handles caching transparently where supported.**

**Concern 3: Context window budget for recurring events with transcripts.**
Meeting transcripts can be very long. The plan uses `summary` over full `transcript` for prior meetings, which is the right call. But even summaries can vary in length. The orchestrator has a `MAX_TOTAL_TOKENS` budget that will truncate if needed. **Adequate safeguard.**

**Concern 4: Take quality depends heavily on event description quality.**
The 50-character minimum filters out "zoom link only" descriptions but still allows low-quality descriptions like "Discuss things with the team about the project and other items." The Take will be proportionally useless. **Acceptable — the LLM will produce a generic Take, which is harmless. Users will learn which events get useful Takes.**

**Concern 5: No feedback loop for Take quality.**
There's no mechanism for users to rate or dismiss a Take, which would help tune the qualification criteria over time. **Out of scope for v1, but worth considering for v2** — a simple thumbs up/down on the Take callout could feed back into generation decisions.**

**Concern 6: `logUsage` is called by the orchestrator automatically.**
The pre-generation pipeline calls `orchestrate()` directly, which calls `logUsage()` internally for each round. The `sessionId` is passed, so usage is attributed to the correct session. `source` comes from the `input.type` field (`"bretts_take"`). **Token accounting works automatically — no additional code needed.**
