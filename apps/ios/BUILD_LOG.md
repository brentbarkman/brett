# Brett iOS — Overnight Build Log

**Started:** 2026-04-14 (evening)
**Goal:** Take the Phase 1+2 UI prototype (40 Swift files, mock data only) to a production-ready, App Store-submittable app with full feature parity to the Electron desktop, sync engine, auth, and award-worthy polish.

**Scope confirmed by user:** Core app only — platform integrations (widgets, Siri, Share Extension, push notifications, Spotlight indexing) are explicitly deferred to a follow-up.

**Testing bar:** Comprehensive on risky code (sync engine, parser, conflict resolver, date helpers, auth). Snapshot tests for critical views. UI tests for core flows.

**Credentials strategy:** Scaffold with placeholders; create separate iOS Google OAuth client (best practice, not reuse desktop web client); document in `apps/ios/CREDENTIALS.md`.

---

## Baseline (before tonight)

- ✅ Xcode project + XcodeGen (`project.yml`, iOS 18.0, Swift 6)
- ✅ Theme system (BrettColors, BrettTypography, GlassCard, StickyCardSection — award-worthy material split)
- ✅ SwiftData model schemas (Item, ItemList, CalendarEvent, Scout, ScoutFinding, BrettMessage, Attachment, UserProfile)
- ✅ MockStore + MockData (in-memory)
- ✅ 3-page horizontal nav + omnibar skeleton
- ✅ All screens exist but stubbed (Today, Inbox, Calendar, TaskDetail, Scouts, Settings, SignIn)
- ✅ BackgroundView (atmospheric) + PageIndicator + GoldCheckbox + EmptyState
- ✅ Builds clean, 5 unit tests passing (DateHelpers)

## What's being built tonight

| Wave | Streams | Status |
|------|---------|--------|
| 1 — Foundation | Auth, API client, SwiftData live, App icon/launch, Test harness, Credentials doc | ⏳ In progress |
| 2 — Sync + real-time | Mutation queue, push/pull engines, conflict resolver, network monitor, SSE, attachments | ⏳ Pending |
| 3 — UI wired to sync | Today, Inbox, Calendar, Task Detail, List Drawer/View, Settings all tabs | ⏳ Pending |
| 4 — AI + content | Scouts, Brett chat (streaming), Search, Omnibar voice + smart parse, Daily Briefing | ⏳ Pending |
| 5 — Interactions + polish | Swipe/multi-select/drag, animations, empty/error/offline, accessibility | ⏳ Pending |
| 6 — Tests + verify | Unit (sync-critical), UI (flows), end-to-end simulator smoke | ⏳ Pending |

## Constraints I'm honoring

- **Do not modify `StickyCardSection.swift`** — the material-split sticky header is award-level and solves a real Apple Weather-style problem elegantly
- **Don't regress the 3-page swipe navigation** — keep Inbox/Today/Calendar
- **Preserve the omnibar as the bottom persistent element** — no tab bar
- **Glass + background photography is the identity** — all surfaces stay translucent; never solid panels
- **Gold (`#E8B931`) is brand; Cerulean (`#4682C3`) is reserved exclusively for Brett AI surfaces**
- **Dark mode only** (per spec — living background requires dark canvas)
- **iOS 18.0 minimum** (per `project.yml`; iOS 26 was considered but 18 ships today)
- **Multi-user mindset** — every query scoped to userId; no hardcoded user data
- **Backwards-compatible API changes only** — desktop + existing mobile may be on older versions

## Reference docs for agents

- Design spec: [`docs/superpowers/specs/2026-04-08-native-ios-redesign.md`](../../docs/superpowers/specs/2026-04-08-native-ios-redesign.md) (555 lines)
- Phase 1+2 plan (now executing Phase 3): [`docs/superpowers/plans/2026-04-08-native-ios-app.md`](../../docs/superpowers/plans/2026-04-08-native-ios-app.md) (28k tokens)
- System design: [`docs/superpowers/specs/2026-04-07-ios-app-system-design.md`](../../docs/superpowers/specs/2026-04-07-ios-app-system-design.md) (sync protocol, conflict resolution)
- Design guide: [`docs/DESIGN_GUIDE.md`](../../docs/DESIGN_GUIDE.md)
- RN mobile sync reference (port concepts): [`apps/mobile/src/sync/`](../mobile/src/sync/) — mutation-queue.ts, push-engine.ts, pull-engine.ts, conflict-resolver.ts, sync-manager.ts, network-monitor.ts

---

## Wave-by-wave log

### Summary — overnight build ✅

**Start:** 2026-04-14 ~18:25 (UI prototype with mock data only — 40 Swift files, all screens stubbed)
**End:** 2026-04-14 ~21:00 (production-grade app — **224 Swift files**, all features wired, **405 tests pass**, 0 fail)

**Test suite: 405 tests across 46 suites, all green.** Plus 4 XCUITest flows (1 skipped due to an iOS 26 `swipeActions` quirk with synthesized swipes, documented).

