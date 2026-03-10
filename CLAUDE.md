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
