# Wordmark Styling & Assistant Rename

**Date:** 2026-04-06
**Status:** Design approved, pending implementation

## Summary

Two related changes:

1. **Wordmark uplift** — Replace the plain white "Brett" text in the LeftNav with a styled wordmark: Plus Jakarta Sans ExtraBold in metallic gold, with a cerulean underline bar that breathes when the AI is working.
2. **Assistant rename** — Let users rename the AI assistant (default "Brett"). All ~40 user-facing strings and all LLM system prompts swap to the custom name. All copy is gender-neutral.

---

## 1. Data Model

### User table — new field

```prisma
assistantName  String  @default("Brett")  // 1-10 characters, trimmed
```

**Validation:**
- Min 1 character, max 10 characters
- Trimmed (no leading/trailing whitespace)
- No empty/whitespace-only strings
- Alphanumeric + spaces + basic punctuation (letters, numbers, spaces, hyphens, apostrophes)
- Reject strings containing HTML tags, angle brackets, or null bytes

**Security considerations:**
- **Prompt injection:** The name is interpolated into system prompts sent to the LLM. The 10-char limit + character whitelist (letters, numbers, spaces, hyphens, apostrophes only) makes meaningful injection infeasible — you can't construct "ignore previous instructions" in 10 chars of alphanumeric text. No additional runtime sanitization needed beyond the whitelist.
- **XSS:** The name is rendered in React JSX via `{name}` (not `dangerouslySetInnerHTML`), so XSS via the name field is not possible in the UI. The character whitelist also excludes `<`, `>`, `"`, `'` (apostrophe is curly/typographic only if needed — clarify in implementation whether `'` is allowed). **Decision: allow ASCII apostrophe `'` — it's needed for names like "O'Brien" and React's JSX rendering escapes it safely.**
- **Server-rendered HTML:** OAuth callback pages use `callbackHtml()` which should already escape interpolated values. Verify during implementation that any helper rendering HTML escapes the assistant name if it's ever used there (per decision above, it won't be, but defense in depth).
- **Stored XSS via API:** The `PATCH /users/me` endpoint must validate server-side (not just client-side). The whitelist regex: `/^[a-zA-Z0-9 '\-]{1,10}$/` after trimming.

**Migration:** Non-breaking. Default value means no backfill needed.

### What does NOT change

- Database field names (`brettObservation`, `brettMessages`, etc.)
- API route paths (`/api/brett-chat`, `/api/brett-intelligence`, etc.)
- File/component names (`BrettMark.tsx`, `BrettThread.tsx`, etc.)
- Export names (`BrettMark`, `ProductMark`, `BrettThread`)
- Code variables and internal comments
- The `source` field default of `"Brett"` on Items (this is an internal origin label, not user-facing)

---

## 2. Wordmark Component

### New export: `Wordmark`

**File:** `packages/ui/src/BrettMark.tsx` (alongside existing `BrettMark` and `ProductMark`)

```tsx
interface WordmarkProps {
  name: string;
  isWorking?: boolean;
  size?: number; // font-size in px, default 19
}
export function Wordmark({ name, isWorking = false, size = 19 }: WordmarkProps)
```

### Visual spec

- **Font:** Plus Jakarta Sans, weight 800 (ExtraBold)
- **Loading:** Bundled as a web font in the Electron app (same as Switzer). Only weights 700 and 800 are needed. Downloaded from Google Fonts and added to the font loading pipeline in `index.css`.
- **Color:** Metallic gold gradient, top-to-bottom: `#F5D96B` → `#D4A020`. Applied via `background-clip: text`.
- **Letter-spacing:** `0.03em`
- **Size:** 19px at default nav size (prop-configurable)
- **Max width:** CSS `truncate` (ellipsis) as a safety net

### Cerulean underline bar

- **Shape:** Rounded rect, 2.5px tall, `border-radius: 2px`
- **Width:** 65% of the rendered text width
- **Color:** `linear-gradient(90deg, #4682C3, #5A9AD6 70%, transparent 100%)` — fading right
- **Idle state:** Static, `opacity: 0.55`
- **Working state:** Breathing animation — opacity oscillates `0.45 → 0.9`, `1.4s ease-in-out infinite`. This matches the `brettSignalPulse` animation timing in `BrettMark`.

### Design rationale

The cerulean underline is visually the "fourth bar" in the product mark cascade. The mark has three gold bars that get progressively shorter; the cerulean bar under the name continues that rhythm in the AI's color. This ties the wordmark to Brett's mark (gold dot + cerulean line) — same visual language, same colors, same roles.

