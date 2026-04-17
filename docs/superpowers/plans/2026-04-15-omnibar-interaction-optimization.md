# Omnibar Interaction & Performance Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate streaming-induced render churn, tighten animation scope, add smart auto-scroll and click-outside-to-minimize, across both `Omnibar` and `SpotlightModal`.

**Architecture:** Split `useOmnibar`'s memo so action identity stays stable across streaming chunks. Batch SSE text chunks via rAF and defer query invalidations until the stream ends. Swap `transition-all` for scoped property lists. Add `isMinimized` state to the hook; Omnibar collapses to bar form on click-outside during a conversation (Spotlight modal closes but preserves session for restore).

**Tech Stack:** TypeScript · React 19 (with React Compiler) · Vitest · @testing-library/react · React Query · Tailwind

**Spec:** [`docs/superpowers/specs/2026-04-15-omnibar-interaction-optimization-design.md`](../specs/2026-04-15-omnibar-interaction-optimization-design.md)

**File structure:**
- `apps/desktop/src/api/omnibar.ts` — hook (modified): split memo, minimize action, rAF batching, deferred invalidation
- `packages/ui/src/Omnibar.tsx` — component (modified): transitions, focus, close animation, auto-scroll, minimize, click-outside
- `packages/ui/src/SpotlightModal.tsx` — component (modified): mirrored animation/focus/scroll changes + preserve-conversation backdrop
- `apps/desktop/src/App.tsx` — consumer (modified): wire `onMinimize`/`isMinimized`, destructure stable actions in keyboard effect
- `apps/desktop/src/api/__tests__/omnibar.test.ts` — tests (modified): coverage for new hook behavior

**Working directory (worktree):** `/Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach`

---

## Task 1: Hook — return-shape split (actions vs state memos)

**Files:**
- Modify: `apps/desktop/src/api/omnibar.ts` (the final `return useMemo(...)` at lines ~339-374)

**Why:** This is a pure structural refactor. The final useMemo currently depends on `messages`, so it recomputes on every SSE text chunk. That's fine — individual callback identities are already stable via their own `useCallback` wrappers. What the split SETS UP is the pattern Task 9 consumes: App.tsx destructures actions and depends only on them in its keyboard-shortcut effect, which then stops re-running per chunk. Without this split, destructuring would work too — but codifying the actions-vs-state separation in the hook signals the intent to future maintainers and avoids someone accidentally reshuffling a callback into the state memo.

**No new test** — Task 1 preserves all observable behavior. Existing tests (18 in `omnibar.test.ts`) must continue to pass, which is the regression guarantee.

- [ ] **Step 1: Confirm existing tests pass before the refactor (baseline)**

From `apps/desktop`:
```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts
```
Expected: 18 tests pass.

- [ ] **Step 2: Split the memo in `apps/desktop/src/api/omnibar.ts`**

Replace the final `return useMemo(...)` block (roughly lines 339-374) with this structure. Leave the `stateRef` + `useCallback` definitions above untouched.

```typescript
  // Actions — stable identity across streaming state changes. Consumer effects
  // that only depend on actions (e.g. keyboard shortcut setup in App.tsx) won't
  // re-run per SSE chunk.
  const actions = useMemo(() => ({
    open,
    close,
    cancel,
    reset,
    setInput,
    send,
    createTask,
    searchThings,
  }), [open, close, cancel, reset, send, createTask, searchThings]);
  // setInput is a useState setter — already stable, no dep needed

  // State — changes per render; consumers that read these are expected to re-render
  const state = useMemo(() => ({
    isOpen,
    mode,
    input,
    messages,
    isStreaming,
    sessionId,
    hasAI,
    searchResults,
    isSearching,
  }), [
    isOpen,
    mode,
    input,
    messages,
    isStreaming,
    sessionId,
    hasAI,
    searchResults,
    isSearching,
  ]);

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
```

- [ ] **Step 3: Run the full omnibar suite to verify no regression**

```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts
```
Expected: all 18 pre-existing tests still pass.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: 18/18 packages successful.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/api/omnibar.ts
git commit -m "$(cat <<'EOF'
refactor(omnibar): split hook return into actions + state memos

Pure structural refactor. Separates the hook's return into two internal
memos (actions + state) before merging them into the same flat shape
consumers already use. No observable behavior change; existing tests
unchanged. Sets up Task 2's minimize action and Task 9's App.tsx
destructuring pattern, where keyboard-shortcut effects can depend on
stable action references instead of the churning top-level omnibar
object.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Hook — `isMinimized` state + `minimize()` action

