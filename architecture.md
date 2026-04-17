# Brett — Architecture

> Technical reference for engineering agents. Pairs with [features.md](features.md) (the user-language overview) and `CLAUDE.md` (operating rules). Read all three before touching production.

---

## 1. Top-level Layout

Monorepo: pnpm workspaces (`pnpm@8.15.6`) + Turborepo. Node 20, TypeScript 5.3, `type: "module"` in most packages (imports use `.js` extensions for ESM resolution).

```
apps/
  api/            Hono + Prisma + better-auth — single deployable backend
  desktop/        Electron 28 + Vite + React 19 — primary client
  ios/            Native Swift / SwiftData / SwiftUI — iOS 18+, near dev-complete
  admin/          React (Vite) admin dashboard (passkey auth)
  admin-api/      Hono admin backend (passkey, role-gated)
packages/
  types/          Pure TS interfaces (no runtime)
  utils/          Pure helpers (detectContentType, date, url, weather)
  business/       Domain logic (urgency, grouping, validation, recurrence, background selection)
  api-core/       Prisma client singleton, better-auth setup, Hono base, re-exports Prisma types/enums
  ai/             LLM providers, skills, memory, embeddings, KG, orchestrator
  ui/             Web-only React components (desktop + admin)
evals/            Offline eval harness for AI features
docs/             DESIGN_GUIDE, llm-call-audit, memory-system, specs, plans
```

The native iOS app lives in the same repo but is an Xcode project; it shares no pnpm/Turbo tooling with the rest — it talks to `apps/api` over HTTP/SSE and re-implements domain types/rules in Swift.

Package dependency graph is strictly acyclic:
`types → utils → business → {ai, ui}`, `types → api-core → ai`, apps sit on top. Apps use `workspace:*`; Vite resolves to TS source at dev time (no pre-build needed on the hot path). `.npmrc` sets `node-linker=hoisted` for simpler pnpm resolution across the workspace.

**Release model.** Two-branch: `main` is dev (CI: typecheck + tests on every push); PR `main → release` runs the deploy workflow (`.github/workflows/release.yml`) — tests, Railway API deploy via `@railway/cli`, health check, Electron build, S3 upload. Migrations auto-apply via `prisma migrate deploy` in the Dockerfile `CMD`. **Never push directly to `release`. Never force-push either branch. No destructive migrations in a single step.**

---

## 2. API — `apps/api`

Hono server, split `src/app.ts` (routes + middleware) vs. `src/index.ts` (entry). Tests drive `app.request()` directly — no HTTP.

### 2.1 Auth

