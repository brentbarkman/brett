# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
pnpm dev                    # Run all apps in parallel (Turborepo)
pnpm dev:full               # Start everything: Postgres + migrations + API + desktop
pnpm dev:api                # API server only
pnpm dev:desktop            # Desktop only
pnpm dev:mobile             # Mobile Metro bundler only
pnpm dev:mobile:simulator   # Full mobile dev: Postgres + API + iOS Simulator
pnpm dev:mobile:device      # Full mobile dev: Postgres + API + ngrok + physical iPhone
pnpm build                  # Build all packages and apps
pnpm typecheck              # Type-check all packages
pnpm lint                   # Lint all packages
pnpm test                   # Run API tests (requires Postgres)
pnpm setup                  # Start Postgres + run migrations
pnpm db:up / db:down        # Start/stop local Postgres + MinIO via Docker
pnpm db:migrate             # Run Prisma migrations
pnpm db:studio              # Open Prisma Studio (DB GUI)
```

## Stack
- **Monorepo:** pnpm workspaces + Turborepo
- **API:** Hono + Prisma + better-auth (deployed on Railway)
- **Desktop:** Electron + Vite + React + TypeScript
- **Mobile:** Expo 55 / React Native + TypeScript (iOS, offline-first with SQLite sync engine)
- **UI:** shadcn/ui
- **Database:** Postgres (Docker Compose locally, Railway in prod)
- **Auth:** better-auth (email/password + Google OAuth + Sign in with Apple, JWT bearer tokens)
- **Storage:** Railway Object Storage (S3-compatible)
- **Notifications:** Firebase Cloud Messaging (planned — notifications only, not auth)
- **React:** v19 with React Compiler enabled (desktop). Do NOT add `useMemo`/`useCallback`/`React.memo` — the compiler handles memoization automatically.

## Architecture

pnpm workspaces + Turborepo monorepo with three apps sharing four packages.

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
@brett/mobile         ← Expo 55 + React Native (imports types, utils, business — NOT ui)
                        Offline-first: SQLite + Drizzle ORM, sync engine, Zustand stores

@brett/ui             ← web-only React components — used by desktop only
```

### Mobile Sync

The mobile app syncs with the API via two endpoints:
- `POST /sync/pull` — incremental pull with per-table cursors, returns upserted + deleted records
- `POST /sync/push` — batched mutations with field-level merge (previousValues comparison)

Mobile writes are offline-first: SQLite → mutation queue → push when online. See `apps/mobile/CLAUDE.md` for details.

All workspace dependencies use the `workspace:*` protocol.

### Key Config Decisions

- `.npmrc` sets `node-linker=hoisted` — required for Expo/React Native compatibility with pnpm
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