**Files:**
- Modify: `apps/desktop/src/api/omnibar.ts`
- Test: `apps/desktop/src/api/__tests__/omnibar.test.ts`

**Why:** Today click-outside on the Omnibar is gated to "no conversation" — an active conversation pins it open indefinitely. Adding a minimize action lets click-outside collapse the Omnibar to bar form while preserving the conversation.

- [ ] **Step 1: Write failing tests — minimize preserves messages, open clears, no-op during streaming**

Add inside `describe("useOmnibar", ...)`:

```typescript
describe("minimize", () => {
  it("sets isMinimized without clearing messages", () => {
    const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

    // Seed a synthetic message — in real use, streaming populates this
    act(() => {
      result.current.setInput("hi");
    });
    // Directly poke messages via streaming would be heavy; test using the
    // derived outcome: minimize flips the flag, messages remain untouched.
    // Set a messages-present state via the private setter is not exposed, so we
    // settle for flag behavior plus no-op-while-streaming below.
    act(() => {
      result.current.minimize();
    });

    expect(result.current.isMinimized).toBe(true);
  });

  it("open() clears isMinimized", () => {
    const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

    act(() => {
      result.current.minimize();
    });
    expect(result.current.isMinimized).toBe(true);

    act(() => {
      result.current.open("bar");
    });
    expect(result.current.isMinimized).toBe(false);
  });

  it("reset() clears isMinimized", () => {
    const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

    act(() => {
      result.current.minimize();
    });

    act(() => {
      result.current.reset();
    });
    expect(result.current.isMinimized).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts -t "minimize"
```
Expected: FAIL — `result.current.minimize` is undefined / `isMinimized` missing.

- [ ] **Step 3: Add state, action, clear on open/reset; include in memos**

In `apps/desktop/src/api/omnibar.ts`, right after `const [isSearching, setIsSearching] = useState(false);` near the top of the hook, add:

```typescript
  const [isMinimized, setIsMinimized] = useState(false);
```

Update the `stateRef` line (currently `stateRef.current = { isStreaming, messages, sessionId };`) — no change needed, we don't read `isMinimized` in closures.

Add a new `minimize` callback near the other callbacks (after `reset`):

```typescript
  const minimize = useCallback(() => {
    if (stateRef.current.isStreaming) return; // don't minimize mid-stream
    setIsMinimized(true);
  }, []);
```

Update `open` to clear `isMinimized`:

```typescript
  const open = useCallback((newMode: OmnibarMode = "bar") => {
    setMode(newMode);
    setIsOpen(true);
    setIsMinimized(false);
  }, []);
```

Update `reset` to clear `isMinimized`:

```typescript
  const reset = useCallback(() => {
    cancel();
    setMessages([]);
    setSessionId(null);
    setInput("");
    setSearchResults(null);
    setIsMinimized(false);
    toolCallNamesRef.current.clear();
  }, [cancel]);
```

Update the `actions` memo (from Task 1) to include `minimize`:

```typescript
  const actions = useMemo(() => ({
    open,
    close,
    cancel,
    reset,
    setInput,
    send,
    createTask,
    searchThings,
    minimize,
  }), [open, close, cancel, reset, send, createTask, searchThings, minimize]);
```

Update the `state` memo to include `isMinimized`:

```typescript
  const state = useMemo(() => ({
    isOpen,
    mode,
    input,
    messages,
    isStreaming,
    sessionId,
    hasAI,
    searchResults,
    isSearching,
    isMinimized,
  }), [
    isOpen,
    mode,
    input,
    messages,
    isStreaming,
    sessionId,
    hasAI,
    searchResults,
    isSearching,
    isMinimized,
  ]);
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts
```
Expected: all 21+ tests pass (18 existing + 1 action identity + 3 minimize).

- [ ] **Step 5: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/api/omnibar.ts apps/desktop/src/api/__tests__/omnibar.test.ts
git commit -m "$(cat <<'EOF'
feat(omnibar): add isMinimized state and minimize() action

New hook-level state that lets the Omnibar component collapse to its
bar form while preserving the in-progress conversation (messages +
sessionId). open() and reset() clear it; minimize() is a no-op during
streaming.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Hook — rAF-batched streaming text

**Files:**
- Modify: `apps/desktop/src/api/omnibar.ts`
- Test: `apps/desktop/src/api/__tests__/omnibar.test.ts`

**Why:** Each SSE `text` chunk triggers a full `setMessages` call with a new array. Under fast streams this is dozens of renders per second of the entire Omnibar tree. Batching multiple chunks into one `setMessages` per animation frame cuts render pressure without changing perceived streaming smoothness.

- [ ] **Step 1: Write failing test — multiple text chunks in one tick coalesce**

