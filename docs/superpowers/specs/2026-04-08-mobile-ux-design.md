# Brett Mobile — UX & Interaction Design

**Date:** 2026-04-08
**Status:** Design approved
**Builds on:** `2026-04-07-ios-app-system-design.md` (data layer, sync, architecture)
**Scope:** Navigation, screens, interactions, visual language, haptics, animations, iOS integrations

---

## Design Philosophy

**Full parity, form-factor native.** Every feature on desktop exists on mobile — but every surface is hyper-focused to the phone. Not a shrunken desktop. Not a compromised subset. A purpose-built iOS app that happens to do everything.

**Capture is the hero interaction.** The single most important thing Brett mobile does is let you fire off a task in under 2 seconds. Everything else is secondary to that speed.

**iOS bones, Brett's soul.** SF Pro for legibility, iOS touch targets and spacing, system navigation patterns. But Brett's dark palette, gold accents, editorial hierarchy, and dynamic backgrounds make it unmistakably Brett. Native where it counts, branded where it matters.

---

## Navigation Architecture

### Tab Bar (4 tabs + center voice button)

```
┌────────────────────────────────────────────────┐
│  Today    Inbox    🎙 Voice    Upcoming    Cal  │
└────────────────────────────────────────────────┘
```

| Position | Tab | Content |
|----------|-----|---------|
| Left 1 | **Today** | Daily command center — header, briefing, next event, tasks, omnibar |
| Left 2 | **Inbox** | Unsorted tasks, newsletters, captured content |
| Center | **Voice** | Brett voice mode activation (not a navigation destination) |
| Right 1 | **Upcoming** | Future tasks grouped by date |
| Right 2 | **Calendar** | Week strip + day timeline |

The center voice button is oversized with a gold accent and radial gradient. Tapping it activates Brett voice mode with a heavy haptic. It does not navigate — it's a modal action.

### Contextual Drawer (Long-Press on Tabs)

Long-pressing any tab reveals a drawer with contextual sub-destinations:

| Tab Long-Press | Drawer Contents |
|---------------|-----------------|
| Today | Scouts roster |
| Inbox | — |
| Upcoming | Lists picker (all user lists with item counts) |
| Calendar | Calendar settings |
| Any tab | Settings (gear icon in drawer) |

The drawer slides up as a half-sheet with a grab handle. Tap a destination to navigate, swipe down to dismiss.

### Navigation Model

- **Tab switching:** Instant, no animation between tabs
- **Drill-in:** Standard iOS push (slide from right). Used for: task detail, list detail, scout detail, content detail, settings
- **Back:** Breadcrumb link at top-left + swipe-from-left-edge (iOS standard)
- **Modals:** Used sparingly — voice mode, expanded capture form, date picker

---

## Screens

### 1. Today

The home screen. Vertical scroll layout:

#### 1a. Header
```
Tuesday, Apr 8 · 5 of 12 done · 3 meetings (2h 15m)
```

- Large date (22px, weight 700)
- Stats line below (12px, white/35): task progress + meeting count with total duration
- Stats update live as tasks complete and meetings pass

#### 1b. Daily Briefing

Brett's AI-generated summary of your day. Sits directly below the header.

- Cerulean-tinted card (`rgba(70,130,195,0.06)` background, `rgba(70,130,195,0.12)` border)
- "Daily Briefing" label in cerulean uppercase
- Briefing text in white/55, 12-13px
- **Collapsible:** Tap to collapse to a single line ("Daily Briefing ▸"). State persisted to SQLite — if you collapse it, it stays collapsed until you expand it.
- **Dismissible:** Swipe right to dismiss for the day. Returns next morning.

#### 1c. Next Up Card

Single compact card showing the next calendar event. Mirrors desktop's NextUpCard behavior:

- Gold-tinted border when event is >10 minutes away
- Becomes more prominent (larger, amber background) when ≤10 minutes away
- Shows: time until event, title, location/meeting link, duration
- Tap to push to event detail

