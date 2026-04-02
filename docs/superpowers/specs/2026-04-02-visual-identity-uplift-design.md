# Brett Visual Identity Uplift — Design Spec

**Date:** 2026-04-02  
**Status:** Approved  
**Scope:** Brand voice, color system, typography, iconography, animation/motion

---

## 1. Brand Voice & Aesthetic Direction

### Identity Formula

**Editorial elegance as the foundation, environmental atmosphere as the differentiator.**

The app lives in a lush, dynamic environment (photo backgrounds, time-of-day shifts), but the design work on that canvas borrows from magazine layout — typographic confidence, generous breathing room, warm photography meeting sharp type.

### Reference Triangle (Updated)

| Priority | Reference | What We Take |
|----------|-----------|--------------|
| Primary | Apple Weather | Environmental richness, data-as-art, backgrounds that *are* information |
| Secondary | High-end editorial print (Monocle, Cereal, Kinfolk) | Typographic confidence, generous whitespace, warm photography + sharp type |
| Tertiary | Things 3 | Interaction craft, completion animations that feel *good*, tactile satisfaction |

**Removed:** Linear (too cold/engineering), Arc (less relevant to new direction).

### UI Personality Rule

**Ambient, never blocking.** The UI has visual personality 100% of the time at a whisper level — through texture, timing, and environmental response. It doesn't save up personality for special moments; it's *always there*, just quiet enough that it never competes with content or blocks interaction.

Examples of ambient personality:
- Stale task tooltip has a slightly warmer tint, like it's *aging*
- Clearing your last task subtly brightens the background — the environment responds
- The streaming cursor has an organic, slightly irregular rhythm — alive, not mechanical
- Section headers use heavier weight for "Overdue" than "Today" — the UI emphasizes like a person would

**Hard rule:** If the personality *delays* an interaction or *demands* acknowledgment, it's too much. Cut it.

---

## 2. Color System

### Brand Accent

**Electric Gold `#E8B931`**

The signature color. Warm, metallic, energetic — like morning light hitting a surface. Used for:
- Active nav states
- Task checkboxes and toggle borders
- Time/date badges
- Section header text (at reduced opacity)
- Omnibar border accent
- Brand wordmark
- Completion pulse animation

**Why gold:** Unique in the SaaS space (almost no competitor uses it), naturally warm without effort, reads clearly against any nature photograph background, signals premium/editorial.

### Brett AI Color (Reserved)

**Deep Cerulean `#4682C3`**

Exclusively for Brett AI surfaces. Appears **nowhere else** in the app. When users see this color, they know Brett is involved.

Used for:
- Brett's Take callout (border, label, dot)
- Chat message cards from Brett
- Omnibar AI indicator dot
- "Brett is thinking..." text
- Brett Chat section headers
- AI-related badges/pills

**Why reserved:** Creates instant visual identification — "this color = AI." Separates the app chrome (gold) from the intelligent layer (cerulean). Deep enough to survive any background photograph.

### Semantic Colors (Supporting Cast — Rich)

These colors have confidence but never compete with gold for attention.

| Role | Color | Usage |
|------|-------|-------|
| **Success/complete** | Teal `#48BBA0` | Completion checkmarks, "done" states, success feedback |
| **Error/danger** | Warm red `#E6554B` | Overdue badges, error messages, destructive action confirms |
| **Warning** | Amber (lighter gold) | Approaching deadlines, caution states |
| **Calendar accents** | Teal, violet `#AA6ED2`, coral, blue | Event color coding (each at /20 bg, /50 border) |

### Text Opacity Scale (Unchanged)

| Opacity | Role |
|---------|------|
| `text-white` | Primary headings, active nav |
| `text-white/90` | Emphasized body |
| `text-white/80` | Standard body |
| `text-white/60` | Secondary text |
| `text-white/50` | Inactive interactive |
| `text-white/40` | Tertiary/muted (section labels, timestamps) |
| `text-white/30` | Placeholder |
| `text-white/20` | Ghost (decorative only) |

### Surface System (Unchanged, with noted improvement)

Glass morphism surfaces remain. **Known issue:** glass is too transparent on bright backgrounds (ocean, sky). Future fix: bump `bg-black` opacity on cards (probably `/30` → `/40` or `/50`), possibly add a subtle vignette/scrim layer. Address during implementation, not in this spec.

---

## 3. Typography

### Font Stack