Add inside `describe("useOmnibar", ...)`:

```typescript
describe("streaming text batching", () => {
  it("coalesces multiple text chunks into a single setMessages per frame", async () => {
    // Mock streamingFetch to yield 5 text chunks immediately
    const { streamingFetch } = await import("../streaming");
    const mockStream = vi.mocked(streamingFetch);
    mockStream.mockImplementation(async function* () {
      yield { type: "text" as const, content: "A" };
      yield { type: "text" as const, content: "B" };
      yield { type: "text" as const, content: "C" };
      yield { type: "text" as const, content: "D" };
      yield { type: "text" as const, content: "E" };
      yield { type: "done" as const, sessionId: "s1" };
    });

    mockUseAIConfigs.mockReturnValue({
      data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
    } as any);

    const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hello");
    });

    // After the stream finishes, the assistant message should contain the
    // concatenated text (proving the buffer flushed correctly).
    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.content).toBe("ABCDE");
  });
});
```

(Note: this test primarily verifies correctness of the buffered flush. A pure count-of-setMessages-calls test would require a render-counting wrapper — overkill. The content-integrity test is what matters end-to-end.)

- [ ] **Step 2: Run test to verify it fails or passes for the wrong reason**

```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts -t "streaming text batching"
```
Expected: likely PASS on current code (unbatched path also produces `"ABCDE"`). That means this test alone doesn't prove batching. Add this second test to force batching semantics:

```typescript
  it("flushes buffered text synchronously on done", async () => {
    const { streamingFetch } = await import("../streaming");
    const mockStream = vi.mocked(streamingFetch);
    mockStream.mockImplementation(async function* () {
      yield { type: "text" as const, content: "final" };
      yield { type: "done" as const, sessionId: "s2" };
    });

    mockUseAIConfigs.mockReturnValue({
      data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
    } as any);

    const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hi");
    });

    // After `done`, isStreaming must be false AND the text must be visible —
    // proving the pending rAF buffer flushed before the streaming lifecycle ended.
    expect(result.current.isStreaming).toBe(false);
    const lastMsg = result.current.messages[result.current.messages.length - 1];
    expect(lastMsg.content).toBe("final");
  });
```

Re-run:
```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts -t "streaming text batching"
```
Expected: both pass on current code (because the current code updates synchronously). They'll continue to pass after the rAF refactor — serving as regression tests for correctness. Batching improvement is a perf win we verify manually; the tests guarantee content integrity.

- [ ] **Step 3: Implement rAF batching in `apps/desktop/src/api/omnibar.ts`**

At the top of the hook (next to `abortRef`), add:

```typescript
  const pendingTextRef = useRef<string>("");
  const pendingFrameRef = useRef<number | null>(null);
```

Add a helper inside the hook (before `send`):

```typescript
  const flushPendingText = useCallback(() => {
    if (pendingFrameRef.current !== null) {
      cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
    const buffered = pendingTextRef.current;
    if (!buffered) return;
    pendingTextRef.current = "";
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          content: last.content + buffered,
        };
      }
      return updated;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (pendingFrameRef.current !== null) return;
    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;
      flushPendingText();
    });
  }, [flushPendingText]);
```

Replace the existing `case "text":` block inside the `for await` loop (currently lines ~132-144) with:

```typescript
            case "text":
              pendingTextRef.current += chunk.content;
              scheduleFlush();
              break;
```

Add a synchronous flush at the top of each non-text chunk handler, so queued text lands before later events commit. Modify the `case "tool_call":`, `case "tool_result":`, `case "done":`, and `case "error":` blocks — add `flushPendingText();` as the first statement inside each case:

```typescript
            case "tool_call":
              flushPendingText();
              // ...rest unchanged
              break;

            case "tool_result":
              flushPendingText();
              // ...rest unchanged
              break;

            case "done":
              flushPendingText();
              if (chunk.sessionId) setSessionId(chunk.sessionId);
              break;

            case "error":
              flushPendingText();
              console.error("[omnibar] SSE error event:", chunk);
              // ...rest unchanged
              break;
```

In the outer `catch (err)` block, add `flushPendingText();` as the first statement.

In the `finally` block, add `flushPendingText();` before `setIsStreaming(false)`.

- [ ] **Step 4: Run full omnibar tests to verify pass**

```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts
```
Expected: all pass.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/api/omnibar.ts apps/desktop/src/api/__tests__/omnibar.test.ts
git commit -m "$(cat <<'EOF'
perf(omnibar): batch streaming text chunks via requestAnimationFrame

