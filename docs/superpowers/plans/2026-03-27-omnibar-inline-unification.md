# Omnibar Inline Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all Omnibar modes (suggestions, search, task creation) into inline sections inside the glass container, eliminating floating dropdowns and adding task creation confirmation.

**Architecture:** Single-file refactor of `Omnibar.tsx`. Move two floating `absolute`-positioned dropdowns (suggestions, search results) inside the main glass container with `border-t` dividers. Add a new `confirmedTask` state with auto-dismiss timer for task creation feedback. All inline sections are mutually exclusive (only one shows at a time).

**Tech Stack:** React, Tailwind CSS, existing Omnibar component patterns

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `packages/ui/src/Omnibar.tsx` | All Omnibar rendering and state | Move suggestions inline, move search results inline, add task confirmation state + UI |

No new files. No API/type/hook changes.

---

### Task 1: Move suggestions dropdown inline

Move the suggestions from a floating `absolute top-full` dropdown to an inline section inside the glass container, separated by a `border-t` divider.

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx:467-491` (suggestions dropdown) → move inside the glass container div (before line 465's closing `</div>`)

- [ ] **Step 1: Move the suggestions block inside the glass container**

Cut the suggestions block (currently at lines 467-491, outside the glass container) and paste it inside the glass container div, just before the closing `</div>` at line 465. Remove the floating positioning classes and add an inline treatment:

**Before (floating):**
```tsx
{/* Suggestions Dropdown */}
{showSuggestions && (
  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden shadow-xl">
    {suggestions.map((suggestion, i) => (
      // ... rows unchanged
    ))}
  </div>
)}
```

**After (inline):**
```tsx
{/* Suggestions — inline */}
{showSuggestions && (
  <div className="border-t border-white/10">
    {suggestions.map((suggestion, i) => (
      <button
        key={suggestion.id}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
          i === selectedSuggestion
            ? "bg-white/10 text-white"
            : "text-white/70 hover:bg-white/5"
        }`}
        onClick={() => handleSuggestionSelect(suggestion)}
        onMouseEnter={() => setSelectedSuggestion(i)}
      >
        {suggestion.icon}
        <span className="truncate">{suggestion.label}</span>
        {suggestion.shortcut && (
          <kbd className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/30 font-mono">
            {suggestion.shortcut}
          </kbd>
        )}
      </button>
    ))}
  </div>
)}
```

Key changes:
- Remove `absolute top-full left-0 right-0 mt-1 z-50` (no longer floating)
- Remove `bg-black/60 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden shadow-xl` (the glass container provides the background)
- Add `border-t border-white/10` as the section divider
- Row content and behavior unchanged

Place this block inside the glass container `<div>` (the one with `bg-black/40 backdrop-blur-xl`), **immediately after the Top Bar's closing `</div>` tag** — before the Weather Expanded block. This keeps the inline sections in logical order: Top Bar → Suggestions → Search → Confirmation → Weather → AI Upsell → Conversation.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: All packages pass

- [ ] **Step 3: Manual verification**

Open the app (`pnpm dev:desktop`). Test:
1. Click into omnibar, type text → suggestions appear inline inside the glass container (not floating below)
2. Arrow keys still highlight suggestions
3. Enter still selects a suggestion
4. Escape still closes the omnibar
5. The `s ` and `t ` shortcuts still work

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "refactor(omnibar): move suggestions dropdown inline"
```

---

### Task 2: Move search results inline

Move search results from a floating dropdown to an inline section. Remove the result count header. Preserve loading and empty sub-states.

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx:493-536` (search results dropdown) → move inside glass container

- [ ] **Step 1: Move search results block inside the glass container**

Cut the search results block (currently after the suggestions block, outside the glass container) and paste it inside the glass container, right after the inline suggestions block from Task 1.

**Before (floating):**
```tsx
{/* Search Results Dropdown */}
{showSearchResults && (
  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden shadow-xl">
    {isSearching ? (
      <div className="px-4 py-3 text-sm text-white/40 flex items-center gap-2">
        <div className="w-3 h-3 border border-white/30 border-t-white/80 rounded-full animate-spin" />
        Searching...
      </div>
    ) : visibleResults.length === 0 ? (
      <div className="px-4 py-3 text-sm text-white/40">
        No results found.
      </div>
    ) : (
      <>
        <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-white/30 border-b border-white/5">
          {searchResults!.length} result{searchResults!.length === 1 ? "" : "s"}
        </div>
        {visibleResults.map((item, i) => (
          // ... result rows
        ))}
      </>
    )}
  </div>
)}
```

**After (inline):**
```tsx
{/* Search Results — inline */}
{showSearchResults && (
  <div className="border-t border-white/10">
    {isSearching ? (
      <div className="px-4 py-3 text-sm text-white/40 flex items-center gap-2">
        <div className="w-3 h-3 border border-white/30 border-t-white/80 rounded-full animate-spin" />
        Searching...
      </div>
    ) : visibleResults.length === 0 ? (
      <div className="px-4 py-3 text-sm text-white/40">
        No results found.
      </div>
    ) : (
      <div className="max-h-[320px] overflow-y-auto scrollbar-hide">
        {visibleResults.map((item, i) => (
          <button
            key={item.id}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
              i === selectedSearchIdx
                ? "bg-white/10 text-white"
                : "text-white/80 hover:bg-white/5"
            }`}
            onClick={() => onSearchResultClick?.(item.id)}
            onMouseEnter={() => setSelectedSearchIdx(i)}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              item.status === "done" ? "bg-green-400" : item.status === "active" ? "bg-blue-400" : "bg-white/30"
            }`} />
            <span className="text-[10px] text-white/30 uppercase flex-shrink-0">
              {item.type === "content" ? (item.contentType || "content") : "task"}
            </span>
            <span className="truncate">{item.title}</span>
            <span className="ml-auto text-[10px] text-white/30 flex-shrink-0">
              {item.listName || "Inbox"}
            </span>
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

Key changes:
- Remove floating positioning classes (same as Task 1)
- Add `border-t border-white/10` divider
- **Remove the result count header** (`{searchResults!.length} result(s)` div) — per design decision
- Add `max-h-[320px] overflow-y-auto scrollbar-hide` on the results list to prevent the omnibar from growing too tall with many results
- Loading and empty states preserved, just rendered inline
- Row content unchanged

- [ ] **Step 2: Verify the outer wrapper is clean**

After moving both blocks inside, the outer `<div ref={containerRef}>` should now contain ONLY the glass container `<div>` — no more floating children. Verify the closing structure looks like:

```tsx
        {/* ... conversation area ... */}
      </div>  {/* end glass container */}
    </div>    {/* end containerRef */}
  );
```

No `absolute`-positioned siblings should remain.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: All packages pass

- [ ] **Step 4: Manual verification**

Test:
1. Type `s ` then a query, press Enter → search results appear inline (not floating)
2. Loading spinner appears inline while searching
3. "No results found." appears inline for empty results
4. Arrow keys and Tab navigate results
5. Enter opens a result
6. No result count header visible
7. Scroll works when results overflow

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "refactor(omnibar): move search results inline, remove count header"
```

---

### Task 3: Add task creation confirmation

Add a `confirmedTask` state variable, show an inline confirmation card when a task is created, and auto-dismiss after 1.5s.

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx` — add state, modify create handlers, add confirmation JSX

- [ ] **Step 1: Add the `confirmedTask` state and auto-dismiss effect**

Near the existing state declarations (around line 98-100), add:

```tsx
const [confirmedTask, setConfirmedTask] = useState<string | null>(null);
```

Add an import for `Check` from lucide-react (add to existing import on line 2):

```tsx
import { Bot, Send, Search, Plus, Sparkles, X, Square, Check } from "lucide-react";
```

Add the auto-dismiss effect after the existing effects (around line 155):

```tsx
// Auto-dismiss task confirmation
useEffect(() => {
  if (!confirmedTask) return;
  const timer = setTimeout(() => {
    setConfirmedTask(null);
    onClose();
  }, 1500);
  return () => clearTimeout(timer);
}, [confirmedTask, onClose]);
```

- [ ] **Step 2: Create a helper function to handle task creation with confirmation**

Add a new callback **before** `handleSuggestionSelect` (insert before line 206), since `handleSuggestionSelect` will depend on it:

```tsx
const handleCreateTask = useCallback((title: string) => {
  onCreateTask(title);
  onInputChange("");
  setConfirmedTask(title);
}, [onCreateTask, onInputChange]);
```

- [ ] **Step 3: Replace all `onCreateTask` calls with `handleCreateTask`**

There are three places that call `onCreateTask` directly:

1. In `handleSuggestionSelect` (line 212):
   ```tsx
   // Before:
   } else if (suggestion.action === "create") {
     onCreateTask(input);
   }
   // After:
   } else if (suggestion.action === "create") {
     handleCreateTask(input);
   }
   ```

2. In `handleKeyDown`, forced create mode (line 296):
   ```tsx
   // Before:
   } else if (forcedAction === "create") {
     onCreateTask(input);
   }
   // After:
   } else if (forcedAction === "create") {
     handleCreateTask(input);
   }
   ```

3. In `handleKeyDown`, no-AI default (line 301):
   ```tsx
   // Before:
   // No AI: default Enter creates a task
   onCreateTask(input);
   // After:
   // No AI: default Enter creates a task
   handleCreateTask(input);
   ```

Update the dependency arrays:
- `handleSuggestionSelect` deps: replace `onCreateTask` with `handleCreateTask`
- `handleKeyDown` deps: replace `onCreateTask` with `handleCreateTask`, add `onInputChange` (now called in Escape handler for forcedAction clear)

- [ ] **Step 4: Add the confirmation card JSX**

Inside the glass container, after the search results inline block and before the conversation area, add:

```tsx
{/* Task Created — inline confirmation */}
{confirmedTask && (
  <div className="border-t border-white/10">
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-6 h-6 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center flex-shrink-0">
        <Check size={12} className="text-green-400" />
      </div>
      <div>
        <div className="text-sm text-white/85 font-medium">{confirmedTask}</div>
        <div className="text-[11px] text-white/35">Added to Inbox</div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Gate other inline sections when confirmation is showing**

The task confirmation should be the only inline section visible. Update the `showSuggestions` condition to also check `!confirmedTask`:

```tsx
// Before:
const showSuggestions = isOpen && (input.trim().length > 0 || forcedAction !== null) && !hasConversation;
// After:
const showSuggestions = isOpen && (input.trim().length > 0 || forcedAction !== null) && !hasConversation && !confirmedTask;
```

Update `showSearchResults` to also gate on `!confirmedTask`:

```tsx
// Before:
const showSearchResults = isOpen && !hasConversation && !showSuggestions && (isSearching || (searchResults !== null && searchResults !== undefined));
// After:
const showSearchResults = isOpen && !hasConversation && !showSuggestions && !confirmedTask && (isSearching || (searchResults !== null && searchResults !== undefined));
```

Update the AI Upsell condition to also gate on `!confirmedTask` (prevents upsell from showing alongside the confirmation card):

```tsx
// Before:
{isOpen && !hasAI && !input.trim() && !hasConversation && !showSearchResults && (
// After:
{isOpen && !hasAI && !input.trim() && !hasConversation && !showSearchResults && !confirmedTask && (
```

- [ ] **Step 6: Update Escape key handling for forcedAction layering**

The spec requires that when `forcedAction` is set (e.g., user pressed `s ` for search mode), Escape clears `forcedAction` first without closing the omnibar. A second Escape then closes it.

In `handleKeyDown`, modify the Escape branch. Currently (around lines 222-235):

```tsx
// Before:
if (e.key === "Escape") {
  e.preventDefault();
  // Layered dismiss: weather → conversation → omnibar
  if (showWeatherExpanded && onWeatherClick) {
    onWeatherClick();
    return;
  }
  if (hasConversation && onReset) {
    onReset();
    return;
  }
  setForcedAction(null);
  onClose();
  return;
}
```

```tsx
// After:
if (e.key === "Escape") {
  e.preventDefault();
  // Layered dismiss: weather → conversation → forced action → omnibar
  if (showWeatherExpanded && onWeatherClick) {
    onWeatherClick();
    return;
  }
  if (hasConversation && onReset) {
    onReset();
    return;
  }
  if (forcedAction) {
    setForcedAction(null);
    onInputChange("");
    return;
  }
  onClose();
  return;
}
```

This adds a new layer: if `forcedAction` is set, first Escape clears it and the inline panel disappears (because `showSuggestions`/`showSearchResults` depend on `forcedAction`). Second Escape closes the omnibar.

- [ ] **Step 7: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: All packages pass

- [ ] **Step 8: Manual verification**

Test:
1. Type a task title, select "Create task" from suggestions → confirmation card appears with green check + title + "Added to Inbox"
2. After ~1.5s, confirmation auto-dismisses and omnibar collapses
3. Use `t ` shortcut, type title, Enter → same confirmation behavior
4. Without AI configured: type text, Enter → same confirmation behavior
5. Weather pill still visible in top bar during confirmation
6. Rapidly creating multiple tasks — each one resets the timer correctly
7. Escape in `s ` mode clears forced action first, second Escape closes omnibar
8. AI Upsell does not appear while task confirmation is showing

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "feat(omnibar): add inline task creation confirmation with auto-dismiss"
```

---

### Task 4: Final cleanup and ordering verification

Ensure the inline sections render in the correct order and the JSX structure is clean.

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx` — verify section ordering

- [ ] **Step 1: Verify the inline section order inside the glass container**

The sections inside the glass container `<div>` should be in this order:

```tsx
<div className="relative bg-black/40 backdrop-blur-xl ...">
  {/* 1. Top Bar (input) — when no conversation */}
  {!hasConversation && ( <div className="flex items-center h-12 ..."> ... </div> )}

  {/* 2. Suggestions — inline */}
  {showSuggestions && ( ... )}

  {/* 3. Search Results — inline */}
  {showSearchResults && ( ... )}

  {/* 4. Task Created — inline confirmation */}
  {confirmedTask && ( ... )}

  {/* 5. Weather Expanded */}
  {showWeatherExpanded && weather && !hasConversation && !showSuggestions && !showSearchResults && !input.trim() && ( ... )}

  {/* 6. AI Upsell */}
  {isOpen && !hasAI && !input.trim() && !hasConversation && !showSearchResults && ( ... )}

  {/* 7. Conversation Area */}
  {isOpen && hasConversation && ( ... )}
</div>
```

Sections 2-4 are mutually exclusive (only one shows at a time due to gating logic). Section 5 has its own gates. Section 7 replaces sections 1-6 when conversation is active.

- [ ] **Step 2: Remove the `rounded-b-2xl` conversation class if no longer needed**

Check line 316: `${hasConversation && isOpen ? "rounded-b-2xl" : ""}`. This was added when conversation replaced the top bar. It's still valid since conversation mode still changes the container shape. Leave it.

- [ ] **Step 3: Verify no floating dropdowns remain outside the glass container**

The outer `<div ref={containerRef}>` should contain only the glass container `<div>` — nothing else. Confirm there are no stray `absolute`-positioned siblings.

- [ ] **Step 4: Full typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: All packages pass (14/14)

- [ ] **Step 5: Full manual test pass**

Run through all states:
1. **Collapsed**: Bot icon, placeholder, weather pill, ⌘K badge — unchanged
2. **Suggestions**: Type text → inline suggestions below divider, arrow keys work, Enter selects
3. **Search**: `s ` + query + Enter → inline results, loading spinner, empty state all inline
4. **Task create**: `t ` + title + Enter → inline confirmation, auto-dismisses ~1.5s
5. **Brett conversation**: Ask question → conversation inline, follow-up input, Escape resets
6. **Weather**: Click weather pill → expands inline, click day → scrolls hourly
7. **Escape layering**: weather → conversation → forced action → close
8. **Click outside**: Closes when no conversation

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Omnibar.tsx
git commit -m "refactor(omnibar): verify inline section ordering and cleanup"
```
