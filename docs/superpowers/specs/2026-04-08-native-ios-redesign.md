# Brett iOS — Native SwiftUI Redesign

**Date:** 2026-04-08
**Status:** Design approved
**Replaces:** `2026-04-08-mobile-ux-design.md` (React Native prototype)
**Builds on:** `2026-04-07-ios-app-system-design.md` (sync protocol, API contract)
**Framework:** Swift / SwiftUI / iOS 26+

---

## Design Philosophy

**One input. Three views. No clutter.**

Brett mobile is not a shrunken desktop app. It's a purpose-built iOS experience where the background IS the interface, glass is used with restraint, and every pixel of screen real estate earns its place.

The app should feel like it was designed by someone Apple calls for advice. Trendsetting, not trend-following. Intuitive even when unconventional. Tastefully pushing limits.

**Core principles:**
1. **Background is the brand** — living photography sets the mood, glass doesn't hide it
2. **Restraint over decoration** — few cards, generous whitespace, no boxes inside boxes
3. **One surface for everything** — the omnibar captures, navigates, and talks to Brett
4. **Typography is hierarchy** — size, weight, and opacity do the work, not containers
5. **Motion means something** — every animation communicates state, nothing is decorative
6. **Liquid glass where it earns its place** — iOS system glass for structure, custom treatments for Brett identity

---

## Technology

- **Language:** Swift
- **UI Framework:** SwiftUI (iOS 26+)
- **Glass/Materials:** `.ultraThinMaterial`, `.thinMaterial`, custom `Material` configurations
- **Data:** SwiftData for local persistence, shared App Group container for widgets/extensions
- **Networking:** URLSession + async/await
- **Auth:** Keychain for token storage, URLSession for sign-in/sign-up API calls
- **Sync:** Offline-first — SwiftData (local) → mutation queue → POST /sync/push → server. Pull via POST /sync/pull with per-table cursors. Same protocol as the RN prototype.
- **Haptics:** UIFeedbackGenerator (UIKit bridge)
- **Animations:** SwiftUI `.animation()`, `withAnimation()`, spring physics via `Animation.spring()`
- **Background images:** Bundled or fetched image set, same manifest as desktop (6 time segments × 3 busyness tiers)

---

## Spatial Model & Navigation

```
              ⚙ (top-right, settings push)

    ← Inbox  ·  TODAY  ·  Calendar →
    (swipe)    (home)     (swipe)

     ══════════════════════════════
     Omnibar (pinned, every screen)
     ══════════════════════════════
```

### Three horizontal pages

Swipe between them. Subtle dot indicators near the top.

| Page | Position | Content |
|------|----------|---------|
| **Inbox** | Left | Unsorted tasks, newsletters, captured content |
| **Today** | Center (home) | Daily command center — header, briefing, tasks by urgency, this week, done |
| **Calendar** | Right | Week strip + day timeline |

- App always launches to **Today** (center page).
- **Upcoming is folded into Today** — "This Week" and "Next Week" sections appear below today's tasks. No separate page needed.
- **No tab bar.** The omnibar replaces it as the persistent bottom element.

### Settings

Gear icon in the top-right corner of the header. Tap → standard iOS push navigation to settings screen. Grouped inset list style.

### Drill-in screens

Standard iOS push (slide from right, swipe-back from left edge):
- Task detail
- List view (filtered tasks)
- Scout detail
- Content/newsletter detail
- Event detail
- Settings

---

## Visual Treatment

### Background

Full-bleed living photography. Clearly visible — this is the soul of the app.

- Same image manifest as desktop: 6 time segments (Dawn, Morning, Afternoon, Golden Hour, Evening, Night) × 3 busyness tiers = 18 categories
- Busyness formula: `score = (meetingCount × 2) + taskCount`
- Images served at device-appropriate resolution
- Slow crossfade between images (~10 minute rotation within category, 3-second dissolve)
- Top vignette gradient for status bar readability
- Bottom vignette gradient for omnibar readability
- **The background adapts:** brighter images get a slightly heavier vignette. Metadata (average luminance per zone) ships with each image.