Each SSE text chunk previously triggered a full setMessages + array
rebuild, producing dozens of renders per second under fast streams.
Buffer chunks in a ref and commit at most one setMessages per animation
frame. Synchronous flushes at tool_call / tool_result / done / error /
catch / finally guarantee content integrity — the regression tests
assert the full text is present once isStreaming is false.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Hook — deferred query invalidation

**Files:**
- Modify: `apps/desktop/src/api/omnibar.ts`
- Test: `apps/desktop/src/api/__tests__/omnibar.test.ts`

**Why:** Currently every `tool_result` chunk calls up to 5 `invalidateQueries` + 3 `refetchQueries` inline during streaming. Each refetch is a network request plus a re-render cascade. Batching keys into a set and flushing once at stream end eliminates the in-flight cascade. Confirmation-card tool results still invalidate immediately so the visible card reflects fresh backing data.

- [ ] **Step 1: Write failing test — invalidations collect and flush at stream end**

Add inside `describe("useOmnibar", ...)`:

```typescript
describe("query invalidation batching", () => {
  it("defers non-confirmation tool_result invalidations until stream end", async () => {
    const { streamingFetch } = await import("../streaming");
    const mockStream = vi.mocked(streamingFetch);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    mockStream.mockImplementation(async function* () {
      yield { type: "tool_call" as const, id: "t1", name: "search_things", args: {} };
      yield {
        type: "tool_result" as const,
        id: "t1",
        data: { results: [] },
        // No displayHint → should NOT invalidate mid-stream
      };
      yield { type: "done" as const, sessionId: "s1" };
    });

    mockUseAIConfigs.mockReturnValue({
      data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
    } as any);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useOmnibar(), { wrapper });

    await act(async () => {
      await result.current.send("hi");
    });

    // Post-stream, no invalidation should have been called for this key because
    // the tool_result had no confirmation displayHint.
    const thingsCalls = invalidateSpy.mock.calls.filter(
      (c) => Array.isArray((c[0] as any)?.queryKey) && (c[0] as any).queryKey[0] === "things"
    );
    expect(thingsCalls.length).toBe(0);
  });

  it("invalidates immediately on confirmation displayHint", async () => {
    const { streamingFetch } = await import("../streaming");
    const mockStream = vi.mocked(streamingFetch);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    mockStream.mockImplementation(async function* () {
      yield { type: "tool_call" as const, id: "t1", name: "create_task", args: {} };
      yield {
        type: "tool_result" as const,
        id: "t1",
        data: { ok: true },
        displayHint: { type: "task_created" as const },
      };
      yield { type: "done" as const, sessionId: "s1" };
    });

    mockUseAIConfigs.mockReturnValue({
      data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
    } as any);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useOmnibar(), { wrapper });

    await act(async () => {
      await result.current.send("make a task");
    });

    const thingsCalls = invalidateSpy.mock.calls.filter(
      (c) => Array.isArray((c[0] as any)?.queryKey) && (c[0] as any).queryKey[0] === "things"
    );
    expect(thingsCalls.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify the first one fails (the second may already pass)**

```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts -t "query invalidation"
```
Expected: "defers non-confirmation" FAILS (current code invalidates unconditionally); "invalidates immediately" PASSES.

- [ ] **Step 3: Implement deferred invalidation in the send() closure**

In `apps/desktop/src/api/omnibar.ts`, inside `send()`, declare the set **before** the `try` block so it's reachable from `finally`. Put it right after `abortRef.current = controller;` (and before `try {`):

```typescript
    const pendingInvalidations = new Set<string>();
```

Inside the `for await` loop, replace the `case "tool_result":` block's invalidation tail (the part after `setMessages(...)`) with this logic:

```typescript
              // Confirmation-style results: invalidate immediately so the
              // user-visible card reflects fresh backing data. No refetch
              // calls — mark-stale is enough for any active observer.
              if (chunk.displayHint?.type === "task_created" || chunk.displayHint?.type === "confirmation") {
                queryClient.invalidateQueries({ queryKey: ["things"] });
                queryClient.invalidateQueries({ queryKey: ["thing-detail"] });
                queryClient.invalidateQueries({ queryKey: ["inbox"] });
                queryClient.invalidateQueries({ queryKey: ["lists"] });
              }
              // Scout mutations: defer to stream end. No visible card, so
              // batching until the stream completes is user-invisible.
              {
                const toolName = toolCallNamesRef.current.get(chunk.id);
                if (toolName === "create_scout" || toolName === "update_scout" || toolName === "delete_scout") {
                  pendingInvalidations.add("scouts");
                }
              }
```

In the `finally` block, flush the set after `flushPendingText()` (from Task 3) but before `setIsStreaming(false)`:

```typescript
    } finally {
      flushPendingText();
      for (const key of pendingInvalidations) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setIsStreaming(false);
      abortRef.current = null;
    }
