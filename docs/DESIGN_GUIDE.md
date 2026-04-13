# Brett Design Guide

**Read this file before making any frontend/UI changes.**

This is the design system reference for Brett's desktop application. It codifies the visual language and provides rules for maintaining design consistency and quality.

---

## Design Philosophy

Brett is a **warm, editorial-premium desktop app with an environmental soul.** Think: Apple Weather's lushness meets Monocle magazine's typographic confidence meets Things 3's interaction craft. Every surface is translucent. Every animation communicates meaning. Every pixel earns its place.

**Identity formula:** Editorial elegance as the foundation, environmental atmosphere as the differentiator.

**Core principles:**
1. **Glass over chrome** — translucent surfaces with backdrop blur, never opaque panels
2. **Motion for meaning** — every animation communicates a state change, never decorative
3. **Color as identity** — gold is the brand, cerulean is Brett, everything else is semantic
4. **Whisper, don't shout** — use opacity to create hierarchy, not size or weight alone
5. **Density with clarity** — show information-rich UI that still breathes
6. **Ambient personality** — the UI has opinions through texture, timing, and environmental response, but never blocks interaction or demands acknowledgment

**Reference triangle:**

| Priority | Reference | What We Take |
|----------|-----------|--------------|
| Primary | Apple Weather | Environmental richness, data-as-art, backgrounds that *are* information |
| Secondary | High-end editorial print (Monocle, Cereal, Kinfolk) | Typographic confidence, generous whitespace, warm photography + sharp type |
| Tertiary | Things 3 | Interaction craft, completion animations that feel *good*, tactile satisfaction |

---

## Surface System

All containers use the glass morphism pattern. Never use solid opaque backgrounds.

| Surface | Classes | Use |
|---------|---------|-----|
| **Card** | `bg-black/30 backdrop-blur-xl rounded-xl border border-white/10` | Primary containers (ThingsList, Calendar) |
| **Elevated card** | `bg-black/40 backdrop-blur-md border-{color}-500/30` | Accent cards (DailyBriefing, UpNextCard) |
| **Overlay** | `bg-black/60 backdrop-blur-2xl` | Panels over content (DetailPanel) |
| **Inline input** | `bg-transparent` or `bg-white/5` | Inputs within cards |
| **Hover surface** | `hover:bg-white/10` | Interactive list items, buttons |

**Rules:**
- Standard card padding is `p-4` (16px)
- Border radius is `rounded-xl` (12px) for cards, `rounded-lg` (8px) for inner elements, `rounded-full` for badges/pills
- Never mix glass cards with solid-background cards in the same view
- **`backdrop-blur` has exactly three tiers:** `backdrop-blur-xl` (cards), `backdrop-blur-md` (elevated/accent cards only), `backdrop-blur-2xl` (overlays/modals). Never use `backdrop-blur-sm` or `backdrop-blur-lg`.
- **`bg-black` standard stops:** `/20` (light dimming), `/30` (cards), `/40` (elevated cards), `/60` (overlays/modals), `/80` (tooltips/dropdowns). Never use in-between values like `/50`, `/55`, `/70`, `/85`.
- **`bg-white` standard stops:** `/5` (subtle tint, resting surfaces), `/10` (hover surfaces), `/15` (strong hover), `/20` (active/pressed). Never use fractional values like `bg-white/[0.03]`, `[0.06]`, `[0.07]` — use the nearest standard stop.

**Known issue:** Glass is too transparent on bright backgrounds (ocean, sky). Fix needed: bump `bg-black` opacity on cards and/or add a subtle vignette/scrim layer. Track this during implementation.

---

## Color System

### Brand Accent — Electric Gold

**`#E8B931`** — the signature color. Warm, metallic, energetic.

| Usage | Example |
|-------|---------|
| Active nav states | Selected nav item background/text |
| Task checkboxes | Toggle border color |
| Time/date badges | Pill background + text |
| Section header text | At `/50` opacity |
| Omnibar border accent | Subtle gold border |
| Completion pulse | Gold box-shadow animation |

**Why gold:** Unique in the SaaS space, naturally warm, reads clearly against any nature photograph, signals premium/editorial.

