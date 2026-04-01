# Settings Page Redesign — Design Spec

## Overview

Redesign the settings page from a single scrolling page with sticky horizontal category tabs to a **vertical sidebar + detail pane** layout. The left nav auto-collapses when settings is open, giving the settings sidebar and content area maximum breathing room. Each category gets its own page with content broken into smaller, focused cards.

## Layout Structure

### Three-column layout when settings is active

```
┌──────────┬───────────────────┬──────────────────────────────────────┐
│ Left Nav │  Settings Sidebar │  Detail Pane                         │
│  (68px)  │     (200px)       │  (flex-1, content max-w 640px)       │
│ collapsed│                   │                                      │
│ to icons │  ← Settings       │  Profile                             │
│          │                   │  Your personal information...        │
│  [logo]  │  ACCOUNT          │                                      │
│  ──────  │  ● Profile        │  ┌─────────────────────────────┐     │
│  [inbox] │    Security       │  │ Avatar & Identity card      │     │
│  [today] │                   │  └─────────────────────────────┘     │
│  [up]    │  CONNECTIONS      │  ┌─────────────────────────────┐     │
│  [cal]   │    Calendar       │  │ Display Name card           │     │
│  [scout] │                   │  └─────────────────────────────┘     │
│          │  INTELLIGENCE     │  ┌─────────────────────────────┐     │
│          │    AI Providers   │  │ Email card                  │     │
│          │    Memory         │  └─────────────────────────────┘     │
│          │                   │                                      │
│          │  PREFERENCES      │                                      │
│          │    Timezone & Loc  │                                      │
│          │    Briefing       │                                      │
│          │                   │                                      │
│          │  DATA             │                                      │
│          │    Import         │                                      │
│          │                   │                                      │
│          │  ─────────────    │                                      │
│  [user]  │  Sign Out         │                                      │
│          │  Delete Account   │                                      │
└──────────┴───────────────────┴──────────────────────────────────────┘
```

### Left nav behavior

- Auto-collapses to **68px icon mode** when settings route is active. Same collapse mechanic already used when the task detail panel opens (`isCollapsed` state in LeftNav).
- Transition: **300ms ease-in-out** (matches existing).
- User avatar at bottom of collapsed nav stays visible.
- Clicking any main nav item (Inbox, Today, etc.) exits settings and expands nav back.
- No hover-to-expand on collapsed nav while in settings.

### Settings sidebar

- Width: **200px**, fixed.
- Background: `bg-white/5` with `border-r border-white/5`.
- Top: back arrow + "Settings" title. Back arrow navigates to previous page (`navigate(-1)`).
- Bottom: "Sign Out" and "Delete Account" pinned with `mt-auto`.
- Delete Account text uses `text-red-400/60`.

### Detail pane

- Fills remaining width (`flex-1`).
- Content constrained to **max-w-[640px]** for readable line length.
- Padding: **32px horizontal, 20px top**.
- Scrolls independently (`overflow-y-auto scrollbar-hide`).

## Sidebar Categories & Items

### Groups and items

| Group | Items | Notes |
|-------|-------|-------|
| **Account** | Profile, Security | |
| **Connections** | Calendar | Future: more integrations land here |
| **Intelligence** | AI Providers, Memory | |
| **Preferences** | Timezone & Location, Briefing | Timezone + Location merged — closely related, neither heavy enough alone |
| **Data** | Import | |
| *(pinned bottom)* | Sign Out, Delete Account | Separated by `mt-auto` spacer |

### Sidebar styling

- Group headings: `text-[8px] uppercase tracking-[1.5px] text-white/30 px-2`.
- Items: `text-[11px] px-2.5 py-[7px] rounded-md`.
- Active item: `bg-white/10 text-white/90`.
- Hover (inactive): `bg-white/5 text-white/50`.
- Inactive: `text-white/40`.
- Gap between items within a group: `2px`.
- Gap between groups: `14px` top margin on group heading.
- Default selection on mount: **Profile** (first item).

## Slide Transition

When switching categories in the sidebar:

- Content slides **vertically** based on direction relative to current selection.
- Clicking an item **below** current: new content enters from below (slides up + fades in).
- Clicking an item **above** current: new content enters from above (slides down + fades in).
- Duration: **200ms**.
- Easing: **ease-out**.
- Slide distance: **12px** (subtle, not dramatic).
- Old content fades out instantly (opacity 0), new content slides + fades in.
- Scroll position resets to top on category switch.