#### 1d. Task Sections

Grouped by urgency (mirrors desktop exactly):

1. **Overdue** (if any) — red-tinted section header, red left border on task rows
2. **Today** — default section
3. **This Week** — tasks due before end of week
4. **Done Today** — completed tasks, faded (opacity 35%)

Each section has an uppercase section header (10px, 1.5px tracking).

Desktop's 600ms batch freeze for rapid checkbox clicks is replicated: task rows stay in place during rapid completion, list reflows after 1.5 seconds of tap inactivity.

#### 1e. Omnibar

Pinned above the tab bar. Always visible, always one tap away.

- Compact single-line input: "Add a task..." placeholder
- Small gold dot on the right edge (brand touch)
- Tap to focus → keyboard rises, omnibar stays pinned above keyboard
- Type and hit return → task created (default: due today)
- Smart parsing: "buy milk tomorrow at 5pm" → task with due date + reminder
- Expand affordance (▾ chevron) → full capture form slides up as a sheet (list picker, date, priority, notes)
- Brett AI routing: questions ("what's my day look like?") route to Brett chat

On Inbox, the omnibar says "Capture something..." and creates undated tasks (true inbox capture).

### 2. Inbox

Same list component and gesture model as Today. Different query: unsorted tasks + newsletters + captured content.

- Header: "Inbox" with item count
- Flat list (no urgency grouping — items are unsorted by definition)
- Newsletters and content items have a cerulean left border accent and content-type indicator
- Omnibar creates undated tasks

### 3. Upcoming

Future tasks grouped by date sections.

- Section headers are date-based: "Tomorrow," "Wednesday, Apr 10," "Thursday, Apr 11," etc.
- Same task row component, same gestures
- Omnibar present, creates task with the nearest visible date section as the default due date

### 4. Calendar

Week strip + day timeline (Fantastical-inspired).

#### 4a. Week Strip
- Horizontal scrollable week at top
- Day circles: current day highlighted with gold fill
- Dots below days with events
- Tap a day to scroll the timeline to that day
- Swipe week strip to navigate between weeks

#### 4b. Day Timeline
- Vertical timeline with time slots (hourly)
- Events rendered as blocks with colored left border (gold default, teal for secondary calendar, etc.)
- Event blocks show: title, location/meeting link, duration
- Tap event → push to event detail
- Empty slots are tappable for quick event creation (future enhancement)

### 5. Task Detail (Full-Screen Push)

Accessed by tapping a task row (not the checkbox). Standard iOS push navigation.

Layout (vertical scroll):

1. **Back breadcrumb** — "‹ Today" / "‹ Inbox" / "‹ List Name" in gold
2. **Title + checkbox** — Large title (20px, weight 600) with completion checkbox
3. **Details card** — Grouped inset style:
   - Due date
   - List assignment (gold-colored list name)
   - Reminder
   - Recurrence
   - Each row is tappable to edit
4. **Notes card** — Free-form text, tappable to edit
5. **Subtasks card** — Checklist with gold checkboxes, add subtask input at bottom
6. **Attachments card** — File previews, add attachment button
7. **Brett chat** — Cerulean-tinted card at bottom: "Ask Brett about this task..." Tap to expand inline chat about this specific task.

### 6. List Detail

Accessed from contextual drawer (long-press Upcoming tab → lists picker → tap a list).

- Header: list name + item count
- Same task list component, same gestures
- Same task rows, filtered to this list

### 7. Scouts Roster

Accessed from contextual drawer (long-press Today tab).

- Grid or list of active scouts with status indicators
- Each scout card shows: name, goal summary, last finding timestamp, status (active/paused/error)
- Tap → push to scout detail

### 8. Scout Detail (Full-Screen Push)

- Goal description
- Sources list
- Findings list (insight/article/task types with relevance scores)
- Memory entries
- Per-field editing for scout configuration

### 9. Content Detail