### Brett AI Color — Deep Cerulean (Reserved)

**`#4682C3`** — exclusively for Brett AI surfaces. Appears **nowhere else** in the app.

When users see this color, they know Brett is involved. This creates instant visual identification.

| Usage | Example |
|-------|---------|
| Brett's Take callout | Border, label, indicator dot |
| Chat messages from Brett | Message card border/background |
| Omnibar AI indicator | Glowing dot |
| "Brett is thinking..." | Text color |
| Brett Chat headers | Section label color |
| AI-related badges | Background tint |

### Semantic Colors

| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| **Success/complete** | Teal | `#48BBA0` | Completion checkmarks, "done" states |
| **Error/danger** | Warm red | `#E6554B` | Overdue badges, errors, destructive confirms |
| **Warning** | Amber (lighter gold) | — | Approaching deadlines, caution states |
| **Calendar accents** | Teal, violet, coral, blue | Various | Event color coding (each at /20 bg, /50 border) |

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
- **Readability floor: `/20`.** Nothing the user needs to *read* (not just glance at) should be below `/30`. Ghost text (`/20`) is for decorative separators, disabled icons, and whisper-level hints only.
- **Timestamps and relative ages always use `/40`** — they carry meaning and must remain readable on any background image
- Only use standard opacity stops: `/20`, `/30`, `/40`, `/50`, `/60`, `/80`, `/90`, `white`. Avoid fractional or in-between values.

### Border Opacity Scale

| Opacity | Role |
|---------|------|
| `border-white/10` | Default card/divider borders |
| `border-white/5` | Very subtle grid lines |
| `border-{color}-500/20–/50` | Colored accent borders |

**Rules:**
- Only use `border-white/5`, `border-white/10`, `border-white/15`, or `border-white/20` — never fractional values
- Divider lines (horizontal separators) always use `bg-white/10` for the 1px line

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

**Single typeface: Switzer** — a neo-grotesque sans-serif with subtle humanist warmth. Shares Inter's readability DNA (tall x-height, open apertures, screen-optimized) but with more personality.

Weights loaded: 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold), 400 Italic.

Bundled as a web font in the Electron app — no CDN dependency.

**No monospace in the UI.** All text uses Switzer. The only exception is actual code display. The monospace section label pattern is retired.

### Scale

| Element | Classes |
|---------|---------|
| Page/detail title | `text-2xl font-semibold text-white` |
| Card title | `text-xl font-bold text-white` or `text-base font-semibold` |
| Body | `text-sm text-white/80` |
| Section header | `text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40` |
| Badge text | `text-xs font-medium` or `text-[10px] font-bold` |
| Metadata | `text-xs text-white/40` |
| Brett's Take quote | `text-sm italic` in Brett's cerulean |

**Rules:**
- Section headers are ALWAYS `text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40` — this is a signature pattern. Never deviate from `/40` opacity.
- Don't use `text-lg` — jump from `text-base` to `text-xl`
- Avoid `font-light` — minimum weight is `font-normal`
- No `font-mono` in UI text — Switzer for everything
- Page subtitles (metadata below page headings like "2 active · 7 findings") use `/50`, not `/30`

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

### Engine

**Framer-motion** is the primary animation engine. CSS transitions remain for hovers and simple color changes (no re-render overhead needed).

Framer-motion enables: exit animations (`AnimatePresence`), layout reflow (`layout` prop), staggered children, and gesture interactions.

### Task Completion (Things 3 Pattern)

The completion interaction must feel satisfying while never blocking rapid task clearing.

1. **Click complete** — checkbox animates immediately with gold pulse (instant feedback)
2. **Row stays in place** — click targets don't move. User can keep completing other tasks.
3. **Debounced batch exit** (~800ms-1s after last completion) — all completed tasks swoosh out together via `AnimatePresence`
4. **Remaining tasks reflow** — `layout` prop animates remaining cards into new positions smoothly

- Completion pulse: **gold** (brand color), not green
- Total animation duration: under 400ms per item
- **Never blocks the next click**

### List Entrances (Staggered Reveal)

- Stagger: 30ms delay between cards
- Each card: fade in + translateY(8px), 300ms, ease-out
- Only on initial load / view switch — not when scrolling reveals more items
- Subtle wave effect, not a performance