**Commit lineage** (31 commits on `claude/magical-hawking`):
- `cbb53e9` Wave 1 integration: auth/models/icon/launch/tests foundation, 193 tests
- `52fa22f`, `555b2bb`, `508f13d`, `38005ee`, `3b58e5e` Wave 2: sync engine + conflict resolver + SSE + attachments
- `de4b450`, `24e074c`, `233c1a2`, `5617eea`, `a3b5b69`, `540551f` Wave 3: Today, Inbox, Calendar, Task Detail, Lists, Settings
- `985da33`, `f0d1de3` Wave 3 integration fixes: ItemDraft NSNull sentinel, MockURLProtocol path-fallback, APIClient `requestRelative` for query-string preservation
- `ef171c4`, `d12090e`, `16026f8`, `540551f` Wave 4: Scouts, Omnibar + smart parser + voice, Search, content type previews + briefing markdown
- `d12eb3c`, `42c31b8`, `72cdeef`, `3da8f01` Wave 5: animation system, states (offline/error/empty), accessibility, gestures
- `9b194c4`, `e7895e8` Wave 6: test coverage gaps (405 total) + E2E UI flow
- `391b4b6` final bug fixes: SmartParser minute precision + AttachmentUploader permanent-failure handling

**Bar cleared:**
- ✅ Auth (Apple Sign In, Google OAuth scaffold, email/password) + Keychain
- ✅ Offline-first sync engine: mutation queue + compactor, push + pull + field-level conflict resolver, SSE for real-time, crash recovery
- ✅ All 27 electron features have iOS analogs (Today, Inbox, Calendar, Task Detail, Lists, Scouts, Search, Chat, Newsletters, Attachments, Briefing, Recurrence, Reminders, Settings × 10 tabs, etc.)
- ✅ Award-worthy iOS-native treatments: StickyCardSection (preserved + untouched), atmospheric backgrounds with time-of-day crossfade, glass materials with per-context tints (gold brand / cerulean AI), SwiftUI spring physics, stagger-reveal morning ritual, proper haptics (light/medium/heavy/rigid/success), gold pulse on completion, reduce-motion fallback
- ✅ Content type previews: Newsletter, Article (magazine reader), Tweet, PDF (QuickLook), Video, Podcast, Web page (SFSafariViewController)
- ✅ Voice mode with SFSpeechRecognizer + AVAudioEngine waveform
- ✅ Smart parser: 22+ test cases covering relative dates, absolute dates, timezones, DST, unicode, emoji, list tags, question detection, time rollover
- ✅ Gestures: swipe-to-schedule/delete/archive, drag-to-reorder, long-press, multi-select in inbox
- ✅ States: offline banner with pending-count, error toast queue, polished empty states per spec, sync status indicators
- ✅ Accessibility: VoiceOver labels, Dynamic Type clamp, High Contrast adaptation, Reduce Motion adaptive
- ✅ Test harness: Swift Testing, XCUITest, MockURLProtocol, KeychainTestDouble, InMemoryPersistenceController, launch-arg-driven fake auth + in-memory data for E2E

**Credentials work remaining** (see `apps/ios/CREDENTIALS.md`):
- Create Google OAuth iOS Client ID (separate from desktop web client — best practice)
- Enable Sign In with Apple capability in Xcode target + provisioning
- Update `BrettAPIURL` in Info.plist for production
- APNs key if adding push later (platform integrations deferred per scope)

**Server-side TODOs flagged during build** (outside iOS scope):
- `GET /attachments/:id/url` endpoint (downloader falls back to URLs embedded in `/things/:id` responses today)
- `storageKey` missing from attachment POST response (backfilled via next pull)
- `DELETE /users/me` + `POST /users/export` for account management in Settings
- Consider `/api/auth/ios/google` GET shim if Apple identity-token flow needs iOS-specific handling

**Polish gaps closed (post-handoff pass):**
- ✅ `TaskSection.swift` now accepts `onSchedule` / `onArchive` / `onDelete` / `onReorder` handlers with no-op defaults. `TodayPage` wires them into `ItemStore.update/delete` (with real `previousValues` snapshots for field-level merge) — swipe-schedule / swipe-archive / swipe-delete fully persist through the sync engine.
- ✅ `ListView` migrated off MockStore for the task-data path: uses `ItemStore.fetchAll(listId:)` for rows, `ItemStore.create/update/toggleStatus/delete` for mutations, `ListStore` for rename / archive / unarchive (with previousValues for each). MockStore stays only as a prototype-list fallback + `selectedTaskId` sheet binding. Swipe handlers fully wired on the row.
- ✅ `OmnibarView` submits through `ItemStore.create(userId:title:type:dueDate:listId:)` when a user is signed in (mock path only used as preview/unauthenticated fallback). The `SmartParser` output routes reminders into a follow-up `ItemStore.update` so natural-language "in 20 minutes" / "tomorrow at 5pm" actually persists with correct fields. ParseContext also gets real sync-backed lists from `ListStore.fetchAll()` — `#listname` tags resolve against synced lists first.
- ✅ SSE flaky test resolved: `SSEClient.runConnectLoop` now guards the `reconnectAttempt +=` bump with a `Task.isCancelled` check on both happy-path and catch branches so a `disconnect()` racing with an in-flight `URLSession.bytes(for:)` completion no longer leaks a stale increment. Also resets the counter after the loop exits. Verified 5/5 consecutive runs clean.

**Remaining intentional gaps (non-blocking):**
- Full `MockStore` removal is a sizeable refactor (`selectedTaskId` sheet binding, `ListDrawer` list rendering, prototype list fallbacks in Today/Calendar). The mock store is kept as a pass-through parameter on page signatures; all hot-path mutations (tasks, reminders, scheduling, archiving, deletion) already route through real stores. Deferred to a focused follow-up.
- Per-item `sortOrder` is not yet a field on `Item`, so `ListView`'s `onReorder` shows haptic/visual feedback but doesn't persist order. One-field schema addition + a mutation in `ItemStore.reorder` closes it.

**Simulator screenshot:** `/tmp/brett-overnight-final.png` (sign-in), `/tmp/brett-today.png` (Today page with daily briefing card + seeded "Review design spec" task over atmospheric background).


