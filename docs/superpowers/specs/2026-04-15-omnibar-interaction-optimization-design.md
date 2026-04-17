# Omnibar Interaction & Performance Optimization

Date: 2026-04-15
Status: Design — awaiting approval

## Context

The Omnibar (top-of-app bar) and Spotlight Modal (⌘K floating modal) are two surfaces backed by the same `useOmnibar` hook (`apps/desktop/src/api/omnibar.ts`). Users report the experience is "a bit janky" — both in raw interaction responsiveness and in the interaction model itself (what happens when you click outside during a conversation, how streaming feels, how quickly the surface opens and closes).

This spec captures the first pass of fixes: performance jank plus one interaction-model change (click-outside-to-minimize). Further interaction-model work is deferred pending user feedback after this pass lands.

Per `CLAUDE.md`, every change here must apply identically to both `Omnibar.tsx` and `SpotlightModal.tsx` — they are two surfaces for the same feature.

## Scope

**In scope:**
- Performance fixes in the streaming state pipeline (`useOmnibar`)
- Transition/animation polish in `Omnibar.tsx` and `SpotlightModal.tsx`
- Race-safe open/close animation
- Smart auto-scroll that respects user scroll position during streaming
- Click-outside-to-minimize behavior preserving conversation state
- Hook return identity stabilization to eliminate cross-app re-render churn

**Out of scope:**
- Backend or SSE protocol changes
- New dependencies
- Rewriting the `useOmnibar` hook's architecture
- Broader interaction-model changes beyond click-outside (deferred)
- Changes to `InboxView`, `ThingsList`, `UpcomingView` even though they co-exist with the Omnibar

## Files Touched

- `apps/desktop/src/api/omnibar.ts` — hook: batching, invalidation deferral, `minimize` action, return-shape split
- `packages/ui/src/Omnibar.tsx` — transitions, focus, auto-scroll, minimize render branch
- `packages/ui/src/SpotlightModal.tsx` — mirrored changes (animations, focus, auto-scroll)
- `apps/desktop/src/App.tsx` — wire new `onMinimize` handler, update `omnibarProps`
- `apps/desktop/src/api/__tests__/omnibar.test.ts` — new coverage

## Hook Changes (`apps/desktop/src/api/omnibar.ts`)

### Return-shape split (conservative)

Keep the flat shape consumers use today. Split the existing single `useMemo` into two, then merge:

```ts
const actions = useMemo(() => ({
  open, close, cancel, reset, setInput,
  send, createTask, searchThings, minimize,
}), [open, close, cancel, reset, send, createTask, searchThings, minimize]);
// setInput is a useState setter and already stable

const state = useMemo(() => ({
  isOpen, mode, input, messages, isStreaming, sessionId,
  hasAI, searchResults, isSearching, isMinimized,
}), [isOpen, mode, input, messages, isStreaming, sessionId,
     hasAI, searchResults, isSearching, isMinimized]);

return useMemo(() => ({ ...state, ...actions }), [state, actions]);
```

Consumer benefit: when an effect depends on `omnibar` and only reads actions (e.g. App.tsx keyboard-shortcut setup), React's shallow dep comparison sees a new top-level object on every streaming chunk, but Compiler + our downstream useEffect dep check can reference `omnibar.open`/`omnibar.close` via destructuring. Where needed, App.tsx can destructure actions once at the top (e.g. `const { open, close } = omnibar`) so the effect depends on stable references — this is the pattern to adopt in consumer effects that don't read state.

Alternative considered: return `{ state, actions }` as two top-level keys. Rejected because every callsite (~40 in App.tsx) already reads flat. Too invasive for the gain.

### rAF-batched streaming text

Problem: each SSE `text` chunk calls `setMessages` with a fresh array, rebuilding the last message object. Under fast streams this is dozens of renders per second of the entire Omnibar tree (~765 lines of JSX).

Approach:
```ts
const pendingTextRef = useRef<string>("");
const pendingFrameRef = useRef<number | null>(null);

function scheduleFlush() {
  if (pendingFrameRef.current !== null) return;
  pendingFrameRef.current = requestAnimationFrame(() => {
    pendingFrameRef.current = null;
    const buffered = pendingTextRef.current;
    if (!buffered) return;
    pendingTextRef.current = "";
    setMessages((prev) => {
      // append buffered to last assistant message
    });
  });
}
```

On `chunk.type === "text"`: append to `pendingTextRef.current`, call `scheduleFlush()`.

On stream end / abort / error: flush synchronously (cancel pending rAF, drain buffer into one final `setMessages`), so final text is never lost. Specifically:
- `case "done":` flush before `setSessionId`
- `catch` block: flush before setting error message
- `finally` block: if any pending frame still scheduled, cancel and drain

### Deferred query invalidation

Problem: during a multi-tool response, each `tool_result` chunk triggers up to 5 `invalidateQueries` + 3 `refetchQueries` calls inline. Each refetch is a network round-trip and a re-render cascade.

