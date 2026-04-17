# Brett — Features

> Brett is a personal AI chief-of-staff. One unified surface for tasks, content, calendar, communications, and intelligence — with Claude doing the integration work so the human can focus on decisions and action. Desktop (Electron, primary) and iOS (native Swift, near dev-complete), backed by a single Hono API.

This document describes **what Brett does for the user**. For technical structure see [architecture.md](architecture.md).

---

## 1. Core Mental Model: Things, Lists, Sources

Everything in Brett is a **Thing**. A Thing has:

- **type** — `task` or `content` (and from a wider lens, calendar events and meeting notes are first-class siblings)
- **list** — where it lives in the user's hierarchy (Inbox, Today, Upcoming, custom lists)
- **source** — where it came from (manual, scout, newsletter, integration, share extension, AI)

Source provenance is a first-class concern: a task surfaced by a Scout looks and behaves differently than a task the user typed. This shows up in trust signals, filtering, and attribution everywhere.

Things support: due dates with **precision** (exact day vs. "this week"), reminders (morning-of / 1-hour-before / day-before), recurrence (RRULE), notes, attachments, bidirectional links to other Things, and a per-Thing chat thread with Brett.

---

## 2. Daily Surfaces

### Today
The home view. Combines:
- **Daily Briefing** — AI-generated, conversational summary of the day (cached per day; auto-generates on first open if AI is configured). Dismissible; `Cmd+Ctrl+B` re-shows for debug.
- **Filter pills** (All / Tasks / Content)
- **Next Up card** — next calendar event with live countdown; expands when ≤10 min away
- **Active items** — anything due today or overdue, sorted by due date
- **Done today** — today's completions, persisted separately so the day's progress is visible

Keyboard: `j/k` navigate, `e` toggle done, `l/d` triage list-first / date-first, `Cmd+Enter` quick-add.

### Inbox
Triage surface. Anything unrouted lands here: newsletters, share-extension drops, scout findings the user converted, items with no list and no due date. The user clears the inbox with two patterns:
- **List-first** — pick a list, then optionally a date
- **Date-first** — pick a date, then optionally a list

The inbox suggests lists semantically (embedding-driven `/api/things/suggestions`) so most items are one tap to file. Multi-select supports bulk archive/move.

### Upcoming
Forward-looking view. Items grouped into **Overdue → Due Today → This Week → Later**. Same triage shortcuts as Today.

### Custom Lists
User-created lists (projects, areas, recurring contexts). Each list has a name, color, and sort order. Inline rename, color picker, archive/unarchive. A list page is just a filtered Things view with a built-in Quick-Add input.

### Calendar
Month / Week / Day views over connected Google calendars. Each event shows title, time, location, attendees with RSVP status, and meeting link. Inline RSVP (yes/no/maybe), per-event editable notes (meeting prep + retrospective), and per-event chat with Brett. Color-coded from Google's calendar colors, mapped through the glass palette. A compact Calendar Sidebar can stay open next to any list view, showing today's timeline + the Next Up countdown.

### Scouts
Persistent AI research agents. Each Scout has a goal ("watch for changes to Stripe's pricing page", "surface weekly news on competitor X"), a sensitivity level, a cadence, and a budget. Scouts run in the background, search the web, judge findings against the goal, and surface results into the inbox or Findings panel.

The Scouts tab shows the **roster** (status, last run, finding count) and a per-Scout detail page with **Findings** (with useful/not feedback), **Activity** (run log), and **Memories** (long-term factual/judgment/pattern memory the scout has built up across runs). Memories are editable and decay/consolidate periodically.

---

## 3. Task & Content Detail

Click any item → right-side detail panel slides in.

- **Header** — title, completion toggle, overflow menu (duplicate, archive, delete)
- **Meta** — list, due date (with week precision), reminder, recurrence
- **Content preview** — for content-type Things, the auto-extracted readable text + favicon + "view original"
- **Brett's Take** — for content items, an AI-generated summary (cerulean-bordered card)
- **Attachments** — drag-drop or click to upload; files live in S3-compatible storage; presigned URLs for download. 25 MB cap, MIME and magic-byte verified
- **Linked items** — bidirectional links between Things (manual or embedding-suggested)
- **Chat** — per-Thing streaming chat with Brett (history paginated; tool calls render inline)
- **Calendar context** — when the Thing is a calendar event: attendees, RSVP, meeting link, notes

History stack supports back navigation between items; `Esc` closes; `e` toggles complete; `Cmd+Enter` saves.

---

## 4. Brett (the AI)