### Panel Transitions

- **DetailPanel enter:** slide from right + scale(0.98→1) + fade, 250ms, spring with low bounce
- **DetailPanel exit:** `AnimatePresence` reverse — no manual timeout chains
- **Backdrop:** `bg-black/20` fades in behind panel, focuses attention and creates depth
- **Spotlight/⌘K:** scale from 0.95 + fade, 200ms

### View Transitions

When switching between sibling views (Today, Inbox, Upcoming, custom lists):

- `AnimatePresence` with `mode="wait"`
- Old view: fade out + translateY(-4px), 150ms
- New view: fade in + staggered cards + translateY(6px), 300ms
- Total transition under 350ms
- **No horizontal slide** — sibling views, not hierarchical navigation

### Hover States (CSS Only)

```
Cards:          hover:translateY(-1px) + shadow increase, 150ms
Buttons/actions: color shift only, no lift
Nav items:      bg-white/10 fade in, no lift
```

Do not use framer-motion for hovers — CSS transitions avoid unnecessary re-renders.

### Ambient Motion (Background Texture)

Non-blocking, barely perceptible motion that makes the UI feel alive:

- **Background image transitions:** cross-fade over ~1.5s when changing (time of day, manual switch)
- **Omnibar gold glow:** subtle box-shadow warmth shift by time of day — crisper morning, softer evening. CSS custom property driven.
- **Streaming cursor (Brett thinking):** the cerulean line in Brett's mark animates left-to-right repeatedly (stroke-dashoffset, 1.8s loop) — like a signal being transmitted from the gold dot. The dot stays static; the line does the work.

### Easing Curves

| Curve | Use |
|-------|-----|
| Framer-motion spring (stiffness: 300, damping: 30) | Panel entrances, layout reflow |
| `cubic-bezier(0.16, 1, 0.3, 1)` | Section enters, toggles, cross-fades |
| `ease-out` | Fade-ins, staggered children |
| `ease-in-out` | Hover transitions (CSS) |
| `cubic-bezier(0.4, 0, 1, 1)` | Exit animations |

### Duration Scale

| Duration | Use |
|----------|-----|
| `150ms` | Micro-interactions (hover color shifts) |
| `200ms` | Spotlight/overlay entrances |
| `250ms` | Panel slides |
| `300ms` | List card entrances, layout shifts |
| `400ms` | Completion check animation |
| `~1500ms` | Background cross-fade |

### Rules
- Every animation must communicate a state change — no decorative motion
- Ambient motion is always non-blocking background texture
- Use `AnimatePresence` for all exit animations — no manual timeout chains
- Use `layout` prop for list reflow after item removal
- Pulsing indicators use organic rhythm, not mechanical `animate-pulse`

---

## Interactive Patterns

### Hover States
```
hover:bg-white/10 + translateY(-1px) + shadow  — cards (physical lift)
hover:bg-white/20                               — buttons (stronger lift)
hover:text-white                                — text brighten
hover:text-white/80                             — subtle text brighten
hover:brightness-125                            — overall brighten (colored cards)
group-hover:opacity-100                         — reveal child on parent hover
```

### Focus States
- **Global:** Browser default focus outlines are removed via `*:focus { outline: none }` in `index.css`. All focus indication is custom.
- Inputs: `focus:border-[#E8B931]/20` (subtle gold border shift)
- Omnibar special: `border-[#E8B931]/50 shadow-[0_0_20px_rgba(232,185,49,0.15)]` (gold glow)
- List items: focus tracked via `isFocused` prop → `bg-white/10 border-[#E8B931]/30`
- **Do not** add `outline-none` to individual elements — the global rule handles it

