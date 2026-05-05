# Brett iOS — Design Guide

**Read this before any UI work on `apps/ios/`. Read [`docs/DESIGN_GUIDE.md`](../../docs/DESIGN_GUIDE.md) too — it's the cross-platform design system. This file captures the iOS-specific patterns that build on it.**

The two clients should look like the same product. The Mac and iPhone share the gold/cerulean palette, the Switzer/serif type, the glass-over-photography vibe. The iOS app diverges on layout — small screens demand more restraint, the bottom is the user's thumb's home, and editorial motion is more important than dense information.

---

## Identity

iOS-specific elaboration of the cross-platform identity:

> **One screen. One photo. One input.**

The home screen (Today) wears today's photo. Every other surface wears a wash sampled from it. The omnibar is the only persistent chrome — capture, navigate, eventually talk to Brett, all from one pill at the bottom. Top of screen stays editorially empty save the iOS status bar.

**iOS principles (in addition to the cross-platform six in [DESIGN_GUIDE.md](../../docs/DESIGN_GUIDE.md)):**

1. **Calm hero, working bed.** The top of Today is editorial — serif greeting + brief over the photo. Below it, the photo fades to a sampled solid wash that hosts the workday list.
2. **Photo only on Today.** Inbox / Calendar / Lists / Scouts / Settings all wear the same solid wash. The photo is a privilege of the home screen, not a noisy texture under every surface.
3. **Adaptive chrome.** The bottom view-pills row + omnibar fade in as the user scrolls past the hero. At the top of Today it's invisible; at the work zone it's substantive. The omnibar is always interactive even at low opacity.
4. **One menu chip.** Profile / Scouts / Notifications / Settings collapse into a single gold "B" chip at the bottom-right of the view-pills row. The top of the screen stays empty.

---

## Surface System

| Surface | Implementation | Use |
|---------|----------------|-----|
| **Hero** | `TodayHero` — photo + serif text, no chrome | Top of Today only |
| **Wash** | `WashBackground` reading `BackgroundService.currentWashColor` | Inbox, Calendar, Lists, Scouts, Settings, section bed below the Today hero |
| **Sticky card section** | `StickyCardSection` (Apple Weather pattern) | Today task sections, Scouts status filter |
| **Glass card** | `GlassCard` / `.thinMaterial` | Settings cards, NextUpCard |
| **Bottom chrome** | `ViewPillsBar` + `OmnibarView` in `MainContainer.overlay(alignment: .bottom)` | Persistent across all four pages |
| **Sheet** | `.sheet(item: $NavStore.currentDestination)` | Task detail, search, B menu, scout edit |

**Rules:**
- Cerulean (`BrettColors.cerulean`) is reserved for Brett-generated AI surfaces (briefing, take, AI cards). User content uses gold (`BrettColors.gold`). No exceptions — the cerulean signal is what tells the user "Brett did this."
- Glass cards in iOS use `.thinMaterial` or the custom two-zone material from `StickyCardSection`. Never stack two materials at the same opacity in a single card — the backdrop sample doubles up and reads brighter than intended.
- The wash is always opaque: it's the bed. Never put a glass card over a photo when on a non-Today page; stack it on the wash.

---

## Editorial Page Headers

All four primary pages and Scouts use the same editorial header treatment via `EditorialPageHeader`:

- **Title:** 38pt serif (New York / `design: .serif`), white. On the Today hero the title is a time-of-day greeting ("Tuesday morning") with layered text-shadow for legibility against any photo. On non-Today pages the title is the page name ("Inbox", "May 4", "Lists", "Scouts") with no shadow.
- **Sub-line:** 13pt sans, white at 0.7. Counts ("3 to triage", "2 events", "5 lists") or a date.
- **Position:** leading-aligned, 24pt horizontal padding, top respects the safe-area inset (never hardcode 60pt).

The legacy 28pt `BrettTypography.dateHeader` is **deprecated for top-level page titles**. It still applies to nested labels (e.g. a date inside a calendar day cell).

---

## Today's Hero

`TodayHero` in `Views/Today/TodayHero.swift`. Three text elements stacked:

1. **Greeting** — 38pt serif, "{Weekday} {part of day}" (morning / afternoon / evening / night, derived from `tickerNow`).
2. **Date sub-line** — 13pt sans, white at 0.7.
3. **Brief** — 17pt sans, full white. Pulled from `BriefingStore.briefing` (markdown), reduced to a single-paragraph plain summary via `TodayHero.stripMarkdownToPlain`. Hidden when `isDismissedToday`.

Below the hero, a 140pt `LinearGradient(.clear → washColor)` provides the photo→wash transition. Below that, the rest of Today's content (NextUpCard, task sections, empty state) sits on a `.background(washColor)`. The hero scrolls with the page; the photo behind it (rendered by the global `BackgroundView`) stays put, so as the user scrolls the wash content covers more of the photo.

**Don't add chrome to the hero.** No card, no border, no glass plate — that defeats the calm.

---

## Sticky / Collapse Sections

Today's task sections (Overdue / Today / This Week / Next Week / Done Today) and Scouts' status filter use the sticky-header pattern:

> When a section header reaches the top of the viewport it pins. Items in that section continue scrolling and clip at the header's base. When the section is exhausted, the header fades out (over a 24pt `fadeDistance`) and the next section's header pins in its place.

Implementation:
- **Today's sections:** custom `StickyCardSection` (`Views/Shared/StickyCardSection.swift`) — uses a `GeometryReader` + `.coordinateSpace(name: "scroll")` to track per-card travel and apply a body mask so the body's material doesn't render under the sticky header.
- **Scouts' filter:** SwiftUI's native `LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders])` — the native pattern is enough when the pinned thing has its own opaque chrome (segmented control + wash bg).

**Empty sections do not render their header.** `TaskSection` already handles this (`if !items.isEmpty`). Page-level empty states (no items at all) render as centered editorial copy on the wash, no glass card.

---

## Type Icons

`TaskRow.leadingGlyph` — 30pt glass-tinted circles:

| State | Glyph | Tint |
|-------|-------|------|
| Task | `bolt.fill` | Gold at 0.7 |
| Content | `doc.text` | Gold at 0.7 |
| Selected (multi-select) | `checkmark` | Gold |

**No completion-state icon swap.** Done items keep their original task/content glyph; the title fade + strikethrough does the work. Removing the green-checkmark variant was a deliberate calm-hero call.

---

## Adaptive Bottom Chrome

`ViewPillsBar` + `OmnibarView` live in `MainContainer.overlay(alignment: .bottom)` and stay there across page swipes. Two opacities, both driven by the same scroll-offset published from `TodayPage` via `HeroScrollOffsetKey`:

- **Pills + B chip:** `pillsVisibility` ramps 0 → 1 over 140pt of Today scroll. Always 1 on non-Today pages.
- **Omnibar bg:** `omnibarBackgroundOpacity` ramps 0.55 → 1.0 over the same range. Never below 0.55 — the input field needs *some* glass plate to read against.

Wrap any new scroll-driven animations in `BrettAnimation.respectingReduceMotion(...)`. Reduce-Motion users get instant snaps instead of the crossfade. SwiftUI Materials handle Reduce-Transparency on their own — don't double-up with manual fallbacks unless a material isn't carrying the surface.

---

## Wash Color

`BackgroundService.currentWashColor` is the single source of truth. Three sources resolve into it during `recompute()`:

| Background style | Wash source |
|------------------|-------------|
| User-picked solid (`solid:#RRGGBB`) | The solid color itself |
| Remote photo | `WashColorSampler.cachedWash(forURL:)` synchronously, then async sample writes through |
| Bundled fallback asset | `WashColorSampler.sampledWash(forAssetNamed:)` (synchronous) |

`WashColorSampler` averages the 50–65% vertical band of the image (CoreGraphics 1×1 down-sample), darkens by 15%, and persists results to `UserDefaults` under `background.washColors.v1`. Bounded by manifest size — under 1KB total.