Brett is woven through the product, not bolted on. Same engine, multiple surfaces:

### Omnibar (`Cmd+K`, `Cmd+Ctrl+F`)
A spotlight modal that runs in two modes:
1. **Search** — hybrid keyword + semantic search across Tasks, Content, Lists, Events, Meeting Notes, and Scout Findings, with reranking
2. **Chat** — a conversational interface that streams Claude's response with inline tool calls. Common asks: *"Add 'follow up with Stephen' to my Gravity Health list for tomorrow"*, *"What's tomorrow look like?"*, *"Summarize my last meeting with Aria"*

The Omnibar uses ~30 skills (create_task, complete_task, get_calendar_events, search_things, recall_memory, list_inbox, etc.) and shows results inline with the rendered tool result so the user can immediately accept/undo. Tool results trigger automatic data invalidation — anything Brett creates appears instantly in the right place.

### Daily Briefing
A morning conversational summary: today's calendar, the items overdue or due today, weather (if location set), recent context Brett has learned about you. Generated via an LLM call on first load each day, cached, regeneratable. There's also a non-AI summary endpoint (just counts) so the dashboard works even without an AI key.

### Brett's Take
Per-content summaries — paste a long article or newsletter, Brett gives you the takeaway. Streamed, saved to the item's `brettObservation`.

### Per-Thing Chat
Every task and every calendar event has its own Brett thread. Useful for "what was decided here?", "draft an email response", "what's the status of this project?" — Brett pulls in linked items, related calendar events, recent meeting notes, and your stored facts as context.

### Memory & Knowledge Graph
Brett extracts **user facts** (preferences, relationships, contexts, habits) from your conversations and stores them as durable structured records with confidence + validity windows. A separate **knowledge graph** captures entities (people, companies, projects, topics) and their relationships (works_at, manages, blocks, related_to), built from the same conversation stream. Both feed back into every prompt so Brett gets sharper over time. Periodic consolidation merges duplicates and supersedes outdated facts.

### Scout Findings
Each Scout writes structured findings (article, insight, task) with relevance score and reasoning. Useful/not feedback teaches the Scout. Findings can be one-tap-converted into tasks or content items.

---

## 5. Capture & Integrations

### Quick Capture
- **Omnibar Quick Add** — `Cmd+Enter` from anywhere creates a Today task
- **List Quick Add** — `Tab` in any list focuses the inline input
- **iOS Share Extension** — share-sheet from any app silently saves to Inbox via App Group queue + late-fire POST
- **iOS Voice mode** — speech-to-text into the omnibar with live waveform; SmartParser extracts dates, lists, reminders from natural language

### Newsletters
A unique per-user ingest email (e.g. `ingest+<token>@…`) captured by Postmark webhook. First-time senders go to a **PendingNewsletter** approval queue; approved senders auto-ingest. Newsletter content is parsed (Mozilla Readability), classified, and dropped into the inbox tagged with sender. Settings exposes the address, the approved senders list, and a per-sender disable toggle.

### Google Calendar
OAuth connect (system-browser flow on desktop, native flow on iOS), multi-account, per-calendar visibility and meeting-notes scope. Real-time updates via Google's push-notifications webhook (auto-renewed every 6h). Events sync 90 days back / 90 days forward. Calendar event notes are first-class: edited inline, persisted server-side, synced to iOS.

### Granola
MCP-style integration with Granola's meeting notes service. Brett pulls meeting transcripts, summaries, and action items, then can auto-create tasks from action items (configurable). Token storage is AES-256-GCM encrypted. Working-hours gating prevents off-hours sync.

### Things 3 Import
Desktop-only, macOS-only. Settings → Import scans the local Things 3 SQLite DB, shows the user a summary, then imports todos, projects, and tags into Brett lists.

---

## 6. Settings

Eleven (or so) tabs accessible via `/settings#<hash>`:

- **Profile** — name, avatar, email
- **Account** — sign out, delete account
- **Security** — password, sessions, biometric lock (iOS)
- **Calendar** — Google account connect/disconnect, per-calendar visibility, meeting-notes capture, Granola toggle
- **AI Providers** — add/activate/delete encrypted API keys per provider (Anthropic, OpenAI, Google), masked display, status badges, usage stats (24h / 7d / 30d, by provider/model)
- **Newsletters** — ingest address, approved sender list, sender controls
- **Personalize** (Timezone / Location) — IANA timezone, location for weather, background style + image picker (with Pin)
- **Import** — Things 3 importer (macOS desktop only)
- **Updates** — auto-update toggle, manual check, install-on-quit
- **Lists** — manage and unarchive lists