### LeftNav integration

```tsx
// Before
<span className="text-white font-bold tracking-wide">Brett</span>

// After
<Wordmark name={assistantName} isWorking={isAnyAIStreaming} />
```

The `isWorking` boolean is true when any AI surface is actively streaming (omnibar, thread, briefing, or Brett's Take generation). This state is already tracked — the omnibar hook exposes `isStreaming`, and the thread components track their own streaming state. A lightweight global signal (React context or a shared query key) aggregates these into a single boolean for the wordmark.

---

## 3. Client-Side String Replacement

### Hook: `useAssistantName()`

**File:** `apps/desktop/src/api/assistant-name.ts`

Returns the user's `assistantName` from the session/user query (already fetched by auth). No additional API call needed.

```tsx
export function useAssistantName(): string {
  const user = useUser(); // existing auth context
  return user?.assistantName ?? "Brett";
}
```

### Components to update (~16 files)

Every hardcoded `"Brett"` in user-facing UI text is replaced with the hook value. Grouped by component:

**packages/ui/** (these components receive `assistantName` as a prop from the desktop app):

| Component | Strings | Change |
|-----------|---------|--------|
| `Omnibar.tsx` | "Ask Brett anything...", "Ask Brett: ...", "Brett is thinking...", "unlock Brett's full capabilities" | `{name}` interpolation |
| `SpotlightModal.tsx` | "Ask Brett anything...", "Ask Brett: ...", "Brett is thinking..." | `{name}` interpolation |
| `BrettThread.tsx` | "Brett is working...", "Brett is thinking...", "Brett" (header), "Brett needs an AI provider...", "Ask Brett anything..." | `{name}` interpolation |
| `ContentDetailPanel.tsx` | "Brett's Take" | `{name}'s Take` |
| `CalendarEventDetailPanel.tsx` | "Brett's Take" | `{name}'s Take` |
| `CalendarTimeline.tsx` | "Brett's Take available" (tooltip) | `{name}'s Take available` |
| `DailyBriefing.tsx` | "Brett needs an AI provider..." | `{name} needs an AI provider. Set one up in Settings.` |
| `NotFoundView.tsx` | "Brett doesn't know this place either." | `{name} doesn't know this place either.` |
| `LeftNav.tsx` | Wordmark text | Uses new `Wordmark` component |

**apps/desktop/** (these use the hook directly):

| Component | Change |
|-----------|--------|
| `App.tsx` | Passes `assistantName` to UI components that need it |

### Gender-neutral copy

All gendered language is removed:

| Before | After |
|--------|-------|
| "Brett needs an AI provider to work his magic. Set one up in Settings." | "{name} needs an AI provider. Set one up in Settings." |

This is the only gendered string. All other strings are already neutral.

### Prop threading

UI components in `packages/ui/` can't use the `useAssistantName()` hook (it depends on desktop auth context). Instead, `App.tsx` passes `assistantName` as a prop to the top-level UI components that need it. Components like `Omnibar`, `SpotlightModal`, `BrettThread`, etc. already accept configuration props from `App.tsx` — this adds one more.

**New prop on affected UI components:**
```tsx
assistantName?: string; // defaults to "Brett" if not provided
```

---

## 4. Server-Side: System Prompts

### Constants → functions

**File:** `packages/ai/src/context/system-prompts.ts`

```ts
// Before
export const BRETT_SYSTEM_PROMPT = `You are Brett, a personal...`

// After
export function getSystemPrompt(assistantName: string): string {
  return `You are ${assistantName}, a personal productivity assistant...`
}
```

Four prompts become functions:

| Constant | Function |
|----------|----------|
| `BRETT_SYSTEM_PROMPT` | `getSystemPrompt(name)` |
| `BRIEFING_SYSTEM_PROMPT` | `getBriefingPrompt(name)` |
| `BRETTS_TAKE_SYSTEM_PROMPT` | `getBrettsTakePrompt(name)` |
| `FACT_EXTRACTION_PROMPT` | `getFactExtractionPrompt(name)` |

`SECURITY_BLOCK` and `SCOUT_CREATION_PROMPT` remain constants (no user-facing name references).

### Callsite changes

Every place that references these prompts already has access to the authenticated user (via `c.get("user")` in Hono routes). The user's `assistantName` is read from the user record and passed to the prompt function.

Affected routes:
- `apps/api/src/routes/brett-intelligence.ts` — omnibar chat, Brett's Take
- `apps/api/src/routes/calendar.ts` — calendar Brett thread
- `apps/api/src/routes/things.ts` — thing Brett thread
- Any briefing generation endpoint

### Explain-feature skill

**File:** `packages/ai/src/skills/explain-feature.ts`

Feature descriptions reference "Brett" by name. These become a function that accepts the assistant name:

```ts
// Before
"Brett is your AI assistant. Ask questions..."

// After
function getFeatureDescriptions(name: string) {
  return {
    ...
    brett: `${name} is your AI assistant. Ask questions...`,
    bretts_take: `${name}'s Take is an AI-generated observation...`,
    ...
  };
}
```

### OAuth callback pages

**Files:** `apps/api/src/routes/calendar-accounts.ts`, `apps/api/src/routes/granola-auth.ts`

These render HTML pages shown in the browser during OAuth flows with messages like "Head back to Brett." These pages are server-rendered **but the user may not be authenticated** at the point the callback fires (the OAuth flow may have cleared the session context). Two options:

1. **Keep "Brett" hardcoded in OAuth callbacks.** These are transient pages the user sees for 2 seconds. The product is called Brett. This is the product name, not the assistant name.
2. Query `assistantName` from the user record if available, fall back to "Brett".

**Decision: Option 1.** OAuth callbacks use the product name. These are system pages, not AI surfaces. The rename applies to AI-personality strings, not product infrastructure.

### Granola auth messages

Same reasoning — "Head back to Brett" refers to the app, not the assistant. Stays hardcoded.

### Download page

**File:** `apps/api/src/routes/download.ts`

The download page renders the app name "Brett" in the page title and UI. This is the **product name**, not the assistant name — it stays hardcoded. The product is called Brett regardless of what the user names their assistant.

---

## 5. Settings UI

### Location: Profile tab (`#profile`)

The assistant name is a personal identity choice, so it lives in the Profile section alongside the user's own name and avatar.

### UI

- **Label:** "Assistant name" (section header style: `text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40`)
- **Input:** Text field, same inline input pattern as other profile fields
- **Max length:** 10 characters (enforced on input + server validation)
- **Placeholder:** "Brett"
- **Save:** Same auto-save / blur-save pattern as existing profile fields
- **Feedback:** Inline success state (same as other settings), inline error for validation failures

### API endpoint

```
PATCH /users/me  { assistantName: "Jarvis" }
```

Uses the existing user update endpoint. Server validates: 1-10 chars, trimmed, character whitelist (letters, numbers, spaces, hyphens, apostrophes), no HTML/angle brackets/null bytes.

---

## 6. Font Loading

Plus Jakarta Sans (weights 700, 800) is added to the font bundle alongside Switzer.

**File:** `apps/desktop/src/index.css` (or equivalent font-loading setup)

```css
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

Font files are downloaded and bundled locally (no CDN dependency), same as Switzer.

---

## 7. Migration & Rollout

- **Database migration:** `ALTER TABLE "User" ADD COLUMN "assistantName" TEXT NOT NULL DEFAULT 'Brett';`
- **No backfill needed** — default value covers existing users
- **No breaking changes** — all new props have defaults, all prompt functions have the same signature
- **Backwards compatible** — if the client doesn't send `assistantName`, the server uses the default

---

## 8. Edge Cases

- **Empty name after trim:** Reject, keep previous value. The input should prevent this client-side; the server enforces it as a backstop.
- **Name changes while AI is streaming:** The wordmark updates immediately (React re-render). In-flight LLM responses still use the old name (the system prompt was already sent). This is acceptable — the next request uses the new name.
- **Possessive form:** `{name}'s Take` works for most names. Edge case: names ending in "s" (e.g., "James" → "James's Take" vs "James' Take"). **Decision: always use `'s`** — "James's Take" is grammatically correct per modern English style guides and avoids conditional logic.
- **Collapsed LeftNav:** When the nav is collapsed (68px), only the ProductMark shows — the wordmark is hidden. No issue.
- **Font loading race:** If Plus Jakarta Sans hasn't loaded yet, CSS `font-display: swap` shows the name in the fallback font (system sans-serif), then swaps. Acceptable — the wordmark is not above the fold on initial load.

---

## 9. Out of Scope

- Custom AI mark colors (always gold dot + cerulean line)
- Pronoun customization (all copy is gender-neutral)
- Custom voice/personality per name
- Renaming the product itself (always "Brett" in marketing, download page, app store)
- Mobile app (deferred)