When adding a new surface that wears the wash: read it through `WashBackground` (don't sample your own).

---

## Navigation

`NavDestination` (in `Views/MainContainer.swift`) is the single source of truth. Push-style cases drive `.navigationDestination(for:)`; sheet-style cases drive `.sheet(item:)`. Use `NavStore.shared.go(to: ...)` rather than appending to `path` directly — it routes to the right presenter via the `isSheet` property.

The B menu (`BMenuSheet`) routes through the unified sheet presenter as `.menu`. Top-bar nav (search/scouts/settings buttons) is gone — those destinations live behind the B chip.

---

## Multi-User Discipline

Every `@Query` that touches per-user data MUST capture `userId` in the predicate. The pattern across the codebase:

```swift
struct SomeView: View {
    @Environment(AuthManager.self) private var authManager
    var body: some View {
        if let userId = authManager.currentUser?.id {
            SomeViewBody(userId: userId).id(userId)
        } else { EmptyView() }
    }
}

private struct SomeViewBody: View {
    let userId: String
    @Query private var items: [Item]
    init(userId: String) {
        self.userId = userId
        let predicate = #Predicate<Item> { item in
            item.deletedAt == nil && item.userId == userId
        }
        _items = Query(filter: predicate, sort: \.createdAt)
    }
}
```

The `.id(userId)` on the body is load-bearing — it forces a fresh `@Query` instance on account switch. Without it, signing in as a second user shows the first user's stale predicate results.

---

## Animation

| Token | Use | Duration |
|-------|-----|----------|
| `.spring(response: 0.45, dampingFraction: 0.85)` | Row enter/exit, sticky reflows | — |
| `.spring(response: 0.32, dampingFraction: 0.85)` | Pill + tab selection | — |
| `.easeOut(duration: 0.20)` | Adaptive chrome opacity | 200ms |
| `.easeOut(duration: 0.15)` | Omnibar pulse, hover-equivalent | 150ms |
| `.easeInOut(duration: 1.5)` | Cross-fade between background photos | — |
| `.easeOut(duration: 2.5)` | Cold-launch Ken Burns (`Awakening.kenBurnsDuration`) | 2.5s |

Every motion that's tied to scroll position or that runs continuously must be wrapped in `BrettAnimation.respectingReduceMotion(...)`. Fades (opacity) without scroll coupling are usually safe under Reduce Motion.

---

## Accessibility Identifiers

Every interactive element that XCUITest needs to reach has a stable `accessibilityIdentifier`. The naming convention:

- `nav.{name}` for navigation surfaces (`nav.menu`, `nav.pill.today`)
- `menu.{name}` for B menu rows (`menu.profile`, `menu.scouts`, `menu.settings`)
- `omnibar.{role}` for omnibar elements (`omnibar.input`, `omnibar.send`)
- `task.row.{slug}` for task rows (slug-cased title)
- `detail.{field}` for task-detail sheet fields
- `settings.{action}` for Settings actions (`settings.signout`, `settings.signout.confirm`)

When adding a new interactive element that's part of a user flow, give it an identifier upfront. Tests are easier to write than retrofit.

---

## Don'ts

- Don't use cerulean for user content. Reserved for Brett AI surfaces.
- Don't put glass cards over the photo on non-Today pages. Wash first, then card.
- Don't hardcode 60pt for the safe-area inset. Use SwiftUI's safe-area APIs.
- Don't add a navigation gear at the top. Settings is in the B menu.
- Don't sample wash color in a view body. Read through `WashBackground` / `BackgroundService.currentWashColor`.
- Don't bypass `NavStore.go(to:)` to push destinations directly — route through the unified presenter.
- Don't write a `@Query` without a `userId` predicate when the model has user scope.
- Don't introduce a new typography size. Use the editorial header (38pt serif), the existing `BrettTypography` scale, or argue in the PR for why the existing scale doesn't fit.
- Don't ship animations without checking Reduce Motion behavior.

---

## When in doubt

Read the calm-hero spec at [`docs/superpowers/specs/2026-05-04-ios-calm-hero-design.md`](../../docs/superpowers/specs/2026-05-04-ios-calm-hero-design.md). If the spec doesn't cover a case, default to: **fewer surfaces, more typography, more wash, less chrome.** The iOS app should feel calmer than the Mac app, not denser.
