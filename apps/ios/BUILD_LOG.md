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

### Wave 1 — Foundation

_(updated as agents report)_