### Active States (Pills/Tabs)
- Active: `bg-[#E8B931] text-white border-[#E8B931] shadow-[0_0_10px_rgba(232,185,49,0.3)]`
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
className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40"
```

### Glass Card
```jsx
className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4"
```

### Inline Input (inside cards)
```jsx
className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
```

### Colored Accent Card (e.g., DailyBriefing)
```jsx
className="bg-black/40 backdrop-blur-md rounded-xl border border-[#E8B931]/30 p-4"
// With optional glow:
<div className="absolute top-0 right-0 w-32 h-32 bg-[#E8B931]/5 rounded-full blur-2xl" />
```

---

## Icons

- Library: `lucide-react` (v0.522+)
- Default size: 16–18px for nav, 14–16px for inline, 12px for metadata
- Color follows the text opacity scale (e.g., `text-white/50` for inactive)
- Always pair icons with text labels in navigation
- Use semantic icons consistently: `Zap` = tasks, `BookOpen` = content, `Bot` = AI, `Sparkles` = empty/new

---

## Logo & Brand Marks

Brett has a two-mark system built from the same visual language: dots + horizontal lines = a brief.

### Product Mark (Gold)

The "stacked brief" — three bullet items (dot + line) with cascade fade. Represents the product itself.

```
●━━━━━━━━━━   (100% opacity)
●━━━━━━━       (60% opacity)
●━━━━           (30% opacity)
```

- **Color:** All gold `#E8B931`
- **Background:** Navy-black `#0C0F15`
- **Used for:** App icon, dock icon, favicon (default), splash screen, marketing, wordmark lockup
- **Behavior:** Static. Does not animate or change state.

The stagger in line lengths and the opacity cascade create the "information being distilled" metaphor — your day, summarized.

### Brett's Mark (Gold + Cerulean)

The "single bullet" — one dot + one horizontal line. Represents the AI assistant.

```
●━━━━━━━
```

- **Dot:** Gold `#E8B931`
- **Line:** Solid cerulean `#4682C3` at 70% opacity
- **Used for:** Chat avatar, Brett's Take indicator, omnibar AI dot, tray icon (working state), favicon (working state)
- **Behavior:** Animated. When thinking/working, the cerulean line draws left-to-right repeatedly (stroke-dashoffset animation, 1.8s loop). The gold dot stays static — the line carries the motion.

The single bullet is a component extracted from the product mark — they share the same geometry. When you see the stack, it's the app. When you see the single, Brett is talking.

### Wordmark

The wordmark is the user's chosen assistant name (default "Brett") set in **Switzer SemiBold**. The name is dynamic — users can rename their assistant, so the wordmark renders whatever name they chose. Never hardcode "Brett" in the mark.

### Icon System

| Context | Mark | Color | State |
|---------|------|-------|-------|
| **App icon / Dock** | Product (stacked) | Gold on `#0C0F15` | Static |
| **Favicon (default)** | Product (stacked) | Gold on `#0C0F15` | Static |
| **Favicon (Brett active)** | Brett (single) | Gold dot + cerulean line | Swap dynamically, title → "Brett is thinking..." |
| **Tray — idle** | Product (stacked) | Monochrome (macOS template) | Static, auto dark/light |
| **Tray — Brett working** | Brett (single) | Full color (gold + cerulean) | Gentle pulse via `Tray.setImage()` |
| **Tray — notification** | Product (stacked) + badge | Monochrome + gold dot overlay | Static badge |
| **LeftNav header** | Product (stacked) + wordmark | Gold | Static |
| **Chat avatar** | Brett (single) | Gold dot + cerulean line | Static (line draws on thinking) |
| **Brett's Take label** | Brett (single, small) | Gold dot + cerulean line | Static |

### Asset Files

```
apps/desktop/
├── build/
│   ├── icon.icns          # macOS app icon
│   └── icon.png           # 512px app icon for electron-builder
├── resources/
│   ├── icon.svg           # Source SVG — product mark
│   ├── icon-{16,32,64,128,256,512}.png
│   ├── tray-idleTemplate.png      # 22px monochrome (macOS template)
│   ├── tray-idleTemplate@2x.png   # 44px monochrome
│   ├── tray-working.png           # 22px color (Brett's mark)
│   ├── tray-working@2x.png        # 44px color
│   ├── tray-notificationTemplate.png    # 22px monochrome + badge
│   ├── tray-notificationTemplate@2x.png # 44px monochrome + badge
│   ├── tray-idle.svg              # Source SVG
│   ├── tray-working.svg           # Source SVG
│   └── tray-notification.svg      # Source SVG
└── public/
    ├── favicon.svg                # Product mark (default)
    └── favicon-working.svg        # Brett's mark (active state)
```

