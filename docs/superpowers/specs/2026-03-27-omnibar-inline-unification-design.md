# Omnibar Inline Unification — Design Spec

## Problem

The Omnibar has three action modes (Brett conversation, search, task creation) that use three incompatible UX patterns:

| Mode | Container | Feedback |
|------|-----------|----------|
| Brett conversation | Inline — replaces top bar, grows omnibar downward | Full chat UI with bubbles, streaming, skill cards |
| Search | Floating dropdown below omnibar (`absolute top-full`) | Result rows in detached panel |
| Task creation | None | Zero feedback — input clears silently |

This creates three problems:
1. **Search feels cheap** compared to the Brett experience because it floats outside the container
2. **Task creation has no confirmation** — violates the design guide's rule that every animation must communicate a state change
3. **Suggestions dropdown also floats** — same spatial inconsistency as search

## Solution: Option D — Inline Everything

**One container, one expansion direction, three visual identities.**

All modes expand the omnibar downward with a `border-t` divider. What differentiates modes is the content inside (icon, color, layout), not where the content renders.

## Design

### Principle

The omnibar has exactly one spatial behavior: it grows vertically. Every interaction (search, create, ask Brett, weather) renders inside the same glass container below a thin divider. No floating dropdowns. All inline panels render inside `containerRef` — never in a portal — so click-outside detection continues to work.

### State: Collapsed (unchanged)

Same as today: Bot icon, input placeholder, weather pill, ⌘K badge.

### State: Suggestions (type-ahead)

**Currently:** Floating dropdown below omnibar.
**New:** Renders inline inside the omnibar below a `border-t` divider.

When the user types and hasn't committed to an action yet, suggestion rows appear inside the container:
- Each row: icon + label + optional shortcut badge
- Arrow key navigation highlights rows with `bg-white/10`
- Enter selects the highlighted suggestion
- Same data and behavior as today, just rendered inline instead of floating

### State: Search Results

**Currently:** Floating dropdown with result count header.
**New:** Renders inline inside the omnibar below a `border-t` divider. No result count header.

- Input stays visible in the top bar with the query text
- Results render directly below the divider
- Each row: status dot + type label + title + list name (same data as today)
- Arrow key / Tab navigation, Enter to open
- Max visible results: 8 (same as today), content area scrolls if overflow

**Search sub-states:**
- **Loading** (`isSearching = true`): Inline spinner + "Searching..." text, same content as today but rendered inside the container
- **Empty** (`visibleResults.length === 0`): "No results found." text, rendered inline
- **Results present**: Result rows as described above

### State: Task Created (new)

**Currently:** No feedback.
**New:** Brief inline confirmation card, then auto-dismiss.

**Implementation:** Add a `confirmedTask: string | null` state variable. When `onCreateTask` fires:
1. Store the task title in `confirmedTask`
2. Clear input
3. Below the divider, render a simple confirmation row: green check circle (`bg-green-500/15 border border-green-500/30`) + task title (medium weight) + "Added to Inbox" subtext (`text-white/35`)
4. A `useEffect` watching `confirmedTask` starts a 1.5s `setTimeout`, then sets `confirmedTask` back to `null` and calls `onClose()` to collapse the omnibar
5. Cleanup: the effect returns `clearTimeout` to avoid stale timers

This is a standalone row component — not a `SkillResultCard` reuse. The skill card requires a full tool-call object and conversation context. The confirmation row is simpler: just a check icon, title, and subtitle.

### State: Brett Conversation (unchanged)

Stays as-is. Already renders inline. This is the pattern the other modes are now matching.

### State: Weather Expanded (unchanged)

Already renders inline with `border-t`. The existing gating condition is preserved: weather expanded only shows when `!showSuggestions && !showSearchResults && !input.trim()` — so it never renders simultaneously with other inline sections.

## Interaction Details

### Escape Key

Layered dismiss order:
1. Weather expanded open → close weather (existing)
2. Active conversation → reset conversation (existing)
3. `forcedAction` set (e.g., `s ` or `t ` prefix) → clear `forcedAction`, collapse inline panel. Omnibar stays open but empty.
4. Otherwise → close omnibar

This means: if the user pressed `s ` to enter search mode and results are showing, first Escape clears the forced mode and dismisses results. Second Escape closes the omnibar. This matches the current behavior where `setForcedAction(null)` and `onClose()` happen together — the difference is just visual (inline panel disappears vs floating dropdown disappears).

### Click Outside

Same behavior as today. When suggestions or search results are showing (no conversation), clicking outside closes the omnibar. All inline panels are children of `containerRef`, so clicks inside them don't trigger the outside handler.

### Transition Between Modes

- Typing with suggestions visible → selecting "Search" → suggestions replaced by search results (same container, content swaps)
- Typing with suggestions visible → selecting "Create task" → suggestions replaced by confirmation card → auto-dismiss
- Typing with suggestions visible → selecting "Ask Brett" → suggestions disappear, conversation begins

### Forced Action Modes (s + space, t + space)

Unchanged. `s ` still forces search mode, `t ` still forces create mode. The only difference is where the resulting UI renders (inline vs floating).

## Animation

The inline sections appear and disappear without height transitions — same as the current floating dropdowns which have no entry/exit animation. Adding `max-h` transitions or framer-motion is out of scope for this change (the design guide says CSS keyframes are the current approach, and the existing omnibar uses none for dropdowns).

**Task confirmation card:** Appears instantly. Dismisses after 1.5s by setting `confirmedTask = null` — the row simply unmounts. No exit animation. The 1.5s timer starts immediately after the state is set (after the task creation call returns). If we want a fade-out later, that's a polish pass, not part of this spec.

## SpotlightModal Exception

The CLAUDE.md rule states: "When editing either Omnibar or SpotlightModal, you MUST apply the same change to the other."

**This change is excepted from that rule.** The SpotlightModal is a centered modal overlay with different spatial semantics — floating dropdowns inside a modal don't have the same "cheap vs premium" perception problem because the modal itself is already a contained surface. The Omnibar sits in the main page flow where floating panels feel disconnected from the glass container. The SpotlightModal can be updated separately if desired, but it's not required for consistency here.

## Scope

### In Scope
- Move suggestions dropdown from floating to inline
- Move search results dropdown from floating to inline
- Add task creation confirmation card (inline, auto-dismiss)
- Keyboard navigation works identically in the inline variants

### Out of Scope
- Changing the Brett conversation UI
- Changing the weather expanded UI
- Changing suggestion logic or search result data
- SpotlightModal changes (see exception above)
- Entry/exit animations for inline panels
- Unified search (merging suggestions + search results into one list) — future consideration
- Brett-mediated search (Option E) — future consideration

## Files Affected

| File | Change |
|------|--------|
| `packages/ui/src/Omnibar.tsx` | Move suggestions and search results from floating `absolute` positioned divs to inline sections inside the main container. Add `confirmedTask` state variable and auto-dismiss timer. Add task creation confirmation row. |

This is a single-file UI change. No API, type, or hook changes required.

## Testing

- Manual: verify all omnibar modes render inline
- Manual: verify keyboard navigation (arrow keys, Enter, Escape, Tab) works in suggestions and search results
- Manual: verify task creation shows confirmation then auto-dismisses after ~1.5s
- Manual: verify weather expanded still works alongside other inline sections
- Manual: verify search loading spinner and empty state render inline
- Manual: verify Spotlight (⌘K) is unaffected (it has its own rendering)
- Typecheck: `pnpm typecheck` passes