### Surface model

**No full-screen glass sheet.** The background is clearly visible. Content uses glass only where it earns its place.

| Element | Surface | Treatment |
|---------|---------|-----------|
| **Header (date, stats)** | None — floats on background | Text shadow / vignette for readability |
| **Section cards (Overdue, Today, This Week, Done)** | Glass card | `.thinMaterial`, subtle `white/8` border, 12-14pt radius |
| **Daily Briefing** | Cerulean-tinted glass card | Custom material with cerulean tint, distinct from task cards |
| **Task rows inside cards** | None — content within section card | Checkbox + title + metadata, separated by whitespace or `white/5` hairline |
| **Between cards** | Open — background visible | 20-24pt gaps. The app breathes here. |
| **Omnibar** | Glass pill | `.regularMaterial`, floating above home indicator |
| **List drawer** | Glass half-sheet | `.thickMaterial`, heavier blur |
| **Settings / modals** | Glass sheet | iOS system sheet presentation |
| **Calendar week strip** | Glass | `.thinMaterial` |
| **Calendar event blocks** | Glass chips | Lightweight individual glass elements |

### Typography

SF Pro (system) throughout. No custom fonts. Brand identity comes through color and space, not typography.

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Date header | 28pt | Bold | white/100 |
| Stats line | 13pt | Regular | white/35 |
| Section label | 11pt uppercase, 1.5px tracking | Semibold | gold/50 or white/25 |
| Task title | 16pt | Medium | white/85 |
| Task metadata | 12pt | Regular | white/40 |
| Omnibar placeholder | 16pt | Regular | white/30 |
| Briefing text | 14pt | Regular | white/60 |
| Briefing label | 11pt uppercase | Semibold | cerulean/60 |

### Color system

Unchanged from brand guide:

| Role | Color | Hex |
|------|-------|-----|
| Brand accent | Electric Gold | `#E8B931` |
| Brett AI (exclusive) | Deep Cerulean | `#4682C3` |
| Success | Teal | `#48BBA0` |
| Error / Overdue | Warm Red | `#E6554B` |
| Text | White at varying opacity | `rgba(255,255,255,*)` |

**Rule:** No gray values. Always white with opacity. Ensures consistency over any background.

### Card design

