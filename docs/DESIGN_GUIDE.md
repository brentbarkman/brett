# Brett Design Guide

**Read this file before making any frontend/UI changes.**

This is the design system reference for Brett's desktop application. It codifies the current visual language and provides rules for maintaining design consistency and quality.

---

## Design Philosophy

Brett is a **dark glass, editorial-premium desktop app**. Think: Linear meets Arc meets Apple Weather. Every surface is translucent. Every animation communicates meaning. Every pixel earns its place.

**Core principles:**
1. **Glass over chrome** — translucent surfaces with backdrop blur, never opaque panels
2. **Motion for meaning** — every animation communicates a state change, never decorative
3. **Color as category** — color encodes type/urgency, not decoration
4. **Whisper, don't shout** — use opacity to create hierarchy, not size or weight alone
5. **Density with clarity** — show information-rich UI that still breathes

---

## Surface System

All containers use the glass morphism pattern. Never use solid opaque backgrounds.

| Surface | Classes | Use |
|---------|---------|-----|
| **Card** | `bg-black/30 backdrop-blur-xl rounded-xl border border-white/10` | Primary containers (ThingsList, Calendar) |
| **Elevated card** | `bg-black/40 backdrop-blur-md border-{color}-500/30` | Accent cards (MorningBriefing, UpNextCard) |
| **Overlay** | `bg-black/60 backdrop-blur-2xl` | Panels over content (DetailPanel) |
| **Inline input** | `bg-transparent` or `bg-white/5` | Inputs within cards |
| **Hover surface** | `hover:bg-white/10` | Interactive list items, buttons |

**Rules:**
- Standard card padding is `p-4` (16px)
- Border radius is `rounded-xl` (12px) for cards, `rounded-lg` (8px) for inner elements, `rounded-full` for badges/pills
- Never mix glass cards with solid-background cards in the same view

---

## Color System

### Semantic Colors

| Role | Color | Usage |
|------|-------|-------|
| **Primary action** | `blue-500` | Active states, focus rings, primary buttons, task icons |
| **Success/complete** | `green-500` | Completion animations, "done" states |
| **Warning/upcoming** | `amber-500` | Content type, "today" urgency, upcoming events |
| **Danger/overdue** | `red-500` | Overdue badges, errors, current-time indicator |
| **Calendar accents** | `blue/green/purple/amber` | Event color coding (each at /20 bg, /50 border) |

### Text Opacity Scale

This is the primary hierarchy tool. Master it.

| Opacity | Role | Example |
|---------|------|---------|
| `text-white` | Primary headings, active nav | Page titles, selected nav items |
| `text-white/90` | Emphasized body | Card titles |
| `text-white/80` | Standard body | Descriptions, briefing text |
| `text-white/60` | Secondary text | Metadata values |
| `text-white/50` | Inactive interactive | Unselected nav icons |
| `text-white/40` | Tertiary/muted | Section labels, timestamps, list+source |
| `text-white/30` | Placeholder | Input placeholders |
| `text-white/20` | Ghost | Unfocused icons |

**Rules:**
- Never use `text-gray-*` — always use `text-white/{opacity}`
- Body text should be `/80`, not `/100` — pure white is reserved for headings and active states
- Muted metadata uses `/40`, not `/60`

### Border Opacity Scale

| Opacity | Role |
|---------|------|
| `border-white/10` | Default card/divider borders |
| `border-white/5` | Very subtle grid lines |
| `border-white/[0.03]` | Nearly invisible (unfocused inputs) |
| `border-{color}-500/20–/50` | Colored accent borders |

### Background Opacity for Color

| Opacity | Usage |
|---------|-------|
| `bg-{color}/5` | Barely visible tint |
| `bg-{color}/10` | Light card backgrounds |
| `bg-{color}/20` | Badges, pills, status indicators |
| `bg-{color}/30` | Strong colored backgrounds |

---

## Typography

### Font Stack
- Body: `font-sans` (system stack)
- Labels/section headers: `font-mono text-xs uppercase tracking-wider`

### Scale

| Element | Classes |
|---------|---------|
| Page/detail title | `text-2xl font-semibold text-white` |
| Card title | `text-xl font-bold text-white` or `text-base font-semibold` |
| Body | `text-sm text-white/80` |
| Section header | `font-mono text-xs uppercase tracking-wider text-white/40 font-semibold` |
| Badge text | `text-xs font-medium` or `text-[10px] font-bold` |
| Metadata | `text-xs text-white/40` |