Every UI element that links to settings deep-links to the right tab via the URL hash.

---

## 7. Real-Time Sync & Offline

- **Real-time** via Server-Sent Events (`/events/stream`, ticket-authenticated) — calendar changes, content extraction completion, scout findings, scout runs, item updates. The desktop and iOS clients both invalidate React Query / live `@Query` results on event receipt, so any change made anywhere shows up instantly everywhere.
- **Offline-first (iOS)** — every write goes to local SwiftData immediately, then through a mutation queue with field-level merge conflict resolution. Pull is cursor-based per table; push is batched (max 50 mutations / 1 MB body). Server-wins on field-level conflicts. Background poll every 30 s plus pull-to-refresh.
- **Idempotency** — mutation IDs are deduped server-side via an `IdempotencyKey` table so retries on flaky networks are safe.

---

## 8. Visual Design

The Brett identity: **glass over chrome**. Semi-transparent panels with `backdrop-filter: blur()` floating over a full-bleed wallpaper, never opaque SaaS chrome.

- **Living Background** — wallpapers rotate by time-of-day segment (dawn, morning, afternoon, golden hour, evening, night) and calendar busyness tier (light/moderate/packed). Photography or abstract or solid; user can pin a favorite.
- **Awakening** — first frame each session: the background zooms 1.15 → 1.0 over 2.5 s while the UI fades in over 1.5 s
- **Brand colors** — gold (`#E8B931`) for primary CTA / section labels / completion, cerulean (`#4682C3`) for AI surfaces (chat, briefing, Brett's Take), emerald for active scouts
- **Typography** — Switzer for branding, Plus Jakarta Sans for UI; weight + size carry hierarchy, color almost never does
- **Dark mode only** (the wallpaper system requires dark canvas)

The design system is documented exhaustively in `docs/DESIGN_GUIDE.md`. iOS and desktop must look like the same product — the CLAUDE.md enforces parity rules about list chrome, section headers, and AI-surface tinting.

---

## 9. Platform-Specific

### Desktop (Electron — primary, most-tested)
- System-browser Google OAuth (passkeys + biometrics work because it's a real browser)
- `safeStorage`-encrypted bearer token persistence
- electron-updater for auto-updates with user-configurable install-on-quit
- Things 3 import (macOS only)
- Custom `app://` protocol in production (avoids `null` `file://` origins)
- Screenshot-attached feedback modal

### iOS (native Swift — near dev-complete)
The iOS app mirrors the desktop. As of 2026-04-16: 27 of the desktop's features are present (Today / Inbox / Calendar / Lists / Scouts / Chat / Briefing / Search / 10 Settings tabs). 405 tests pass. Native niceties:
- Sign in with Apple, native Google SDK, email/password
- Keychain-backed bearer token (App Group shared with Share Extension)
- Optional Face ID / Touch ID gate on app foreground
- Shake-to-report (accelerometer → feedback modal)
- Share extension: silent fast-queue + late POST
- Voice omnibar with `SFSpeechRecognizer` + waveform
- 3-page horizontal swipe (Inbox / Today / Calendar) and persistent omnibar pill — the iOS-native take on the desktop's modal omnibar
- Liquid glass materials, atmospheric portrait backgrounds, full VoiceOver/Dynamic Type/High Contrast/Reduce Motion support

**Known gaps vs. desktop**: APNs/FCM push (scaffold only), widgets, Siri Shortcuts, Spotlight indexing, persistent drag-to-reorder (UI works, server `sortOrder` not yet wired). Account delete & data export endpoints not yet on the server.

### Admin
A small admin dashboard at `apps/admin/` (React) backed by `apps/admin-api/` (Hono). Passkey-only sign-in, no sign-up. Surfaces ops dashboards: user list, scout health, AI spend, knowledge-graph debugging.

---

## 10. Release & Production Posture

Brett is in production with real users. Two-branch release model: commits land on `main` → CI runs typecheck + tests; PR `main → release` triggers deploy (Railway API + Electron build + S3 upload). Migrations run automatically on deploy, with strict rules: no destructive changes in a single step, two-phase column drops/renames, test against production-shaped data first. Rollback = revert the merge commit on `release`.

---

## What Brett deliberately is not

- Not a commercial product (single-user mindset throughout, no monetization)
- Not a general-purpose AI assistant — it's opinionated about productivity
- Not a long-form notes app (notes are Things; long-form capture is out of scope)
- Not multi-tenant (every query is `userId`-scoped, but the product isn't designed for teams)
