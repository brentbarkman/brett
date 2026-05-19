# Brett Tuning — May 2026

**Date:** 2026-05-18
**Status:** Design approved — ready for implementation planning
**Scope:** Five focused tweaks across Today view (desktop + iOS), MCP settings, and connection health UX.

## Summary

Five small but high-signal changes to make daily use feel calmer and more honest:

1. **Badge count narrows** to overdue + today + tonight (drops "this week").
2. **Collapsible "This Week" / "This Weekend" / "Done"** sections on Electron — default collapsed, count chip visible. iOS unchanged.
3. **New "Tonight" concept** — due-date shortcut, dedicated section, auto-expands at 6pm local.
4. **Fix:** second Granola MCP account not appearing in Settings list.
5. **Per-account connection health visibility** — show *which* account is broken and *why*, and stop letting one account's reconnect clear another account's issue.

Items 1–3 are evergreen Today-view polish. Items 4–5 are bugfixes/UX fills against the existing multi-granola + connection-health work.

Updates two prior specs:
- [`2026-04-24-today-count-badge-design.md`](2026-04-24-today-count-badge-design.md) — count definition narrows.
- [`2026-04-04-connection-health-ux-design.md`](2026-04-04-connection-health-ux-design.md) — extends per-account visibility into settings UI.

---

## 1. Badge count: overdue + today + tonight only

### Change

Drop "this week" from the count. New definition:

```
badgeCount = count(items where status != done AND (
  dueDate < startOfToday        -- overdue
  OR sameDay(dueDate, today)    -- today (includes tonight)
))
```

**Tonight always counts in the badge** regardless of clock time — it's still a today item, the evening tag only affects sectioning.

### Files affected

**Desktop** (`apps/desktop/src/App.tsx`):
- `activeThingsForCount` currently includes items where `dueDate ≤ endOfWeekUTC`. Narrow to `dueDate ≤ endOfTodayUTC`. The variable serves two callers: the in-app sidebar Today badge and the new dock badge. Both should now show the narrower count — the existing sidebar badge will go down for most users, which is the intended outcome.

**iOS** (`apps/ios/Brett/Views/Today/TodayPage.swift`):
- `TodaySections.badgeCount(items:)` currently returns `overdue.count + today.count + thisWeek.count`. Change to `overdue.count + today.count`. The `today` bucket already includes Tonight tasks (they have `dueDate = today`), so the badge picks them up automatically.

**Spec sync:** update `2026-04-24-today-count-badge-design.md` Count definition section to match.

### Risk

- Some users' badge count will drop noticeably. That's the goal. Not a regression.
- Make sure the sidebar Today nav count and the dock/app icon badge stay in lockstep — both read from the same `activeThingsForCount` source on desktop and the same `TodaySections.badgeCount` on iOS. Don't fork them.

---

## 2. Collapsible sections on Electron (Today view only)

### Change

In the Today view on desktop, the following sections become collapsible accordions:

- This Week — default **collapsed**
- This Weekend — default **collapsed**
- Done — default **collapsed**

Stay non-collapsible (always expanded):
- Overdue, Today, Tonight (when present)

Section header always shows:
- Section title
- Item count chip (regardless of expanded state)
- Disclosure chevron (rotates on expand)

### Persistence

Per-section expand state stored in `localStorage`, keyed `today.section.<name>.expanded`. Persists across reloads. Defaults to `false` (collapsed) if absent.

Why localStorage and not the DB: this is a UI affordance, not user data. No need to sync across devices, and the user will rarely tweak it.

### Scope