**Rules:**
- Section headers are ALWAYS `font-mono uppercase tracking-wider` — this is a signature pattern
- Don't use `text-lg` — jump from `text-base` to `text-xl`
- Avoid `font-light` — minimum weight is `font-normal`

---

## Spacing

Base unit: 4px (Tailwind's default scale).

| Context | Value | Tailwind |
|---------|-------|----------|
| Between items in a list | 8px | `gap-2` |
| Between sections | 16px | `gap-4` or `space-y-4` |
| Card padding | 16px | `p-4` |
| Compact padding | 8–12px | `p-2` or `p-3` |
| Major section margin | 24–32px | `mb-6` or `mb-8` |

**Rules:**
- Use `gap-*` or `space-y-*` for vertical rhythm, not margin on individual items
- Card padding is always `p-4` unless it's a compact inline element (`p-2` or `p-3`)
- The main content column is `max-w-3xl mx-auto`

---

## Layout

### Three-Column Desktop Layout
```
┌──────────┬────────────────────┬──────────┐
│ LeftNav  │   Main Content     │ Calendar │
│ 220px    │   flex-1, max-3xl  │  300px   │
│ (68px    │   scrollable       │          │
│ collapsed)│                   │          │
└──────────┴────────────────────┴──────────┘
```

- Outer container: `flex h-screen w-full gap-4 p-4 pl-0`
- Main scroll area: `flex-1 min-w-0 overflow-y-auto scrollbar-hide`
- Use `min-w-0` on flex children to prevent overflow
- DetailPanel overlays from the right at `z-50`, width `400px`

---

## Animation

### Easing Curves

| Curve | Use |
|-------|-----|
| `cubic-bezier(0.16, 1, 0.3, 1)` | Primary — bouncy/elastic. Section enters, toggles, cross-fades. |
| `cubic-bezier(0.4, 0, 1, 1)` | Exit animations (cross-fade out) |
| `ease-in-out` | Default Tailwind transitions |
| `ease-out` | Slide-in panels (DetailPanel) |

### Duration Scale

| Duration | Use |
|----------|-----|
| `150ms` | Micro-interactions (icon opacity) |
| `200ms` | Color/hover transitions |
| `300ms` | Panel slides, sidebar collapse, input expand |
| `400–450ms` | Section enters, check-pop |
| `600ms` | Completion pulse (togglePulse) |

### Existing Animations

| Name | Duration | Effect | Used in |
|------|----------|--------|---------|
| `togglePulse` | 600ms | Scale + green box-shadow ring | ThingCard completion |
| `checkPop` | 400ms | Scale + rotate check icon | ThingCard completion |
| `sectionEnter` | 450ms | Fade in + translateY(12px) | ThingsList new sections |
| `crossFadeOut` | 180ms | Fade out + translateY(6px) + scale(0.985) | CrossFade exit |
| `crossFadeIn` | 280ms | Fade in + translateY(10px) + scale(0.985) | CrossFade enter |

### CSS Keyframes vs Framer Motion

**Current approach:** CSS keyframes + Tailwind transitions. Zero bundle cost, native performance, sufficient for current animations.

**When to adopt framer-motion:** When we need exit animations (`AnimatePresence`), list reorder animations (`layout`), staggered children, or gesture interactions (drag/swipe). The CrossFade component is already working around the lack of `AnimatePresence` with manual timeout chains — that's the inflection point. Adopt framer-motion when tackling animation improvements, don't retrofit existing working animations.

### Rules
- **Current:** CSS keyframes (inline `<style>` blocks) + Tailwind transitions
- **Future:** framer-motion is approved when exit/layout/stagger animations are needed
- Transition defaults: `transition-all duration-200` for hover, `duration-300` for layout shifts
- Pulsing indicators use `animate-pulse` (Tailwind built-in)
- Every animation must communicate a state change — no decorative motion
- Use `animation-fill-mode: forwards` for enter animations

---

## Interactive Patterns

### Hover States
```
hover:bg-white/10          — subtle background lift (default)
hover:bg-white/20          — stronger lift (buttons)
hover:text-white           — text brighten
hover:text-white/80        — subtle text brighten
hover:brightness-125       — overall brighten (colored cards)
group-hover:opacity-100    — reveal child on parent hover
```

### Focus States
- **Global:** Browser default focus outlines are removed via `*:focus { outline: none }` in `index.css`. All focus indication is custom.
- Inputs: `focus:border-blue-500/20` (subtle border shift, no rings)
- Omnibar special: `border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.15)]` (blue glow)
- List items: focus tracked via `isFocused` prop → `bg-white/10 border-blue-500/30`
- **Do not** add `outline-none` to individual elements — the global rule handles it

### Active States (Pills/Tabs)
- Active: `bg-blue-500 text-white border-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.3)]`
- Inactive: `bg-white/5 text-white/50 border-white/10`

### Disabled States
- `disabled:opacity-30 disabled:cursor-not-allowed`

---

## Component Patterns

### Badge/Pill
```jsx
className="px-2.5 py-1 rounded-full text-xs font-medium bg-{color}/20 text-{color}-400 border border-{color}/20"
```

### Icon Button
```jsx
className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
```

### Section Header
```jsx
className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold"
```

### Glass Card
```jsx
className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4"
```

### Inline Input (inside cards)
```jsx
className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
```

### Colored Accent Card (e.g., MorningBriefing)
```jsx
className="bg-black/40 backdrop-blur-md rounded-xl border border-blue-500/30 p-4"
// With optional glow:
<div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl" />
```

---

## Icons

- Library: `lucide-react` (v0.522+)
- Default size: 16–18px for nav, 14–16px for inline, 12px for metadata
- Color follows the text opacity scale (e.g., `text-white/50` for inactive)
- Always pair icons with text labels in navigation
- Use semantic icons consistently: `Zap` = tasks, `BookOpen` = content, `Bot` = AI, `Sparkles` = empty/new

---

## Keyboard Interactions

- **Escape** closes overlays (DetailPanel, Omnibar, focused inputs)
- **Enter** submits inline forms
- DetailPanel close has a 300ms delay before clearing selection (for exit animation)

---

## Improvement Opportunities

These are areas where the design can level up. Apply these when touching relevant components.

### 1. Micro-interaction Polish
**Current:** Hover states are basic (`bg-white/10`).
**Upgrade:** Add subtle `translateY(-1px)` lift on card hover with `shadow` increase. Cards should feel like they physically respond to cursor proximity.
```jsx
className="hover:bg-white/10 hover:-translate-y-[1px] hover:shadow-lg transition-all duration-200"
```

### 2. Empty State Richness
**Current:** ThingsEmptyState uses static icons.
**Upgrade:** Add a subtle entrance animation (staggered fade-in for the pills/badges). Empty states are where personality lives — consider a gentle floating/breathing animation on the main icon.

### 3. Skeleton Loading States ✅ IMPLEMENTED
**Rule:** All loading states use skeleton loaders — never show "Loading..." text.

**Components:**
- `SkeletonBar` — single pulsing bar, accepts `className` for sizing
- `SkeletonListView` — full list skeleton (header + add input + 3 item cards)

**Pattern:**
```jsx
// Single bar
<div className="bg-white/5 animate-pulse rounded-lg h-4 w-3/4" />

// Thing card skeleton
<div className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-white/5">
  <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse flex-shrink-0" />
  <div className="flex-1 space-y-2">
    <div className="bg-white/5 animate-pulse rounded-lg h-3.5 w-3/4" />
    <div className="bg-white/5 animate-pulse rounded-lg h-2.5 w-1/2" />
  </div>
  <div className="bg-white/5 animate-pulse rounded-lg h-6 w-16 rounded-full" />
</div>
```

**Rules:**
- Skeletons must match the shape of the content they replace (cards look like cards, inputs look like inputs)
- Use `bg-white/5` — not `bg-white/10` (too bright) or `bg-white/[0.03]` (invisible)
- Use `animate-pulse` (Tailwind built-in) — not custom keyframes
- Show 3 skeleton cards for list views (enough to indicate content, not so many it feels heavy)
- Full-screen loading (auth init): use pulsing logo, not skeletons

### 4. Scroll Position Indicators
**Current:** Lists in LeftNav use `scrollbar-hide` with no overflow indication.
**Upgrade:** Add subtle gradient fade masks at top/bottom of scrollable areas to hint at overflow:
```jsx
// Top fade when scrolled
className="bg-gradient-to-b from-black/40 to-transparent h-4 pointer-events-none"
```

### 5. Transition Choreography
**Current:** All list items appear simultaneously.
**Upgrade:** Stagger ThingCard entrance animations (each card delayed by 30–50ms) for a cascading reveal effect. This is an Apple-signature pattern.

### 6. DetailPanel Backdrop
**Current:** DetailPanel slides in over content with no backdrop dimming.
**Upgrade:** Add a `bg-black/20` backdrop overlay behind the panel that fades in/out with the panel. This focuses attention and creates depth.

### 7. Focus Ring Consistency
**Current:** Some inputs have focus rings, others don't. Inconsistent across components.
**Upgrade:** Standardize on: `focus-visible:ring-1 focus-visible:ring-blue-500/30 focus-visible:outline-none` for all interactive elements. Use `focus-visible` (not `focus`) so keyboard users get rings but mouse users don't.

### 8. Toast/Notification System
**Current:** No feedback for mutations (toggle, add, delete).
**Upgrade:** Add a minimal toast system — small glass pill that slides up from bottom center, auto-dismisses in 2–3s. "Task completed", "Added to Inbox", etc.

### 9. CalendarTimeline Current Hour Emphasis
**Current:** Red dot + line marks current time.
**Upgrade:** Add a subtle gradient glow around the current hour band. Make past hours slightly more faded (`opacity-60`) vs upcoming hours (`opacity-100`) to create a time-awareness gradient.

### 10. LeftNav Active State
**Current:** Active nav item uses `text-white` vs inactive `text-white/50`.
**Upgrade:** Add a subtle left border accent (`border-l-2 border-blue-500`) or a glass highlight (`bg-white/10 rounded-lg`) on the active item for stronger spatial anchoring.

---

## Anti-Patterns (Never Do These)

1. **Solid opaque backgrounds** — always use transparency + blur
2. **`text-gray-*` colors** — use `text-white/{opacity}` exclusively
3. **Thick focus outlines** — use subtle 1px rings or glow shadows
4. **Decorative animation** — every motion must communicate state
5. **Inconsistent border radius** — cards are `rounded-xl`, inner elements `rounded-lg`, pills `rounded-full`
6. **Raw color values** — use the semantic color system (blue=primary, amber=warning, etc.)
7. **`font-light`** — minimum weight is `font-normal`
8. **`text-lg`** — skip from `text-base` to `text-xl`
9. **Component libraries (shadcn, Radix, etc.) for styled components** — this app uses custom glass components, not shadcn. `@brett/ui` is the component library.
10. **Framer Motion** — use CSS keyframes and Tailwind transitions only
11. **Toast notifications** — never use toasts. All feedback is inline, contextual, and integrated into the surface where the action happened.
12. **Generic empty states** — every empty state must be crafted, contextual, and carry Brett's personality. Never "No items found."

---

## Design Persona & Judgment Heuristics

This section covers the *taste and judgment layer* — how to make design decisions when the system tokens don't give you a clear answer.

### Product Identity

**Apple Weather meets a witty assistant.** Brett's visual identity is lush, data-rich, and polished (Apple Weather's data-as-art philosophy), but cut with dry personality and editorial sharpness. The tension that makes Brett distinctive is: **premium polish with a voice that has opinions.**

