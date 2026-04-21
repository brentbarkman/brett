# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Reference docs

Consult the relevant doc(s) for your task — no need to read all of them every time.

- [`features.md`](features.md) — what the product does, in user language. Fastest way to understand what every surface (Today, Inbox, Calendar, Lists, Scouts, Chat, Briefing, Settings, Omnibar) actually does. Read when you need product context.
- [`architecture.md`](architecture.md) — technical structure: monorepo layout, API routes + data model, desktop / iOS clients, sync engine, operating constraints, tech debt. Skim the ToC; deep-read the section for your task.
- [`ai-deep-dive.md`](ai-deep-dive.md) — the AI layer specifically. Orchestrator, skills, memory/facts, embeddings, prompt caching. Consult before changing anything under `packages/ai/`.
- [`docs/DESIGN_GUIDE.md`](docs/DESIGN_GUIDE.md) — consult before any UI work. Glass-over-chrome system, typography, color, spacing, animations, anti-patterns. iOS and desktop must look like the same product — see the parity rules in the Rules section below.
- [`docs/llm-call-audit.md`](docs/llm-call-audit.md) — every LLM invocation in the codebase with model tier, streaming flag, frequency. Consult when adding a new LLM call site; the shared Security block at the top gets appended to every user-facing prompt.
- [`docs/memory-system.md`](docs/memory-system.md) — how facts, embeddings, and the knowledge graph fit together. Consult when working on memory/retrieval.

**If you update any of these files**, keep them evergreen: no references to a specific chat/session, no "recently fixed" language, no first-person. State what the code does now and why.

## Build & Dev Commands

```bash
pnpm dev                    # Run all apps in parallel (Turborepo)
pnpm dev:full               # Start everything: Postgres + migrations + API + desktop
pnpm dev:api                # API server only
pnpm dev:desktop            # Desktop only
pnpm build                  # Build all packages and apps
pnpm typecheck              # Type-check all packages
pnpm lint                   # Lint all packages
pnpm test                   # Run API tests (requires Postgres)
pnpm setup                  # Start Postgres + run migrations
pnpm db:up / db:down        # Start/stop local Postgres + MinIO via Docker
pnpm db:migrate             # Run Prisma migrations
pnpm db:studio              # Open Prisma Studio (DB GUI)
```

The native iOS app lives at `apps/ios/` (Xcode project; not driven by pnpm). See `apps/ios/BUILD_LOG.md` for its build setup.

## Stack
- **Monorepo:** pnpm workspaces + Turborepo
- **API:** Hono + Prisma + better-auth (deployed on Railway)
- **Desktop:** Electron + Vite + React + TypeScript
- **iOS:** Native Swift / SwiftUI / SwiftData (offline-first with local SQLite sync engine)
- **UI:** shadcn/ui
- **Database:** Postgres (Docker Compose locally, Railway in prod)
- **Auth:** better-auth (email/password + Google OAuth + Sign in with Apple, JWT bearer tokens)
- **Storage:** Railway Object Storage (S3-compatible)
- **Notifications:** Firebase Cloud Messaging (planned — notifications only, not auth)
- **React:** v19.2.0. Two things to know about the packaged Electron build.
  - **React 19.2.0's `startTransition` + React Router v7 `<HashRouter>` silently breaks navigation in the packaged prod bundle.** HashRouter wraps its internal `setState` in `startTransition` by default; the transition commit never fires in `app://` + prod-mode React, so URL updates don't re-render the tree. The fix is a single prop — `<HashRouter unstable_useTransitions={false}>` in `apps/desktop/src/main.tsx`. **Do NOT remove that prop** until a React 19 patch lands that fixes the transition-commit behavior. Reproducible locally with `electron dist/electron/main.js` after `vite build` and verified via CDP: directly dispatching to HashRouter's useState queue re-renders; going through the wrapped setState (with startTransition) does not.
  - **React Compiler is disabled** in `vite.config.ts`. Compiler v1.0.0 had its own closure-hoisting problems with `useSyncExternalStore` subscribers. Hand-written `useMemo` / `useCallback` / `React.memo` is fine where it measurably helps. Revisit once a React 19 patch + a newer `babel-plugin-react-compiler` both ship.

## Architecture

pnpm workspaces + Turborepo monorepo. The TypeScript side is the API, desktop, admin, and shared packages. The native iOS app (`apps/ios/`) lives in the same repo but is an Xcode project — it talks to the same API and shares no build tooling.

### Dependency Graph