### Animation Notes

- **Product mark in splash screen:** Lines stagger in one by one (30ms delay), each fading up from nothing — like a brief being composed in real time
- **Brett's mark (thinking):** Cerulean line draws left-to-right repeatedly (stroke-dashoffset, 1.8s loop, ease). The gold dot stays static — the line carries the motion, like a signal being transmitted.
- **Tray state transitions:** Swap icon file instantly via `Tray.setImage()` — no animation on the icon itself, the state change IS the communication.

---

## Keyboard Interactions

- **Escape** closes overlays (DetailPanel, Omnibar, focused inputs)
- **Enter** submits inline forms
- DetailPanel close uses `AnimatePresence` exit — no manual delay before clearing selection

---

## Brett AI Surfaces — Consistency Rules

Brett appears in multiple surfaces. **All must feel like the same character.** The Omnibar is the reference implementation — when in doubt, match it.

### The Surfaces

| Surface | Component | Role |
|---------|-----------|------|
| **Omnibar** | `Omnibar.tsx` | Primary input — always visible, top of main content |
| **⌘K Spotlight** | `SpotlightModal.tsx` | Modal variant of omnibar — same hook, shared behavior |
| **Brett Chat** | `BrettThread.tsx` | Contextual chat in detail panels (tasks + calendar events) |
| **Brett's Take** | In `CalendarEventDetailPanel.tsx` | Pre-generated insight callout on calendar events |
| **Daily Briefing** | `DailyBriefing.tsx` | Morning summary card |

### Visual Identity (Non-Negotiable)

| Element | Standard | Notes |
|---------|----------|-------|
| **Icon** | `Bot` from lucide-react, `text-[#4682C3]` | Every AI surface shows this icon. Never use dots as substitutes. |
| **Streaming cursor** | `bg-[#E8B931]` pulsing rectangle | Gold = "working on it." Organic pulse rhythm, not mechanical. |
| **"Thinking" text** | "Brett is thinking..." in `text-[#4682C3]` | Show in ALL surfaces during streaming. |
| **Message cards** | `bg-white/5 rounded-lg px-3.5 py-3 border border-white/10` | Assistant messages always get glass cards. Never render flat. |
| **Send button** | `bg-[#E8B931] text-white hover:bg-[#D4A62B]` | Solid gold. Must look tappable. |
| **Input placeholder** | "Ask Brett anything..." | Same text everywhere. Consistent voice. |
| **Brett's brand color** | Deep Cerulean `#4682C3` | All Brett surfaces use cerulean. **Reserved — appears nowhere else.** |

### Brett's Take Callout

```jsx
// Cerulean accent, left border, italic quoted text
<div className="bg-[#4682C3]/10 border-l-2 border-[#4682C3] p-4 rounded-r-lg">
  <div className="flex items-center gap-2 mb-2">
    <div className="w-1.5 h-1.5 rounded-full bg-[#4682C3]" />
    <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#4682C3]">
      Brett&apos;s Take
    </span>
  </div>
  <p className="text-sm italic text-[#4682C3]/85 leading-relaxed">
    &ldquo;{observation}&rdquo;
  </p>
</div>
```

### "AI Not Configured" State

When the user hasn't set up an AI provider, show a warm gold callout — not an error, an invitation:

```jsx
<div className="bg-[#E8B931]/10 border border-[#E8B931]/20 rounded-lg p-3 text-center">
  <p className="text-xs text-[#E8B931]/80">
    Brett needs an AI provider to work his magic.
    Set one up in <button>Settings</button>.
  </p>
</div>
```

### When Adding New Brett Surfaces

1. Import and display the `Bot` icon in `text-[#4682C3]`
2. Use gold streaming cursor with organic pulse
3. Show "Brett is thinking..." during streaming in cerulean
4. Wrap assistant responses in glass cards
5. Use "Ask Brett anything..." as placeholder
6. Follow the "not configured" gold callout pattern
7. Read the Omnibar source as your reference

---

## Design Persona & Judgment Heuristics

### Product Identity