Think of it as: the UI is quiet and beautiful, but Brett (the character) is not quiet at all.

**Reference triangle:** Apple Weather (primary) > Linear (secondary) > Arc (tertiary)
- From Apple Weather: data-as-art, backgrounds that *are* information, lush environmental shifts
- From Linear: engineering precision, density with clarity, respect for power users
- From Arc: willingness to be opinionated, break conventions when it serves the user

### Brett as a Character

Brett is an assistant, but the best kind — the kind that challenges you.

**Voice:** Dry wit. Direct. Occasionally self-deprecating. Never sycophantic, never corporate.

**Personality traits:**
- Confident but not arrogant — will say "not sure about this one" when uncertain
- Challenges you when something seems off — "Hey, does this still matter?"
- Celebrates your wins without being performative — knows the difference between clearing 3 tasks on a light day vs. crushing 8 things through 6 hours of meetings
- Context-aware — Brett's observations should reflect what actually happened, not generic encouragement

**Voice examples:**

| Moment | Bad (generic) | Good (Brett) |
|--------|---------------|--------------|
| Empty inbox, free day | "No tasks" | "Nothing but focus today. Let's get it." |
| Empty inbox, earned it | "All done!" | "Nice work — you got 8 things done while getting through 6 hours of meetings. Have a glass of wine, you earned it." |
| Stale task (2+ weeks) | "This task is overdue" | "Hey, does this still matter? Do something or delete it." |
| Error saving | "Something went wrong" | "Failed to save. Try again — if this persists after refreshing, ask Brett to report an error." |