Newsletter/article/saved content viewer. Full-screen push.

- Clean reading view
- Content type header (newsletter, article, video, etc.)
- Source/author metadata
- Body content
- "Save as task" action

### 10. Brett Chat

Accessible from:
- Task detail ("Ask Brett about this task...")
- Calendar event detail ("Ask Brett about this meeting...")
- Standalone (future — possibly from voice mode or a dedicated entry point)

Chat UI:
- Message bubbles: user messages right-aligned, Brett messages left-aligned with cerulean accent
- Brett messages use cerulean tint (`rgba(70,130,195,0.06)`)
- Text input at bottom
- Context-aware: when opened from a task/event, Brett has that context

### 11. Settings

iOS grouped-inset list style (UITableView.Style.insetGrouped equivalent).

All desktop settings present, adapted to iOS form patterns:
- Profile
- Security (password, connected accounts)
- Calendar (Google Calendar connection)
- AI Providers
- Newsletters
- Timezone & Location
- Import
- Updates
- Account

Deep-linking: any UI element that sends to Settings deep-links to the correct section.

### 12. Sign In

- Email/password form
- "Sign in with Google" button
- "Sign in with Apple" button (required for App Store)
- Loading states, error handling (already partially built)

---

## Gesture & Interaction Model

All gestures are consistent across every list view (Today, Inbox, Upcoming, List Detail). No per-screen gesture variations.

| Gesture | Action | Visual Feedback |
|---------|--------|----------------|
| **Tap checkbox** | Complete/uncomplete task | Gold fill floods checkbox, success haptic. Task stays in place. List reflows after 1.5s inactivity. |
| **Tap task row** | Push to task detail | Standard iOS push transition |
| **Swipe right** | Date picker | Gold accent reveal behind row. Inline date picker appears. |
| **Swipe left** | Select (multiselect mode) | Cerulean/blue accent reveal. Task is selected, selection circles appear on all rows, bottom toolbar slides up with actions: Schedule, Move to List, Delete. Tap additional rows to add/remove from selection. |
| **Long press** | Drag to reorder | Rigid haptic on lift. Row lifts with shadow. Other items part to make room. Drop with settling animation. |
| **Pull to refresh** | Manual sync trigger | Standard iOS refresh control |
| **Swipe from left edge** | Navigate back | Standard iOS back gesture |

### Multiselect Flow (Swipe Left)

1. Swipe left on a task → that task is selected
2. Selection circles appear on all rows in the list
3. Bottom toolbar slides up with action buttons: **Schedule**, **Move to List**, **Delete**
4. Tap more rows to add/remove from selection
5. Tap a toolbar action → applies to all selected tasks
6. Selection mode exits, toolbar slides away
7. List reflows if items moved/deleted

### Task Completion — Batch Behavior

When rapidly tapping multiple checkboxes:
- Each checkbox animates independently (gold fill + haptic)
- Task rows do NOT reflow during rapid tapping
- After 1.5 seconds of inactivity, the list settles:
  - Completed items fade/slide into the "Done Today" section
  - List collapses in one smooth coordinated animation
- Shake-to-undo (iOS native) recovers accidental completions

---

## Capture Flow

### Text Capture (Omnibar)

The omnibar is the primary capture surface. Pinned above the tab bar on Today and Inbox.

**Default path (sub-2-second capture):**
1. Tap omnibar → keyboard rises, cursor active
2. Type task title (smart parsing active)
3. Hit return → task created → light haptic → brief gold flash confirmation
4. Omnibar clears, ready for next capture

**Smart parsing examples:**
| Input | Result |
|-------|--------|
| "buy milk" | Task, no date (Inbox) or today (Today) |
| "buy milk tomorrow" | Task, due tomorrow |
| "buy milk tomorrow at 5pm" | Task, due tomorrow, reminder at 5pm |
| "buy milk #personal" | Task, assigned to Personal list |
| "what's my day look like?" | Routes to Brett AI chat |