better-auth mounted at `/api/auth/*` with the `bearer` plugin (Electron + iOS can't rely on cross-origin cookies). Config in `src/lib/auth.ts`. Trusted origins include `app://.` (Electron prod), dev localhost, `BETTER_AUTH_URL` in prod. Passkeys supported.

- Bearer token stored client-side in Electron `safeStorage` / iOS Keychain.
- Protected routes use `authMiddleware` from `src/middleware/auth.ts`; `c.get("user")` + `c.get("session")`.
- **iOS-native Google Sign-In** has its own endpoint at `/api/auth/ios/google/token` (`routes/auth-ios.ts`, `lib/ios-google-signin.ts`) — accepts the `idToken` from GoogleSignIn-iOS, verifies against Google JWKS with the iOS-specific `aud`, and mints a better-auth session. Rate-limited 10/60s per IP.
- **Google OAuth (desktop):** POST-only `/sign-in/social` must happen from a browser context with cookies preserved. Desktop flow spins up an ephemeral `127.0.0.1:<port>` server, opens the system browser to `BETTER_AUTH_URL/api/auth/desktop/google?port=&state=`, the API serves an HTML page that POSTs `/sign-in/social`, then after OAuth it redirects back to the localhost callback with the token. HMAC-signed state prevents forgery.
- **Cookie prefix:** `__Secure-` in prod (HTTPS). Read both `__Secure-better-auth.session_token` and `better-auth.session_token`.

### 2.2 Data model

`apps/api/prisma/schema.prisma`, ~35 models. Not exhaustive — key clusters:

- **Auth (better-auth):** `User` (timezone, location, weather prefs, assistantName, role), `Session`, `Account`, `Verification`, `Passkey`.
- **Core:** `List`, `Item` (the Thing; type `task` or `content`; status active/snoozed/done/archived; `dueDate` + `dueDatePrecision` "day"/"week"; `recurrence` + `recurrenceRule` RRULE; `source`/`sourceId`/`sourceUrl`; `contentType`/`contentStatus`; `brettObservation`), `Attachment`, `ItemLink` (bidirectional; source `manual`/`embedding`).
- **Calendar:** `GoogleAccount`, `CalendarList` (per-calendar watch token), `CalendarEvent`, `CalendarEventNote`.
- **Meeting notes:** `GranolaAccount` (encrypted tokens), `MeetingNote` (unified across Granola + Google Meet), `MeetingNoteSource`.
- **AI:** `UserAIConfig` (per-provider encrypted keys), `ConversationSession` (`omnibar`/`brett_thread`/`briefing`), `ConversationMessage`, `UserFact` (category/key/value/confidence + validity window), `AIUsageLog`, `Embedding` (pgvector, entityType ∈ item/calendar_event/meeting_note/scout_finding/conversation).
- **Scouts:** `Scout` (goal, sensitivity, sources, budget, cadence), `ScoutRun` (mode `standard`/`bootstrap`), `ScoutFinding`, `ScoutActivity`, `ScoutMemory` (`factual`/`judgment`/`pattern`, with status), `ScoutConsolidation`.
- **Knowledge graph:** `KnowledgeEntity`, `KnowledgeRelationship`.
- **Newsletters:** `NewsletterSender`, `PendingNewsletter`.
- **Sync / iOS:** `IdempotencyKey` (key-scoped by `${userId}:${clientKey}` in code — see §2.4), `DeviceToken`, `WeatherCache`.

Soft-delete is handled by a Prisma extension that converts `delete` → `update(deletedAt)` for most models and auto-filters `deletedAt IS NULL` on reads. Sync pull queries explicitly include tombstones by `deletedAt: { not: null }` to bypass the extension.

### 2.3 Routes (selected)

Every protected route `c.get("user")`-scopes its Prisma queries. Deviation is a bug.

- `/things` — CRUD, bulk-update, per-item extract, `/:id/attachments/*`, `/:id/links/*`, suggestions.
- `/lists`, `/calendar/*` (events, accounts, RSVP, notes, per-event chat thread).
- `/brett/*` — `/omnibar`, `/chat/:itemId`, `/briefing`, `/briefing/summary`, `/take/:itemId`, `/chat/:itemId/history`.
- `/ai/config`, `/ai/usage`.
- `/scouts` — CRUD, pause/resume/complete, findings (+ feedback + convert-to-item), activity, memory.
- `/api/search`, `/api/suggestions`, `/api/graph/entities{,/search,/:id/connections}`.
- `/sync/pull`, `/sync/push` (see §2.4).
- `/events/ticket` (POST with Bearer → short-lived ticket), `/events/stream?ticket=…` (SSE; no raw token in URLs).
- `/newsletters/*` + `/webhooks/email/ingest/:secret` (Postmark), `/webhooks/calendar-sync/:secret` (Google push).
- `/granola/auth/callback`, `/devices/(un)register`.
- `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`.
- Admin/internal routes gated behind a `SCOUT_SECRET` middleware.

### 2.4 Sync engine

Two endpoints, `src/routes/sync.ts`:

- `POST /sync/pull` (rate limit 120/min). Cursor is a per-table ISO timestamp. Response returns upserts + tombstones (IDs only) per table. Default limit 500, max 1000; stale cursors (>30 d) trigger `fullSyncRequired`. Calendar events are scoped to ±90 days. New cursor = max(`updatedAt`) of the returned page.
- `POST /sync/push` (rate limit 60/min). Max 50 mutations / 1 MB. Each mutation: `{ entityType, entityId, action: CREATE|UPDATE|DELETE, payload, changedFields, previousValues, idempotencyKey }`.
  - `entityType` allowlist: `item`, `list`, `calendar_event_note`. Everything else rejected.
  - **Idempotency keys are stored as `${user.id}:${clientKey}`** so a malicious client can't replay another user's mutation by matching on the raw key. (Prior behavior leaked the cached `record`; fixed.)
  - UPDATE uses `fieldLevelMerge` (`src/lib/sync-merge.ts`) — server wins on conflict; returned as `applied` / `merged` / `conflict` / `not_found`.
  - `MUTABLE_FIELDS` per entity type is the write allowlist (no surprise columns on update).
  - Server-side `publishSSE(user.id, { type: "${entityType}.${eventType}", payload: { id } })` fans out after apply/merge.

### 2.5 Background jobs (`src/jobs/cron.ts`)

All guarded by a boolean flag (single-process exclusivity; see §6 on Railway horizontal scaling).

| Schedule | Job |
|---|---|
| 30 s | SSE heartbeat |
| 6 h | Google Calendar watch renewal (24 h pre-expiry) |
| 4 h | Per-account incremental calendar sync |
| 5 m | Post-meeting notes sync (events that ended 5–15 min ago) |
| 30 m | Full meeting-notes sweep, working-hours gated per user timezone |
| 5 m | `tickScouts()` |
| 1 h | Expired `Verification` cleanup |
| 3 am | `PendingNewsletter` cleanup |
| 3:15 am | `IdempotencyKey` cleanup (30-day TTL) |

`src/app.ts` also kicks off memory-consolidation scheduler (60 s warmup, then 24 h) and an embedding backfill pass 30 s after startup.

### 2.6 Deploy

Dockerfile in `apps/api/Dockerfile`, `apps/api/railway.json` points at it. Multi-stage (deps → build → runner). `tsconfig.base.json` must be copied into the build stage (shared packages reference it). Shared packages must be copied into the runner stage because hoisted `node_modules` contains symlinks that need the real files. CMD runs `prisma migrate deploy && tsx dist/index.js` — **never** skip or reorder these. Never set a Railway Root Directory; use config-as-code at `apps/api/railway.json`. Rate limiter is in-memory per-process; multiple replicas effectively double per-user limits (tracked technical debt — move to Redis if we ever actually scale horizontally).

---

## 3. Desktop — `apps/desktop`

Electron 28 + Vite + React 19 + Tailwind. Two TS compilation targets:

- **Renderer** (`src/`) — React; `react-jsx`, DOM libs, `moduleResolution: "bundler"`; output `dist/renderer/`.
- **Main** (`electron/`) — CommonJS + Node resolution; separate `tsconfig.electron.json`; output `dist/electron/`.

### 3.1 Shell + state

`src/App.tsx` mounts `AuthProvider → AuthGuard → App`. Inside: `DndContext`, `LivingBackground` + `BackgroundScrim`, `LeftNav`, routes, `DetailPanel`, `SpotlightModal`, modals (Triage, Confirm, Feedback, CalendarConnect), `AppDropZone`.

- **Data:** TanStack Query v5 (`useQuery`/`useMutation`/`useInfiniteQuery`). Optimistic updates pattern: snapshot in `onMutate`, restore in `onError`. **Every optimistic mutation must snapshot every cache key it touches and restore all of them on error** — partial restoration causes stale visuals (this was a real bug in `useToggleThing` for the Granola meeting cache).
- **Real-time:** SSE (`src/api/sse.ts`). Ticket-authenticated (POST `/events/ticket` with Bearer → short-lived ticket in URL). EventSource is established once inside a `useEffect` with empty deps — do NOT add deps; an earlier version redirected through `[connect]` and opened a fresh EventSource on every render, causing 429 storms. `useSSEHandler` uses an internal ref so inline callbacks from components don't cause the effect to re-subscribe on every render, and closures always read the latest state.
- **React Compiler is enabled.** Do not add `useMemo` / `useCallback` / `React.memo` as general perf prophylaxis — the compiler handles this. The one narrow exception: a custom hook whose returned object identity is consumed as a `useEffect` dep, where the compiler bails (large async closures, deep ref interaction). `useOmnibar` is the canonical example — it wraps its return in `useMemo` and uses `useCallback` + `stateRef` patterns, with a block comment at the top explaining why.

### 3.2 Electron main (`electron/`)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. All privileged ops flow through the `electron/preload.ts` bridge.
- **Token storage:** `safeStorage.encryptString()` + `electron-store`. Production throws if encryption is unavailable; dev has an unencrypted fallback.
- **Google OAuth:** ephemeral `127.0.0.1:<random-port>` HTTP server with a `state` nonce; system browser does the OAuth so passkeys/biometrics work; localhost callback receives the token and stores it via IPC.
- **Custom `app://` protocol** in production (avoids `null` origin from `file://`). The handler `path.resolve()`s and verifies the result stays within `dist/renderer/`.
- **Auto-update:** `electron-updater`, opt-in install-on-quit; the auto-updater lifecycle creates a system "Update Brett to vX.Y.Z" task in Today. The concurrency guard for creating that task is now a `useRef` (was a `let` that reset every render → duplicate tasks).
- **Things 3 import** (macOS only): reads `~/Library/Caches/com.culturedcode.Things3/` via main-process `fs`, posts to `/import/things3` with Bearer.
- **Feedback modal** captures `webContents.capturePage()` + a diagnostics ring buffer of recent API failures / route changes.

### 3.3 Streaming SSE/chat

`src/api/streaming.ts` yields `{ type, content/data, ... }` chunks from `POST` streams. Chunk types: `text`, `tool_call`, `tool_result` (with optional `displayHint`), `done` (carries `sessionId`), `error`. Consumers: `useBrettChat`, `useOmnibar`, `useBriefing`. Tool results with `displayHint: "task_created"` etc. trigger TanStack query invalidation so created Things appear immediately.

---

## 4. iOS — `apps/ios`

XcodeGen (`project.yml`), iOS 18 minimum, Swift 6 strict concurrency, 4 targets (app, share extension, tests, UI tests), 224 Swift files, 405 tests passing.

- **Persistence:** SwiftData, single `ModelContainer` via `PersistenceController.shared`. Models mirror server entities plus `_syncStatus` / `_baseUpdatedAt` / `_lastError` columns, plus sync-specific models `MutationQueueEntry`, `ConflictLogEntry`, `SyncHealth`.
- **Sync engine:** `Sync/PushEngine` (FIFO drain, batch 10, per-mutation idempotency key, field-level reconciliation via `ConflictResolver`, permanent failure threshold 10), `Sync/PullEngine` (cursor pagination with `SyncEntityMapper`), `Sync/MutationQueue` + `MutationCompactor` (collapses redundant CRUD before push). On app launch, `in_flight` rows from a prior crash are reset. The flow is the offline-first mirror of the server's `/sync/push` + `/sync/pull`.
- **SSE:** `Sync/SSEClient` with exponential backoff (1/2/4/8, cap 30 s), 401 → re-ticket, 429 → bump to cap. Events surface through an `AsyncStream<SSEEvent>` to `SSEEventHandler`, which triggers `syncManager.schedulePushDebounced()`. `NetworkMonitor` drives online/offline transitions.
- **Auth:** `AuthManager` is the single source of truth. Three providers: Sign in with Apple, Google (native GoogleSignIn SDK → `/api/auth/ios/google/token`), email/password. `KeychainStore` + App Group so the Share Extension can authenticate; `SharedConfig.writeCurrentUserId()` mirrors userId to prevent cross-user share contamination.
- **AI:** Chat uses the server's streaming endpoints; SmartParser (22+ covered edge cases) parses natural-language input from the omnibar; voice mode uses `SFSpeechRecognizer` + `AVAudioEngine`.
- **Design:** `Theme/` (BrettColors, BrettTypography, GlassCard, BrettAnimations), full VoiceOver / Dynamic Type / High Contrast / Reduce Motion support. Dark mode only.
- **Share extension:** silent-save to App Group queue + best-effort POST to `/share/web`; `ShareIngestor.drain()` on app foreground.

**Parity gaps to track:** APNs/FCM push (scaffold only), widgets, Siri Shortcuts, Spotlight indexing, persistent drag-to-reorder (needs server-side `sortOrder` + push allowlist), `DELETE /users/me` + data export endpoints, `GET /attachments/:id/url`.

---

## 5. Shared packages

- **@brett/types** — pure interfaces. `ItemRecord`, `Thing`, `List`, `CalendarEvent`, `Scout*`, `ConversationMessageRecord`, `StreamChunk`, `DisplayHint`, etc. The `Task` alias is deprecated — use `ItemRecord` + `itemToThing()`.
- **@brett/utils** — `detectContentType`, `isSafeUrl`, `googleColorToGlass`, `validatePassword`, weather conversions, `generateCuid`/`generateId`.
- **@brett/business** — all domain math: `computeUrgency`, `getUserDayBounds`, `itemToThing`, `groupUpcomingThings`, `computeNextDueDate` (RRule), `getTimeSegment`/`getBusynessTier`/`selectImage` (wallpaper logic), validators (`validateCreateItem`, `validateRsvpInput`, `validateThings3Import`, …). **Any domain operation that crosses client boundaries belongs here, not in `apps/*`.**
- **@brett/api-core** — Prisma singleton, better-auth factory, Hono base. Re-exports Prisma enums + models.
- **@brett/ai** — see §7 for the full layout. Providers, skills, memory, embedding, graph, context, orchestrator.
- **@brett/ui** — React components. Web-only. Desktop + admin consume it. Big components: `Omnibar`, `SpotlightModal`, `ThingsList`, `ThingCard`, `InboxView`, `CalendarTimeline`, `ScoutsRoster`, `DailyBriefing`, `BrettThread`, `TriagePopup`, `LivingBackground`. Hooks `useListKeyboardNav`, `useNextUpTimer`.

---

## 6. Operating constraints

- **Multi-user mindset everywhere.** Every query must be `userId`-scoped (either direct column or through a relation like `scout.userId` for `ScoutFinding`). Single-user shortcuts are violations.
- **Backwards-compatible API.** Existing desktop and iOS clients may be on older versions. Additive only; breaking changes need a version bump or migration path.
- **Migration safety.** Two-phase drops and renames; no `CREATE INDEX CONCURRENTLY` inside a transaction (Prisma wraps migrations); always test against production-shaped data.
- **Rate limiter is in-process** — don't assume it's cluster-wide.
- **SSE auth via ticket, never via raw Bearer in a URL.**
- **No tokens in URLs that transit the network** (localhost OAuth callback is the documented exception).
- **All user-facing LLM prompts must append the security block** (see `docs/llm-call-audit.md`). Tool args are JSON-Schema-validated via `ai/skills/validate-args`.
- **List/chrome parity:** any change to list behavior / header treatment / background material must apply to every list view on both platforms (see CLAUDE.md "List behavior consistency" and "List container chrome consistency"). The Omnibar and Spotlight ⌘K must also stay in sync — same skill set, same rendering semantics.

---

## 7. AI layer — `packages/ai` (surface)

Treated separately in the AI deep-dive doc. Key shape:

- `providers/` — `anthropic.ts`, `openai.ts`, `google.ts`, `embedding.ts` (OpenAI), `voyage.ts` + `voyage-rerank.ts`, `factory.getProvider(name, apiKey)`. Common `AIProvider.chat(params): AsyncIterable<StreamChunk>` / `EmbeddingProvider` / `RerankProvider`.
- `router.ts` — `(providerName, tier) → modelId` (`MODEL_MAP`).
- `skills/` — 31 registered skills (task/content CRUD, list ops, search, calendar, meeting notes, scouts, settings, memory recall). `SkillRegistry` groups by intent (query/create/mutate/meta/scout). `validate-args.ts` runs JSON-schema validation before execution. `scoped-queries.ts` enforces user scoping.
- `memory/` — `user-profile` + `facts` (LLM-driven extraction with `INJECTION_PATTERN` / `TAG_INJECTION_PATTERN` guards + category allowlist), `entity-facts`, `consolidation`, `usage` logger.
- `embedding/` — `assembler.ts` (rich record → plain text), `chunker.ts`, `pipeline.ts` / `queue.ts` (async batch processor), `search.ts` (RRF fusion of keyword + vector, Voyage rerank on top), `similarity.ts` (duplicates, list suggestions).
- `graph/` — entity/relationship extraction (`VALID_GRAPH_ENTITY_TYPES`, fixed relationship vocabulary) + `store.ts` upsert + `query.ts` BFS / similarity traversal.
- `retrieval/router.ts` → `unifiedRetrieve` (hybrid search + graph context).
- `context/` — `assembler.ts` + `system-prompts.ts` (parameterized by `assistantName`).
- `orchestrator.ts` — the main loop. Assemble context → stream LLM → parse tool calls → execute skills → feed results back → repeat up to `maxRounds=5`. `FIRE_AND_FORGET_TOOLS` skip the follow-up LLM call. `SIMPLE_TOOLS` escalate tier from small → medium if the tool result needs synthesis. Token usage logged into `AIUsageLog` at end of session. Errors sanitized (redacts `sk-*`, `key-*`, long high-entropy strings).

---

## 8. Testing posture

| Surface | Framework | Notable coverage |
|---|---|---|
| api | Vitest, drives `app.request()` directly | 619 tests across 58 files — auth, sync push/pull, items/lists, calendar, scouts, scout memory, embeddings, knowledge graph, content extraction, newsletters, AI config |
| desktop | Vitest + Testing Library | 121 tests — omnibar, SSE, settings, account deletion dialog, SimpleMarkdown, smoke |
| packages | Vitest | ai (24), business (6), ui (3), utils (4) |
| ios | XCTest + XCUITest | 405 tests — sync engines, conflict resolver, SSE client, SmartParser, views, accessibility, E2E flow |
| evals | Custom runner (`evals/runner.ts`) | intent classification, parameter extraction, briefing quality (LLM-judge), action-item extraction |

**Known gaps worth tests:** rate-limit cleanup, scout consolidation multi-run sequences, full SSE streaming end-to-end over HTTP (currently via `app.request()`), optimistic-update revert on error paths in desktop, scout runner with mocked providers.

---

## 9. Risks / known tech debt

- **In-memory rate limiter** (see §2.6) — effectively ~2× the per-user limit if we ever run multiple API replicas.
- **Cross-model embedding mixing** — `Embedding.model` + `Embedding.dim` are persisted on every write, but hybrid search does not yet filter `WHERE model = <current>`. Add a filter at the query boundary before running any provider swap.
- **Partial-name KG dedup** — `graph/store.ts` canonicalizes names by lowercase + whitespace, so "Stephen Kim" / "Stephen  Kim" / "stephen kim" collapse to one node. Partial-name matching ("Stephen" → "Stephen Kim") still needs embedding-similarity lookup.
- **Assembler test mocks** have drifted from the real API before — a reminder that if you rename prompt helpers or assembler signatures, grep `vi.mock("../system-prompts.js"` and the other mock hubs in `packages/ai/src/**/__tests__/`.
