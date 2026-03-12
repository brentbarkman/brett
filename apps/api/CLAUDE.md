# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory.

## Build & Dev Commands

```bash
pnpm dev              # tsx watch on src/index.ts (auto-reload)
pnpm build            # prisma generate + tsc
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run (requires Postgres)
pnpm test:watch       # vitest in watch mode
```

## Architecture

Hono API server split into two files for testability:

- **`src/app.ts`** — Hono app with routes, CORS, and middleware. Exported for direct use in tests via `app.request()`.
- **`src/index.ts`** — Server entrypoint. Imports `app` and calls `serve()`. Not imported in tests.

### Auth

better-auth handles all authentication. Config is in `src/lib/auth.ts` with the `bearer()` plugin enabled. The auth handler is mounted at `/api/auth/*` — better-auth owns all routes under that path.

The `bearer` plugin allows clients to authenticate via `Authorization: Bearer <token>` header instead of cookies. This is essential for Electron (no reliable cross-origin cookie support) and future mobile support.

Protected routes use the `authMiddleware` from `src/middleware/auth.ts`, which calls `auth.api.getSession()` and sets `user` and `session` on the Hono context. The session lookup works with both bearer tokens and cookies. Use `c.get("user")` and `c.get("session")` in route handlers.

When adding new protected routes, type them with `AuthEnv`:
```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";

const router = new Hono<AuthEnv>();
router.get("/example", authMiddleware, async (c) => {
  const user = c.get("user");
  // ...
});
```

### Database

Prisma client singleton in `src/lib/prisma.ts`. Schema is in `prisma/schema.prisma`. The schema uses better-auth's required table structure (User, Session, Account, Verification).

When modifying the schema:
1. Edit `prisma/schema.prisma`
2. Run `pnpm db:migrate` from root (creates migration + applies it)
3. Prisma client auto-regenerates

### Storage

S3 client in `src/lib/storage.ts` connects to Railway's S3-compatible object storage. Not yet used in routes — infrastructure is in place.

### Testing

Tests use Vitest and import `app` from `src/app.ts` directly (no HTTP server needed). The `src/__tests__/setup.ts` file sets test env vars.

- `health.test.ts` — no DB required, always runnable
- `auth.test.ts` — requires a running Postgres instance

Tests are excluded from `tsconfig.json` (via `"exclude": ["src/__tests__"]`) so they don't affect the production build. Vitest has its own config in `vitest.config.ts`.

### File extensions

This package uses `"type": "module"` — all imports must use `.js` extensions (e.g., `import { prisma } from "./lib/prisma.js"`). This is required for Node.js ESM resolution.

## Shared Package Imports

```typescript
import type { AuthUser } from "@brett/types";
import { generateId } from "@brett/utils";
import { createTask } from "@brett/business";
```