- Radius: 14pt
- Padding: 16pt
- Border: 1pt `white/8`
- Material: `.thinMaterial` (default), cerulean-tinted (briefing)
- Shadow: none (glass doesn't cast shadows — it catches light)
- Task rows within cards: 48pt height, no individual borders except `white/5` hairline between rows

---

## The Omnibar

The most important UI element. Always visible. Every screen. Replaces the tab bar.

### Anatomy

```
┌─────────────────────────────────────────┐
│  ≡   Add a task...              🎙      │
└─────────────────────────────────────────┘
```

- Glass pill, pinned above home indicator
- `≡` on left: list drawer
- Placeholder center: "Add a task..."
- Mic icon on right: voice mode
- Subtle gold accent on the left edge (brand touch)

### States

**Resting:** Glass pill with placeholder text. Visible on all three pages.

**Text input (tap):**
- Keyboard rises, omnibar stays pinned above keyboard
- Placeholder replaced with cursor
- Type task title → hit return → task created
- Gold flash confirmation on omnibar border, light haptic
- Smart parsing: "buy milk tomorrow at 5pm" → task with due date + reminder
- `#listname` assigns to a list
- Questions route to Brett chat

**Voice mode (tap mic):**
- Omnibar expands upward smoothly
- Gold waveform visualization appears above, responsive to audio amplitude
- "Listening..." state indicator
- On silence detection → smart parsing → task created
- Collapses back to resting state
- Heavy haptic on activate, light on dismiss

**List drawer (tap ≡):**
- Half-sheet rises from omnibar
- Your lists as horizontal scrollable pills with item counts
- `+` button to create a new list (inline name + color picker)
- Tap a list → push to filtered list view
- Swipe down to dismiss

### Omnibar on different pages

| Page | Placeholder | Default behavior |
|------|-------------|-----------------|
| Today | "Add a task..." | Creates task due today |
| Inbox | "Capture something..." | Creates undated task (true inbox) |
| Calendar | "Add an event..." | Creates event (future) or task |

---

## Screens

### 1. Today (Center Page)

The home screen. Vertical scroll.

**Header (no card):**
```
Wednesday, Apr 8
3 of 8 done · 3 meetings (2h 15m)
```
- Large date (28pt bold), floating on background
- Stats line below (13pt, white/35)
- Settings gear icon top-right
- Stats pulse gold briefly when a task is completed

**Daily Briefing (cerulean glass card):**
- Brett's AI-generated morning summary
- "DAILY BRIEFING" label in cerulean uppercase
- Collapsible (tap to toggle, state persisted)
- Dismissible (swipe right, returns next morning)

**Task sections (one glass card per section):**
- **Overdue** (if any) — section label in red, red left accent on the card
- **Today** — default section
- **This Week** — tasks due before end of week
- **Next Week** — tasks due next week
- **Done Today** — completed tasks at reduced opacity (white/35)

Each section card contains task rows with no individual containers. Rows are: checkbox (gold) + title + metadata whisper. 48pt row height. `white/5` hairline separators.

**Between every card: 20-24pt of open space.** Background visible.

### 2. Inbox (Left Page)

Swipe right from Today.

**Header:** "Inbox" + item count. Floating on background.

**One glass card** containing all inbox items:
- Tasks, newsletters, captured content in a flat list
- Newsletter items have a cerulean left accent within the card
- No urgency grouping (items are unsorted by definition)

### 3. Calendar (Right Page)

Swipe left from Today.

**Week strip (glass):**
- Horizontal scrollable week at top
- Current day: gold-filled circle
- Dots below days with events
- Tap day → scroll timeline to that day

**Day timeline:**
- Vertical timeline with hourly slots
- Events as glass chips with colored left border
- Event chip shows: title, location, duration
- Current-time indicator: gold horizontal line
- Tap event → push to event detail

### 4. Task Detail (Push)

Standard iOS push from any task row.

**Back breadcrumb:** "< Today" / "< Inbox" / "< List Name" — floating on background.

**Title area (no card):** Large editable title (22pt semibold) + checkbox. Floating on background.

**Details card (glass):** Grouped inset style.
- Due date (tappable to edit)
- List assignment (gold list name, tappable)
- Reminder (formatted time, tappable)
- Recurrence (tappable)

**Notes card (glass):** Free-form editable text.

**Subtasks card (glass):** Checklist with gold checkboxes. Add subtask input at bottom.

**Brett chat (cerulean glass):** "Ask Brett about this task..." at the bottom. Tap to expand inline chat.

**Between cards: 20-24pt gaps.** Background visible.

### 5. List View (Push)

Accessed from list drawer (≡ on omnibar).

- Header: list name + item count
- One glass card with filtered tasks
- Same row treatment as Today sections

### 6. Settings (Push)

Gear icon top-right → push navigation.

iOS grouped inset list style on glass. All sections:
- Profile
- Security
- Calendar (Google Calendar connection)
- AI Providers
- Newsletters
- Timezone & Location
- Lists (create, rename, reorder, delete, color)
- Import
- Updates
- Account

### 7. Empty States

No illustrations. Just words and space. Background breathes more prominently.

| Screen | Heading | Copy |
|--------|---------|------|
| Today (all done) | **"Cleared."** | "Nothing left. Go build something or enjoy the quiet." |
| Today (nothing) | — | "Nothing on the books today. A rare opening — use it well." |
| Inbox (empty) | **"Your inbox"** | "Everything worth doing starts here." |
| Upcoming (empty) | **"Wide open"** | "Nothing scheduled ahead. That's either zen or an oversight." |

Large heading (26pt bold), body copy (15pt, white/50). Centered vertically.

### 8. Sign In

- Clean, minimal. Background visible.
- App logo centered
- Email/password inputs (glass-backed)
- "Sign In" button (gold fill)
- "Sign in with Google" (glass outline)
- "Sign in with Apple" (system ASAuthorizationAppleIDButton)

---

## Gestures & Interactions

Consistent across every list view. No per-screen variations.

| Gesture | Action | Feedback |
|---------|--------|----------|
| **Tap checkbox** | Complete/uncomplete | Gold fill radiates from center. Success haptic. Task stays in place, list reflows after 1.5s idle. |
| **Tap task row** | Push to detail | Standard iOS push |
| **Swipe task right** | Quick schedule | Gold reveal. Inline date options (Today, Tomorrow, Next Week, Pick Date). Medium haptic at threshold. |
| **Swipe task left** | Delete/archive | Red reveal. Confirm at threshold with haptic. |
| **Long press task** | Drag to reorder | Row lifts with shadow + slight scale. Other rows part. Rigid haptic on lift. |
| **Swipe between pages** | Navigate Inbox/Today/Calendar | Horizontal spring paging with subtle overscroll bounce. |
| **Pull to refresh** | Sync | Gold-tinted refresh spinner. |
| **Swipe from left edge** | Back (drill-in screens) | Standard iOS |

### Task completion — batch behavior

Rapidly tapping multiple checkboxes:
- Each checkbox animates independently
- Rows do NOT reflow during rapid tapping
- After 1.5s of inactivity, completed items fade/slide into Done section
- List settles in one coordinated spring animation
- Shake to undo

### Multiselect

Swipe left on a task → enters selection mode:
- Selection circles appear on all rows
- Bottom toolbar slides up above omnibar: **Schedule**, **Move to List**, **Delete**
- Tap more rows to toggle selection
- Tap action → applies to all selected → exits selection mode

---

## Motion & Animation

### Morning ritual (first open of day)

Background crossfades from dawn. Date header fades in, then section cards stagger up — 100ms between each. Total ~800ms. Plays once per day (tracked via local storage date check).

### Task completion cascade

1. Checkbox fills gold (150ms spring)
2. Header stats pulse gold briefly (400ms ease-out)
3. After 1.5s idle: row slides and fades into Done section (300ms ease-out)
4. List settles with spring physics (400ms)

### Omnibar capture

1. Text slides up and fades on submit (200ms)
2. Gold flash on omnibar border (150ms)
3. New task appears in appropriate section with slide-in (250ms spring)

### Voice mode

1. Omnibar expands upward (200ms spring)
2. Gold waveform pulses with amplitude
3. On finish: collapses back (300ms spring)
4. Heavy haptic activate, light haptic dismiss

### Page transitions

Horizontal spring paging. Background moves slower than content (parallax). Dot indicators update with spring physics.

### Background

Slow crossfade rotation (~10 min). 3-second dissolve. Never abrupt.

### Reduce motion

All animations collapse to simple fades or instant state changes when "Reduce Motion" is enabled in iOS Settings.

---

## Accessibility

### Dynamic Type

All text scales via `UIFontMetrics`. Layout adapts — taller rows, more vertical space. Section cards grow naturally.

### VoiceOver

Every interactive element has semantic labels:
- Task: "[title], [due date], [list name]. Double-tap for details."
- Checkbox: "Complete [title]" / "Mark [title] incomplete"
- Omnibar: "Add a task. Double-tap to start typing."
- Page indicator: "[Page name], page [N] of 3"
- Swipe actions: exposed as accessibility custom actions

### High Contrast

When "Increase Contrast" enabled:
- Glass materials increase opacity
- Text opacity bumps up one tier
- Borders become more visible
- Gold accent slightly brightened

---

## iOS Integrations (v1)

### Widgets (WidgetKit)

Lock screen (rectangular): next task + event count.
Home screen (small): today progress ring + next event.
Home screen (medium): progress + next 3 tasks + next event.

Reads from shared App Group SwiftData container.

### SiriKit

`INAddTasksIntent`, `INSearchForNotebookItemsIntent`, `INSetTaskAttributeIntent`. Swift Intents Extension reading/writing shared App Group data.

### Shortcuts (App Intents)

"Brett daily briefing" — reads cached briefing aloud.

### Share Sheet Extension

Share from any app → captured to Brett Inbox. Compact form, saves to shared App Group → mutation queue.

### Spotlight

Tasks indexed via `CSSearchableIndex`. Tap result → opens task detail.

### Notifications

- Task reminders (at set time)
- Event alerts (configurable pre-event)
- Daily briefing ready (morning)
- Overdue nudge (configurable)
- Actionable: "Complete" and "Snooze" on task reminders

### Sign in with Apple

Required for App Store. Native `ASAuthorizationAppleIDButton`.

---

## Appearance

**Dark mode only (v1).** The living background system requires a dark canvas. App ignores system appearance setting.

---

## Sync Engine (Swift Implementation)

Same protocol as the API expects. Reimplemented in Swift.

### Local storage: SwiftData

- Models mirror Prisma schema: Item, List, CalendarEvent, etc.
- `@Model` classes with same fields
- Relationships via SwiftData `@Relationship`

### Mutation queue

- `MutationQueue` table in SwiftData
- Each write: save to SwiftData (optimistic) + enqueue mutation
- Background task pushes queue via `POST /sync/push`
- Field-level merge with `previousValues` for conflict resolution

### Pull sync

- `POST /sync/pull` with per-table cursors
- Returns upserted + soft-deleted records
- Apply to SwiftData, advance cursors
- 30-second auto-poll when online + pull-to-refresh

### Offline

All writes are local-first. Mutation queue accumulates offline. On connectivity restored, push queue then pull latest.

### Auth

- `POST /api/auth/sign-in/email` → receives JWT token
- Token stored in Keychain (`kSecClassGenericPassword`)
- All API requests include `Authorization: Bearer <token>` header
- Sign out: clear Keychain, wipe SwiftData

---

## What Carries Over from RN Prototype

**Conceptual (knowledge, not code):**
- Screen inventory and information architecture
- Sync protocol design (push/pull, cursors, mutation queue)
- API contract (`/sync/push`, `/sync/pull`, `/api/auth/*`)
- Gesture model (swipe right = schedule, swipe left = delete, long press = reorder)
- Haptic feedback map
- Empty state copy
- Smart parsing concept for omnibar

**Nothing from the codebase.** All TypeScript/React Native code is abandoned. Clean Swift project.

---

## What's New vs RN Prototype

| Change | Old (RN) | New (SwiftUI) |
|--------|----------|---------------|
| Navigation | 5-tab bar | 3-page horizontal swipe, no tab bar |
| Omnibar | Pinned above tab bar on some screens | Pinned on every screen, replaces tab bar, handles voice + lists |
| Surfaces | Cards everywhere, boxes in boxes | Few section-level glass cards, generous spacing, background visible |
| Upcoming | Separate tab | Folded into Today as sections |
| Voice mode | Full-screen overlay | Inline omnibar expansion |
| Lists | Tab/drawer navigation | Omnibar drawer (≡), creation via `+` in drawer |
| Task rows | Individual containers | Bare content within section cards |
| Background | Not implemented in prototype | Living photography, clearly visible through gaps |
| Framework | Expo/React Native/TypeScript | Swift/SwiftUI, native iOS |