Approach:
- Build a `pendingInvalidations = new Set<string>()` (scoped to the `send()` closure — reset each call).
- On `tool_result`: add the string keys (`"things"`, `"inbox"`, etc.) to the set; skip the refetch.
- Exception: if `displayHint.type === "confirmation" || "task_created"`, invalidate immediately — the user sees the confirmation card and expects lists to update. (Still skip `refetchQueries`; mark-stale is sufficient for active observers.)
- In `finally`: iterate the set and call `invalidateQueries({ queryKey: [key] })` once per key.

Net effect: tool calls that don't produce user-visible confirmation cards don't trigger backing-list refetches until the stream ends. The one-per-key flush at the end handles cleanup.

Tradeoff: for multi-tool responses where the UI should reflect mid-stream state (none currently exist), invalidation is batched. If future tools need mid-stream refresh, they can opt in via a new displayHint type. Not a concern today.

### New action: `minimize`

```ts
const [isMinimized, setIsMinimized] = useState(false);

const minimize = useCallback(() => {
  if (stateRef.current.isStreaming) return; // don't minimize mid-stream
  setIsMinimized(true);
}, []);

// open() and reset() both clear isMinimized
const open = useCallback((newMode: OmnibarMode = "bar") => {
  setMode(newMode);
  setIsOpen(true);
  setIsMinimized(false);
}, []);
```