**Apple Weather meets editorial print meets a witty assistant.** Brett's visual identity is lush, warm, and polished (Apple Weather's data-as-art philosophy), with typographic confidence borrowed from magazine design, cut with dry personality and editorial sharpness.

The tension that makes Brett distinctive is: **premium polish with a voice that has opinions.**

The UI is quiet and beautiful, but Brett (the character) is not quiet at all.

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

### Ambient Visual Personality

The UI has opinions 100% of the time at a whisper level. Personality lives in texture, timing, and environmental response — never in interruption or decoration.

**Examples of ambient personality (safe zone):**
- Stale task tooltip has a slightly warmer/amber tint, like it's *aging*
- Clearing your last task subtly brightens the background — the environment responds
- The omnibar gold accent pulses subtly differently by time of day — morning is crisper, evening is slower
- When Brett is "thinking," the indicator has an organic, slightly irregular rhythm — alive, not mechanical
- Section headers use heavier weight for "Overdue" than "Today" — the UI emphasizes like a person would

**Hard rule:** If the personality *delays* an interaction or *demands* acknowledgment, it's too much. Cut it.

**Anti-patterns for personality:**
- Task cards that physically droop when overdue (cute once, annoying forever)
- Emoji or illustrations in the UI chrome (kills editorial tone)
- Animations that delay workflow to be clever

### Data as Art / Environmental Design

The app should feel alive and responsive to context — not a static dark shell.

**Background:**
- The background is not sacred. It can shift, change images, respond to time of day and workload.
- Source different background images. Factor in: time of day, season, how busy the user's day is.
- Background transitions use a ~1.5s cross-fade — the environment shifts, it doesn't cut.
- **Readability contract:** Because the background image changes, ALL text must remain readable on any image. Glass surfaces provide isolation, but text opacity must never rely on a dark background being behind it.

**Time-of-day evolution:**
- **Morning:** Energetic, forward-looking. "Here's what's ahead." Crisper gold glow.
- **Afternoon:** Focused, supportive. Progress-aware.
- **Evening:** Chill, reflective. "You got through a lot today." Softer gold glow.
- **Late night:** Minimal, calm. Don't be loud.

### Motion & Interaction Feel

**Completion (Things 3 swoosh):**
- Task completion should be efficient (you can rapid-fire through a list) but also *feel good*.
- Debounced batch exit — click targets stay put until you're done, then completed items swoosh out together.
- Gold pulse on the checkbox, not green.
- On mobile (future): explore tactile/haptic feedback combined with the swoosh.

**Hover states:** Physical, not luminous. Cards lift (`translateY(-1px)`), shadows deepen. It should feel like touching a real surface, not highlighting a pixel region.

**Panel transitions:** Snappy but organic. Spring-based (framer-motion), fast enough to feel responsive (~250ms), with gentle ease that avoids feeling mechanical. Not bouncy — just alive.

### Density & Information Hierarchy

**Default bias: less.** When in doubt, show less. But this is a power-user tool — density is a feature when it serves comprehension.

**Detail panel rules:**
- Remove duplicative metadata
- Source/origin information lives in the content preview area as an "open original" link
- All detail panel types should follow the same structural pattern
- Panel width is not sacred at 550px — size it to what makes sense holistically

### Consistency as Default

**Force consistency most of the time.** Every panel type, every list row, every section header should follow the same patterns unless there's a compelling reason to diverge.