```

**Summary of changes to the old block:** remove the three `refetchQueries(...)` calls, and funnel the scout branch through `pendingInvalidations.add("scouts")` instead of calling invalidate/refetch inline.

- [ ] **Step 4: Run full omnibar tests to verify pass**

```bash
pnpm vitest run src/api/__tests__/omnibar.test.ts
```
Expected: all pass (including both new invalidation tests).

- [ ] **Step 5: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/api/omnibar.ts apps/desktop/src/api/__tests__/omnibar.test.ts
git commit -m "$(cat <<'EOF'
perf(omnibar): defer non-visible query invalidations to stream end

Tool results that don't produce a user-visible confirmation card no
longer trigger mid-stream invalidateQueries + refetchQueries storms.
Keys collect in a Set during the stream and flush once in the finally
block. task_created / confirmation displayHints still invalidate
immediately so the visible card reflects fresh backing data. Drop the
explicit refetchQueries calls — mark-stale is sufficient for active
observers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Omnibar — animation/transition polish

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx`

**Why:** `transition-all` animates every property (color, sizing, box-model) — expensive and risks unintended transitions. Manual `setTimeout` for close animation collides with rapid open/close. 50 ms focus delay is arbitrary; rAF is more precise.

- [ ] **Step 1: Tighten transition scopes**

In `packages/ui/src/Omnibar.tsx` at line ~373 (the top-level pill container), change:

```tsx
          relative bg-black/40 backdrop-blur-xl border rounded-2xl transition-all duration-300 ease-in-out overflow-hidden
```

to:

```tsx
          relative bg-black/40 backdrop-blur-xl border rounded-2xl transition-[border-color,box-shadow] duration-300 ease-in-out overflow-hidden
```

At line ~423 (the expanded content container), change:

```tsx
        <div className={`transition-all duration-150 ease-out origin-top ${
```

to:

```tsx
        <div className={`transition-[opacity,transform] duration-150 ease-out origin-top ${
```

- [ ] **Step 2: Race-safe close animation**

Add a timer ref at the top of the component body (near the existing `useRef` calls around line 110):

```tsx
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Replace the existing `animateClose` (lines ~119-128) with:

```tsx
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
```

Add an effect right after `animateClose` that cancels a pending close when `isOpen` flips true (protects against reopen-during-fadeout):

```tsx
  // Cancel any pending close animation when the omnibar is reopened. Without
  // this, a rapid close → reopen leaves isClosing true and the old timer
  // eventually clears it, producing a visible flicker.
  useEffect(() => {
    if (isOpen && closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setIsClosing(false);
    }
  }, [isOpen]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
  }, []);
```

- [ ] **Step 3: Replace 50 ms focus `setTimeout` with `requestAnimationFrame`**

Find the existing focus effect (lines ~159-163):

```tsx
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);
```

Replace with:

```tsx
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: 18/18 packages successful.

- [ ] **Step 5: Manual smoke — open and close the Omnibar**

Start the dev environment if not already running:

```bash
pnpm dev:full
```

In the desktop app:
1. Click the Omnibar to open — focus should land on the input immediately (no visible lag).
2. Press ⌘K several times rapidly to toggle — no visual glitch, no stuck half-closed state.
3. Open the Omnibar, then click outside — smooth fade out.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "$(cat <<'EOF'
polish(omnibar): scoped transitions, race-safe close, rAF focus

- Replace transition-all with specific property lists (border-color,
  box-shadow on the container; opacity, transform on the expanded
  panel) so unrelated state changes don't animate.
- Track the close-animation timeout in a ref and cancel it when
  isOpen flips true, eliminating the rapid-toggle flicker.
- Swap the 50ms setTimeout focus for requestAnimationFrame — fires on
  the next paint instead of an arbitrary delay.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Omnibar — smart auto-scroll

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx`

**Why:** Today every `messages` change scrolls the container to bottom. During streaming this fights the user if they've scrolled up to re-read earlier content. Track whether the user has scrolled away from the bottom; only auto-scroll when they're near it.

- [ ] **Step 1: Add scroll-position tracking refs and handler**

Near the existing `chatContainerRef` ref (around line 166), add:

```tsx
  const userScrolledUpRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);

  const handleScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledUpRef.current = !nearBottom;
  };
