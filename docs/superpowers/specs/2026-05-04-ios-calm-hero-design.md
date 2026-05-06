# Brett iOS — Calm-Inspired Editorial Today (UX Spec)

**Date:** 2026-05-04
**Status:** Design approved (v18 mockup)
**Builds on:** [`2026-04-08-native-ios-redesign.md`](2026-04-08-native-ios-redesign.md) — supersedes the "spatial model" and "header" sections, refines the philosophy.
**Mockup of record:** `.superpowers/brainstorm/14313-1777843924/content/calm-hero-v18.html`
**Scope:** UX changes to Today, Inbox, Calendar, Lists, Scouts, omnibar, and bottom chrome on iOS. No backend, sync, or data-model changes.

---

## Why this exists

The current iOS Today screen layers atmospheric photography under glass cards. On mobile the photos read as noisy texture rather than atmosphere — chrome takes over the canvas, negative space disappears, and the photo's mood is lost. This spec defines a Calm-inspired editorial treatment where the hero IS the brief, the photo only lives on Today, and chrome adapts to where you are on the page.

The aim is awards-quality editorial polish without giving up any existing function.

---

## Design principles

1. **Hero is the brand.** The top of Today is a photo + serif greeting + briefing — no cards, no chrome, just atmosphere and copy. Everything below is utilitarian.
2. **Photo only on Today.** Inbox, Calendar, Lists, and Scouts use a solid wash sampled from today's photo. The photo is a privilege of the home screen; other pages stay calm.
3. **Adaptive chrome.** The omnibar is always available. Section navigation (the view-pills row) fades in as you scroll past the hero — at the top, it's invisible; in the work zone, it's present.
4. **All gold, cerulean reserved.** All user content uses gold accents (icons, checkmarks, focus). Cerulean is reserved for Brett-generated surfaces (briefing, take, AI cards). This is a tightening of the existing rule — no cerulean on type icons.
5. **One input.** The omnibar captures, navigates, and talks to Brett. No `+` button. No separate chat pill. The placeholder text shifts per view to communicate context.
6. **Preserve every load-bearing behavior.** Sticky/collapse subsections, pull-to-refresh, task detail sheet, lists progress dot, swipe-between-pages — all already exist and must continue working.

---

## Spatial model

### Pages and order

Four pages, horizontal swipe via the existing `TabView(selection:).tabViewStyle(.page)` in [MainContainer.swift:88](apps/ios/Brett/Views/MainContainer.swift:88). **Order is unchanged from current code:** `0=Lists, 1=Inbox, 2=Today (default launch), 3=Calendar`. The mockup shows Today/Inbox/Calendar/Lists left-to-right for editorial readability, but implementation keeps the existing index order so swipe muscle memory and analytics aren't disturbed.

