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

**Follow-up pass — deferred items closed:**
- ✅ `MockStore` + `MockData` deleted. `selectedTaskId` extracted into `SelectionStore` (app-wide `@Observable` coordinator). `ListDrawer` rewritten against live `@Query` on SwiftData — pill counts refresh automatically on item mutations. `ListView` + `OmnibarView` dropped all mock fallbacks — submission requires a signed-in user (matches app-gate behaviour). Every page signature is now store-free. The `Mock/` folder is gone from the repo.
- ✅ **UX/brand consistency pass vs. Electron desktop.** Desktop uses `bg-brett-gold text-white` for every primary CTA — our iOS was shipping `.foregroundStyle(.black)` on gold buttons, which reads as consumer-coupon rather than editorial-premium. Swept the fleet: `SignInView`, `ScoutsRosterView` (Create + FAB), `ScoutDetailView` (Run now), `NewScoutSheet` (Next/Create), `CalendarPage` (Connect Google Calendar), `ConnectCalendarModal`, `TriagePopup` (Schedule + Create), `EventDetailView` (Send RSVP) — all now white-text-on-gold. `ProgressView.tint(.black)` bumped to `.white` to match. Gold checkmark glyph on `GoldCheckbox` kept black for contrast at 12pt.
- ✅ `SignInView` reshaped to match desktop: centred glass card (`bg-black/40 backdrop-blur-2xl border-white/10`), uppercase tracked field labels, gold inline "Sign up" link, uppercase "OR" horizontal rule, muted Google glass pill. Visual parity with [apps/desktop/src/auth/LoginPage.tsx](../../apps/desktop/src/auth/LoginPage.tsx).

**Still deferred (requires backend change):**
- Per-item `sortOrder` for drag-to-reorder persistence — needs a Prisma schema addition (`Item.sortOrder Float @default(0)`) + push allowlist update on the server. Currently the drag gesture persists haptic + visual feedback only. Logged as a coordinated iOS+API task.

**Simulator screenshot:** `/tmp/brett-overnight-final.png` (sign-in), `/tmp/brett-today.png` (Today page with daily briefing card + seeded "Review design spec" task over atmospheric background).

---

## TestFlight release (Fastlane)

Releases go out via Fastlane from your local Mac — no CI, no shared secrets.

**One-time setup:**

1. Install Ruby bundler + Fastlane deps:
   ```bash
   gem install bundler
   cd apps/ios && bundle install
   ```
2. Generate an App Store Connect API key at https://appstoreconnect.apple.com
   (Users and Access → Integrations → App Store Connect API → Team Keys).
   Role: **App Manager**. Download the `.p8` (only offered once) and drop it at:
   ```
   apps/ios/fastlane/AuthKey_6H9C24ZV75.p8
   ```
   Gitignored — do not commit.
3. Ensure Xcode is signed into the team (`FQUJNV9M6S`) so automatic signing
   can fetch the `Apple Distribution` cert + provisioning profile on first run.

**Cut a TestFlight build:**

```bash
scripts/release.sh ios
```

What the `beta` lane does:
- Regenerates `Brett.xcodeproj` from `project.yml` (so any tweaks are picked up).
- Authenticates to App Store Connect using the API key.
- Queries the latest TestFlight build number for this `MARKETING_VERSION` and bumps by 1 — works across machines without a committed counter.
- Builds the `Release` configuration, signs with `Apple Distribution`, exports an `app-store` IPA.
- Uploads to TestFlight without waiting for processing (fire-and-forget).

**Version policy:** `MARKETING_VERSION` in `project.yml` is bumped manually when you want a new user-visible version (e.g. `1.0.0` → `1.1.0`). `CURRENT_PROJECT_VERSION` (build number) auto-increments on every `beta` run.

---

## Running the test suite

The `BrettTests` target uses Swift Testing (`@Test` / `@Suite`). Tests share a `MockURLProtocol` singleton for HTTP stubbing, which means they must run sequentially — Swift Testing's default cross-suite parallelism causes false failures from leaked request logs.

**Always run with `-parallel-testing-enabled NO`:**

```bash
cd apps/ios
xcodebuild -scheme Brett \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -configuration Debug \
  -parallel-testing-enabled NO \
  test
```

The xctestplan's `parallelizable: false` key only disables _cross-target_ parallelism in Xcode 26 — it doesn't affect Swift Testing's within-target scheduling. CI scripts and local scripts that invoke `xcodebuild test` must pass the flag explicitly.

For quickly running one suite or test:

```bash
# Entire suite (Swift Testing suite identifiers use the struct name)
xcodebuild ... -only-testing:BrettTests/ItemStoreUpdateTests test

# Single test
xcodebuild ... -only-testing:BrettTests/ItemStoreUpdateTests/toggleStatusSnapshotsPreMutationState test
```

Isolated runs (`-only-testing:`) don't need the parallel-disable flag — the cross-suite-pollution problem only manifests when multiple suites run back-to-back.


