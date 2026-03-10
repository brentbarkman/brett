# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
pnpm dev                # Run all apps in parallel (Turborepo)
pnpm dev:desktop        # Desktop only
pnpm dev:mobile         # Mobile only
pnpm build              # Build all packages and apps
pnpm typecheck          # Type-check all packages
pnpm lint               # Lint all packages
```

## Stack
- **Monorepo:** pnpm workspaces + Turborepo
- **Desktop:** Electron + Vite + React + TypeScript
- **Mobile:** Expo / React Native + TypeScript
- **UI:** shadcn/ui
- **Backend:** Railway + Postgres

## Architecture

pnpm workspaces + Turborepo monorepo with two apps sharing four packages.

### Dependency Graph

```
@brett/types          ← shared TS interfaces (User, Task, Notification)
  ↑
@brett/utils          ← generic helpers (formatDate, generateId, sleep)
  ↑
@brett/business       ← domain logic (createTask, toggleTask)
  ↑
@brett/desktop        ← Electron + Vite + React (imports all 4 packages)
@brett/mobile         ← Expo SDK 51 + React Native (imports types, utils, business — NOT ui)

@brett/ui             ← web-only React components (Button) — used by desktop only
```

All workspace dependencies use the `workspace:*` protocol.

### Key Config Decisions

- `.npmrc` sets `node-linker=hoisted` — required for Expo/React Native compatibility with pnpm
- `tsconfig.base.json` uses `composite: true` with project references for incremental builds
- Turbo caches build outputs (`dist/`, `.next/`, `build/`) and invalidates on `.env.*local` changes

## Environment Variables

Copy `.env.example` files (root, `apps/desktop/`, `apps/mobile/`) to `.env` and fill in:
- `DATABASE_URL` — Railway Postgres connection string
- `ANTHROPIC_API_KEY` — Claude API key
- `GRANOLA_MCP_ENDPOINT` / `GRANOLA_MCP_API_KEY` — Granola MCP integration
- `FCM_*` — Firebase Cloud Messaging (desktop uses VAPID_KEY; mobile uses SENDER_ID)

## Engineering Principles

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

## Plan Mode Review (for any significant change)

Before starting, ask: **BIG or SMALL change?**
- **BIG:** run all 4 sections, top 3-4 issues each
- **SMALL:** one focused question per section

### 1. Architecture — component boundaries, data flow, scaling, security
### 2. Code Quality — DRY, error handling, tech debt, over/under-engineering  
### 3. Tests — coverage, assertion quality, edge cases, failure scenarios
### 4. Performance — N+1 queries, memory, caching, latency

For each issue: description → why it matters → 2-3 options (with effort/risk/impact) → recommendation → wait for approval.

## Rules
- Always typecheck after changes
- Write failing test before fixing a production bug
- Tell me if something is overengineered, underengineered, or just right
- Prefer adding to shared packages/ over duplicating across apps
- Do NOT commit .env files
