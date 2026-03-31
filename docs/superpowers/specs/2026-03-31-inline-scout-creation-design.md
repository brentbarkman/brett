# Inline Scout Creation on Scouts Page

## Goal

Replace the "New Scout" button → spotlight modal flow with an inline omnibar embedded at the top of the scouts roster page. Scout creation becomes a conversational input in-context rather than a floating modal.

## Background

Scout creation is a multi-turn conversation (goal sharpening, source suggestions, config proposal, confirmation). The spotlight modal (⌘K) is designed for quick search/act — one or two turns. The scouts roster page is the natural home for this conversation since the user can see existing scouts while creating.

## Design

### Omnibar `placeholder` prop

Add an optional `placeholder` prop to the Omnibar component (`packages/ui/src/Omnibar.tsx`). Currently the placeholder is hardcoded. When provided, it overrides the default. No other Omnibar changes needed.

### ScoutsRoster receives omnibar props

ScoutsRoster gains omnibar-related props (the same set TodayView uses) and renders the Omnibar inline at the top, replacing the "New Scout" button. The layout becomes:

```
┌─────────────────────────────────┐
│ Scouts (3 active)               │
│ ┌─────────────────────────────┐ │
│ │ What do you want to monitor?│ │  ← inline omnibar (collapsed)
│ └─────────────────────────────┘ │
│                                 │
│ [Scout Card] [Scout Card]       │  ← existing roster
│ [Scout Card]                    │
└─────────────────────────────────┘
```

When the user types and sends, the omnibar expands to show the conversation (messages, streaming, tool results) — same behavior as TodayView's omnibar.

### App.tsx wiring

App.tsx passes the existing omnibar props to ScoutsRoster, the same way it passes them to TodayView. The `send()` calls use `currentView: "scouts"` so Brett knows the context.

Remove `handleNewScout` (which opened spotlight with pre-filled text). The ScoutsRoster empty state "Create your first Scout" button should focus the inline omnibar input instead.

### System prompt context

The API already receives `currentView` via the omnibar hook's `send()`. Add a line to the Brett system prompt: when `currentView` is "scouts", Brett should default to treating input as scout creation intent (same goal-sharpening flow, just without requiring the user to say "create a scout").

### SpotlightModal (⌘K)

Unchanged. Users can still create scouts from ⌘K anywhere in the app — it just won't be the primary path from the scouts page.

## Files Changed

- `packages/ui/src/Omnibar.tsx` — add optional `placeholder` prop
- `packages/ui/src/ScoutsRoster.tsx` — accept omnibar props, render inline omnibar, remove "New Scout" button
- `apps/desktop/src/App.tsx` — pass omnibar props to ScoutsRoster, remove `handleNewScout`, pass `currentView: "scouts"` in send
- `packages/ai/src/context/system-prompts.ts` — add scouts page context hint to Brett system prompt

## Not In Scope

- No new components
- No new API routes
- No changes to create_scout skill or backend
- No changes to SpotlightModal
- No changes to useOmnibar hook (it already supports currentView context)
