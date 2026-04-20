# Demo Mode

**Date:** 2026-04-19
**Scope:** Desktop only
**Purpose:** Let the user screenshare Brett without exposing real task titles and calendar event titles.

## Problem

Brent demos Brett on calls. Real task titles and calendar events contain private information — names, companies, personal reminders. A one-keystroke toggle that swaps those titles for stable, funny placeholders lets him show the product without scrubbing his data first.

## Non-goals

- iOS: out of scope, forever. Screenshares happen on desktop.
- Task descriptions, chat, detail-pane bodies, Daily Briefing prose, list names in the left nav, scout names: not replaced. Briefing prose embeds titles inside narrative sentences — replacing mid-string is fragile and the user accepted this gap for MVP.
- Search-through-real-titles: when demo mode is ON, Omnibar/Spotlight search matches against *fake* titles. Keeps the illusion intact; the user will not be running searches mid-demo.

## UX

**Trigger:** `Cmd+Shift+D` toggles demo mode on/off.

**Indicator:** A small gold pill labeled `DEMO MODE` in the top-right of the sidebar header. Clickable — toggles off. Prevents the two failure modes: "I forgot it was on" (embarrassing next time the app is opened in front of someone) and "I forgot it was off" (started a screenshare, titles are live).

**Persistence:** `localStorage`. If the app reloads mid-screenshare, demo mode stays on.

**Mapping:** Stable per item. A given task ID always maps to the same fake title. Toggling off → on shows identical fake titles. Implementation: deterministic hash of the item ID → index into a curated phrase pool.

## Architecture

### Central helper — `packages/ui/src/lib/demoMode.ts`

Single source of truth. Exposes:

```ts
// Subscribable store + React hook
useDemoMode(): { enabled: boolean; toggle: () => void }

// The replacement function every surface calls
displayTitle(id: string, realTitle: string, kind: 'thing' | 'calendar'): string
```

Semantics:
- `displayTitle` reads the current store value synchronously. When `enabled === false`, it returns `realTitle` unchanged (zero overhead on the common path).
- When `enabled === true`, it returns `POOL[kind][hash(id) % POOL[kind].length]`.
- Hash: a simple, fast, non-cryptographic string hash (FNV-1a or equivalent). Deterministic across reloads.
- Store is a minimal subscribable singleton (plain module-level state + listeners) exported as a React hook via `useSyncExternalStore`. Avoids adding Zustand-for-one-boolean.

### Phrase pools

Two pools co-located in `demoMode.ts`:

- `things`: ~60 task-shaped phrases. Examples: "Negotiate truce with the office plant", "Email the dragon about escrow", "Ransom back the stapler", "File taxes for the rubber duck", "Apologize to the printer."
- `calendar`: ~40 calendar-shaped phrases. Examples: "Tactical nap sync", "Vibes quarterly", "Stakeholder beef", "Alignment grooming", "Standup about the standup."

Pool size rationale: with ~60 phrases and a good hash, collisions across a demo-size list (~30 visible items) are acceptable and occasionally funny. Not a privacy concern — the goal is to obscure real titles, not to guarantee unique fakes.

### Trigger wiring

Register `Cmd+Shift+D` in `apps/desktop/src/App.tsx` alongside the existing keyboard handlers. Match the existing pattern (`metaKey && altKey && e.key === 'd'`). Call `demoMode.toggle()`. No Electron `globalShortcut` — in-window only, which is what we want (shortcut only fires when Brett is focused).

### Indicator placement

A `<DemoModeBadge />` component rendered in the sidebar header (next to user avatar or below the logo — pick what fits the existing layout). Hidden when `enabled === false`. Gold pill, subtle, clickable.

### Surfaces to wire

Everywhere a thing title or calendar event title is rendered today, replace `thing.title` / `event.summary` with `displayTitle(thing.id, thing.title, 'thing')` or the calendar equivalent.

**Things** (`packages/ui/src/`):
- `ThingCard.tsx`
- `InboxItemRow.tsx`
- `UpNextCard.tsx`
- `NextUpCard.tsx`
- `TaskDetailPanel.tsx` — header title only; description and all other fields untouched
- `Omnibar.tsx` + `SpotlightModal.tsx` — list results; search also matches against fake titles when demo mode is on (filter logic must read `displayTitle`, not `thing.title`)
- `EventHoverTooltip.tsx` — where it renders linked-task titles

**Calendar** (`packages/ui/src/`):
- `CalendarTimeline.tsx`
- `CalendarEventDetailPanel.tsx` — header title only
- `EventHoverTooltip.tsx` — event summary
- `DailyBriefing.tsx` — *if* it renders discrete calendar rows (non-prose), replace those. Prose sentences that mention titles are left alone (see Non-goals). The implementer should inspect the component and apply only where a title appears as a rendered field, not as inline text inside a sentence.

**Explicitly not touched:** `DetailPanel.tsx` description fields, chat views, Daily Briefing prose sentences, list names in sidebar nav, `ScoutDetail.tsx`, `RecentFindingsPanel.tsx`, `LinkedItemsList.tsx` (flag for follow-up if it reads as title-heavy during demos), `ContentDetailPanel.tsx`.

## Data flow

```
Cmd+Shift+D
  → App.tsx keydown handler
  → demoMode.toggle()
  → localStorage write + listener fanout
  → every subscribed component re-renders
  → displayTitle() returns fake titles on next render
```

No server round-trip. No cache invalidation. Pure client-side presentation layer.

## Testing

Unit tests in `packages/ui/src/lib/demoMode.test.ts`:

- `displayTitle` passthrough when `enabled === false`.
- `displayTitle` returns a stable fake for the same `id` across repeated calls.
- `displayTitle` returns different pools for `'thing'` vs `'calendar'` (no cross-contamination — no calendar phrase shows up for a task).
- Hash distribution: across 200 randomly generated IDs, no single phrase is used more than ~8× (sanity check against bad hash clustering).
- Toggle updates subscribers synchronously.

One integration test (desktop, if the existing test harness allows):
- Render a ThingCard, assert real title is shown.
- Fire Cmd+Shift+D.
- Assert fake title is shown.
- Fire again. Assert real title is back.

## Out-of-scope / known gaps

- Daily Briefing prose leaks real titles. Accepted for MVP.
- Left-nav list names leak real list names. Accepted — user said "just those two spots."
- iOS has no demo mode. Screenshares happen on desktop.
- Chat views leak whatever they leak. Per user brief.
- If in the future we want stricter privacy (e.g., also swap people names, email addresses, locations) this helper's shape (`kind`-parameterized) is easy to extend — just add more kinds and more pools.

## Risks

- **Forgetting to toggle off.** Mitigated by the always-visible gold `DEMO MODE` badge.
- **Shortcut collision.** `Cmd+Shift+D` is currently unused in Brett; confirm during implementation by grepping existing handlers.
- **Performance.** `displayTitle` on the hot path for every list item. The `enabled === false` early return keeps this O(1) and allocation-free. The `enabled === true` path is one hash + one array index — also O(1).
- **Test harness coverage.** The integration test assumes the desktop test setup renders `ThingCard` and can dispatch keyboard events. If that harness doesn't exist, ship the unit tests alone and verify the integration manually before merging.