**Single typeface: Switzer** (by Jérémie Hornus)

A neo-grotesque sans-serif with subtle humanist warmth. Shares Inter's readability DNA (tall x-height, open apertures, screen-optimized) but with more personality — tighter spacing, more angular character. The closest free alternative to Söhne (Linear's font).

Weights loaded: 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold), 400 Italic.

**No monospace in the UI.** Section labels, timestamps, and all text use Switzer. The only exception is actual code display (if ever needed). The monospace section label pattern is retired — it read too "developer tool" for the editorial direction.

### Type Scale

| Element | Classes |
|---------|---------|
| Page/detail title | `text-2xl font-semibold text-white` |
| Card title | `text-xl font-bold text-white` or `text-base font-semibold` |
| Body | `text-sm text-white/80` |
| Section header | `text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40` |
| Badge text | `text-xs font-medium` or `text-[10px] font-bold` |
| Metadata | `text-xs text-white/40` |
| Brett's Take quote | `text-sm italic text-[#4682C3]/85` (Switzer italic) |

### Type Rules

- **No `text-lg`** — jump from `text-base` to `text-xl`. Forces clear hierarchy decisions.
- **No `font-light`** — minimum weight is `font-normal` (400).
- **No monospace** — unless displaying actual code.
- Section headers use Switzer uppercase with wide letter-spacing (`tracking-[0.15em]`), not monospace.
- Font loaded as web font bundled in Electron (no CDN dependency).

---

## 4. Iconography

### Library: Lucide (No Change)

Lucide remains the icon library. It has the largest usable catalog, consistent drawing style, and is already integrated.

- Default size: 16-18px for nav, 14-16px for inline, 12px for metadata
- Color follows text opacity scale
- Semantic mappings unchanged: `Zap` = tasks, `BookOpen` = content, `Bot` = AI, `Sparkles` = empty/new

---

## 5. Animation & Motion

### Engine

**Framer-motion adopted** as the primary animation engine. CSS transitions remain for hovers and simple color changes (no re-render overhead needed).

Framer-motion enables: exit animations (`AnimatePresence`), layout reflow (`layout` prop), staggered children, and gesture interactions — all critical for the "ambient alive" feel.

### Task Completion (Things 3 Pattern)

The completion interaction must feel satisfying while never blocking rapid task clearing.

1. **Click complete** — checkbox animates immediately with gold pulse (instant feedback)
2. **Row stays in place** — click targets don't move. User can keep completing other tasks.
3. **Debounced batch exit** (~800ms-1s after last completion) — all completed tasks swoosh out together
4. **Remaining tasks reflow** — `layout` prop animates remaining cards into new positions smoothly

- Completion pulse: **gold** (not green) — brand color
- Total animation duration: under 400ms per item
- Never blocks the next click

### List Entrances (Staggered Reveal)

- **Stagger:** 30ms delay between cards
- **Each card:** fade in + translateY(8px), 300ms, ease-out
- **When:** Initial load and view switches only — not on scroll reveal
- Subtle wave effect, not a performance

### Panel Transitions

- **DetailPanel enter:** Slide from right + scale(0.98→1) + fade, 250ms, spring with low bounce
- **DetailPanel exit:** `AnimatePresence` reverse — no more manual timeout chains
- **Backdrop:** `bg-black/20` fades in behind panel
- **Spotlight/⌘K:** Scale from 0.95 + fade, 200ms

### View Transitions

When switching between sibling views (Today, Inbox, Upcoming, custom lists):

- `AnimatePresence` with `mode="wait"`
- Old view: fade out + translateY(-4px), 150ms
- New view: fade in + staggered cards + translateY(6px), 300ms
- Total transition under 350ms
- **No horizontal slide** — sibling views, not hierarchical navigation

### Hover States (CSS Only)

- **Cards:** `translateY(-1px)` + subtle shadow increase, 150ms
- **Buttons/actions:** Color shift only, no lift
- **Nav items:** `bg-white/10` fade in, no lift
- All CSS transitions — framer-motion is overkill for hovers

### Ambient Motion (Background Texture)

Non-blocking, barely perceptible motion that makes the UI feel alive:

- **Background image transitions:** Cross-fade over ~1.5s when changing (time of day, manual switch)
- **Omnibar gold glow:** Subtle box-shadow warmth shift by time of day — crisper morning, softer evening. CSS custom property driven.
- **Streaming cursor (Brett thinking):** Organic, slightly irregular pulse rhythm — alive, not mechanical
- **Brett's indicator:** TBD — future decision