```
@brett/types          ← shared TS interfaces (User, AuthUser, Task, Notification)
  ↑
@brett/utils          ← generic helpers (formatDate, generateId, sleep)
  ↑
@brett/business       ← domain logic (createTask, toggleTask)
  ↑
@brett/api            ← Hono + Prisma + better-auth (imports types, utils, business)
@brett/desktop        ← Electron + Vite + React (imports all 4 packages + better-auth client)

@brett/ui             ← web-only React components — used by desktop + admin

apps/ios/             ← native Swift app. Re-implements types/business rules in Swift;
                        talks to @brett/api over HTTP + SSE. Not a workspace package.
```

### Sync (API ↔ iOS)

iOS writes are offline-first. Local SwiftData → mutation queue → push to the API when online.

Two endpoints:
- `POST /sync/pull` — incremental pull with per-table cursors, returns upserted + deleted records
- `POST /sync/push` — batched mutations with field-level merge (previousValues comparison)

The Swift side of this lives under `apps/ios/Brett/Sync/` (`SyncManager`, `PushEngine`, `PullEngine`, `ConflictResolver`, `MutationQueue`, `SSEClient`). See `architecture.md` §4 for the full breakdown.

All TS workspace dependencies use the `workspace:*` protocol.

### Key Config Decisions

- `.npmrc` sets `node-linker=hoisted` — simplifies monorepo resolution under pnpm for tools that don't cope well with symlinked `node_modules`
- `.nvmrc` pins Node 20 — required by Prisma (>= 18.18)
- `tsconfig.base.json` uses `composite: true` with project references for incremental builds
- Turbo caches build outputs (`dist/`, `.next/`, `build/`) and invalidates on `.env.*local` changes

## Environment Variables

Copy `.env.example` files (`apps/api/`, `apps/desktop/`) to `.env` and fill in:
- `DATABASE_URL` — Postgres connection string (defaults to Docker Compose values)
- `BETTER_AUTH_SECRET` — session signing secret (dev default in `.env.example`, generate a real one for prod)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth (optional for dev)
- `STORAGE_*` — S3-compatible object storage (MinIO locally via Docker, Railway in prod). Required for file attachments.
- `VITE_API_URL` — API server URL for desktop (defaults to `http://localhost:3001`)
- `NEWSLETTER_INGEST_SECRET` — Random secret for webhook URL path (generate with `openssl rand -hex 32`)
- `NEWSLETTER_INGEST_EMAIL` — Forwarding address shown in Settings (e.g., `ingest@yourdomain.com`)

Do NOT commit `.env` files.

## Release Process

Brett is in production with real users. All code changes flow through a gated release process.

### Branching Model

```
commit to main → push → CI tests run
main → PR to release → CI tests + deploy → live
```

- **`main`** — development branch. Brent commits and pushes directly. CI (`.github/workflows/ci.yml`) runs typecheck + tests on every push.
- **`release`** — production branch. Merging `main → release` via PR triggers the full deploy pipeline (`.github/workflows/release.yml`): tests → Railway API deploy → health check → desktop build → artifact upload.
- **Never push directly to `release`.** Always go through a PR from `main`.
- **Never force-push to `main` or `release`.**

### Deploying

To cut a release: open a PR from `main` to `release` on GitHub, review the diff, merge. The deploy pipeline runs automatically.

### Rolling Back

If a release breaks production: revert the merge commit on `release` and push. This triggers a redeploy of the previous known-good state.

### Migration Safety

Every Prisma migration runs automatically on deploy (`prisma migrate deploy` in the Dockerfile CMD). This means a bad migration hits production the moment `release` is updated. Rules:

- **No destructive migrations without a two-phase approach.** To drop a column: (1) deploy code that stops reading/writing it, (2) drop it in a follow-up release.
- **No renaming columns in a single step.** Add the new column, migrate data, deploy code to use it, then drop the old one.
- **Always test migrations locally against a copy of production-shaped data** before merging to `main`.
- **`CREATE INDEX CONCURRENTLY` is not supported inside a transaction** — Prisma migrations run in a transaction by default. If you need a concurrent index, use a raw SQL migration with `-- CreateIndex` comment and test it manually.

## Engineering Principles

Brett is in production. Every change ships to real users. No throwaway code, no "just for me" shortcuts, no untested paths.

Before writing any code, review the plan thoroughly.
Do NOT start implementation until the review is complete and I approve.

For every issue or recommendation:
- Explain the concrete tradeoffs
- Give an opinionated recommendation
- Ask for my input before proceeding

Principles:
- Prefer DRY — aggressively flag duplication
- Well-tested code is mandatory
- "Engineered enough" — not fragile, not over-engineered
- Prefer explicit over clever
- **Multi-user mindset** — never assume a single user. Every query must be scoped to `userId`. Every UI state must handle concurrent accounts. Every feature must work for user N, not just user 1.
- **No hardcoded user-specific data** — no special-casing behavior for a specific account, email, or ID. If it can't work for every user, it doesn't ship.
- **Backwards-compatible API changes** — existing clients (desktop, mobile) may be on older versions. Additive changes only; breaking changes require versioning or a migration path.

