# Naked-row list density — design

**Date:** 2026-05-16
**Status:** Approved direction, awaiting written-spec review
**Scope:** Desktop (ThingCard, InboxItemRow) + iOS (TaskRow). Today, Inbox, Upcoming, and custom lists.

## Goal

Increase information density across every list view. Drop the per-row card chrome (background, border, rounded corners) in favor of "naked" rows where text is primary and the type icon acts as both kind-marker and tap-to-complete affordance. Same item count, less visual weight, ~30–40% more rows per viewport.

## Non-goals

- Section headers ("Today · 5") stay as they are — same hairline rule, same padding, same count chip.
- No change to the items model, the toggle/complete mutation path, drag-and-drop wiring, or keyboard nav.
- No change to detail-panel behavior (clicking the row still opens it).
- No change to UpcomingView's chrome beyond what flows from ThingCard.
- Reconnect/install pills, stale dot, provenance, source pill, list tag, multi-select selection circle — all behaviors stay; only their surrounding row chrome changes.

## The pattern (visual contract)

A row is three zones, left to right:

1. **Leading glyph (16–22pt hit area, 12–13pt visible glyph)** — type icon by default. On desktop hover, the icon swaps to a 14pt hollow ring; clicking the ring completes the item. On iOS, the bare glyph IS the toggle (tap target preserved via `contentShape`).
2. **Title + inline provenance** — title at 13.5pt (desktop) / 15pt (iOS), font-weight 400 (desktop) / .medium (iOS), color `white/94` for active, `white/35` strikethrough for completed. Provenance whisper ("from Lena's standup", "Reading") in 11pt `white/40` follows on the same line, separated by a `·`.
3. **Trailing meta** — due-date label, list tag, source pill, stale dot. Same content as today, smaller padding, no background pills for the date itself (color encodes urgency; chip background removed).

Idle rows have no background, no border, no rounded corners. Hover gets `bg-white/[0.04]` and reveals the completion ring in the leading slot (desktop only). Focused (keyboard) rows get `bg-white/10` — same as today. Completed rows render at full opacity but with the title struck through and the icon dimmed (`white/30`); they don't fade the whole row.

A 1px hairline divider (`white/[0.04]`) separates adjacent rows. The first and last rows in a section have no divider on their outer edge.

## Why this works

- Brett's existing toggle pattern already swaps the type icon for a check overlay on hover (see `ThingCard.tsx:148–158`). We're removing the orb chrome around that interaction, not inventing a new one. Users don't need to relearn anything.
- The type icon is doing two jobs (kind marker + toggle) instead of one, and the row gives it back the space the orb used. Density improves without losing function.
- Color carries urgency. Today is gold, overdue is red, future is muted. Pill backgrounds aren't doing useful work — color alone is enough at this density.
- iOS gets the same simplification: TaskRow's `typeIconCircle` (gold-tinted glass, 30pt) becomes a bare 15pt glyph. The v18 "calm-hero" mockup pushed the typeIconCircle direction; this spec intentionally departs from it for density.

## Desktop changes

### `packages/ui/src/ThingCard.tsx`

**Container** — replace the current card chrome:

| | Before | After |
|---|---|---|
| Padding | `px-3 py-1.5` | `px-2 py-1` |
| Background (idle) | `bg-white/5` | `transparent` |
| Background (hover) | `bg-white/10` | `bg-white/[0.04]` |
| Border (idle) | `border border-white/5` | `border-b border-white/[0.04]` (hairline between rows) |
| Border (hover) | `border-white/10` | none |
| Border-radius | `rounded-lg` | `rounded-md` (only when hover bg is applied, for a soft pill effect — kept tight at 6px) |
| Hover lift | `-translate-y-[1px] hover:shadow-lg` | removed |
| Min height | ~44px effective | 30px |

Focused state (`bg-white/10` + `border-brett-gold/30`) stays — keyboard nav still needs the strong cue.

**Leading glyph** — replace the 32×32 orb:

- Remove the outer `<button>` wrapper's `w-8 h-8 rounded-full bg-black/20 border` chrome. The glass-sheen `<span>` goes with it.
- Render a 16×16 hit container (`w-4 h-4 inline-flex items-center justify-center flex-shrink-0`). Inside it, the existing type icon at `size={13}` (down from 16).
- On row-hover, the type icon hides and a 14×14 hollow ring (`border-[1.2px] border-white/40 rounded-full`) replaces it. The ring's own hover state fills to teal (`border-brett-teal bg-brett-teal/15`). Clicking the ring triggers the existing toggle flow — same `handleToggleClick` handler, same 500ms `togglePulse`, same completion animation. The pulse animation re-targets the 14×14 ring instead of the 32×32 orb (re-tune scale so the pulse stays visible).
- Completed rows: type icon stays visible at `text-white/30` (no ring, no swap). Clicking it un-completes (existing behavior — wire to the existing `RotateCcw` path).
- Completing state (the 500ms intermediate before mutation fires): show the existing `Check` icon at `size={14}` in `text-brett-teal` with the `checkPop` animation. No orb background — the check stands on its own.

