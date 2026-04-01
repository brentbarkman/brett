# Admin Panel Design

**Date:** 2026-03-31
**Status:** Draft

## Overview

A standalone admin panel for Brett — separate web frontend and separate API service — providing operational visibility, data management, and system controls for a solo operator. Isolated from the main app at the process and deployment level, sharing only the database and extracted common API infrastructure.

## Decisions

- **Audience:** Solo operator (just Brent). No multi-tenant, no RBAC beyond a role enum.
- **Auth:** Reuse better-auth with a `role` enum (`user | admin`) on the User model. No separate auth system.
- **Architecture:** Separate frontend (Vite SPA) + separate API (Hono) — both as independent Railway services. Shared infrastructure extracted into `@brett/api-core`.
- **Frontend stack:** React + Vite + Tailwind. Glass design system adapted for data density. Fixed left sidebar layout.
- **Observability boundary:** Domain-specific stats in the admin panel (scout outcomes, AI spend, user counts). Real-time monitoring and alerting delegated to dedicated tools (Grafana, Railway built-ins).
- **Admin frontend hosting:** Static deploy — Railway or Cloudflare Pages.

## Data Model Changes

### User role enum

```prisma
enum UserRole {
  user
  admin
}
```

Add to User model:

```prisma
model User {
  // ... existing fields
  role  UserRole @default(user)
}
```

No separate admin table. No permissions matrix. A single enum field, extensible later (`support`, `viewer`, etc.).

Admin role is granted via direct DB update or CLI command. No self-service promotion endpoint for non-admin users.

### better-auth configuration

The `role` field must be exposed on `session.user` via better-auth's `additionalFields` config (better-auth only returns built-in fields by default):

```typescript
// In @brett/api-core auth setup
user: {
  additionalFields: {
    role: { type: "string", defaultValue: "user", fieldName: "role" }
  }
}
```

Without this, `session.user.role` would be `undefined` and the `requireAdmin()` check would silently block all admin access.

## New Package: `@brett/api-core`

Extract shared API infrastructure from `apps/api` into `packages/api-core`.

### What moves to `@brett/api-core`:

- **Prisma client setup** — client instantiation, connection management
- **Auth configuration** — better-auth setup, `bearer()` plugin, trusted origins (parameterized — see `createBaseApp()` below)
- **Base middleware** — `authMiddleware`, error handling, request logging
- **New: `requireAdmin()` middleware** — checks `session.user.role === 'admin'`, returns 403
- **Shared utilities** — response formatters, pagination helpers, common Hono patterns

### What stays in `apps/api`:

- All existing route handlers (things, lists, scouts, calendar, AI, etc.)
- Domain-specific middleware (`requireSecret()` for cron jobs)
- SSE event system
- App-specific config

### Package interface:

```typescript
// packages/api-core/src/index.ts
export { prisma } from './prisma'
export { auth, authMiddleware } from './auth'
export { requireAdmin } from './middleware/require-admin'
export { errorHandler } from './middleware/error-handler'
export { createBaseApp } from './app'  // pre-configured Hono instance
```

### `createBaseApp()` interface

`createBaseApp()` accepts configuration to parameterize per-service differences:

```typescript
interface BaseAppOptions {
  trustedOrigins: string[]   // better-auth trusted origins
  corsOrigins: string[]      // CORS allowed origins
}

// Main API usage:
createBaseApp({
  trustedOrigins: ["app://.", "http://localhost:5173", process.env.BETTER_AUTH_URL],
  corsOrigins: ["app://.", "http://localhost:5173"],
})

// Admin API usage:
createBaseApp({
  trustedOrigins: [process.env.ADMIN_FRONTEND_URL],
  corsOrigins: [process.env.ADMIN_FRONTEND_URL],
})
```

Both services get a Hono instance with auth, error handling, and logging pre-wired, then mount their own routes.

### Database migrations

Migrations are owned by `apps/api` — its Dockerfile runs `prisma migrate deploy` on startup. The admin API connects read/write but never runs migrations. Both services use the same `DATABASE_URL`.

## Admin API (`apps/admin-api`)

Separate Hono server, own Railway service. Connects to the same Postgres via `@brett/api-core`. Every route requires `authMiddleware` + `requireAdmin()` except `/health`.

### Routes

```
GET  /health                          — public health check

# Dashboard
GET  /admin/dashboard/stats           — aggregate stats (users, items, scouts, AI spend as estimated USD)

# Users
GET  /admin/users                     — paginated user list (email, name, role, created, item count)
GET  /admin/users/:id                 — user detail (profile, usage summary, scout count)
PATCH /admin/users/:id/role           — toggle admin role

# Scouts
GET  /admin/scouts                    — all scouts across users (status, last run, error rate)
GET  /admin/scouts/:id                — scout detail (config, recent runs, findings)
GET  /admin/scouts/runs               — recent runs across all scouts
POST /admin/scouts/:id/pause          — pause individual scout
POST /admin/scouts/:id/resume         — resume individual scout
POST /admin/scouts/pause-all          — emergency kill switch
POST /admin/scouts/resume-all         — resume all paused scouts

# AI Usage
GET  /admin/ai/usage                  — token spend by model, tier, source, time range
GET  /admin/ai/usage/daily            — daily spend trend
GET  /admin/ai/sessions               — recent conversation sessions with metadata

# System
GET  /admin/system/config             — current feature flags / runtime config
```

### Migration from main API

