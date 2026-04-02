# Visual Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the visual identity uplift across the entire Brett desktop app — colors, typography, animations, and logo.

**Architecture:** Systematic migration of ~180 blue class instances to gold/cerulean, font stack swap to Switzer, framer-motion adoption for complex animations, and logo replacement. Changes are mostly in `packages/ui/src/` (shared components) and `apps/desktop/src/` (app-specific pages/settings).

**Tech Stack:** Tailwind CSS, Switzer font (bundled), framer-motion, Lucide icons, Electron (tray icons)

---

## Important Context

### Color Decision Map

Not every `blue-*` class becomes the same color. The rule is:

| Current | Context | New Color | Tailwind |
|---------|---------|-----------|----------|
| `blue-400/500` | Brett AI surfaces (chat, omnibar AI, Brett's Take, Daily Briefing) | Deep Cerulean `#4682C3` | Use arbitrary `[#4682C3]` |
| `blue-400/500` | Primary actions, focus rings, active states, links, nav highlights | Electric Gold `#E8B931` | Use arbitrary `[#E8B931]` |
| `blue-400/500` | Calendar event accents | Keep blue — calendar events use a multi-color system | No change |
| `blue-300` | Brett AI text (lighter variant) | Cerulean at reduced opacity | `text-[#4682C3]/85` |
| `blue-600` | Hover on Brett actions | Darker cerulean or gold | Context-dependent |
| `green-400/500` | Completion/success states | Teal `#48BBA0` | Use arbitrary `[#48BBA0]` |
| `green-300` | Lighter success text | Teal at reduced opacity | `text-[#48BBA0]/80` |

### Files to NEVER Change Blue In

These files use blue as calendar/event accent colors (part of the rich supporting cast):
- `CalendarTimeline.tsx` — event card colors (blue is one of several calendar accent colors)
- `CalendarPage.tsx` — calendar event mock data colors
- `EventHoverTooltip.tsx` — event color gradient
- `avatarColor.ts` — blue is one of 8 avatar hash colors (keep it)

### Tailwind Custom Colors

Rather than using arbitrary values everywhere, we'll extend the Tailwind config with named colors:

```js
// In tailwind.config.js extend.colors:
brett: {
  gold: '#E8B931',
  'gold-dark': '#D4A62B',
  cerulean: '#4682C3',
  teal: '#48BBA0',
  red: '#E6554B',
  bg: '#0C0F15',
}
```

This lets us write `text-brett-gold` instead of `text-[#E8B931]` everywhere.

---

## Task 1: Tailwind Config — Add Custom Colors + Switzer Font

**Files:**
- Modify: `apps/desktop/tailwind.config.js`
- Modify: `apps/desktop/src/index.css`
- Create: `apps/desktop/src/fonts/` (directory for Switzer font files)

- [ ] **Step 1: Install Switzer font files**

Download Switzer from fontsource and add to the project:

```bash
cd apps/desktop
pnpm add @fontsource-variable/switzer
```

- [ ] **Step 2: Import Switzer in index.css**

Add at the top of `apps/desktop/src/index.css`, before the Tailwind imports:

```css
@import "@fontsource-variable/switzer";
@import "@fontsource-variable/switzer/wght-italic.css";
```

- [ ] **Step 3: Update Tailwind config with brand colors and font**

In `apps/desktop/tailwind.config.js`, add to the `extend` object:

```js
colors: {
  // ...existing colors...
  brett: {
    gold: '#E8B931',
    'gold-dark': '#D4A62B',
    cerulean: '#4682C3',
    teal: '#48BBA0',
    red: '#E6554B',
    bg: '#0C0F15',
  },
},
fontFamily: {
  sans: ['"Switzer Variable"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
},
```

- [ ] **Step 4: Verify font loads**

```bash
pnpm dev:desktop
```

Open the app — all text should now render in Switzer. Verify in DevTools: computed font-family should show "Switzer Variable".

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/tailwind.config.js apps/desktop/src/index.css apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(ui): add Switzer font and brett brand colors to Tailwind config"
```

---

## Task 2: LeftNav Logo — Replace Blue "B" with Product Mark

**Files:**
- Modify: `packages/ui/src/LeftNav.tsx`

- [ ] **Step 1: Read current LeftNav logo code**

Read `packages/ui/src/LeftNav.tsx` and find the logo section (around lines 104-113).

- [ ] **Step 2: Replace logo with product mark SVG**

Replace the blue "B" square with the gold stacked brief mark. The SVG should be inline for easy color control. Also replace the hardcoded "Brett" text with the dynamic name prop if available, or keep it as the product name for now.

Current (approximately):
```tsx
<div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
  <span className="text-white font-bold text-xs">B</span>
</div>
```

New:
```tsx
<div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
  <svg width="24" height="24" viewBox="0 0 48 48" className="drop-shadow-[0_0_8px_rgba(232,185,49,0.4)]">
    <circle cx="11" cy="14" r="3" fill="#E8B931"/>
    <line x1="19" y1="14" x2="40" y2="14" stroke="#E8B931" strokeWidth="2.5" strokeLinecap="round"/>
    <circle cx="11" cy="24" r="3" fill="#E8B931" opacity="0.6"/>
    <line x1="19" y1="24" x2="34" y2="24" stroke="#E8B931" strokeWidth="2.5" strokeLinecap="round" opacity="0.6"/>
    <circle cx="11" cy="34" r="3" fill="#E8B931" opacity="0.3"/>
    <line x1="19" y1="34" x2="28" y2="34" stroke="#E8B931" strokeWidth="2.5" strokeLinecap="round" opacity="0.3"/>
  </svg>
</div>
```

- [ ] **Step 3: Update LeftNav nav highlight colors**

Search for `bg-blue-500` and `before:bg-blue-500` in LeftNav.tsx and replace with `bg-brett-gold` / `before:bg-brett-gold`.

- [ ] **Step 4: Verify in browser**

Open the app, check: logo renders as gold stacked brief, nav highlights are gold, collapsed state shows mark only.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/LeftNav.tsx
git commit -m "feat(ui): replace blue B logo with gold stacked brief product mark"
```

---

## Task 3: Brett AI Surfaces — Cerulean Migration

**Files:**
- Modify: `packages/ui/src/Omnibar.tsx`
- Modify: `packages/ui/src/SpotlightModal.tsx`
- Modify: `packages/ui/src/BrettThread.tsx`
- Modify: `packages/ui/src/DailyBriefing.tsx`
- Modify: `packages/ui/src/CalendarEventDetailPanel.tsx`

These are Brett's AI surfaces — the most important consistency work. All blue references become cerulean.

- [ ] **Step 1: Migrate Omnibar.tsx**

Read the file. Replace all Brett-AI-related blue classes:
- `text-blue-400` → `text-brett-cerulean` (for Brett icons, labels)
- `bg-blue-500/5` → `bg-brett-cerulean/5` (Brett container backgrounds)
- `border-blue-500/10` → `border-brett-cerulean/10` (Brett container borders)
- `border-blue-500/50` → `border-brett-cerulean/50` (focused state with Brett)
- `rgba(59,130,246,0.15)` → `rgba(70,130,195,0.15)` (shadow)
- `bg-blue-500 hover:bg-blue-600` (send button) → `bg-brett-gold hover:bg-brett-gold-dark`
- `bg-blue-400` / `bg-green-400` (status indicators) → `bg-brett-cerulean` / `bg-brett-teal`

- [ ] **Step 2: Migrate SpotlightModal.tsx**

Same pattern as Omnibar — these share the same hook. Replace:
- All `text-blue-400` → `text-brett-cerulean`
- `bg-blue-500/5`, `border-blue-500/10` → cerulean equivalents
- Send button `bg-blue-500 hover:bg-blue-600` → `bg-brett-gold hover:bg-brett-gold-dark`
- Streaming indicator `text-blue-400 animate-pulse` → `text-brett-cerulean animate-pulse`

- [ ] **Step 3: Migrate BrettThread.tsx**

Replace:
- `text-blue-400` → `text-brett-cerulean` (bot icon, loader)
- `text-blue-400/60` → `text-brett-cerulean/60` (dimmed states)
- Send button `bg-blue-500 hover:bg-blue-600` → `bg-brett-gold hover:bg-brett-gold-dark`

- [ ] **Step 4: Migrate DailyBriefing.tsx**

Replace:
- `border-blue-500/30` → `border-brett-cerulean/30` (container border)
- `text-blue-400` → `text-brett-cerulean` (bot icon)
- `text-blue-400/70` → `text-brett-cerulean/70` (label)
- `text-blue-400/60` → `text-brett-cerulean/60` (loader)
- `text-blue-500/50` → `text-brett-cerulean/50` (bullet)

- [ ] **Step 5: Migrate CalendarEventDetailPanel.tsx Brett's Take section**

Find the Brett's Take section (around lines 315-322). Replace:
- `bg-blue-500/10` → `bg-brett-cerulean/10`
- `border-blue-500` → `border-brett-cerulean`
- `bg-blue-500` (indicator dot) → `bg-brett-cerulean`
- `text-blue-400` → `text-brett-cerulean`
- `text-blue-300/90` → `text-brett-cerulean/85`
- `font-mono` in section label → remove, use `text-[10px] uppercase tracking-[0.15em] font-semibold`

**Note:** This file also has RSVP buttons and other non-Brett blue that may need gold treatment. Handle those in Task 4.

- [ ] **Step 6: Verify all Brett surfaces in browser**

Open the app. Check:
- Omnibar shows cerulean AI indicator, gold send button
- ⌘K Spotlight matches Omnibar exactly
- Brett Chat in detail panels uses cerulean
- Daily Briefing uses cerulean
- Brett's Take callout uses cerulean with left border

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/Omnibar.tsx packages/ui/src/SpotlightModal.tsx packages/ui/src/BrettThread.tsx packages/ui/src/DailyBriefing.tsx packages/ui/src/CalendarEventDetailPanel.tsx
git commit -m "feat(ui): migrate Brett AI surfaces from blue to cerulean #4682C3"
```

---

## Task 4: Primary Action Colors — Gold Migration (UI Package)

**Files:**
- Modify: All remaining `packages/ui/src/*.tsx` files with blue classes that are NOT Brett AI and NOT calendar accents

This is the bulk color migration. Every blue class used for primary actions, focus rings, active states, links, and nav highlights becomes gold.

- [ ] **Step 1: Systematic search and replace in packages/ui/src/**

For each file, read it, identify which blue usages are "primary action" (not Brett AI, not calendar accent), and replace:
- `text-blue-400` → `text-brett-gold` (links, active states)
- `bg-blue-500` → `bg-brett-gold` (buttons, active pills)
- `hover:bg-blue-600` → `hover:bg-brett-gold-dark`
- `border-blue-500/20` → `border-brett-gold/20` (focus states)
- `focus:border-blue-500/20` → `focus:border-brett-gold/20`
- `border-blue-500/30` → `border-brett-gold/30` (focused list items)

Files to process (non-Brett, non-calendar):
- `ThingCard.tsx` — focus/selected border
- `InboxItemRow.tsx` — blue accent (but NOT the green completion — that's Task 5)
- `InboxView.tsx` — "Not Configured" callout, labels
- `QuickAddInput.tsx` — focus border
- `LinkedItemsList.tsx` — link color, focus border
- `ContentDetailPanel.tsx` — link color, "Brett's Take" section
- `ContentPreview.tsx` — link colors
- `TaskDetailPanel.tsx` — status badge, link colors
- `RichTextEditor.tsx` — link color
- `ScheduleRow.tsx` — time accent
- `ScoutDetail.tsx` — primary buttons, accent borders, gradients
- `ScoutCard.tsx` — accent border, shadow, badge
- `ScoutsRoster.tsx` — blue classes
- `TriagePopup.tsx` — accent colors
- `WeatherExpanded.tsx` — accent colors
- `ThingsEmptyState.tsx` — accent colors, buttons
- `SimpleMarkdown.tsx` — link colors
- `AttachmentList.tsx` — link color
- `FilterPills.tsx` — if blue is used for active state
- `UpNextCard.tsx` — time accent
- `NextUpCard.tsx` — time accent, badge

- [ ] **Step 2: Verify no orphaned blue classes remain**

```bash
cd packages/ui/src
grep -rn "blue-[345]00" --include="*.tsx" --include="*.ts" | grep -v "Calendar" | grep -v "Event" | grep -v "avatar"
```

The only remaining blue should be in calendar components and avatarColor.ts.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/
git commit -m "feat(ui): migrate primary action colors from blue to gold #E8B931"
```

---

## Task 5: Success/Completion Colors — Green to Teal

**Files:**
- Modify: Files with `green-400`, `green-500` used for completion/success states

- [ ] **Step 1: Replace green completion colors**

In each file, replace:
- `bg-green-500/20` → `bg-brett-teal/20`
- `border-green-500/40` → `border-brett-teal/40`
- `text-green-400` → `text-brett-teal`
- `bg-green-400` → `bg-brett-teal`
- `border-green-400/40` → `border-brett-teal/40`
- `bg-green-500/10` → `bg-brett-teal/10`
- `text-green-300` → `text-brett-teal/80`
- `bg-green-500` → `bg-brett-teal`

Files: `ThingCard.tsx`, `InboxItemRow.tsx`, `Omnibar.tsx`, `SpotlightModal.tsx`, `TaskDetailPanel.tsx`, `ContentDetailPanel.tsx`, `ThingsEmptyState.tsx`, `SkillResultCard.tsx`, `EventHoverTooltip.tsx`, `WeatherExpanded.tsx`

Also in `apps/desktop/src/settings/`: `AISection.tsx`, `ProfileSection.tsx`, `MemorySection.tsx`

- [ ] **Step 2: Update togglePulse animation color**

In `packages/ui/src/animations.css`, find the `togglePulse` keyframe and replace the green box-shadow color with gold (completion pulse is gold per design guide):

```css
/* From: box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.4) */
/* To:   box-shadow: 0 0 0 4px rgba(232, 185, 49, 0.4) */
```

- [ ] **Step 3: Verify completion animations in browser**

Toggle a task complete — the pulse should be gold, the checkmark should use teal.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ apps/desktop/src/
git commit -m "feat(ui): migrate completion colors from green to teal, gold pulse"
```

---

## Task 6: Desktop App Pages — Color Migration

**Files:**
- Modify: `apps/desktop/src/auth/AuthGuard.tsx`
- Modify: `apps/desktop/src/auth/LoginPage.tsx`
- Modify: `apps/desktop/src/views/NotFoundView.tsx`
- Modify: `apps/desktop/src/settings/*.tsx` (all settings sections)
- Modify: `apps/desktop/src/pages/CalendarPage.tsx` (only non-calendar-accent blues)

- [ ] **Step 1: Migrate auth pages**

`AuthGuard.tsx`: Replace `bg-blue-500` loading state with `bg-brett-gold`, update shadow RGB.
`LoginPage.tsx`: Replace all `focus:border-blue-500`, `text-blue-400` link colors with gold equivalents.

- [ ] **Step 2: Migrate settings pages**

For each settings file, replace:
- Toggle switches: `bg-blue-500` → `bg-brett-gold`
- Focus borders: `focus:border-blue-500/20` → `focus:border-brett-gold/20`
- Links: `text-blue-400` → `text-brett-gold`
- Active states: `bg-blue-500` → `bg-brett-gold`
- Green success indicators → `text-brett-teal` / `bg-brett-teal`

Files: `AISection.tsx`, `CalendarSection.tsx`, `SecuritySection.tsx`, `BackgroundSection.tsx`, `LocationSection.tsx`, `TimezoneSection.tsx`, `BriefingSection.tsx`, `ProfileSection.tsx`, `SettingsLayout.tsx`, `CalendarHeader.tsx`, `MemorySection.tsx`

- [ ] **Step 3: Migrate NotFoundView**

Replace `bg-blue-500/20 text-blue-400` with `bg-brett-gold/20 text-brett-gold`.

- [ ] **Step 4: Verify in browser**

Check: login page, settings pages, 404 page all use gold accents consistently.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(ui): migrate desktop app pages to gold/cerulean/teal color system"
```

---

## Task 7: Typography — Remove font-mono from UI Labels

**Files:**
- Modify: ~25 files in `packages/ui/src/` and `apps/desktop/src/`
- Modify: `packages/ui/src/SectionHeader.tsx`

- [ ] **Step 1: Update SectionHeader component**

This is the canonical section header. Change from:
```tsx
className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold"
```
To:
```tsx
className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40"
```

- [ ] **Step 2: Find and replace all inline font-mono section headers**

Search all `.tsx` files for `font-mono` combined with `uppercase` and `tracking-`. These are section headers that should match the SectionHeader pattern. Replace each with `text-[10px] uppercase tracking-[0.15em] font-semibold`.

DO NOT remove `font-mono` from:
- `SimpleMarkdown.tsx` code blocks (line ~156)
- `SkillResultCard.tsx` code line numbers
- Any actual code display context

- [ ] **Step 3: Remove font-mono from non-header UI elements**

Some `font-mono` usages are on keyboard shortcuts, timestamps, or config displays. Replace these with just removing `font-mono` (let the default Switzer handle it).

Files: `Omnibar.tsx` (keyboard hints), `SpotlightModal.tsx` (keyboard hints), `LeftNav.tsx` (shortcuts), `TriagePopup.tsx` (time labels), `LoginPage.tsx` (form labels)

- [ ] **Step 4: Verify in browser**

Check: section headers throughout the app use Switzer uppercase tracked, not monospace. Code blocks still render in monospace.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ apps/desktop/src/
git commit -m "feat(ui): replace font-mono section labels with Switzer uppercase tracked"
```

---

## Task 8: Install framer-motion

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Install framer-motion**

```bash
cd packages/ui
pnpm add framer-motion
```

- [ ] **Step 2: Verify it resolves**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/package.json pnpm-lock.yaml
git commit -m "deps: add framer-motion to @brett/ui"
```

---

## Task 9: Typecheck + Visual QA Pass

This is a verification task — no new code, just ensuring everything works together.

- [ ] **Step 1: Run full typecheck**

```bash
pnpm typecheck
```

Fix any TypeScript errors from the color/class changes.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Fix any lint errors.

- [ ] **Step 3: Visual QA in browser**

Open the app and walk through every major view:
1. Login page — gold accents, gold focus rings
2. Today view — gold section headers, gold task checkboxes
3. Inbox — gold accents, teal completion
4. Calendar — calendar colors preserved, Brett's Take in cerulean
5. Detail panels (task, content, calendar event) — cerulean Brett Chat, gold actions
6. Omnibar — cerulean AI indicator, gold send button
7. ⌘K Spotlight — matches Omnibar exactly
8. Settings — gold toggles, gold focus rings
9. Daily Briefing — cerulean Brett branding
10. LeftNav — gold product mark logo, gold nav highlights
11. Empty states — gold accents

- [ ] **Step 4: Fix any visual inconsistencies found**

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(ui): visual QA fixes for identity uplift"
```

---

## Task Dependency Graph

```
Task 1 (Tailwind config + font) ─┬─→ Task 2 (Logo)
                                  ├─→ Task 3 (Brett AI surfaces)
                                  ├─→ Task 4 (Gold migration)
                                  ├─→ Task 5 (Teal migration)
                                  ├─→ Task 6 (Desktop pages)
                                  ├─→ Task 7 (Typography)
                                  └─→ Task 8 (framer-motion)
                                       ↓
                                  Task 9 (QA pass) ← depends on ALL above
```

Tasks 2–8 are independent of each other and can run in parallel after Task 1.