**Title** — change size from `text-sm` (14px) to `text-[13.5px]` and weight from `font-light` (300) to `font-normal` (400). Light at the smaller size without a card background reads anemic against the wallpaper; bumping the weight compensates. Color stays `text-white` active, `line-through text-white/40` completed.

**Trailing meta** — remove pill backgrounds for due-date labels:

- `dueDateLabel` renders as a plain `<span>` at `text-xs font-medium` with color-only urgency: `text-brett-gold` for today, `text-brett-red` for overdue, `text-white/45` otherwise. No padding, no border, no rounded chip.
- `thing.list` tag stays at `text-xs text-white/50` but loses any background it might pick up (it doesn't have one today; this is forward-compat).
- Reconnect/install pills retain their current pill chrome — they're calls-to-action that need to stand out. They keep `bg-brett-gold/15 text-brett-gold rounded-full`.
- The empty-state `<Calendar>` placeholder shown on hover when there's no due date can be dropped — at this density it's noise.
- The stale dot stays at 1.5×1.5 amber.

**Provenance subtitle** — currently rendered as a second line below the title (mt-0.5, 10px). At the new density, move it inline with the title in a smaller weight: `text-white/40 text-[11px] ml-2`. Truncate cleanly behind the title at narrow widths. (Note: the InboxView already has wide rows; provenance fits inline easily there. ThingsList inside Today's left column is narrower — at the narrowest breakpoint, fall back to the existing second-line treatment via `@container` query if needed. If we can't get the container query landed cleanly in this PR, keep provenance inline at all widths and accept early truncation. We can revisit.)

### `packages/ui/src/InboxItemRow.tsx`

Mirror every ThingCard change above, with one Inbox-specific addition:

- **Multi-select mode** — the row gets selected when `selectedIds` includes its id. Selection still renders `bg-white/10`. The leading glyph in select mode shows a small filled circle in `brett-gold` (matching iOS's `selectionCircleGlyph` pattern) instead of the type icon. Existing shift-click + drag-multi-select behavior unchanged.
- **Source pill** (Granola, Brett, etc.) — stays at `text-[11px] text-white/40 px-1.5 py-0.5 rounded bg-white/5`. It's small enough to coexist with the naked row.
- **Relative age** stays at `text-xs text-white/40 tabular-nums` on the right.

### `apps/desktop/src/views/UpcomingView.tsx`

Renders `ThingCard` directly, so it inherits all changes for free. Manually verify the per-day section spacing still feels right with denser rows — if sections sit too close together, bump the inter-section padding by 4–8px.

### Drag-and-drop visual

`useDraggable`'s `isDragging` opacity-50 stays. The drag-preview will look thinner without the card background; that's the right read — it shows "this is just a row, not a tile."

## iOS changes

### `apps/ios/Brett/Views/Shared/TaskRow.swift`

**Leading glyph** — remove `typeIconCircle`:

- Replace the 30×30 ZStack (`Circle().fill(BrettColors.gold.opacity(0.18))` + `strokeBorder(BrettColors.gold.opacity(0.40))` + inset highlight) with a bare 20×20 frame holding the same SF Symbol at `.system(size: 15, weight: .semibold)` tinted `BrettColors.gold` (full saturation, not the cream-on-glass color). `contentShape(Rectangle())` on a 30×30 frame keeps the tap target HIG-safe.
- `selectionCircleGlyph` (Inbox multi-select) keeps its existing chrome — it's already minimal and reads correctly without an orb.
- Completed state: bolt/document glyph stays put, tinted `BrettColors.gold.opacity(0.30)` — same dim-but-present treatment as desktop.

**Row container** — tighten padding:

- `padding(.horizontal, 14)` → `padding(.horizontal, 12)`
- `padding(.vertical, 12)` → `padding(.vertical, 8)`
- Net row height drops from ~54pt to ~40pt.

**Title + meta** — no change. The font (15pt medium) was deliberately bumped from a 13pt mockup spec for device readability; that decision stays. The meta whisper (time, list, domain) keeps the existing `·`-separated treatment.

**Container chrome** — TaskRow itself doesn't paint a card background today; the container chrome lives in `TaskSection`, `ListView.stickyHeaderContent`, etc. Verify the parent containers still look right with the new shorter rows — specifically:

- `TaskSection.swift` (Today)
- `InboxPage.swift` (Inbox card)
- `ListView.swift` (custom lists)

If the parent card looks too tall now that each row is 14pt shorter, reduce the parent's vertical padding by the same delta. No changes to header treatment per the user's call.

**Swipe actions, drag-to-reorder, accessibility identifiers, gold pulse, schedule sheet** — all unchanged.

### iOS regression watch

The `project_ios_simplification.md` memory flags load-bearing patterns in TaskRow (`@Query+userId-init-subview`, `MutationCompactor.compactAndApply`, the gesture flag plumbing). None of those are affected by chrome-only changes here, but the spec calls out that they must not regress.

## Edge cases

| Case | Behavior |
|---|---|
| Stale-flag amber dot | Renders inline between title and meta, 5×5px, `bg-amber-500/60`. Same as today. |
| Reconnect pill (broken integration) | Keeps gold pill chrome — it's a CTA. |
| Install-update pill (system update item) | Keeps gold pill chrome — also a CTA. |
| Multi-select highlighted row (Inbox) | Bg = `bg-white/10`, leading glyph = gold filled circle. |
| Drag preview | `opacity-30` on drag, no card to "lift" — matches the naked-row mental model. |
| Focused (keyboard nav) row | `bg-white/10`, `border-brett-gold/30` strong outline. Already in place; only the idle state changes. |
| Completed row clicked again | Type icon stays visible; clicking it un-completes (existing RotateCcw flow). |
| Completing (500ms before mutation fires) | Teal check glyph appears in the leading slot, no orb. `checkPop` animation re-tuned for the smaller target. |
| Empty list | No change — empty-state copy lives at the section level, not the row. |
| Provenance overflow at narrow width | Inline `· from <source>` truncates with `text-overflow: ellipsis`. If the title alone overflows, the title truncates first. |

## Risks

- **Discoverability of the toggle-on-hover ring.** Mitigation: the type icon's role as "tap to complete" is already the current behavior, so users with muscle memory don't have to re-learn. New users will discover the ring within a few hover-interactions; the column-wide highlight on hover makes the row feel actionable.
- **Touch users on a touchscreen Windows desktop (rare).** No hover → no ring reveal → only the visible type icon to tap. The type icon IS the tap target on iOS for exactly this reason; replicating that on desktop is fine. Tap on the icon completes, tap on the row body opens detail. Acceptable.
- **iOS parity drift from the v18 "calm-hero" direction.** This spec intentionally simplifies away the gold-tinted typeIconCircle. If the user wants the calm-hero chrome back later, the change is local to TaskRow and easy to revert.
- **Read across many surfaces.** Today section, Inbox, custom lists, Upcoming, Briefing's "Next Up" card. The last two also use ThingCard — they get the change for free, but their parent containers (Briefing's NextUpCard, UpcomingView's day sections) should be eyeballed for visual regressions. Listed in the test plan.
- **Density at the wrong wallpaper.** The `project_background_readability.md` memory flags that glass over a bright wallpaper is already a known weakness. Naked rows over a bright wallpaper will be even more dependent on title-color contrast. Out of scope for this spec, but worth noting — the existing fix (opacity bump + vignette scrim) becomes more pressing.

## Test plan

**Manual:**

1. Today view (desktop): scroll through a day with overdue, today, future, completed items. Confirm density jump, hover reveal, drag, keyboard nav (`j`/`k`), and complete/un-complete cycle.
2. Inbox view (desktop): same checks, plus multi-select + drag-multi.
3. Custom list (desktop): same as Today.
4. Upcoming view (desktop): per-day sections still visually grouped.
5. Briefing's NextUpCard (desktop): uses ThingCard — verify it still looks right embedded in the briefing card.
6. iOS Today: rows are denser; tap the bolt glyph to complete (haptic + gold pulse), tap the body to open. Swipe-leading to schedule, swipe-trailing to delete/archive.
7. iOS Inbox: same, plus multi-select.
8. iOS custom list: same.

**Automated:**

- Existing XCUITest `task.row.*` identifiers MUST still resolve. The accessibility ID generation is independent of chrome, so this should be free, but verify.
- `pnpm typecheck` clean.
- No new lint warnings.

## Out of scope (deliberately)

- Section header treatment (kept as-is, per user).
- Empty-state copy.
- The detail panel.
- Briefing chrome (the briefing card itself, not its embedded ThingCards).
- Background readability work — separate spec.

## Files changing

- `packages/ui/src/ThingCard.tsx` — primary row component for Today, Upcoming, custom lists, Briefing.
- `packages/ui/src/InboxItemRow.tsx` — Inbox row, mirror changes.
- `apps/ios/Brett/Views/Shared/TaskRow.swift` — iOS row for all list views.
- Possibly minor padding tweaks in `apps/ios/Brett/Views/Today/TaskSection.swift`, `apps/ios/Brett/Views/Inbox/InboxPage.swift`, `apps/ios/Brett/Views/List/ListView.swift` if shorter rows make parent containers feel hollow.
- Possibly `apps/desktop/src/views/UpcomingView.tsx` for per-day inter-section spacing.