- Remove `src/routes/admin-scouts.ts` and the `requireSecret()` pattern from main API
- Remove `ADMIN_SECRET` env var
- Keep `/internal/scouts` (cron-triggered) in main API with existing `SCOUT_TICK_SECRET` auth

## Admin Frontend (`apps/admin`)

### Stack

- Vite + React + TypeScript SPA (no Electron)
- React Router for routing
- Tailwind CSS with glass system adapted for data density
- Auth via better-auth client, Google OAuth only for admin login
- Bearer token auth against admin API

### Layout

Fixed left sidebar navigation with five sections:

1. **Dashboard** — stat cards (users, scouts, AI spend, error rate) + recent scout runs table
2. **Users** — paginated table, click-through to user detail
3. **Scouts** — all scouts across users, per-scout controls, run inspector
4. **AI Usage** — spend by model/tier/source, daily trends, session list
5. **System** — feature flags, runtime config

### Design adaptation

Glass aesthetic from `@brett/ui` adapted for admin data density:

- Tighter spacing: `gap-1.5`, `p-3` defaults instead of `gap-2`, `p-4`
- Smaller text defaults for table content
- Same surface pattern: `bg-black/30 backdrop-blur-xl rounded-xl border border-white/10`
- Same section headers: `font-mono text-xs uppercase tracking-wider text-white/40`
- Data tables with `border-bottom: 1px solid rgba(255,255,255,0.06)` row separators
- Status badges: green (success), red (failed), amber (warning), blue (active)

### Components

- Import from `@brett/ui` where applicable (buttons, dialogs, badges, skeletons)
- Admin-specific components built locally: `DataTable`, `StatCard`, `LogViewer`, `UserDetail`, `ScoutInspector`
- No shadcn dependency — uses `@brett/ui` for shared components and custom glass-pattern components for admin-specific needs

### Error and loading states

Follow patterns from `DESIGN_GUIDE.md`:

- Skeleton loaders for initial data fetching (never "Loading..." text)
- Inline error display for failed API requests (never toast notifications)
- Redirect to login on 401 responses
- Empty states with contextual messaging (e.g., "No scout runs in the last 24 hours")

## Deployment & Security

### Infrastructure

- **Admin frontend:** Static deploy on Railway or Cloudflare Pages (edge-cached, free tier)
- **Admin API:** Own Railway service, own Dockerfile (same multi-stage pattern as main API)
- **Database:** Same Postgres instance as main API
- **HTTPS:** Both services behind HTTPS

### Security layers

1. **Auth gate:** Every admin API route requires valid session + `role === 'admin'`
2. **CORS:** Admin API only accepts requests from admin frontend origin (`ADMIN_FRONTEND_URL` env var)
3. **No self-promotion:** Non-admin users cannot grant themselves admin. The `PATCH /admin/users/:id/role` endpoint requires existing admin auth. Guard against the last admin demoting themselves.
4. **Shared sessions:** Both services share the same `BETTER_AUTH_SECRET` and database, so a session token is valid across both APIs. The admin frontend must check `user.role` after login and show an "insufficient permissions" screen if `role !== 'admin'` — login itself will succeed for any valid user.
5. **Separate deploy:** Admin frontend URL not discoverable from main app — no links, no references
6. **Rate limiting:** Auth endpoints rate-limited
7. **Future:** IP allowlisting at Railway/Cloudflare level

### Environment variables (admin API)

- `DATABASE_URL` — same Postgres connection string
- `BETTER_AUTH_SECRET` — same session signing secret
- `BETTER_AUTH_URL` — admin API's own URL
- `ADMIN_FRONTEND_URL` — admin frontend origin for CORS
- `GOOGLE_CLIENT_ID` — Google OAuth client ID (same as main API)
- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret (same as main API)
- `PORT` — server port (Railway auto-assigns)

## Feature Tiers

### Tier 1 — Launch

- Dashboard with aggregate stats
- Scout management (migrated from main API + per-scout controls)
- AI usage tracking (spend by model/tier, daily trends)
- User management (list, view details, toggle admin role)

### Tier 2 — Fast follow

- Audit log viewer (requires adding audit log table + logging to main API)
- Scout run inspector (drill into individual runs, search queries, findings, errors)
- System config page (feature flags, rate limits, maintenance mode)
- Lightweight read-only database explorer for key tables

### Tier 3 — Later

- Custom domain-specific dashboards beyond what Grafana provides
- Bulk operations (mass pause scouts, data exports)
- Links/embeds to external observability tools
- Analytics (user engagement, retention, feature usage)

## Dependency Graph (updated)

```
@brett/types          ← shared TS interfaces
  ↑
@brett/utils          ← generic helpers
  ↑
@brett/business       ← domain logic
  ↑
@brett/api-core       ← Prisma client, auth, base middleware (NEW)
  ↑
@brett/api            ← Hono user-facing API (refactored to import api-core)
@brett/admin-api      ← Hono admin API (imports api-core)
@brett/desktop        ← Electron app
@brett/admin          ← Admin web SPA (imports ui, types)
@brett/mobile         ← Expo app (deferred)

@brett/ui             ← React component library (used by desktop + admin)
```

Package names in `package.json` follow the existing convention: `apps/admin-api` → `"name": "@brett/admin-api"`, `apps/admin` → `"name": "@brett/admin"`.

## AI Spend Calculation

AI spend is computed from token counts in the `AIUsageLog` table using hardcoded per-model pricing constants maintained in `@brett/utils` (or `@brett/api-core`). The admin dashboard displays both raw token counts and estimated USD cost. Pricing constants are updated manually when provider pricing changes.