**When to break consistency:**
- The content type has fundamentally different affordances (calendar events have RSVP, tasks don't)
- Consistency would actively mislead (making a read-only field look editable)
- A one-off moment of delight that earns its keep

### Destructive Actions & Friction

**Inline transformation, never modals.** When the user hits delete, the row/button itself transforms into the confirmation state.

**Pattern:** Action button → transforms to "Are you sure? [Confirm] [Cancel]" in the same space → completes or reverts.

**Errors:** Glass-style inline errors. Appear contextually where the action happened. Clinical tone. Include escalation path.

### Actionable Tooltips

Tooltips should not just describe — they should *suggest action*. When hovering over a stale task, the tooltip says "This has been sitting for 2 weeks. Complete it or delete it."

### Empty States

Every empty state should be:
1. **Contextual** — aware of *why* it's empty (fresh start vs. you cleared everything)
2. **Personality-forward** — Brett's voice, not system language
3. **Smoothly integrated** — feels like a natural part of the view, not an error page
4. **Actionable when appropriate** — if there's a next step, surface it naturally

---

## Improvement Opportunities

These are areas where the design can level up. Apply these when touching relevant components.

### 1. Micro-interaction Polish
Cards should feel like they physically respond to cursor proximity:
```jsx
className="hover:bg-white/10 hover:-translate-y-[1px] hover:shadow-lg transition-all duration-150"
```

### 2. Empty State Richness
Add staggered entrance animations (framer-motion) for empty state elements. Empty states are where personality lives — consider a gentle breathing animation on the main icon.

### 3. Skeleton Loading States (IMPLEMENTED)
**Rule:** All loading states use skeleton loaders — never show "Loading..." text.

**Components:**
- `SkeletonBar` — single pulsing bar, accepts `className` for sizing
- `SkeletonListView` — full list skeleton (header + add input + 3 item cards)

**Rules:**
- Skeletons must match the shape of the content they replace
- Use `bg-white/5` — not `bg-white/10` (too bright) or `bg-white/[0.03]` (invisible)
- Use `animate-pulse` (Tailwind built-in) — not custom keyframes
- Show 3 skeleton cards for list views
- Full-screen loading (auth init): use pulsing logo, not skeletons

### 4. Scroll Position Indicators
Add subtle gradient fade masks at top/bottom of scrollable areas to hint at overflow:
```jsx
className="bg-gradient-to-b from-black/40 to-transparent h-4 pointer-events-none"
```

### 5. Transition Choreography (READY TO IMPLEMENT)
Stagger ThingCard entrance animations using framer-motion. Each card delayed by 30ms for a cascading reveal effect.

### 6. DetailPanel Backdrop (READY TO IMPLEMENT)
Add a `bg-black/20` backdrop overlay behind the panel that fades in/out with `AnimatePresence`.

### 7. Focus Ring Consistency
Standardize on: `focus-visible:ring-1 focus-visible:ring-[#E8B931]/30 focus-visible:outline-none` for all interactive elements. Use `focus-visible` (not `focus`) so keyboard users get rings but mouse users don't.

### 8. CalendarTimeline Current Hour Emphasis
Add a subtle gradient glow around the current hour band. Make past hours slightly more faded (`opacity-60`) vs upcoming hours (`opacity-100`).

### 9. LeftNav Active State
Add a subtle left border accent (`border-l-2 border-[#E8B931]`) or a glass highlight (`bg-white/10 rounded-lg`) on the active item for stronger spatial anchoring.

---

## Anti-Patterns (Never Do These)

1. **Solid opaque backgrounds** — always use transparency + blur
2. **`text-gray-*` colors** — use `text-white/{opacity}` exclusively
3. **`blue-500` as brand/primary** — gold `#E8B931` is the brand, cerulean `#4682C3` is Brett-only
4. **`font-mono` in UI text** — Switzer for everything, no monospace
5. **Green for completion** — gold pulse, teal `#48BBA0` checkmark
6. **Mechanical animation rhythms** — organic, slightly irregular for ambient motion
7. **Blocking animations** — never delay the next user action
8. **Personality that demands acknowledgment** — ambient only, never modal
9. **`text-lg`** — skip from `text-base` to `text-xl`
10. **`font-light`** — minimum weight is `font-normal`
11. **CSS keyframes for complex sequences** — use framer-motion for exits, layout, stagger
12. **Horizontal slide for sibling view transitions** — vertical fade only
13. **Component libraries (shadcn, Radix, etc.) for styled components** — custom glass components only
14. **Toast notifications** — all feedback is inline, contextual, integrated
15. **Generic empty states** — every empty state must be crafted, contextual, and carry Brett's personality
16. **Thick focus outlines** — use subtle 1px rings or glow shadows
17. **Raw color values for brand/AI colors** — use the defined hex values consistently

---

## Cross-Platform Consistency (Desktop + Mobile)

The native iOS app (`apps/ios/`) must maintain visual consistency with the Electron desktop app. These rules apply to both platforms:

### Shared Values — Must Match Exactly

| Token | Desktop (Tailwind) | iOS (SwiftUI) | Notes |
|-------|-------------------|---------------|-------|
| Brand gold | `#E8B931` | `BrettColors.gold` | |
| Brett cerulean | `#4682C3` | `BrettColors.cerulean` | Reserved for AI surfaces only |
| Success/teal | `#48BBA0` | `BrettColors.success` | Checkmarks, completion |
| Error/red | `#E6554B` | `BrettColors.error` | Overdue, destructive |
| Emerald | `#34D399` | `BrettColors.emerald` | Scout active status |
| Purple-400 | `#C084FC` | `BrettColors.purple400` | Insight findings |
| Amber-400 | `#FBBF24` | `BrettColors.amber400` | Task findings |
| Card border | `border-white/10` | `Color.white.opacity(0.10)` | Never use /8 or /12 |
| Subtle grid | `border-white/5` | `Color.white.opacity(0.05)` | Never use /6 |
| Tint overlay | `bg-{color}/10` | `tint.opacity(0.10)` | Never use /8 |
| Checkbox bg | `bg-black/20` | `Color.black.opacity(0.20)` | Never use /25 |

### Opacity Stops — Standard Only

Text: `/20`, `/30`, `/40`, `/50`, `/60`, `/80`, `/90`, `white`
Borders: `/5`, `/10`, `/15`, `/20`
Backgrounds: `/5`, `/10`, `/15`, `/20`, `/30`

Never use non-standard stops like `/8`, `/12`, `/25`, `/35`, `/55`. If you find yourself reaching for a non-standard value, use the nearest standard stop.

### Glass Materials (iOS)

| Surface | Material | Desktop Equivalent |
|---------|----------|--------------------|
| Section cards | `.thinMaterial` | `bg-black/30 backdrop-blur-xl` |
| Omnibar | `.ultraThinMaterial` | `bg-black/30 backdrop-blur-xl` |
| Sheets/modals | `.regularMaterial` | `bg-black/60 backdrop-blur-2xl` |
| Calendar event chips | `.ultraThinMaterial` | `bg-black/20 backdrop-blur-lg` |

### When Adding or Changing Colors

1. Check if the color already exists in `BrettColors.swift` (iOS) or `DESIGN_GUIDE.md` (desktop)
2. If it's a new color, add it to both — `BrettColors.swift` AND this guide
3. Never use inline `Color(red:green:blue:)` for brand/semantic colors — always reference `BrettColors.*`
4. Run a grep for raw color values after adding features to catch drift

---

## Date & Timezone Handling

All date boundary logic must be timezone-aware. The user's IANA timezone is stored on their `User` record and synced from the browser on startup.

### The Rule

**Never use date-only strings (e.g., `"2026-03-29"`) for database queries.** JavaScript's `new Date("2026-03-29")` interprets date-only strings as UTC midnight — not the user's local midnight.

### Client-side (Electron renderer)

```typescript
// CORRECT — send full ISO timestamps computed from local midnight
const start = new Date(someDate);
start.setHours(0, 0, 0, 0);
const end = new Date(start);
end.setDate(end.getDate() + 1);
fetch(`/calendar/events?startDate=${start.toISOString()}&endDate=${end.toISOString()}`);

// WRONG — date-only strings are interpreted as UTC midnight on the API
fetch(`/calendar/events?startDate=2026-03-29&endDate=2026-03-30`);
```

### Server-side (API routes, AI skills)

```typescript
import { getCalendarDateBounds, getUserDayBounds } from "@brett/business";

const { startOfDay, endOfDay } = getCalendarDateBounds("2026-03-29", userTimezone);
const { startOfDay, endOfDay } = getUserDayBounds(userTimezone);
```

### Anti-patterns

| Pattern | Problem |
|---------|---------|
| `new Date(dateStr); d.setUTCHours(0,0,0,0)` | Assumes UTC midnight = user's midnight |
| `new Date(dateStr + "T00:00:00Z")` | Forces UTC, ignores user timezone |
| `new Date(dateStr + "T00:00:00")` | Uses server's local timezone, not user's |
| Formatting local dates as `YYYY-MM-DD` for API params | API parses as UTC, off by timezone offset |