### Easing Curves (Updated)

| Curve | Use |
|-------|-----|
| Framer-motion spring (stiffness: 300, damping: 30) | Panel entrances, layout reflow |
| `cubic-bezier(0.16, 1, 0.3, 1)` | Section enters, toggles (existing, keep) |
| `ease-out` | Fade-ins, staggered children |
| `ease-in-out` | Hover transitions (CSS) |

### Duration Scale (Unchanged)

| Duration | Use |
|----------|-----|
| 150ms | Micro-interactions (hover color shifts) |
| 200ms | Spotlight/overlay entrances |
| 250ms | Panel slides |
| 300ms | List card entrances, layout shifts |
| 400ms | Completion check animation |
| ~1500ms | Background cross-fade |

---

## 6. Anti-Patterns (Updated)

1. **Solid opaque backgrounds** — always use transparency + blur
2. **`text-gray-*` colors** — use `text-white/{opacity}` exclusively
3. **Blue-500 as brand/primary** — gold is the brand, cerulean is Brett-only
4. **Monospace in UI text** — Switzer for everything, no `font-mono`
5. **Green for completion** — gold pulse, teal checkmark
6. **Mechanical animation rhythms** — organic, slightly irregular for ambient motion
7. **Blocking animations** — never delay the next user action
8. **Personality that demands acknowledgment** — ambient only, never modal
9. **`text-lg`** — jump from `text-base` to `text-xl`
10. **`font-light`** — minimum weight is `font-normal`
11. **CSS keyframes for complex sequences** — use framer-motion for exits, layout, stagger
12. **Horizontal slide for sibling view transitions** — vertical fade only

---

## 7. Migration Notes

### Breaking Changes from Current Design Guide

| Area | Old | New |
|------|-----|-----|
| Brand color | `blue-500` | Electric Gold `#E8B931` |
| Brett AI color | `blue-400/500` | Deep Cerulean `#4682C3` (reserved) |
| Success/completion | `green-500` | Teal `#48BBA0` (check), Gold (pulse) |
| Body font | System sans (font-sans) | Switzer |
| Section labels | `font-mono text-xs uppercase tracking-wider` | Switzer `text-[10px] uppercase tracking-[0.15em] font-semibold` |
| Animation engine | CSS keyframes only | Framer-motion + CSS for hovers |
| Completion animation | Green box-shadow pulse | Gold pulse + debounced batch exit |
| Reference triangle | Apple Weather > Linear > Arc | Apple Weather > Editorial Print > Things 3 |
| Streaming cursor | `bg-amber-400` | Keep amber, make pulse organic |
| Toast notifications | "never use toasts" | Unchanged — still no toasts |
| Logo/app icon | Blue square with white "B" | Gold stacked brief on navy-black `#0C0F15` |
| Brett's mark | `Bot` icon in blue | Gold dot + solid cerulean line (single bullet) |
| Favicon | Blue "B" lettermark | Gold stacked brief SVG |

---

## 8. Logo & Brand Marks

### Two-Mark System

**Product Mark (Gold Stacked Brief):** Three dot+line bullet items with cascade fade (100% → 60% → 30%). All gold `#E8B931` on navy-black `#0C0F15`. Represents the product — "your day, distilled."

**Brett's Mark (Gold Dot + Cerulean Line):** Single dot+line. Gold dot `#E8B931`, solid cerulean line `#4682C3` at 70% opacity. Represents the AI assistant. The single bullet is extracted from the product mark — same visual language, different role.

### Wordmark

Dynamic — renders the user's chosen assistant name in Switzer SemiBold. Default is "Brett" but users can rename. Never hardcode the name.

### Icon States

- **App icon / Dock / Favicon (default):** Product mark, static
- **Favicon (Brett active):** Swaps to Brett's mark, tab title changes to "[Name] is thinking..."
- **Tray idle:** Product mark, monochrome template (auto dark/light on macOS)
- **Tray working:** Brett's mark in full color, gentle pulse via `Tray.setImage()`
- **Tray notification:** Product mark + gold badge dot overlay
- **Splash screen:** Product mark, lines stagger in one by one (30ms delay)

### Asset Location

All source SVGs and generated PNGs in `apps/desktop/resources/`. ICNS in `apps/desktop/build/`. Favicons in `apps/desktop/public/`.