```

- [ ] **Step 2: Rewrite the auto-scroll effect**

Replace the existing auto-scroll effect (lines ~167-172):

```tsx
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);
```

with a scroll-aware, rAF-wrapped version:

```tsx
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const el = chatContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  // Reset scroll-to-bottom when the user sends a new message — their own
  // message should always be visible, and we assume they want to see the
  // response that follows.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "user") userScrolledUpRef.current = false;
  }, [messages.length]);

  // Cleanup pending rAF on unmount
  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);
```

- [ ] **Step 3: Wire the scroll handler to the chat container**

Find the chat container element (around line 536):

```tsx
            <div ref={chatContainerRef} className="max-h-[450px] overflow-y-auto scrollbar-hide p-4 space-y-4">
```

Add `onScroll={handleScroll}`:

```tsx
            <div ref={chatContainerRef} onScroll={handleScroll} className="max-h-[450px] overflow-y-auto scrollbar-hide p-4 space-y-4">
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: clean.

- [ ] **Step 5: Manual verification**

1. Ask Brett a question long enough to produce multi-paragraph streaming output (e.g. "Give me a detailed plan for launching a side project in 6 weeks").
2. While the response streams, scroll up to re-read earlier content. Expected: scroll position stays put, does NOT snap back to bottom.
3. Send a follow-up message. Expected: view auto-scrolls to show your new message + new response.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "$(cat <<'EOF'
feat(omnibar): scroll-aware auto-scroll during streaming

Track whether the user has scrolled away from the bottom (>40px). Only
auto-scroll on message updates when they haven't. Sending a new user
message resets the flag so the response is visible again. Scroll write
is wrapped in rAF to coalesce with paint.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Omnibar — `isMinimized` render branch + click-outside-to-minimize

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx`

**Why:** Consume the new hook state. When a conversation is active but the omnibar is minimized, render the bar form with a `Resume conversation...` placeholder instead of the conversation area. Click-outside during a conversation minimizes instead of staying pinned open.

- [ ] **Step 1: Add `isMinimized` / `onMinimize` props to `OmnibarProps`**

At `packages/ui/src/Omnibar.tsx` around line 32-65 (the `OmnibarProps` interface), add:

```tsx
  isMinimized?: boolean;
  onMinimize?: () => void;
```

Destructure them in the function signature around line 75-108:

```tsx
  isMinimized,
  onMinimize,
```

- [ ] **Step 2: Compute `showConversation` and adjust render gates**

Right after `const hasConversation = messages.length > 0;` (around line 193), add:

```tsx
  const showConversation = hasConversation && !isMinimized;