**Only the Today view** (`apps/desktop/src/pages/Today.tsx` / wherever `ThingsList`'s Today-mode lives). NOT applied to:
- Custom lists — they don't have sub-sections.
- Inbox — single bucket.
- Upcoming view — sectioning there is by week, not by urgency.

### iOS — skipped intentionally

iOS scrolls naturally, and the calm-hero pattern already prioritizes Today + Tonight at the top. Adding a tap-to-expand interaction on iOS would fight the existing sticky-header design. **Acceptable parity exception** per CLAUDE.md — the desktop user is staring at a fixed window and benefits from squeezing the view; the iOS user already gets the same visual hierarchy by virtue of scrolling.

If we later add iOS parity, it should reuse the same default-collapsed convention and likely use SwiftUI's `DisclosureGroup` within sections — but not now.

### Animation

Reuse whatever accordion / disclosure pattern is already in use in the app (likely Radix `Collapsible` via shadcn, given the stack). 200ms ease-out matches existing motion language.

---

## 3. Tonight

### Concept

"Tonight" is a due-date hint, not a separate due date. A Tonight task is a Today task with a flag saying *"don't surface me during the workday — surface me after 6pm."*

After today passes, an incomplete Tonight task becomes overdue like any other Today task. The `tonight` flag stays on the row as data but stops affecting UI.

### Data model

**Schema** (`apps/api/prisma/schema.prisma`):

```prisma
model Item {
  // ...existing fields...
  tonight Boolean @default(false)
}
```

Boolean flag rather than a `dueWindow` enum. We don't yet need "morning" / "afternoon" / "evening" — only the evening case is real. YAGNI.

**Migration:** additive non-null boolean with default false. Single statement, safe.

**Sync engine:**
- Add `tonight` to the iOS `Item` SwiftData model.
- Add `tonight` to the field-level merge map in `apps/api/src/services/sync.ts` (treat as standard scalar — last-write-wins via `previousValues`).
- Add to the API request/response Zod schemas for `/sync/push` and `/sync/pull`.

**Older clients:**
- Existing iOS or desktop builds without the field: API serves the field, they ignore unknown JSON keys → no error.
- They cannot **set** `tonight` — that's fine, they fall back to "Today" semantics, which is correct behavior for clients that don't know about the concept.

### Setting Tonight

**Entry point:** Quick-pick chip in the due-date selector, both Omnibar and task detail panel. Natural-language parsing ("tonight", "this evening") is deferred — chip first.

**Chip order in the picker:**
`Today` → `Tonight` → `Tomorrow` → `This Weekend` → `This Week` → `Next Week` → `Pick date…`

**Visual:** Same chip chrome as the others, with a small moon icon (or evening-toned dot) to differentiate. Match the existing chip style in [`packages/ui/src/DatePicker.tsx`](packages/ui/src/DatePicker.tsx) (or wherever the current chip set lives — Explore agent to confirm).

**Behavior:** Selecting Tonight sets `dueDate = today` (end of day, same as Today picker) AND `tonight = true`. Selecting any other chip clears `tonight = false`.

### Tonight section in Today view

**Position:** Between Today and This Week (or between Today and This Weekend if This Weekend appears first — Tonight is always immediately after Today).

**Header:**
- Title: "Tonight"
- Moon icon (24px, neutral-warm — same palette as the chip)
- Count chip

**Collapse behavior:**
- Before 6pm local → default **collapsed**
- At 6pm local → auto-expand
- After auto-expand, **user collapse wins** — if the user manually collapses it after 6pm, it stays collapsed for the rest of the day
- Next day → state resets to default-collapsed before 6pm

**Implementation note:** the auto-expand at 6pm is a passive "default state" change, not an active animation. The component reads `now()` on render and on a minute-tick timer; if the current time is ≥ 6pm and the user hasn't touched the section today, it renders expanded. If they've touched it (recorded in `localStorage` with today's date as part of the key), their choice sticks.

localStorage key: `today.tonight.userToggledOn.<YYYY-MM-DD>` → boolean (presence = user touched it; value = their chosen state).

### Empty state

If a user has no Tonight tasks, the section does not render at all. We don't want a permanent "Tonight (0)" header in the Today view.

### iOS parity

Tonight ships on iOS too. Same model:
- New "Tonight" chip in the iOS due-date picker (`apps/ios/Brett/Views/Date/DatePickerView.swift` or equivalent).
- New Tonight section in `TodayPage`, slotted between Today and This Week.
- `TodaySections` gets a new bucket: `tonight` (items with `tonight == true && sameDay(dueDate, today) && status != done`).
- Section is hidden when empty.
- Auto-expand at 6pm. Same localStorage-equivalent via `@AppStorage`, keyed by date.

### Brett (AI) Tonight routing — out of scope

Whether Brett's AI task creation should ever choose Tonight is deferred. Initial rollout: Tonight is human-driven only. If we later want Brett to route certain content there (e.g., evening reading, errand reminders), we can add it.

---

## 4. Granola second MCP not appearing in Settings

### Symptom

User connected a second Granola account. The Settings → Calendar page only shows one. Multi-granola spec ([`2026-05-16-multi-granola-design.md`](2026-05-16-multi-granola-design.md)) says all connected accounts should render as separate cards.

### Investigation hypothesis

Most likely culprits (Explore agent to confirm):

1. **API still returns `account: GranolaAccount | null` instead of `accounts: GranolaAccount[]`** — spec change might not have shipped. Check `apps/api/src/routes/granola-auth.ts` for the `GET /granola/auth` response shape.

2. **Desktop hook still reads `.account` instead of `.accounts`** — even if API was updated, `apps/desktop/src/api/granola.ts` might still use the old singular hook. Check whether `useGranolaAccount` was renamed to `useGranolaAccounts`.

3. **CalendarSection.tsx renders a single card** — even if hook returns array, the JSX might be `accounts[0]` instead of `.map(...)`.

4. **OAuth callback still upserts on `userId` instead of `(userId, email)`** — would mean the second OAuth attempt overwrites the first row instead of creating a new one. Check the upsert call in the callback handler. Symptom would be: first account's email gets replaced by second account's email, not a "missing" account.

5. **DB schema still has `userId @unique`** — would mean the second `INSERT` would fail at the DB level, but might be silently caught. Check `apps/api/prisma/schema.prisma` and the latest migrations folder.

### Fix

Whichever of 1–5 is the gap, close it. The spec already specifies the correct end state; this is plumbing through whatever didn't make it.

**Acceptance:** With two Granola accounts connected for the same user, `GET /granola/auth` returns both, the Settings Calendar tab renders two cards, and `INSERT`-ing the second account does not collide with the first.

---

## 5. Per-account connection health visibility

### Problems

Both observed by the user; both real:

**5a. Settings shows badge but not which account / why.** Today the left-nav badge tells you "something's broken" but Settings itself doesn't explain *which* account or *why* once you're there. The re-link task in Today says "reconnect granola" but doesn't survive in the UI long enough to be useful.

**5b. Reconnecting any account clears all accounts' tasks.** User had account A broken. They connected (or reconnected) account B. The re-link task for account A disappeared even though A is still broken.

### Fix 5a — Show the state per account in Settings

**On every connected-account card** (Granola, Google Calendar, etc.), render a status row inside the card:

- **Healthy state:** small green dot + "Connected" (or just absence of warning).
- **Broken state:** small amber dot + "Needs reconnection" + reason line below in muted text. Example reasons:
  - "Token expired — last successful sync 3 days ago"
  - "Authorization revoked"
  - "Authentication failed (401)"

The reason text is derived from existing failure logging on the backend. Where the current backend doesn't already write a reason string, add one to the `Item` (re-link task) when it's created — store as a sentence in a new `Item.systemReason` field, or piggyback on `Item.body`. **Spec to choose:** use existing `body` (no schema change), with the format `"Token expired — last successful sync 3 days ago"`. Frontend reads `body` for broken-state reason.

**Card chrome:** warning state adds a 1px amber left-border on the card and a subtle amber wash background. Matches the existing alert chrome pattern in the app (verify in Explore — likely the connection-health task card already has the right treatment to copy).

### Fix 5b — Re-link tasks must be scoped per account

The bug: the `resolveRelinkTask` backend logic (probably) clears any re-link task matching the connection type, not the specific account. So reconnecting account B clears account A's task.

**Fix:**

1. **Verify the task's `sourceId` already encodes accountId.** The connection-health spec says `sourceId = relink:<type>:<accountId>`. Confirm this is actually how the tasks are being created today, for every connection type (Granola, Google Calendar, AI).
2. **Update auto-resolution to require accountId match.** When OAuth completes for account `X` (e.g., `granolaAccountId = X`), only auto-complete re-link tasks whose `sourceId == relink:granola:X`. Other accounts' tasks stay open.
3. **Update the health check loop** that creates re-link tasks: tasks must be uniquely scoped by `(userId, sourceId)` so two broken accounts produce two distinct tasks, not a single deduped one.

**Acceptance test:**
- User has Granola account A broken, B healthy.
- Today view shows one re-link task scoped to A.
- User connects a *new* account C → A's task remains.
- User reconnects A → A's task auto-completes.
- B's settings card never showed a warning throughout.

### Files affected (preliminary)

| Area | File | Change |
|---|---|---|
| API | `src/services/connection-health.ts` (or wherever re-link tasks are created/resolved) | scope resolution by `sourceId == relink:<type>:<accountId>` |
| API | `src/routes/granola-auth.ts` callback, `src/routes/calendar-accounts.ts` callback | on success, only resolve tasks matching the **specific** account just connected |
| API | re-link task creation | ensure reason string written to `Item.body` |
| Desktop | `apps/desktop/src/settings/CalendarSection.tsx` + sibling sections | per-account status row + warning chrome |
| iOS | `apps/ios/Brett/Views/Settings/CalendarSettingsView.swift` + sibling settings views | per-account status row + warning chrome |

---

## Testing

### Item 1 (badge)

- Unit test `TodaySections.badgeCount(items:)` (iOS) — overdue + today, excludes thisWeek and nextWeek.
- Unit/integration test `activeThingsForCount` on desktop — same cases.
- Verify Tonight tasks count in badge regardless of clock time.

### Item 2 (collapsible sections)

- Manual: collapse "This Week" → reload → still collapsed. Expand → reload → still expanded.
- Manual: collapse state for "This Week" does not affect "Done" or other sections.
- Visual regression / screenshot — confirm count chip visible in collapsed state.

### Item 3 (Tonight)

- Unit: Tonight chip in date picker sets `tonight = true` and `dueDate = today`. Switching to any other chip clears `tonight`.
- Unit: `TodaySections.tonight` bucket includes only `tonight && today && !done` items.
- Unit: empty Tonight bucket → section hidden.
- Manual: at 5:59pm section collapsed, at 6:00pm expanded (use device time override or fake clock).
- Manual: after auto-expand, collapse → stays collapsed.
- Sync test: create Tonight task on desktop → appears as Tonight on iOS after pull. And vice versa.
- Schema migration test against prod-shaped data.

### Item 4 (multi-granola visibility)

- API integration test: user with 2 GranolaAccount rows → `GET /granola/auth` returns array of length 2.
- Desktop manual: connect two Granola accounts, both appear in Calendar settings.
- iOS manual: same.

### Item 5 (per-account connection health)

- Backend test: re-link task created with `sourceId = relink:granola:<accountId>`. Reconnecting a different `accountId` does NOT resolve the existing task.
- Backend test: reconnecting the SAME `accountId` auto-resolves its task.
- UI: warning chrome on broken account card with reason text.
- Cross-platform manual: same scenarios on desktop and iOS.

---

## Out of scope

- Brett AI auto-routing tasks to Tonight (revisit if signal emerges).
- iOS collapsible sections (parity exception).
- Surface "Tonight" as a separate dock/app-icon badge color or grouping — it counts the same as Today.
- Natural-language Tonight parsing in the Omnibar (chip-only for now).
- Reconnect-broken-account inline buttons on iOS Settings cards — covered separately by the existing connection-health UX spec; assumed shipped.
- Showing health status for non-Granola/Calendar integrations (e.g., AI providers) in this change. Same pattern, but defer to keep scope tight.

---

## Implementation phasing

These five items are independent enough to dispatch in parallel:

| Item | Surface area | Risk | Notes |
|---|---|---|---|
| 1. Badge narrow | Desktop + iOS | Low | One-line filter change each side |
| 2. Collapsible sections | Desktop only | Low | UI-only, localStorage |
| 3. Tonight | Schema, API, desktop, iOS | Medium | Migration + sync coordination |
| 4. Multi-granola bug | API + desktop + iOS | Low–Med | Bug investigation first |
| 5. Per-account health | API + desktop + iOS | Medium | Backend resolution logic + UI |

**Suggested PR slicing:**

- **PR A** — Items 1 + 2 (Today view tuning, desktop-leaning).
- **PR B** — Item 3 (Tonight — schema, sync, both platforms).
- **PR C** — Items 4 + 5 (connection visibility — backend + both platforms).

Item 3 needs the API to deploy first (per release process) so older clients ignore `tonight: true` from the start. Items 4 + 5 are server-fix-driven; clients consume gracefully.