**Expanded capture (optional):**
- Tap ▾ chevron on omnibar → half-sheet slides up
- Full form: title, list picker, date picker, priority, notes
- Submit or swipe down to dismiss

### Voice Capture (Center Button)

1. Tap center voice button → heavy haptic
2. Gold pulse animation radiates from button
3. Listening state — gold waveform visualization
4. Speak naturally → transcription appears live
5. On silence detection → smart parsing pipeline → task created
6. Confirmation haptic + visual confirmation

---

## Visual Language

### Typography

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Page header (date) | 22px | 700 (Bold) | white/100 |
| Section title | 18px | 600 (SemiBold) | white/90 |
| Section label | 10px uppercase, 1.5-2px tracking | 600 | white/25 or gold/50 |
| Task title | 14-15px | 500 (Medium) | white/85 |
| Body text | 14px | 400 (Regular) | white/70 |
| Metadata / secondary | 11-12px | 400 | white/35-40 |
| Tab labels | 9-10px | 500 | white/35 (inactive), gold (active) |

**Font: SF Pro (system).** Not Switzer. SF Pro is optimized for small screens, dynamic type accessibility, and iOS rendering. The brand identity comes through color, not custom typography.

### Color System

| Role | Value | Usage |
|------|-------|-------|
| Base background | Dynamic (living background system) | Full-bleed atmospheric photo/gradient |
| Card surface | `rgba(0,0,0,0.3)` + `backdrop-filter: blur(20px)` | Glass cards over dynamic background |
| Elevated surface | `rgba(0,0,0,0.4)` + `backdrop-filter: blur(16px)` | Sheets, modals, toolbar |
| Brand accent | `#E8B931` (Gold) | Active tab, checkboxes, completion, capture confirmation, date/schedule actions |
| AI accent | `#4682C3` (Cerulean) | Brett surfaces, briefing card, chat bubbles, select/multiselect actions |
| Success | `#48BBA0` (Teal) | Sync success, completion pulse |
| Error / Overdue | `#E6554B` (Red) | Overdue indicators, error states, delete actions |
| Text primary | `rgba(255,255,255,0.85)` | Headings, task titles |
| Text secondary | `rgba(255,255,255,0.40)` | Metadata, timestamps |
| Text tertiary | `rgba(255,255,255,0.25)` | Placeholders, section labels |
| Text ghost | `rgba(255,255,255,0.15)` | Disabled states |

**Rule:** No gray color values ever. Always white with opacity. This ensures consistency over any dynamic background.

### Dynamic Background

The living background system from desktop, adapted for mobile:

- Same image manifest: 6 time segments × 3 busyness tiers = 18 categories
- Same busyness formula: `score = (meetingCount × 2) + taskCount`
- Same time segments: Dawn, Morning, Afternoon, Golden Hour, Evening, Night
- Same crossfade transitions: instant on launch, ~10-minute rotation within category
- Photography set (default) and Abstract set (user preference)

**Mobile adaptations:**
- Images served at appropriate resolution for phone screens (1170×2532 for iPhone Pro, scaled down for older devices)
- Glass cards use `expo-blur` (`UIVisualEffectView`) for native iOS blur performance — not CSS backdrop-filter
- Vignette overlay: top-to-bottom gradient for status bar readability + bottom gradient for tab bar readability

### Surface Treatment

All content cards sit on glass surfaces over the dynamic background:

```
┌─ Dynamic background image (full bleed) ─────────────┐
│  ┌─ Vignette overlay (top + bottom gradients) ────┐  │
│  │  ┌─ Glass card (blur + semi-transparent) ────┐  │  │
│  │  │  Content                                   │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

- Primary cards: `bg-black/30 backdrop-blur-xl` (20px blur)
- Task rows: `bg-black/20 backdrop-blur-lg` (lighter, more background shows through)
- Elevated surfaces (sheets, toolbar): `bg-black/40 backdrop-blur-md`
- Tab bar: `bg-black/50 backdrop-blur-xl` (heavier, ensures icon legibility)

### Border Radius

| Element | Radius |
|---------|--------|
| Cards, sections | 12-14px |
| Task rows | 11px |
| Checkboxes, avatars | 50% (circle) |
| Buttons, chips | 8px |
| Tab bar (if custom) | 0 (edge-to-edge) |
| Omnibar | 12px |

### Touch Targets

Minimum 44pt × 44pt for all interactive elements (Apple HIG). Checkboxes have a 44pt tap area even though the visual circle is 18-20px.

---

## Haptic Feedback Map

| Action | Haptic Type | Rationale |
|--------|-------------|-----------|
| Task completion | `UINotificationFeedbackGenerator.success` | Satisfying double-tap. The reward. |
| Checkbox tap | `UIImpactFeedbackGenerator.light` | Crisp acknowledgment |
| Swipe threshold reached | `UIImpactFeedbackGenerator.medium` | "This will trigger now" — the commitment point |
| Drag-to-reorder lift | `UIImpactFeedbackGenerator.rigid` | Physical pickup sensation |
| Quick capture submit | `UIImpactFeedbackGenerator.light` | Brief confirmation, not celebratory |
| Voice mode activate | `UIImpactFeedbackGenerator.heavy` | Weighty, intentional — center button should feel important |
| Multiselect enter | `UIImpactFeedbackGenerator.light` | Mode change acknowledgment |
| Toolbar action apply | `UINotificationFeedbackGenerator.success` | Batch action confirmation |
| Error / failure | `UINotificationFeedbackGenerator.error` | Three rapid taps — something went wrong |
| Pull-to-refresh trigger | `UIImpactFeedbackGenerator.medium` | Standard iOS feel |

---

## Animation Principles

### General Rules

- Every animation communicates state — no animation is decorative
- Spring physics (React Native Reanimated) for all interactive animations
- Duration: 200-350ms for micro-interactions, 400-600ms for transitions, 2-3s for ambient (crossfade)
- Easing: spring-based for gestures, ease-out for reveals, linear for progress

### Specific Animations

| Animation | Specification |
|-----------|--------------|
| **Task completion** | Checkbox: gold fill radiates from center (150ms spring). Row: stays in place, fades slightly. After 1.5s idle: row slides left + fades (300ms ease-out), list settles (400ms spring). |
| **Capture submit** | Omnibar text slides up and fades (200ms). Brief gold flash on omnibar border (150ms). New task appears at appropriate position in list with slide-in from right (250ms spring). |
| **Voice mode activate** | Center button scales up 1.1x (100ms spring). Gold pulse ring radiates outward (400ms, fades). Listening waveform begins. |
| **Swipe actions** | Row translates with finger (spring-damped). Action reveal follows with slight delay. Snap-back on cancel (300ms spring). |
| **Drag to reorder** | Lifted row scales 1.03x with shadow. Other rows part with spring animation (250ms). Drop: row settles to new position (350ms spring with slight bounce). |
| **Section appear** | New sections (e.g., "Done Today" appearing) slide in from bottom with fade (450ms ease-out, 80ms delay — matches desktop). |
| **Tab switching** | Instant crossfade of content (no slide). Active tab icon transitions color (150ms). |
| **Push navigation** | Standard iOS push: new screen slides from right (350ms spring). |
| **Background crossfade** | 3-second dissolve between background images. |
| **Briefing collapse** | Height animation with content fade (250ms ease-out). |
| **Next Up urgency transition** | Card border color shifts gold → amber, subtle scale pulse (gentle, 600ms). |

---

## iOS Integrations (v1)

### Widgets (WidgetKit)

**Lock Screen Widget (Rectangular):**
- Next task title + due time
- Event count for today
- Tap → opens Brett to Today

**Home Screen Widget (Small):**
- Today progress: "5 of 12" with circular progress indicator in gold
- Next event: time + title (truncated)
- Tap → opens Brett to Today

**Home Screen Widget (Medium):**
- Today progress + next 3 tasks
- Next event
- Tap task → opens that task's detail

**Implementation:** Swift WidgetKit extension + Expo module bridge for data access. Widget reads from shared App Group SQLite database (separate from main app DB — sync engine writes widget-relevant data to shared container on each sync cycle).

### SiriKit (Lists & Notes Domain)

Natural language task management:

| Intent | Example Phrases |
|--------|----------------|
| `INAddTasksIntent` | "Add buy milk to Brett", "Remind me in Brett to call the dentist" |
| `INSearchForNotebookItemsIntent` | "Show my tasks in Brett", "What's on my list in Brett" |
| `INSetTaskAttributeIntent` | "Mark buy milk as done in Brett" |
| `INCreateTaskListIntent` | "Create a Shopping list in Brett" |

**Implementation:** Swift Intents Extension target. Reads/writes to shared App Group SQLite database. Mutations enqueued to the same `_mutation_queue` — sync engine picks them up on next cycle.

### Custom App Intent (Shortcuts)

| Intent | Trigger | Response |
|--------|---------|----------|
| "Brett daily briefing" | "Hey Siri, Brett daily briefing" | Reads cached daily briefing aloud via Siri speech synthesis. If no cached briefing, says "No briefing available yet — open Brett to generate one." |

**Implementation:** Swift App Intents framework. Reads cached briefing from shared App Group storage.

### Share Sheet Extension

Share URL/article/text from any app → captured as content in Brett's Inbox.

- Share extension presents a compact form: title (pre-filled from shared content), optional note
- Saves to shared App Group SQLite → mutation queue → syncs on next cycle
- Light haptic confirmation

### Spotlight Search

Brett tasks indexed in Spotlight via `CSSearchableIndex`:

- Task titles and descriptions are searchable
- Results show task title, due date, list name
- Tap result → opens Brett to that task's detail
- Index updated on each sync cycle

### Notifications

| Notification Type | Trigger |
|-------------------|---------|
| Task reminder | At the reminder time set on a task |
| Event alert | Pre-event (configurable: 5/10/15/30 min) |
| Daily briefing ready | Morning (configurable time), when briefing is generated |
| Overdue nudge | Configurable — nudge about overdue tasks |

Actionable notifications where possible:
- Task reminder: "Complete" and "Snooze" actions
- Event alert: "Open" action

### Sign in with Apple

Required for App Store (since Google OAuth is offered). Implemented via `expo-apple-authentication`:

- ASAuthorizationAppleIDButton (native Apple button)
- Returns: user identifier, email (possibly private relay), full name (first sign-in only)
- Server: new Apple OAuth provider in better-auth configuration
- Token stored in Keychain via existing token storage

---

## Design Process

### Phase 1: Visual Iteration (This Spec)
Lock screen layouts, navigation model, visual language, gesture definitions, haptic map via browser mockups and terminal discussion. **Complete.**

### Phase 2: Key Prototype
Build 3 hero interactions in React Native on Simulator/device:

1. **Capture flow** — omnibar focus, type, submit, confirmation animation + haptic
2. **Task completion** — checkbox tap, gold fill, batch completion with delayed reflow
3. **Navigation** — tab switching, push/back transitions, contextual drawer

Tune spring physics, haptic timing, and animation curves on device until they feel right.

### Phase 3: Full Implementation
Lock the design, write implementation plan, build everything.

---

## Relationship to Existing Specs

This spec defines the **UX and interaction layer**. It sits on top of:

- **`2026-04-07-ios-app-system-design.md`** — Data layer, sync engine, offline architecture, native extension structure
- **`2026-04-01-living-background-design.md`** — Dynamic background system (adapted for mobile in this spec)
- **`docs/DESIGN_GUIDE.md`** — Brand identity, color system, typography (desktop-focused but brand reference)

Implementation should reference all four documents.