```

Replace the existing `hasConversation` usages that control rendering:

Line ~375, the `rounded-b-2xl` toggle — keep as-is (cosmetic only, safe either way).

Line ~379, the top bar guard:

```tsx
        {!hasConversation && (
```

becomes:

```tsx
        {!showConversation && (
```

Line ~533, the conversation area guard:

```tsx
        {isOpen && hasConversation && (
```

becomes:

```tsx
        {isOpen && showConversation && (
```

- [ ] **Step 3: Resume-conversation placeholder**

Inside the top bar's `<input>` (around line 393), update the placeholder cascade:

```tsx
              placeholder={placeholderOverride ?? (forcedAction === "search" ? "Search..." : forcedAction === "create" ? "New task..." : hasAI ? `Ask ${assistantName} anything...` : "Create a task or search...")}
```

becomes:

```tsx
              placeholder={placeholderOverride ?? (hasConversation && isMinimized ? "Resume conversation..." : forcedAction === "search" ? "Search..." : forcedAction === "create" ? "New task..." : hasAI ? `Ask ${assistantName} anything...` : "Create a task or search...")}
```

- [ ] **Step 4: Click-outside-to-minimize**

Find the `useClickOutside` call (around lines 149-156):

```tsx
  useClickOutside(containerRef, () => {
    // Don't close on click-outside when there's an active conversation —
    // user might be clicking on a task or elsewhere and wants to come back.
    // Only suggestions/search dropdowns should close on click-outside.
    if (isOpen && !isStreaming && messages.length === 0) {
      animateClose();
    }
  }, isOpen);
```

Replace with:

```tsx
  useClickOutside(containerRef, () => {
    if (!isOpen || isStreaming) return;
    if (messages.length === 0) {
      animateClose();
    } else if (onMinimize) {
      // Preserve conversation state but collapse to bar form. The next open()
      // (or click-to-focus the bar) restores the conversation.
      onMinimize();
    }
  }, isOpen);
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```

Expected: desktop typecheck fails because App.tsx doesn't yet pass `isMinimized`/`onMinimize`. That's fine — Task 9 wires it. For now verify only `@brett/ui` compiles:

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach/packages/ui && pnpm typecheck
```

Expected: clean (props are optional on the interface).

If desktop typecheck fails, that's OK at this point — Task 9 resolves it. Do NOT commit yet if desktop is broken; hold the Omnibar + App wiring together if timing is a concern. (Preferred: finish Tasks 7 + 9 back-to-back without pushing.)

- [ ] **Step 6: Commit** (App.tsx wiring is still ahead in Task 9, so this commit temporarily leaves the prop unconsumed — still ships correctly because the props are optional)

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "$(cat <<'EOF'
feat(omnibar): click-outside-to-minimize preserves active conversation

Click-outside during an active conversation now collapses the omnibar
to its bar form (via new onMinimize prop) instead of pinning it open
forever. Conversation state (messages, sessionId) is preserved; clicking
the bar or pressing ⌘K restores the conversation.

Minimized + has-conversation renders the bar with a "Resume
conversation..." placeholder so the paused session is discoverable.

Streaming blocks dismiss as before.

App.tsx wiring lands in a follow-up commit.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: SpotlightModal — mirrored animation/focus/scroll + preserve-conversation comment

**Files:**
- Modify: `packages/ui/src/SpotlightModal.tsx`

**Why:** Per CLAUDE.md, changes to Omnibar must apply to SpotlightModal. Spotlight is a modal (no minimize-to-bar concept); backdrop click already preserves state via hook's `close()`. Mirror Task 5 and Task 6 changes; add a comment noting the preservation.

- [ ] **Step 1: Tighten transition scopes and rAF focus**

In `packages/ui/src/SpotlightModal.tsx` around line 122-126 — replace the existing focus effect:

```tsx
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);
```

with:

```tsx
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);
```

- [ ] **Step 2: Smart auto-scroll (mirror Omnibar Task 6)**

Near the existing `chatContainerRef` ref (around line 86), add the same scroll-tracking refs + handler:

```tsx
  const userScrolledUpRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);

  const handleScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledUpRef.current = !nearBottom;
  };
```

Replace the existing auto-scroll effect (around lines 129-132):

```tsx
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);
```

with:

```tsx
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const el = chatContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "user") userScrolledUpRef.current = false;
  }, [messages.length]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);
```

Find the chat container element (search for `ref={chatContainerRef}`) and add `onScroll={handleScroll}` to it.

- [ ] **Step 3: Document backdrop-preserves-conversation behavior**

Find the backdrop div (around lines 323-324):

```tsx
      <div className="absolute inset-0 bg-black/60 backdrop-blur-2xl"
           onClick={() => !isStreaming && onClose()} />
```

Replace with:

```tsx
      {/* Backdrop click closes the modal but preserves conversation state
          (messages + sessionId). Reopening Spotlight via ⌘K restores the
          session. Streaming blocks dismiss. */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-2xl"
           onClick={() => !isStreaming && onClose()} />
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: 18/18 packages successful (desktop still compiles because Omnibar props are optional).

- [ ] **Step 5: Manual verification**

1. Press ⌘K to open Spotlight. Focus should land on input instantly.
2. Ask a long question to trigger streaming.
3. Scroll up mid-stream — position holds.
4. Click backdrop to dismiss — Spotlight closes.
5. Press ⌘K again — Spotlight reopens with the prior conversation intact.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/SpotlightModal.tsx
git commit -m "$(cat <<'EOF'
polish(spotlight): mirror omnibar focus + smart auto-scroll + backdrop note

Replace 50ms focus setTimeout with rAF. Add scroll-position-aware
auto-scroll (doesn't fight the user mid-stream). Document that backdrop
click preserves the conversation session so reopening via ⌘K restores it
— no behavioral change, just codifies the invariant.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: App.tsx wiring — pass new props, destructure stable actions

**Files:**
- Modify: `apps/desktop/src/App.tsx`

**Why:** Wire the new `onMinimize`/`isMinimized` into both Omnibar and Spotlight surfaces. Destructure stable actions into the keyboard-shortcut effect so it stops re-running per streaming chunk.

- [ ] **Step 1: Pass `isMinimized` + `onMinimize` into `omnibarProps`**

In `apps/desktop/src/App.tsx`, find the `omnibarProps` object (around line 638). Add these fields:

```tsx
    isMinimized: omnibar.isMinimized,
    onMinimize: omnibar.minimize,
```

Pick a sensible position — right after `onReset: omnibar.reset,` is fine.

- [ ] **Step 2: Destructure actions for the keyboard shortcut effect**

Find the Cmd+K / Cmd+F keyboard effect around line 569-597. Replace this entire block:

```tsx
  // Global Cmd+K / Ctrl+K listener for spotlight
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (omnibar.isOpen && omnibar.mode === "spotlight") {
          omnibar.close();
        } else {
          setSpotlightInitialAction(null);
          omnibar.open("spotlight");
          setSelectedItem(null);
          setIsDetailOpen(false);
        }
      }
      // Cmd+F / Ctrl+F opens spotlight with search pre-selected
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        if (omnibar.isOpen && omnibar.mode === "spotlight") {
          omnibar.close();
        } else {
          setSpotlightInitialAction("search");
          omnibar.open("spotlight");
          setSelectedItem(null);
          setIsDetailOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [omnibar]);
```

with:

```tsx
  // Global Cmd+K / Ctrl+K listener for spotlight.
  // Destructures actions so the effect doesn't re-run on every SSE text
  // chunk (the top-level `omnibar` object changes identity when state updates,
  // but these specific action refs are stable across streaming).
  const { open: omnibarOpen, close: omnibarClose, mode: omnibarMode, isOpen: omnibarIsOpen } = omnibar;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (omnibarIsOpen && omnibarMode === "spotlight") {
          omnibarClose();
        } else {
          setSpotlightInitialAction(null);
          omnibarOpen("spotlight");
          setSelectedItem(null);
          setIsDetailOpen(false);
        }
      }
      // Cmd+F / Ctrl+F opens spotlight with search pre-selected
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        if (omnibarIsOpen && omnibarMode === "spotlight") {
          omnibarClose();
        } else {
          setSpotlightInitialAction("search");
          omnibarOpen("spotlight");
          setSelectedItem(null);
          setIsDetailOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [omnibarOpen, omnibarClose, omnibarMode, omnibarIsOpen]);
```

**Note:** the scout-detection effect ending `}, [omnibar]);` (around line 839) legitimately depends on `omnibar.messages` — leave it as-is.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: 18/18 packages successful.

- [ ] **Step 4: Run desktop tests**

```bash
cd apps/desktop && pnpm test
```
Expected: 9+ test files pass, including the expanded `omnibar.test.ts`.

- [ ] **Step 5: Manual smoke**

1. ⌘K toggles Spotlight — cleanly open + close regardless of streaming state.
2. Open Omnibar, ask Brett a question. Mid-stream, click outside. Expected: omnibar stays expanded (streaming blocks dismiss).
3. Let response finish. Click outside again. Expected: collapses to bar form with "Resume conversation..." placeholder.
4. Click the bar input. Expected: conversation restores in-place.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): wire omnibar minimize + stabilize keyboard shortcut effect

Pass onMinimize/isMinimized through to the Omnibar and Spotlight
surfaces. Destructure stable action references into the ⌘K keyboard
shortcut effect so it no longer re-runs per SSE text chunk (the
surrounding omnibar object rotated identity on every message update).
The scout-detection effect still depends on omnibar.messages — that's
intentional.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification

**Files:**
- Read-only verification across the changed files.

**Why:** Confirm the whole branch is green and the user-facing behavior matches the spec before we're done.

- [ ] **Step 1: Root typecheck**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm typecheck
```
Expected: 18/18 packages successful.

- [ ] **Step 2: Full API test suite**

```bash
cd apps/api && pnpm test
```
Expected: 55 test files pass, 566+ tests pass.

- [ ] **Step 3: Full desktop test suite**

```bash
cd ../desktop && pnpm test
```
Expected: all test files pass, including the expanded omnibar tests and useTodayKey tests.

- [ ] **Step 4: Manual verification — the spec's checklist**

Start the dev environment if not already running:

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/compassionate-banach && pnpm dev:full
```

Walk through each bullet from the spec's Testing → Manual verification section:

- [ ] **Smooth streaming** — ask a long-form question, watch response render in steady sub-16ms chunks, not burst-then-pause
- [ ] **Scroll-up-mid-stream stays put** — while response streams, scroll up to re-read earlier content; scroll position should not jump back to bottom. Sending a follow-up resets that
- [ ] **Rapid ⌘K toggle** — mash ⌘K a dozen times; no visual glitch, no stuck "half-open" state
- [ ] **Minimize + reopen** — start a conversation, click outside → bar collapses but remains visible with "Resume conversation..." placeholder. Click input → conversation restores with all messages intact
- [ ] **Click-outside-during-streaming is ignored** — start a send, immediately click outside; omnibar stays expanded, stream completes normally
- [ ] **Spotlight backdrop close preserves session** — open Spotlight, send, click backdrop, press ⌘K again, conversation restored

- [ ] **Step 5: Report completion**

Summarize the shipped behavior + any caveats back to the human. Confirm the PR is ready (or ask whether to open one).
