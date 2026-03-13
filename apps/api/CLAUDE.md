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

## Deployment (Railway)

- Dockerfile at `apps/api/Dockerfile`, config-as-code at `apps/api/railway.json`
- Domain: `api.brett.brentbarkman.com`
- Dockerfile `CMD` handles both migration and server start — no `startCommand` in `railway.json`

### Docker Build Rules

- **Do NOT set Root Directory in Railway** — the Dockerfile needs the full monorepo context. Use config-as-code path to point at `apps/api/railway.json`.
- **`tsconfig.base.json` must be copied into the build stage** — shared packages reference it.
- **Shared packages must be copied into the runner stage** — hoisted `node_modules` has symlinks to `../../packages/*`. If those aren't in the runner image, the server crashes silently on import with no error output.
- **Avoid `npx` in start commands** — use `node_modules/.bin/prisma` or put the command in Dockerfile `CMD` directly.
- When modifying the Dockerfile, trace the full layer chain: what's copied in each stage, what symlinks expect to exist, what's missing in the runner.

### Railway Environment

- Railway terminates SSL at the proxy — `c.req.url` inside Hono is `http://`, not `https://`. Always use `BETTER_AUTH_URL` when constructing public-facing URLs.
- Railway sets `PORT` automatically (currently 8080). The custom domain networking must match this port.
- `DATABASE_URL` should reference the internal Railway Postgres URL (not the public one) for services in the same project.

### better-auth Gotchas

- **`__Secure-` cookie prefix in production** — when `BETTER_AUTH_URL` is `https://`, better-auth prefixes cookies with `__Secure-`. When reading cookies, check both `__Secure-better-auth.session_token` and `better-auth.session_token`.
- **`/sign-in/social` is POST-only** — cannot be linked to directly from a browser GET request.
- **OAuth state is stored in cookies** — server-side proxying of `/sign-in/social` loses these cookies and causes `state_mismatch`. The POST must happen from a browser context (e.g., `fetch()` from a served HTML page) so cookies are preserved.
- **`trustedOrigins` must include any origin that POSTs to better-auth** — including the API's own origin if you serve an HTML page that fetches sign-in endpoints.
- **`callbackURL` validation** — better-auth rejects callback URLs whose protocol doesn't match `BETTER_AUTH_URL`. Use `BETTER_AUTH_URL` as the base, not `c.req.url`.

### Security Checklist (auth/OAuth changes)

- [ ] No tokens in URLs that transit the network (localhost-only is acceptable)
- [ ] HMAC-sign any state/callback parameters to prevent forgery
- [ ] Validate port numbers as integers in range 1024-65535
- [ ] Build URLs with `new URL()`, never string concatenation
- [ ] CORS and `trustedOrigins` should not include `localhost` in production

## Shared Package Imports

```typescript
import type { AuthUser } from "@brett/types";
import { generateId } from "@brett/utils";
import { createTask } from "@brett/business";
```