**Error voice rule:** Errors are clinical and helpful, never cute. Being witty when something broke is annoying. State what happened, what to try, and where to escalate.

### Data as Art / Environmental Design

The app should feel alive and responsive to context — not a static dark shell.

**Background:**
- The background is not sacred. It can shift, change images, respond to time of day and workload.
- Source different background images. Factor in: time of day, season, how busy the user's day is.
- A packed day might feel denser, more focused. A clear day might breathe more.
- Evening should feel warmer. Morning should feel crisp.

**Time-of-day evolution:**
- This goes beyond cosmetic. Brett's personality should shift with the time:
  - **Morning:** Energetic, forward-looking. "Here's what's ahead."
  - **Afternoon:** Focused, supportive. Progress-aware.
  - **Evening:** Chill, reflective. "You got through a lot today."
  - **Late night:** Minimal, calm. Don't be loud.
- Express time through: background imagery/tint, copy tone, greeting energy, subtle color temperature shifts.

### Motion & Interaction Feel

**Completion (Things 3 swoosh):**
- Task completion should be efficient (you can rapid-fire through a list) but also *feel good* — like you accomplished something.
- The gold standard is Things 3: checkmark animates, row compresses with a satisfying vertical slide, item disappears. It's about the *feel* of the row sliding away.
- Don't block the next action. The animation happens, but the user can already be clicking the next item.
- On mobile (future): explore tactile/haptic feedback combined with the swoosh.