## Plan Mode Review (for any significant change)

Before starting, ask: **BIG or SMALL change?**
- **BIG:** run all 4 sections, top 3-4 issues each
- **SMALL:** one focused question per section

### 1. Architecture — component boundaries, data flow, scaling, security
### 2. Code Quality — DRY, error handling, tech debt, over/under-engineering
### 3. Tests — coverage, assertion quality, edge cases, failure scenarios
### 4. Performance — N+1 queries, memory, caching, latency

For each issue: description → why it matters → 2-3 options (with effort/risk/impact) → recommendation → wait for approval.

## UX & Design

**Before making any frontend/UI changes, read [`docs/DESIGN_GUIDE.md`](docs/DESIGN_GUIDE.md).**

It contains the full design system: surface patterns, color system, typography, spacing, animation rules, component patterns, and anti-patterns. All UI work must follow it.

## Rules
- Always typecheck after changes
- Write failing test before fixing a production bug
- Tell me if something is overengineered, underengineered, or just right
- Prefer adding to shared packages/ over duplicating across apps
- Do NOT commit .env files
- When doing deployment/infra work, do a full security review pass before committing
- When modifying the Docker build, mentally trace the full layer chain — what's copied, what's missing, what symlinks expect
- **List behavior consistency:** When changing how any list view works (Inbox, Today, Upcoming, custom lists), the same behavior MUST apply to ALL list views. There are three list components: `InboxView` (uses `InboxItemRow`), `ThingsList` (uses `ThingCard`, powers Today + custom lists), and `UpcomingView` (uses `ThingCard`). If you're not sure whether a change makes sense across all views, ask before implementing.
- **List container chrome consistency (iOS + desktop):** The visual chrome of list containers — header treatment (icon? color? count placement?), background material, border, corner radius — MUST be identical across every list-bearing surface. On iOS that's `TaskSection` (Today), `InboxPage.inboxCard` (Inbox), `ListView.stickyHeaderContent` (custom lists), `DailyBriefing`, `NextUpCard`, `ScoutsRosterView`, etc. On desktop it's `ThingsList`, `InboxView`, `UpcomingView`, `DailyBriefing`. If you're tweaking ONE container's header/background/border, apply the same tweak to ALL containers, OR explicitly justify why this one is different.
- **iOS ↔ Desktop visual parity:** The two clients should look like the same product. Before adding a visual flourish to either platform, check whether the OTHER platform does it too. If desktop has it and iOS doesn't (or vice versa), align them. Common drift points: section-header icons (desktop has none, iOS used to have them), card borders (desktop tints AI-surface borders cerulean, iOS now matches), title color (desktop uses neutral white/40 for ALL section labels, iOS used to use gold/colored). Reference the relevant desktop component before designing an iOS one.
- **Omnibar + ⌘K Spotlight consistency:** The Omnibar (`packages/ui/src/Omnibar.tsx`) and ⌘K Spotlight (`packages/ui/src/SpotlightModal.tsx`) are two surfaces for the same feature. When editing either one, you MUST apply the same change to the other. If you're not sure whether a change makes sense in both, ask before implementing. They share the same hook (`apps/desktop/src/api/omnibar.ts`) but have separate rendering — keep them in sync.
- **Settings deep-links:** Any UI element that sends the user to Settings MUST deep-link to the correct settings tab using the hash fragment (e.g., `/settings#ai-providers`, `/settings#calendar`, `/settings#timezone-location`). Never link to bare `/settings` when the intent is a specific section. Valid tab hashes: `#profile`, `#security`, `#calendar`, `#ai-providers`, `#newsletters`, `#timezone-location`, `#import`, `#updates`, `#account`.

## Process: Exploratory / Infra Work

When doing deployment, infra, or cross-cutting work (anything touching Docker, Railway, auth, Electron packaging):

1. **Before implementing:** Think through the full request lifecycle end-to-end — what runs where, what env vars are available, what protocols/origins are in play, what cookies exist. Write down assumptions.
2. **Before committing:** Re-read every changed file and ask "what will this look like in production?" Check for:
   - HTTP vs HTTPS, localhost vs production URLs
   - Cookie names/prefixes that change by environment
   - Env vars that exist in dev but not in production (or vice versa)
   - File paths that differ between dev, built, and packaged contexts
3. **After a fix:** Don't just fix forward — check if the same category of mistake exists elsewhere. If you fixed a cookie name, check all cookie reads. If you fixed a URL protocol, check all URL constructions.
4. **Security review:** Do a dedicated pass before merging any auth/infra change. Don't combine it with the implementation — fresh eyes catch more.