`close()` leaves `isMinimized` as-is (the hook's `close` already preserves `input/messages/sessionId`; `isMinimized` follows that pattern).

Semantics:
- `minimize()`: collapse the expanded surface while preserving conversation state. Input is re-accessible via the bar form.
- `close()`: as today — hide the surface entirely. Conversation state preserved so reopen restores.
- `reset()`: as today — clear conversation state; also clears `isMinimized`.

## Component Changes

### Omnibar.tsx

**Transition scope tightening**

Replace `transition-all duration-300 ease-in-out` on the container (line 373) with `transition-[border-color,box-shadow] duration-300 ease-in-out`. Replace `transition-all duration-150 ease-out` on the expanded panel (line 423) with `transition-[opacity,transform] duration-150 ease-out`.

**Race-safe close animation**

```ts
const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const animateClose = () => {
  if (isClosing) return;
  setIsClosing(true);
  closeTimerRef.current = setTimeout(() => {
    closeTimerRef.current = null;
    setIsClosing(false);
    setForcedAction(null);
    setConfirmedTask(null);
    onClose();
  }, 150);
};

// When isOpen flips true, cancel any pending close
useEffect(() => {
  if (isOpen && closeTimerRef.current) {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setIsClosing(false);
  }
}, [isOpen]);

// Cleanup on unmount
useEffect(() => () => {
  if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
}, []);
```

**Focus timing**

Drop the 50ms `setTimeout` in favor of `requestAnimationFrame`:
```ts
useEffect(() => {
  if (isOpen) {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }
}, [isOpen]);
```

**Smart auto-scroll**

```ts
const userScrolledUpRef = useRef(false);
const scrollFrameRef = useRef<number | null>(null);

const handleScroll = () => {
  const el = chatContainerRef.current;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  userScrolledUpRef.current = !nearBottom;
};

useEffect(() => {
  if (userScrolledUpRef.current) return;
  if (scrollFrameRef.current !== null) return;
  scrollFrameRef.current = requestAnimationFrame(() => {
    scrollFrameRef.current = null;
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
}, [messages]);

// Reset to bottom when user sends (their new message should be visible)
useEffect(() => {
  const last = messages[messages.length - 1];
  if (last?.role === "user") userScrolledUpRef.current = false;
}, [messages.length]);
```

Apply `onScroll={handleScroll}` to the chat container.

**Minimize render branch**

- New prop: `isMinimized: boolean`, `onMinimize: () => void`.
- Compute `hasConversation = messages.length > 0 && !isMinimized` (treat minimize as "hide conversation").
- Or, cleaner: keep `hasConversation = messages.length > 0` but add a separate `showConversation = hasConversation && !isMinimized`. Use `showConversation` for the conversation area render gate. Use `!showConversation` for the bar form render gate.
- When minimized + messages present: the bar form renders with a subtle visual hint that a conversation is paused (e.g. a small "Resume" chip or just a styled Brett mark). Simplest: set the input's placeholder to `Resume conversation...` and keep the bar otherwise identical. Clicking input or pressing ⌘K triggers `open()` which clears `isMinimized` and shows the conversation area.

**Click-outside behavior**

Replace the current gate:
```ts
useClickOutside(containerRef, () => {
  if (isOpen && !isStreaming && messages.length === 0) {
    animateClose();
  }
}, isOpen);
```
With:
```ts
useClickOutside(containerRef, () => {
  if (!isOpen || isStreaming) return;
  if (messages.length === 0) {
    animateClose();
  } else {
    onMinimize();
  }
}, isOpen);
```

### SpotlightModal.tsx

Mirror all of the above (transitions, focus, auto-scroll, race-safe close if a close animation exists — currently it just uses `animate-in fade-in zoom-in-95 duration-200` on open, no manual close animation; nothing to race-guard there).

**Click-outside (backdrop) — C-minimal**

Current backdrop handler (line 323-324):
```tsx
<div className="absolute inset-0 bg-black/60 backdrop-blur-2xl"
     onClick={() => !isStreaming && onClose()} />
```

No change required functionally: hook's `close()` already preserves `messages`/`sessionId`. Reopening Spotlight restores the conversation. Manual verification item (in Testing section) confirms this works end-to-end.

Document this in a code comment above the backdrop: `// Backdrop click closes the modal but preserves conversation state (messages, sessionId) so reopening restores the session.`

## App.tsx Wiring

Add `onMinimize: omnibar.minimize` and `isMinimized: omnibar.isMinimized` to `omnibarProps` (apps/desktop/src/App.tsx:638). Same for `scoutsOmnibarProps` spread target.

Where the keyboard effect (line 593) depends on `[omnibar]`, destructure the actions it uses:
```ts
const { open, close, mode, isOpen } = omnibar;
// ... effect body uses open/close/mode/isOpen ...
}, [open, close, mode, isOpen]);
```
`open` and `close` are stable via the new `actions` memo. `mode` and `isOpen` change only on actual user action, not on streaming chunks. Net: this effect no longer re-runs per chunk.

The scout-detection effect (line 839) genuinely needs `messages` — leave it as-is.

## Testing

### Unit tests (`apps/desktop/src/api/__tests__/omnibar.test.ts`)

Extend with:

1. **Text batching coalesces chunks** — feed 10 synthetic `text` chunks within a single tick, assert `setMessages` (via state snapshots) reflects a single update batch per rAF. Use `vi.useFakeTimers()` + `vi.stubGlobal("requestAnimationFrame", fn => setTimeout(fn, 16))` to drive rAF deterministically.

2. **Invalidations deferred to stream end** — mock `queryClient.invalidateQueries` as a spy. Send a stream with 3 `tool_result` chunks (none with confirmation displayHint) + `done`. Assert invalidate called only after `done`, once per key.

3. **Confirmation displayHint triggers immediate invalidate** — tool_result with `type: "task_created"` → invalidate called mid-stream.

4. **`minimize()` preserves messages** — open, send, assert `messages.length > 0`, call `minimize()`, assert `isMinimized === true` and `messages` unchanged.

5. **`open()` clears `isMinimized`** — from the above state, call `open()`, assert `isMinimized === false` and `messages` still intact.

6. **`minimize()` is a no-op during streaming** — start a send (don't complete), call `minimize()`, assert `isMinimized === false`.

7. **Action identity stable across message updates** — grab `omnibar.open` reference before + after a message update, assert `===`.

### Manual verification

Run `pnpm dev:full` and exercise:

- **Smooth streaming** — ask a long-form question, watch response render in steady sub-16ms chunks, not burst-then-pause.
- **Scroll-up-mid-stream stays put** — while response streams, scroll up to re-read earlier content; scroll position should not jump back to bottom. Sending a follow-up resets that.
- **Rapid ⌘K toggle** — mash ⌘K a dozen times; no visual glitch, no stuck "half-open" state.
- **Minimize + reopen** — start a conversation, click outside → bar collapses but remains visible. Click input → conversation restores with all messages intact.
- **Click-outside-during-streaming is ignored** — start a send, immediately click outside; omnibar stays expanded, stream completes normally.
- **Spotlight backdrop close preserves session** — open Spotlight, send, click backdrop, press ⌘K-K again (Spotlight shortcut), conversation restored.
- **Cross-app typecheck** — `pnpm typecheck` passes after the hook shape tweak.

## Risks

- **Action identity destructuring regression** — if any consumer reads `omnibar.send(...)` inline inside an effect body (rather than destructuring), the new memo split won't help that consumer. Audit during implementation.
- **rAF timing in tests** — fake timer / rAF stubbing can be finicky. Accepted complexity; test value justifies it.
- **Deferred invalidations and tool behavior** — if a future tool depends on mid-stream list refresh (e.g. an agent tool that reads Brett's list state after a prior tool modified it), the batch could cause stale reads. Low risk today because current tools don't read list state mid-stream; flag in PR description for future awareness.
- **Minimize visual discoverability** — the first time a user clicks outside during a conversation and sees the bar collapse, the "resume" affordance must be obvious. The placeholder-based hint (`Resume conversation...`) is the cheap experiment; if users miss it, a follow-up can add a visible chip or dot indicator.

## Rollout

Single PR. All changes land together. No feature flag — the changes are internal consistency improvements and one new interaction (minimize on click-outside). If the minimize behavior turns out to feel wrong in practice, it's a one-line revert in `useClickOutside` callback back to `animateClose()`.

Desktop-only change. Mobile is unaffected (different codebase, no omnibar).

## Open Questions Resolved

- **Hook shape:** Conservative split (flat return, two internal memos). Not returning `{ state, actions }`.
- **Spotlight minimize behavior:** C-minimal — backdrop close preserves conversation state; no cross-component animation to the bar.
- **Auto-scroll threshold:** 40px from bottom counts as "at bottom."
- **Minimize visual:** placeholder hint only; chip/dot indicator deferred.