The view-pills row at the bottom **mirrors the swipe order, left to right: Lists · Inbox · Today · Calendar**, with the gold "B" menu chip at the right end. The active pill is gold; inactive pills are white at 0.45. (The mockup's pill order — Today/Inbox/Calendar/Lists — was wrong for this reason and should be reordered in implementation.)

### Drill-ins

Unchanged. Settings, Scouts roster, list detail all push via the existing `NavigationStack(path:)`. Task detail still opens via `NavStore.shared.go(to: .taskDetail(id:))` → `.sheet(item:)` at the MainContainer level ([MainContainer.swift:28](apps/ios/Brett/Views/MainContainer.swift:28)). **Tapping a task row opens the existing task detail sheet — no change to that surface in this spec.**

### Top of screen

Empty save the iOS status bar. No top nav, no profile chip, no scouts chip, no settings gear. All of those move into the bottom "B" menu (see Bottom chrome).

---

## Today: the Calm hero

### Hero (top ~250pt)

- **Photo:** today's atmospheric photo from the existing background manifest, anchored to the top, scaled to fit the hero zone. No glass, no scrim above the brief.
- **Greeting:** 38pt serif (New York), e.g. "Tuesday morning". Date sub-line below in 13pt sans, white at 0.7.
- **Brief:** 17pt sans, full white, layered text-shadow (tight 1px outline + soft 8px halo) for legibility on any photo. 2–3 sentences, Calm voice — observation + recommendation, not a status report.
- **Padding:** top respects the safe-area inset (Dynamic Island, notch, no-notch all handled by `.safeAreaInset`/safe-area APIs — never hardcode 60pt), 24pt sides, 24pt bottom. No fixed gap to the next section — the hero ends and the work begins.

### Photo → solid wash transition

As the user scrolls past the hero:
- The photo crops/fades over ~140pt of scroll.
- Below the fade, the page background is a solid color (the "wash") that's intended to be sampled from a 50–65% vertical band of the photo. This solid wash is the bed for all sections below.
- The transition is one continuous gradient mask, not a hard line.

The same wash color is used as the **full-page background on Inbox, Calendar, Lists, and Scouts** — those pages never show the photo. This unifies the palette across the app while keeping Today distinct.

**Implementation honesty (v1):** real per-photo color sampling on iOS requires async UIImage download → CGImage average-color → published value, plus caching keyed by the BackgroundService's `displayedKey`. For v1 we ship with a **fixed neutral warm-dark wash** (~`#1A1612` / a "burnt umber" tone) that complements every photo in the manifest. Per-photo sampling is a follow-up — flagged below. The architecture (single source on `BackgroundService`, single `WashBackground` consumer view) is designed so swapping the constant for a sampled value is a one-line change.

### Sections (preserve sticky/collapse)

The existing `StickyCardSection` ([apps/ios/Brett/Views/Shared/StickyCardSection.swift:74](apps/ios/Brett/Views/Shared/StickyCardSection.swift:74)) and `TaskSection` ([TaskSection.swift:3](apps/ios/Brett/Views/Today/TaskSection.swift:3)) behavior is preserved verbatim:

> When a subsection header reaches the top of the viewport it pins. Items in that section continue scrolling and clip at the header's base. When the section is exhausted, the header fades out (over the existing 24pt `fadeDistance`) and the next section's header pins in its place.

This is non-negotiable — it's the load-bearing scroll mechanic of Today and we spent significant time getting it right. The hero scroll behavior layers on top of this; it does not replace it.

Section order on Today (matches existing `taskSections` in [TodayPage.swift:273](apps/ios/Brett/Views/Today/TodayPage.swift:273)):
1. **Overdue** — header in white at 0.55. Items show their original day in red ("Friday", "Wednesday"). No "X days overdue" subtext (the section title is enough).
2. **Today** — header in white at 0.55.
3. **This Week** — header in white at 0.55. Content items (newsletters, articles, podcasts) cluster here by default.
4. **Next Week** — header in white at 0.55. Already exists in code; keeping for parity with the bucketing logic in `TodaySections`.
5. **Done Today** — header de-emphasized (smaller, white at 0.30). Completed items move into this section. Empty if nothing done today.

**Hero ↔ sticky interaction:** the hero is part of the same ScrollView as the sections, so the hero scrolls UP and OFF as the user scrolls. It is NOT pinned. Section headers continue to pin at the top of the viewport per the existing StickyCardSection mechanics — the hero just scrolls past them. The first section header pins under the status-bar safe area inset, not under the (already-scrolled-away) hero.

**NextUpCard placement:** the existing `NextUpCard` (the "in 12 min: Standup" event ticker) renders just below the hero, above the Overdue section. It's a thin glass pill that earns its place when there's an imminent meeting; out of view otherwise.

### Empty state (Today)

When there is nothing — no overdue, no today, no this week, no done today — **subsection headers do not render**. Instead, design a single editorial empty state under the hero:

- Centered, generous vertical padding (~40% of remaining viewport).
- 17pt serif line ("Nothing on the books.") + 14pt sans sub-line ("Capture something with the omnibar below.")
- White at 0.6 / 0.4 respectively. No illustration, no icon. The hero photo + brief stays visible above.

The same rule applies to every page: **if a subsection has zero items, that subsection's header is not rendered.** Empty pages get an editorial empty state (see per-page sections below).

---

## Headers (parity across pages)

**All four pages use the same editorial header treatment as Today's mockup.** The mockup got this wrong by shrinking Inbox / Calendar / Lists headers; the spec calls for parity with Today.

Treatment:
- **Title:** 38pt serif (New York), white. On Today the title sits over the photo with the same layered text-shadow as the brief; on the other pages it sits on the solid wash with no shadow.
- **Sub-line:** 13pt sans, white at 0.7, immediately below the title.
- **Position:** leading-aligned, 24pt horizontal padding, 60pt top (clears status bar) on each page.

This **replaces the existing `BrettTypography.dateHeader` (28pt bold)** for these top-level pages. The smaller `dateHeader` style remains in use for nested surfaces (e.g., a date label inside a calendar day cell), but page titles upgrade to the editorial 38pt serif. Existing call sites at [InboxPage.swift:229](apps/ios/Brett/Views/Inbox/InboxPage.swift:229), [CalendarPage.swift:193](apps/ios/Brett/Views/Calendar/CalendarPage.swift:193), and the Lists/Scouts equivalents update accordingly.

Per page:
- **Today:** title is the time-of-day greeting ("Tuesday morning"), sub "May 4". The greeting subsumes the date-header role — there is no separate 28pt header on Today, just the greeting + brief.
- **Inbox:** title "Inbox", sub "N to triage".
- **Calendar:** title is the selected date (e.g., "May 4"), sub "N events".
- **Lists:** title "Lists", sub "N lists".
- **Scouts** (drill-in from B menu): title "Scouts", sub "N active".

Section sub-headers *inside* a page (Overdue / Today / This week / Done today) stay smaller and lighter — they're already covered in the Today section above and not affected by this header upgrade.

---

## Adaptive chrome

### Omnibar (always on)

Always pinned to the bottom of the screen. Always interactive. No `+` button. Mic glyph in gold on the right.

The omnibar's surface adapts to scroll position:
- **Hero zone (top of Today):** glass background at 0.55 opacity. Quieter, lets the photo breathe.
- **Work zone (scrolled past hero, or any non-Today page):** glass background at 0.78 opacity. More substantial, easier to read against busy lists.

A `mask-image` fade is applied to the page content above the omnibar so list items fade out before they reach the omnibar's top edge — no hard clip, no bleed-through.

**Contextual placeholder per view:**
- Today: "What's on your mind?"
- Inbox: "Triage or ask…"
- Calendar: "Schedule or ask…"
- Lists: "Add to a list or ask…"
- Scouts: "Brief a scout or ask…"

The omnibar AI parses intent (task vs question vs command). **In the current iOS app the omnibar only adds tasks** ([reference](apps/ios/Brett/Views/MainContainer.swift)) — preserve that behavior for now and wire up the contextual placeholders. Full AI routing lands in a follow-up spec.

### View-pills row + B menu chip

Just above the omnibar, a row of four small pills (Today / Inbox / Calendar / Lists) with the gold "B" menu chip at the right end.

- **Adaptive opacity:** at the very top of Today the row is invisible (opacity 0). It fades in as the user scrolls past the hero (0 → 1 over the same ~140pt as the photo→solid transition). On other pages it's always at full opacity. **Implementation:** TodayPage publishes its scroll offset via a preference key; `MainContainer` reads it and drives the pills/omnibar opacity. On non-Today pages the published offset is treated as "past hero" (opacity = 1).
- **B chip:** gold disc with a stylized "B". Persistent across page swipes (lives in `MainContainer`'s bottom overlay alongside the omnibar, not per-page). Tap opens a bottom sheet sized to its content (custom small detent ~`.fraction(0.30)` — 4 short rows don't need a half-screen sheet) with:
  - **Profile** — `brent@brett.app`, push to existing profile screen.
  - **Scouts** — sub "N active", push to the redesigned Scouts roster.
  - **Notifications** — sub "Coming soon", disabled state for now.
  - **Settings** — push to existing settings.
- The B chip is the only path to Profile / Scouts / Settings from the home navigation. The top of every screen stays empty.

---

## Type icons

**Use the existing icons in the app.** The mockup's icons were placeholder-quality. The real implementation pulls from [TaskRow.swift:258-337](apps/ios/Brett/Views/Shared/TaskRow.swift:258) with two adjustments:

1. **All icons gold.** Currently content items use cerulean. Change content to use the same gold tint as tasks. Cerulean stays reserved for Brett-generated surfaces (briefing, take, AI cards) per the design guide.
2. **Done state: NO icon swap.** The current `completionGlyph` branch in [TaskRow.swift:294](apps/ios/Brett/Views/Shared/TaskRow.swift:294) replaces the type icon with a green checkmark on completion — remove this. The done state should be communicated by the existing title fade + strikethrough only ([TaskRow.swift:198-199](apps/ios/Brett/Views/Shared/TaskRow.swift:198)). The original task/content icon stays put when an item is checked off, just dimmed via the title's lower opacity. Less visual chatter, calmer aesthetic. (Update `leadingGlyph` to drop the `viewModel.isCompleted` branch entirely; selectMode + content + task branches remain.)

Otherwise the SF Symbol mapping is unchanged:
- Task: `bolt.fill`
- Content: `doc.text` (and the existing per-subtype variants for tweet/article/video/pdf/podcast/web_page/newsletter)
- Done: `checkmark` in green success circle
- Select mode: `checkmark` in gold/white circle

The 30pt tinted-glass-circle treatment is preserved.

---

## Lists

**Vertical scroll of lists.** Already implemented at [ListsPage.swift:188](apps/ios/Brett/Views/List/ListsPage.swift:188). No change to the layout — preserve the existing `ListProgressDot` ([ListsPage.swift:306](apps/ios/Brett/Views/List/ListsPage.swift:306)) icon completion logic verbatim:

- **Empty list:** solid color dot.
- **In-progress:** clockwise-filling progress ring in the list's color.
- **All complete:** filled circle in the list's color.

Cosmetic alignment: header to `BrettTypography.dateHeader` parity (above), background to the sampled solid wash, omnibar adaptive chrome on top.

### Empty state (Lists)

If the user has no lists at all (only the system Inbox / Today which aren't shown here): editorial empty state — "No lists yet." + "Create one with the omnibar." Same typography as Today's empty state.

---

## Inbox

Header parity (above). The existing `InboxPage` body is preserved (item rows, triage actions). Solid wash background. Adaptive chrome on top. **Pull-to-refresh:** Inbox does not currently have an explicit `.refreshable` — keep the existing TabView-lifecycle refresh behavior. If we add `.refreshable` later, that's a follow-up.

### Empty state (Inbox)

"Inbox is clear." + "Forward something to ingest@brett.app or use the omnibar." Editorial.

---

## Calendar

Header parity (above). The existing day timeline + week strip is preserved. Solid wash background. Adaptive chrome on top. Pull-to-refresh preserved at [CalendarPage.swift:169](apps/ios/Brett/Views/Calendar/CalendarPage.swift:169).

### Empty state (Calendar)

If no events on the selected day: "Nothing scheduled." + "Tap a date to browse." Editorial. (If accounts aren't connected at all, the existing connect-calendar prompt takes precedence — that's a different state, not the empty state covered here.)

---

## Scouts (redesign to match)

The Scouts roster ([ScoutsRosterView.swift](apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift)) gets the same editorial treatment:

- Header parity ("Scouts" + "N active"), positioned the same as the other pages.
- Solid wash background (sampled from today's photo).
- Sticky/collapse section behavior for the status filter (active / paused / archived) — same `StickyCardSection` mechanism as Today.
- Scout cards keep their existing layout but lose any cerulean tints in favor of gold (same rule).
- FAB ("+ create scout") is removed in favor of the omnibar — "Brief a scout or ask…" placeholder. The omnibar handles scout creation when the user is on the Scouts surface. (Until the omnibar AI routing ships, the FAB stays — flag this as a follow-up dependency.)
- Pull-to-refresh preserved ([ScoutsRosterView.swift:147](apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift:147)).
- Empty state: "No scouts yet." + "Brief one with the omnibar."

---

## Interactions to preserve

- **Pull-to-refresh** on Today, Calendar, Lists, Scouts — unchanged.
- **Task detail sheet** via `NavStore` — unchanged.
- **Horizontal swipe between pages** via `TabView` — unchanged.
- **Sticky/collapse subsections** — unchanged, this is the most important one.
- **Long-press / swipe actions on rows** — unchanged (out of scope, treated as existing).
- **Demo mode, share extension, sync, auth** — out of scope.

---

## Background system (existing — clarification)

The existing background manifest (6 time segments × 3 busyness tiers, ~36 photography images on iOS) feeds the photo. Today's photo is selected at app launch / on the existing rotation cadence.

**v1 ships with a fixed wash color** — a warm-dark neutral that complements every photo in the manifest. This avoids per-photo sampling in the first PR. The cold-launch reveal (Ken Burns scale + cover fade in [MainContainer.swift:121-122](apps/ios/Brett/Views/MainContainer.swift:121)) continues to work — the hero photo is just another renderer of `BackgroundService` and inherits the awakening behavior.

**v2: per-photo wash sampling.** Sample the average color of the 50–65% vertical band of each loaded photo (UIImage → CGContext draw → average → published `currentWashColor: Color?`), cached by `displayedKey`. Until the sample lands, the v1 fixed wash is the fallback. Alternative: pre-sample at manifest build time and ship colors in the manifest JSON — slightly simpler runtime, requires manifest tooling.

---

## Out of scope / follow-up design needed

These came up in brainstorming and are flagged here so they don't get lost:

- **Loading + error states** for every page (skeletons vs spinners vs serif placeholders).
- **Pull-to-refresh visual** — currently the system spinner. Could be a serif "Catching up…" treatment to match the editorial voice.
- **Long-press / context menus on rows** — design a sheet vs the iOS default.
- **Profile screen interior** — push from the B menu, currently the existing settings-flavored screen.
- **Notifications** — disabled in B menu now. When we build it, design the surface (in-app inbox? push permission flow?).
- **Chat history** — currently no surface. When omnibar AI routing ships, where do prior conversations live? In Today as a section? A separate destination from B?
- **Hero photo refresh** — should pull-to-refresh on Today rotate the photo? (Probably not — it's a sync action, not a vibe action. But worth confirming.)
- **Empty-state copy review** — the strings above are placeholders and need a copy pass.
- **Accessibility** — text-shadow on the brief needs contrast verification against every photo in the manifest. Reduce-transparency mode needs a fallback (probably solid wash everywhere, no photo).
- **Reduce-motion** — the photo→solid transition needs a reduce-motion fallback (probably a hard cut at scroll threshold).
- **Omnibar AI routing** — this spec assumes the omnibar will eventually parse intent. Until that ships, the omnibar only adds tasks (current behavior). The contextual placeholder text is cosmetic until then.

---

## Files this spec touches (anticipated)

For implementation planning. Not exhaustive.

- [apps/ios/Brett/Views/MainContainer.swift](apps/ios/Brett/Views/MainContainer.swift) — adaptive chrome, B menu chip, view-pills row.
- [apps/ios/Brett/Views/Today/TodayPage.swift](apps/ios/Brett/Views/Today/TodayPage.swift) — hero zone, photo→wash transition, empty state.
- [apps/ios/Brett/Views/Today/TaskSection.swift](apps/ios/Brett/Views/Today/TaskSection.swift) — section title styling tweaks; preserve mechanism.
- [apps/ios/Brett/Views/Shared/StickyCardSection.swift](apps/ios/Brett/Views/Shared/StickyCardSection.swift) — preserve verbatim; touch only if hero scroll integration requires it.
- [apps/ios/Brett/Views/Shared/TaskRow.swift](apps/ios/Brett/Views/Shared/TaskRow.swift) — change content icon tint from cerulean to gold.
- [apps/ios/Brett/Views/Inbox/InboxPage.swift](apps/ios/Brett/Views/Inbox/InboxPage.swift) — solid-wash background, empty state.
- [apps/ios/Brett/Views/Calendar/CalendarPage.swift](apps/ios/Brett/Views/Calendar/CalendarPage.swift) — solid-wash background, empty state.
- [apps/ios/Brett/Views/List/ListsPage.swift](apps/ios/Brett/Views/List/ListsPage.swift) — solid-wash background, header parity, empty state. Preserve `ListProgressDot`.
- [apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift](apps/ios/Brett/Views/Scouts/ScoutsRosterView.swift) — apply the same editorial UX, gold tint, sticky filter, empty state.
- New: omnibar contextual placeholder logic (location TBD in implementation plan).
- New: B menu sheet view.
- New: photo wash sampling (or build-time addition to the manifest).