### Implementation approach

Track the index of each sidebar item. Compare previous index vs new index to determine direction. Use CSS transitions or `framer-motion`'s `AnimatePresence` with a dynamic `custom` prop for direction. Given the app likely already uses framer-motion or similar, prefer that over manual CSS.

## Per-Page Card Breakdown

Each settings page consists of multiple smaller cards. Cards use the standard surface pattern: `bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4`. Gap between cards: **12px**.

Each page has a title (`text-[17px] font-semibold text-white`) and subtitle (`text-[11px] text-white/30`) above the cards, with **20px** spacing below the subtitle.

### Profile

1. **Avatar & Identity** — avatar circle, name, email, "Change avatar" button.
2. **Display Name** — editable input with save button.
3. **Email** — read-only display, shows auth method.

### Security

1. **Sign-in Method** — Google badge or email/password indicator.
2. **Change Password** — current + new password fields (only for email auth users).
3. **Passkeys** — registered passkeys list, add new passkey button.

### Calendar

1. **Connected Accounts** — list of Google Calendar accounts with disconnect.
2. **Calendar Visibility** — toggles per calendar.
3. **Granola Integration** — meeting action integration settings.

### AI Providers

1. **Active Provider** — current provider indicator with status.
2. **Provider Cards** — Anthropic, OpenAI, Google — each with API key field and status.
3. **Usage Stats** — usage display for active provider.

### Memory

1. **Memory Summary** — count of stored facts.
2. **Facts by Category** — categorized list (Preferences, Context, Relationships, Habits) with delete per fact.

### Timezone & Location

1. **Timezone** — auto-detect toggle + manual timezone picker.
2. **Location** — city search with autocomplete.
3. **Weather** — enabled toggle + temperature unit selector (auto/fahrenheit/celsius).

### Briefing

1. **Daily Briefing** — enable/disable toggle + "Show now" button if dismissed today.

### Import

1. **Things 3 Import** — scan/preview/import workflow (macOS only).
2. **Import History** — status of past imports.

## Routing

Settings currently lives at `/settings` as a single page. The redesign introduces **nested state** within settings but does NOT need nested routes. Use component-level state to track the active sidebar item.

- URL stays as `/settings` regardless of which category is selected.
- Deep-linking via hash (`/settings#ai-providers`) is preserved: on mount, parse the hash and set the active sidebar item accordingly.
- Hash mapping: `profile`, `security`, `calendar`, `ai-providers`, `memory`, `timezone-location`, `briefing`, `import`.

## Component Structure

### New components

- `SettingsSidebar.tsx` — the vertical category navigation. Receives `activeItem` and `onItemSelect`. Renders grouped items with headings.
- `SettingsLayout.tsx` — orchestrator that renders sidebar + detail pane side by side. Manages active item state, direction tracking for transitions, and hash-based deep linking.

### Modified components

- `SettingsPage.tsx` — gutted and replaced with `SettingsLayout`. The existing section components (ProfileSection, SecuritySection, etc.) are reused as-is inside the new layout.
- `LeftNav.tsx` — needs to know when settings is active to trigger collapse. Currently collapses based on detail panel state; extend the same mechanism for the settings route.
- `App.tsx` — may need to pass settings-active state to LeftNav, or LeftNav can read the current route via `useLocation`.

### Preserved components (no changes needed)

All existing section components remain unchanged:
- `ProfileSection.tsx`
- `SecuritySection.tsx`
- `CalendarSection.tsx`
- `TimezoneSection.tsx` + `LocationSection.tsx` (rendered together on one page)
- `BriefingSection.tsx`
- `AISection.tsx`
- `MemorySection.tsx`
- `ImportSection.tsx`
- `SignOutSection.tsx` — no longer a section card. Sign Out becomes a clickable sidebar item that triggers the sign-out action directly.
- `DangerZoneSection.tsx` — Delete Account becomes a clickable sidebar item that opens the existing `DeleteAccountDialog` directly.

The "smaller cards" refinement is a separate follow-up pass — this redesign focuses on the layout restructure first. The existing section components will work as-is in the new detail pane.

## What This Does NOT Change

- No new API endpoints or data model changes.
- No changes to any section's internal logic or state management.
- No changes to the design system (all surfaces, colors, typography follow existing DESIGN_GUIDE.md).
- Mobile/responsive is not in scope (Electron desktop only).
- The left nav's expanded behavior on non-settings routes is unchanged.