**Hover states:** Physical, not luminous. Cards lift (`translateY(-1px)`), shadows deepen. It should feel like touching a real surface, not highlighting a pixel region.

**Panel transitions:** Snappy but organic. Fast enough to feel responsive (~200-250ms), but with a gentle ease curve that avoids feeling mechanical. Not bouncy — just alive.

### Density & Information Hierarchy

**Default bias: less.** When in doubt, show less. But this is a power-user tool — density is a feature when it serves comprehension, not when it's just "more stuff."

**Detail panel rules:**
- Remove duplicative metadata. If the user clicked into this from a list, don't re-show list name or source as prominent badges.
- Source/origin information lives in the content preview area as an "open original" link pattern (like Lenny's newsletter), not as a standalone badge.
- All detail panel types (Task, Content, Calendar Event) should follow the same structural pattern. Enforce consistency unless there's a very strong reason to break.
- Panel width is not sacred at 550px. Size it to what makes sense holistically.

**Inbox list rows:** toggle button, title, relative age. Source pill is noise — remove it.

### Consistency as Default

**Force consistency most of the time.** Every panel type, every list row, every section header should follow the same patterns unless there's a compelling reason to diverge. "Compelling" means the content genuinely demands a different treatment, not "this one felt like it should be different."

**When to break consistency:**
- The content type has fundamentally different affordances (calendar events have RSVP, tasks don't)
- Consistency would actively mislead (making a read-only field look editable)
- A one-off moment of delight that earns its keep

### Typography Direction

**Target feel:** Apple SF Pro neutrality — clean, invisible, gets out of the way. The content is the star, not the typeface.

- Section labels (`font-mono uppercase`) are a signature pattern but not precious. Open to evolution — could explore sans-serif small caps, lighter tracking, or other treatments that feel less "developer tool."
- Font size/density should be configurable as a user preference (not typeface switching — that's a design decision, not a setting).

**Future direction — Zen Mode:**
- A distinct visual mode: softer fonts, Japanese-inspired aesthetic, rounder edges, more pastel colors.
- This is a *mode*, not a setting toggle — it's a holistic visual transformation.
- Hold off on implementation, but design decisions should not preclude it.

### Destructive Actions & Friction

**Inline transformation, never modals.** When the user hits delete, the row/button itself transforms into the confirmation state. The calendar disconnect pattern in Settings is the gold standard — replicate it everywhere.

**Pattern:** Action button → transforms to "Are you sure? [Confirm] [Cancel]" in the same space → completes or reverts.

**Errors:** Glass-style inline errors. Appear contextually where the action happened. Clinical tone (see voice rules above). Include escalation path ("ask Brett to report an error").

### Actionable Tooltips

Tooltips should not just describe — they should *suggest action*. When hovering over a stale task, the tooltip doesn't say "Created 14 days ago." It says "This has been sitting for 2 weeks. Complete it or delete it."

This extends Brett's personality into the smallest interactions.

### Empty States

Every empty state should be:
1. **Contextual** — aware of *why* it's empty (fresh start vs. you cleared everything)
2. **Personality-forward** — Brett's voice, not system language
3. **Smoothly integrated** — feels like a natural part of the view, not an error page
4. **Actionable when appropriate** — if there's a next step, surface it naturally

Empty states are where personality lives. They're the moments when the app has nothing to show, so it shows *character* instead.
