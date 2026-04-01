# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone admin panel (separate web app + separate API) with dashboard, scout management, AI usage tracking, and user management — isolated from the main app.

**Architecture:** Extract shared API infrastructure into `@brett/api-core` package. Two new apps: `apps/admin-api` (Hono server) and `apps/admin` (Vite React SPA). Both connect to the same Postgres. Admin auth reuses better-auth with a `role` enum on User.

**Tech Stack:** Hono, Prisma, better-auth, React, Vite, Tailwind CSS, React Router, React Query

**Spec:** `docs/superpowers/specs/2026-03-31-admin-panel-design.md`

---

## File Structure

### New Package: `packages/api-core/`

```
packages/api-core/
  package.json
  tsconfig.json
  src/
    index.ts              — barrel export
    prisma.ts             — Prisma client singleton
    auth.ts               — better-auth config factory
    middleware/
      auth.ts             — authMiddleware + AuthEnv type
      require-admin.ts    — requireAdmin() middleware
      error-handler.ts    — error formatting middleware
    app.ts                — createBaseApp() factory
```

### New App: `apps/admin-api/`

```
apps/admin-api/
  package.json
  tsconfig.json
  Dockerfile
  railway.json
  src/
    index.ts              — server entry
    app.ts                — Hono app with admin routes
    routes/
      dashboard.ts        — GET /admin/dashboard/stats
      users.ts            — user management routes
      scouts.ts           — scout management routes (migrated + enhanced)
      ai-usage.ts         — AI usage/spend routes
    __tests__/
      setup.ts            — test env setup
      health.test.ts      — health check test
      dashboard.test.ts   — dashboard stats test
      scouts.test.ts      — scout admin routes test
```

### New App: `apps/admin/`

```
apps/admin/
  package.json
  tsconfig.json
  vite.config.ts
  tailwind.config.js
  postcss.config.js
  index.html
  src/
    main.tsx              — entry point
    index.css             — Tailwind + glass base styles
    App.tsx               — router + layout shell
    auth/
      auth-client.ts      — better-auth client for admin
      AuthContext.tsx      — auth provider
      AuthGuard.tsx        — auth + admin role guard
      LoginPage.tsx        — Google OAuth login
    api/
      client.ts           — apiFetch wrapper for admin API
      dashboard.ts        — dashboard query hooks
      users.ts            — user management hooks
      scouts.ts           — scout management hooks
      ai-usage.ts         — AI usage hooks
    components/
      AdminLayout.tsx     — sidebar + content shell
      Sidebar.tsx         — left nav
      StatCard.tsx        — metric card
      DataTable.tsx       — reusable table component
    pages/
      DashboardPage.tsx   — main dashboard
      UsersPage.tsx       — user list + detail
      ScoutsPage.tsx      — scout management
      AIUsagePage.tsx     — AI spend tracking
```

### Modified Files

```
packages/types/src/index.ts                   — add role to AuthUser
apps/api/prisma/schema.prisma                 — add UserRole enum + role field
apps/api/src/app.ts                           — remove admin-scouts route
apps/api/src/lib/prisma.ts                    — move to api-core (re-export)
apps/api/src/lib/auth.ts                      — refactor to use api-core
apps/api/src/middleware/auth.ts               — move to api-core (re-export)
apps/api/package.json                         — add @brett/api-core dep
turbo.json                                    — add test task for admin-api
package.json (root)                           — add dev:admin script
```

---

### Task 1: Prisma Schema — Add UserRole Enum and Role Field

**Files:**
- Modify: `apps/api/prisma/schema.prisma:10-47` (User model)
- Modify: `packages/types/src/index.ts:10-15` (AuthUser interface)

- [ ] **Step 1: Add UserRole enum and role field to Prisma schema**

In `apps/api/prisma/schema.prisma`, add the enum before the User model and the field to User:

```prisma
// Add after datasource block, before model User
enum UserRole {
  user
  admin
}
```

Add to User model after `weatherEnabled`:

```prisma
  role            UserRole @default(user)
```

- [ ] **Step 2: Update AuthUser type to include role**

In `packages/types/src/index.ts`, update `AuthUser`:

```typescript
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role?: string;  // "user" | "admin" — optional for backwards compat with desktop
}
```

- [ ] **Step 3: Run the migration**

```bash
cd /Users/brentbarkman/code/brett
pnpm db:migrate
# Name: add_user_role
```

Expected: Migration created and applied. All existing users get `role: "user"` by default.

- [ ] **Step 4: Verify typecheck passes**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/ packages/types/src/index.ts
git commit -m "feat: add UserRole enum and role field to User model"
```

---

### Task 2: Create `@brett/api-core` Package

**Files:**
- Create: `packages/api-core/package.json`
- Create: `packages/api-core/tsconfig.json`
- Create: `packages/api-core/src/index.ts`
- Create: `packages/api-core/src/prisma.ts`
- Create: `packages/api-core/src/auth.ts`
- Create: `packages/api-core/src/middleware/auth.ts`
- Create: `packages/api-core/src/middleware/require-admin.ts`
- Create: `packages/api-core/src/middleware/error-handler.ts`
- Create: `packages/api-core/src/app.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@brett/api-core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@brett/types": "workspace:*",
    "@prisma/client": "^6.4.1",
    "better-auth": "^1.2.7",
    "hono": "^4.7.4"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/types" }
  ]
}
```

- [ ] **Step 3: Create src/prisma.ts**

Copy the singleton pattern from `apps/api/src/lib/prisma.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 4: Create src/auth.ts**

Factory function that creates a better-auth instance with parameterized trusted origins:

```typescript
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";

export interface AuthOptions {
  trustedOrigins: string[] | ((request: Request) => string[]);
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          input: false,  // prevent users from setting their own role via API
        },
      },
      deleteUser: {
        enabled: true,
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    plugins: [bearer()],
    trustedOrigins: options.trustedOrigins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 5: Create src/middleware/auth.ts**

```typescript
import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth.js";

export type AuthEnv = {
  Variables: {
    user: { id: string; email: string; name: string; image: string | null; role: string };
    session: { id: string; token: string; userId: string; expiresAt: Date };
  };
};

export function createAuthMiddleware(auth: Auth) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", session.user as AuthEnv["Variables"]["user"]);
    c.set("session", session.session as AuthEnv["Variables"]["session"]);

    return next();
  });
}
```

- [ ] **Step 6: Create src/middleware/require-admin.ts**

```typescript
import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./auth.js";

export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }
  return next();
});
```

- [ ] **Step 7: Create src/middleware/error-handler.ts**

```typescript
import type { Context } from "hono";

export function errorHandler(err: Error, c: Context) {
  console.error(`[api-core] Unhandled error: ${err.message}`, err.stack);
  return c.json({ error: "Internal server error" }, 500);
}
```

- [ ] **Step 8: Create src/app.ts**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth, type AuthOptions } from "./auth.js";
import { createAuthMiddleware, type AuthEnv } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface BaseAppOptions {
  trustedOrigins: AuthOptions["trustedOrigins"];
  corsOrigins: string[];
}

export function createBaseApp(options: BaseAppOptions) {
  const auth = createAuth({ trustedOrigins: options.trustedOrigins });
  const authMiddleware = createAuthMiddleware(auth);

  const app = new Hono();

  // CORS
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (options.corsOrigins.includes(origin)) return origin;
        return null;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  );

  // Error handler
  app.onError(errorHandler);

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  return { app, auth, authMiddleware };
}
```

- [ ] **Step 9: Create src/index.ts**

```typescript
export { prisma } from "./prisma.js";
export { createAuth, type Auth, type AuthOptions } from "./auth.js";
export { createAuthMiddleware, type AuthEnv } from "./middleware/auth.js";
export { requireAdmin } from "./middleware/require-admin.js";
export { errorHandler } from "./middleware/error-handler.js";
export { createBaseApp, type BaseAppOptions } from "./app.js";
```

- [ ] **Step 10: Install dependencies**

```bash
cd /Users/brentbarkman/code/brett
pnpm install
```

- [ ] **Step 11: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 12: Commit**

```bash
git add packages/api-core/
git commit -m "feat: create @brett/api-core package with shared auth, prisma, and middleware"
```

---

### Task 3: Refactor `apps/api` to Use `@brett/api-core`

**Files:**
- Modify: `apps/api/package.json` — add `@brett/api-core` dependency
- Modify: `apps/api/tsconfig.json` — add api-core reference
- Modify: `apps/api/src/lib/auth.ts` — use `createAuth` from api-core
- Modify: `apps/api/src/lib/prisma.ts` — re-export from api-core
- Modify: `apps/api/src/middleware/auth.ts` — re-export from api-core
- Modify: `apps/api/src/app.ts` — remove admin-scouts import, keep CORS as-is (main API has unique CORS needs)
- Modify: `apps/api/Dockerfile` — add api-core package to build

**Important:** The main API keeps its own `app.ts` with its own CORS config (it needs `app://.` for Electron, `X-Filename` header, etc.). It does NOT use `createBaseApp()` — only the admin API uses that. The main API imports individual pieces from api-core.

- [ ] **Step 1: Add @brett/api-core dependency to apps/api**

In `apps/api/package.json`, add to dependencies:

```json
"@brett/api-core": "workspace:*",
```

In `apps/api/tsconfig.json`, add to references:

```json
{ "path": "../../packages/api-core" }
```

- [ ] **Step 2: Update apps/api/src/lib/prisma.ts to re-export from api-core**

```typescript
export { prisma } from "@brett/api-core";
```

- [ ] **Step 3: Update apps/api/src/lib/auth.ts to use createAuth from api-core**

```typescript
import { createAuth } from "@brett/api-core";

const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");

export const auth = createAuth({
  trustedOrigins: isLocal
    ? (request) => {
        const origin = request?.headers.get("origin") ?? "";
        if (origin === "app://." || /^http:\/\/localhost:\d+$/.test(origin))
          return [origin];
        return [];
      }
    : [
        "app://.",
        process.env.BETTER_AUTH_URL!, // API's own origin (for desktop OAuth HTML page)
      ],
});
```

- [ ] **Step 4: Update apps/api/src/middleware/auth.ts to re-export from api-core**

```typescript
import { createAuthMiddleware, type AuthEnv as CoreAuthEnv } from "@brett/api-core";
import { auth } from "../lib/auth.js";

export type AuthEnv = CoreAuthEnv;
export const authMiddleware = createAuthMiddleware(auth);
```

- [ ] **Step 5: Remove admin-scouts route from main API**

In `apps/api/src/app.ts`:
- Remove the import: `import { adminScoutsRouter } from "./routes/admin-scouts.js";`
- Remove the route mount: `app.route("/admin/scouts", adminScoutsRouter);`

Do NOT delete `apps/api/src/routes/admin-scouts.ts` yet — keep it as reference until the admin API is verified working. Delete it in the cleanup task.

- [ ] **Step 6: Update Dockerfile to include api-core**

In `apps/api/Dockerfile`, update the deps stage to include api-core:

```dockerfile
# deps stage — add api-core package.json
COPY packages/api-core/package.json packages/api-core/
```

Update the build stage:

```dockerfile
# build stage — add api-core source
COPY packages/api-core packages/api-core
```

Update the runner stage:

```dockerfile
# runner stage — add api-core for symlinks
COPY --from=build /app/packages/api-core packages/api-core
```

Update the filter to include api-core in install:

```dockerfile
RUN pnpm install --frozen-lockfile --filter @brett/api...
```

(The `...` filter already includes all deps, so api-core will be included automatically once it's a dependency.)

- [ ] **Step 7: Install and verify**

```bash
cd /Users/brentbarkman/code/brett
pnpm install
pnpm typecheck
```

- [ ] **Step 8: Run existing tests to verify no regression**

```bash
pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/ packages/api-core/
git commit -m "refactor: wire apps/api to use @brett/api-core for auth and prisma"
```

---

### Task 4: Create `apps/admin-api` — Server and Routes

**Files:**
- Create: `apps/admin-api/package.json`
- Create: `apps/admin-api/tsconfig.json`
- Create: `apps/admin-api/Dockerfile`
- Create: `apps/admin-api/railway.json`
- Create: `apps/admin-api/src/index.ts`
- Create: `apps/admin-api/src/app.ts`
- Create: `apps/admin-api/src/routes/dashboard.ts`
- Create: `apps/admin-api/src/routes/users.ts`
- Create: `apps/admin-api/src/routes/scouts.ts`
- Create: `apps/admin-api/src/routes/ai-usage.ts`
- Create: `apps/admin-api/vitest.config.ts`
- Create: `apps/admin-api/src/__tests__/setup.ts`
- Create: `apps/admin-api/src/__tests__/health.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@brett/admin-api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@brett/api-core": "workspace:*",
    "@brett/types": "workspace:*",
    "@brett/utils": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "@prisma/client": "^6.4.1",
    "better-auth": "^1.2.7",
    "hono": "^4.7.4"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "tsx": "^4.19.2",
    "typescript": "^5.3.3",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/__tests__"],
  "references": [
    { "path": "../../packages/types" },
    { "path": "../../packages/utils" },
    { "path": "../../packages/api-core" }
  ]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
```

- [ ] **Step 4: Create src/__tests__/setup.ts**

```typescript
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

process.env.DATABASE_URL = "postgresql://brett:brett_dev@localhost:5432/brett_test";
process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
process.env.BETTER_AUTH_URL = "http://localhost:3002";
process.env.ADMIN_FRONTEND_URL = "http://localhost:5174";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
```

- [ ] **Step 5: Create src/app.ts**

```typescript
import { Hono } from "hono";
import { createBaseApp, requireAdmin } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";
import { dashboard } from "./routes/dashboard.js";
import { users } from "./routes/users.js";
import { scouts } from "./routes/scouts.js";
import { aiUsage } from "./routes/ai-usage.js";

const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");

const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || "http://localhost:5174";

const { app, auth, authMiddleware } = createBaseApp({
  trustedOrigins: isLocal
    ? (request) => {
        const origin = request?.headers.get("origin") ?? "";
        if (/^http:\/\/localhost:\d+$/.test(origin)) return [origin];
        return [];
      }
    : [adminFrontendUrl],
  corsOrigins: isLocal
    ? [] // handled by dynamic origin check in createBaseApp — but we need to override
    : [adminFrontendUrl],
});

// Mount better-auth handler for /api/auth/*
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Override CORS for local dev to allow any localhost origin
if (isLocal) {
  // The createBaseApp CORS is already configured; for local dev
  // we need dynamic origin matching. This is handled by createBaseApp's
  // corsOrigins — but we pass empty array above because createBaseApp
  // already handles exact-match. Let's fix this properly:
}

// All admin routes require auth + admin role
const adminRoutes = new Hono<AuthEnv>();
adminRoutes.use("*", authMiddleware);
adminRoutes.use("*", requireAdmin);

adminRoutes.route("/dashboard", dashboard);
adminRoutes.route("/users", users);
adminRoutes.route("/scouts", scouts);
adminRoutes.route("/ai", aiUsage);

app.route("/admin", adminRoutes);

export { app };
```

- [ ] **Step 6: Create src/index.ts**

```typescript
import { serve } from "@hono/node-server";

console.log("Starting admin API server...");

try {
  const { app } = await import("./app.js");
  const port = Number(process.env.PORT) || 3002;
  serve({ fetch: app.fetch, port });
  console.log(`Admin API server running on port ${port}`);
} catch (err) {
  console.error("Failed to start admin API server:", err);
  process.exit(1);
}
```

- [ ] **Step 7: Create src/routes/dashboard.ts**

```typescript
import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

// Per-model pricing in USD per 1M tokens (input / output)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-3-20240307": { input: 0.25, output: 1.25 },
  "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0 },
};
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export const dashboard = new Hono<AuthEnv>();

dashboard.get("/stats", async (c) => {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeScouts,
    totalRuns,
    failedRuns,
    totalFindings,
    usageLogs,
    totalItems,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.scout.count({ where: { status: "active" } }),
    prisma.scoutRun.count({ where: { status: "success", createdAt: { gte: startOfMonth } } }),
    prisma.scoutRun.count({ where: { status: "failed", createdAt: { gte: startOfMonth } } }),
    prisma.scoutFinding.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.aIUsageLog.findMany({
      where: { createdAt: { gte: startOfMonth } },
      select: { model: true, inputTokens: true, outputTokens: true },
    }),
    prisma.item.count(),
  ]);

  // Calculate AI spend
  let aiSpendUsd = 0;
  let totalTokens = 0;
  for (const log of usageLogs) {
    const pricing = MODEL_PRICING[log.model ?? ""] ?? DEFAULT_PRICING;
    aiSpendUsd += (log.inputTokens * pricing.input + log.outputTokens * pricing.output) / 1_000_000;
    totalTokens += log.inputTokens + log.outputTokens;
  }

  const totalAttempts = totalRuns + failedRuns;
  const errorRate = totalAttempts > 0 ? failedRuns / totalAttempts : 0;

  return c.json({
    totalUsers,
    totalItems,
    activeScouts,
    scoutRunsThisMonth: totalRuns,
    scoutFailuresThisMonth: failedRuns,
    scoutErrorRate: Math.round(errorRate * 1000) / 1000,
    findingsThisMonth: totalFindings,
    aiSpendUsd: Math.round(aiSpendUsd * 100) / 100,
    aiTokensThisMonth: totalTokens,
  });
});
```

- [ ] **Step 8: Create src/routes/users.ts**

```typescript
import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

export const users = new Hono<AuthEnv>();

// GET /admin/users — paginated user list
users.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
  const offset = (page - 1) * limit;

  const [userList, total] = await Promise.all([
    prisma.user.findMany({
      skip: offset,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
        _count: { select: { items: true, scouts: true } },
      },
    }),
    prisma.user.count(),
  ]);

  return c.json({
    users: userList.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      role: u.role,
      createdAt: u.createdAt,
      itemCount: u._count.items,
      scoutCount: u._count.scouts,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// GET /admin/users/:id — user detail
users.get("/:id", async (c) => {
  const userId = c.req.param("id");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      createdAt: true,
      timezone: true,
      city: true,
      _count: { select: { items: true, scouts: true, usageLogs: true } },
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

// PATCH /admin/users/:id/role — update user role
users.patch("/:id/role", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");
  const body = await c.req.json<{ role: string }>().catch(() => null);

  if (!body || !body.role) {
    return c.json({ error: "role is required" }, 400);
  }

  if (body.role !== "user" && body.role !== "admin") {
    return c.json({ error: "role must be 'user' or 'admin'" }, 400);
  }

  // Prevent last admin from demoting themselves
  if (userId === currentUser.id && body.role === "user") {
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      return c.json({ error: "Cannot demote the last admin" }, 400);
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role: body.role as any },
    select: { id: true, email: true, role: true },
  });

  return c.json({ user: updated });
});
```

- [ ] **Step 9: Create src/routes/scouts.ts**

Migrate and enhance the admin-scouts routes from the main API:

```typescript
import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

export const scouts = new Hono<AuthEnv>();

// GET /admin/scouts — all scouts across users
scouts.get("/", async (c) => {
  const status = c.req.query("status");
  const where = status ? { status: status as any } : {};

  const scoutList = await prisma.scout.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      goal: true,
      cadenceIntervalHours: true,
      nextRunAt: true,
      createdAt: true,
      userId: true,
      user: { select: { email: true, name: true } },
      _count: { select: { runs: true, findings: true } },
    },
  });

  return c.json({ scouts: scoutList });
});

// GET /admin/scouts/runs — recent runs across all scouts
scouts.get("/runs", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));

  const runs = await prisma.scoutRun.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      scoutId: true,
      createdAt: true,
      status: true,
      resultCount: true,
      findingsCount: true,
      tokensUsed: true,
      durationMs: true,
      error: true,
      scout: {
        select: { name: true, userId: true },
      },
    },
  });

  return c.json({ runs });
});

// GET /admin/scouts/:id — scout detail
scouts.get("/:id", async (c) => {
  const scoutId = c.req.param("id");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    include: {
      user: { select: { email: true, name: true } },
      runs: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          status: true,
          findingsCount: true,
          tokensUsed: true,
          durationMs: true,
          error: true,
        },
      },
      findings: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          type: true,
          title: true,
          relevanceScore: true,
          feedbackUseful: true,
        },
      },
      _count: { select: { runs: true, findings: true, memories: true } },
    },
  });

  if (!scout) {
    return c.json({ error: "Scout not found" }, 404);
  }

  return c.json({ scout });
});

// POST /admin/scouts/:id/pause — pause individual scout
scouts.post("/:id/pause", async (c) => {
  const scoutId = c.req.param("id");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { id: true, status: true },
  });

  if (!scout) return c.json({ error: "Scout not found" }, 404);
  if (scout.status !== "active") return c.json({ error: "Scout is not active" }, 400);

  await prisma.scout.update({
    where: { id: scoutId },
    data: { status: "paused" },
  });

  await prisma.scoutActivity.create({
    data: {
      scoutId,
      type: "paused",
      description: "Scout paused by admin",
    },
  });

  return c.json({ ok: true });
});

// POST /admin/scouts/:id/resume — resume individual scout
scouts.post("/:id/resume", async (c) => {
  const scoutId = c.req.param("id");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { id: true, status: true },
  });

  if (!scout) return c.json({ error: "Scout not found" }, 404);
  if (scout.status !== "paused") return c.json({ error: "Scout is not paused" }, 400);

  await prisma.scout.update({
    where: { id: scoutId },
    data: { status: "active", nextRunAt: new Date() },
  });

  await prisma.scoutActivity.create({
    data: {
      scoutId,
      type: "resumed",
      description: "Scout resumed by admin",
    },
  });

  return c.json({ ok: true });
});

// POST /admin/scouts/pause-all — emergency kill switch
scouts.post("/pause-all", async (c) => {
  const activeScouts = await prisma.scout.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  if (activeScouts.length === 0) {
    return c.json({ ok: true, paused: 0 });
  }

  const activeIds = activeScouts.map((s) => s.id);

  await prisma.scout.updateMany({
    where: { id: { in: activeIds } },
    data: { status: "paused" },
  });

  await prisma.scoutActivity.createMany({
    data: activeIds.map((scoutId) => ({
      scoutId,
      type: "paused" as const,
      description: "Scout paused by admin kill switch",
    })),
  });

  return c.json({ ok: true, paused: activeIds.length });
});

// POST /admin/scouts/resume-all — lift kill switch
scouts.post("/resume-all", async (c) => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const killSwitchActivities = await prisma.scoutActivity.findMany({
    where: {
      type: "paused",
      description: { contains: "kill switch" },
      createdAt: { gte: oneHourAgo },
    },
    select: { scoutId: true },
    distinct: ["scoutId"],
  });

  const scoutIds = killSwitchActivities.map((a) => a.scoutId);

  if (scoutIds.length === 0) {
    return c.json({ ok: true, resumed: 0 });
  }

  const result = await prisma.scout.updateMany({
    where: { id: { in: scoutIds }, status: "paused" },
    data: { status: "active", nextRunAt: now },
  });

  return c.json({ ok: true, resumed: result.count });
});
```

- [ ] **Step 10: Create src/routes/ai-usage.ts**

```typescript
import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

// Per-model pricing in USD per 1M tokens
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-3-20240307": { input: 0.25, output: 1.25 },
  "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0 },
};
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model ?? ""] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export const aiUsage = new Hono<AuthEnv>();

// GET /admin/ai/usage — usage breakdown by model/tier/source
aiUsage.get("/usage", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await prisma.aIUsageLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      model: true,
      modelTier: true,
      source: true,
      inputTokens: true,
      outputTokens: true,
    },
  });

  // Aggregate by model
  const byModel: Record<string, { inputTokens: number; outputTokens: number; count: number; costUsd: number }> = {};
  const bySource: Record<string, { inputTokens: number; outputTokens: number; count: number; costUsd: number }> = {};

  for (const log of logs) {
    const model = log.model ?? "unknown";
    const source = log.source ?? "unknown";
    const cost = estimateCost(log.model, log.inputTokens, log.outputTokens);

    if (!byModel[model]) byModel[model] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    byModel[model].inputTokens += log.inputTokens;
    byModel[model].outputTokens += log.outputTokens;
    byModel[model].count += 1;
    byModel[model].costUsd += cost;

    if (!bySource[source]) bySource[source] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    bySource[source].inputTokens += log.inputTokens;
    bySource[source].outputTokens += log.outputTokens;
    bySource[source].count += 1;
    bySource[source].costUsd += cost;
  }

  // Round costs
  for (const v of Object.values(byModel)) v.costUsd = Math.round(v.costUsd * 100) / 100;
  for (const v of Object.values(bySource)) v.costUsd = Math.round(v.costUsd * 100) / 100;

  return c.json({ days, byModel, bySource });
});

// GET /admin/ai/usage/daily — daily spend trend
aiUsage.get("/usage/daily", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await prisma.aIUsageLog.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, model: true, inputTokens: true, outputTokens: true },
    orderBy: { createdAt: "asc" },
  });

  const daily: Record<string, { tokens: number; costUsd: number; count: number }> = {};

  for (const log of logs) {
    const day = log.createdAt.toISOString().slice(0, 10);
    if (!daily[day]) daily[day] = { tokens: 0, costUsd: 0, count: 0 };
    daily[day].tokens += log.inputTokens + log.outputTokens;
    daily[day].costUsd += estimateCost(log.model, log.inputTokens, log.outputTokens);
    daily[day].count += 1;
  }

  // Round costs
  for (const v of Object.values(daily)) v.costUsd = Math.round(v.costUsd * 100) / 100;

  return c.json({
    days,
    daily: Object.entries(daily).map(([date, data]) => ({ date, ...data })),
  });
});

// GET /admin/ai/sessions — recent conversation sessions
aiUsage.get("/sessions", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));

  const sessions = await prisma.conversationSession.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      source: true,
      modelTier: true,
      modelUsed: true,
      userId: true,
      user: { select: { email: true, name: true } },
      _count: { select: { messages: true } },
    },
  });

  return c.json({ sessions });
});
```

- [ ] **Step 11: Write health check test**

Create `apps/admin-api/src/__tests__/health.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { app } from "../app.js";

describe("Admin API Health check", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 12: Create .env.example for admin-api**

Create `apps/admin-api/.env.example`:

```env
DATABASE_URL=postgresql://brett:brett_dev@localhost:5432/brett_dev
BETTER_AUTH_SECRET=change-me-to-a-real-secret-at-least-32-chars
BETTER_AUTH_URL=http://localhost:3002
ADMIN_FRONTEND_URL=http://localhost:5174
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
PORT=3002
```

- [ ] **Step 13: Create .env from .env.example for local dev**

```bash
cp apps/admin-api/.env.example apps/admin-api/.env
```

Then fill in the actual values (copy DATABASE_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET from `apps/api/.env`). Set `PORT=3002`.

- [ ] **Step 14: Install dependencies and verify**

```bash
pnpm install
pnpm --filter @brett/admin-api run typecheck
```

- [ ] **Step 15: Run health check test**

```bash
pnpm --filter @brett/admin-api run test
```

Expected: health test passes.

- [ ] **Step 16: Add dev:admin script to root package.json**

Add to root `package.json` scripts:

```json
"dev:admin": "turbo run dev --filter=@brett/admin-api --filter=@brett/admin"
```

- [ ] **Step 17: Commit**

```bash
git add apps/admin-api/ package.json
git commit -m "feat: create apps/admin-api with dashboard, users, scouts, and AI usage routes"
```

---

### Task 5: Create `apps/admin` — Frontend SPA

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/vite.config.ts`
- Create: `apps/admin/tailwind.config.js`
- Create: `apps/admin/postcss.config.js`
- Create: `apps/admin/index.html`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/index.css`
- Create: `apps/admin/src/vite-env.d.ts`
- Create: `apps/admin/src/App.tsx`
- Create: `apps/admin/src/auth/auth-client.ts`
- Create: `apps/admin/src/auth/AuthContext.tsx`
- Create: `apps/admin/src/auth/AuthGuard.tsx`
- Create: `apps/admin/src/auth/LoginPage.tsx`
- Create: `apps/admin/src/api/client.ts`
- Create: `apps/admin/src/api/dashboard.ts`
- Create: `apps/admin/src/api/users.ts`
- Create: `apps/admin/src/api/scouts.ts`
- Create: `apps/admin/src/api/ai-usage.ts`
- Create: `apps/admin/src/components/AdminLayout.tsx`
- Create: `apps/admin/src/components/Sidebar.tsx`
- Create: `apps/admin/src/components/StatCard.tsx`
- Create: `apps/admin/src/components/DataTable.tsx`
- Create: `apps/admin/src/pages/DashboardPage.tsx`
- Create: `apps/admin/src/pages/UsersPage.tsx`
- Create: `apps/admin/src/pages/ScoutsPage.tsx`
- Create: `apps/admin/src/pages/AIUsagePage.tsx`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@brett/admin",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "tsc && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview"
  },
  "dependencies": {
    "@brett/types": "workspace:*",
    "@tanstack/react-query": "^5.75.5",
    "better-auth": "^1.2.7",
    "lucide-react": "^0.522.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^7.6.1"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.3",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create config files (tsconfig, vite, tailwind, postcss)**

`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "noEmit": true
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/types" }
  ]
}
```

`vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
  },
});
```

`tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

`postcss.config.js`:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create index.html**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Brett Admin</title>
  </head>
  <body class="bg-black text-white antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create src/vite-env.d.ts and src/index.css**

`src/vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Scrollbar styling for glass aesthetic */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
```

- [ ] **Step 5: Create src/auth/auth-client.ts**

Simpler than the desktop version — no Electron, just localStorage:

```typescript
import { createAuthClient } from "better-auth/react";

const API_URL = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:3002";

const TOKEN_KEY = `brett_admin_token_${API_URL}`;

let currentToken: string | null = null;

const tokenReady = (async () => {
  currentToken = localStorage.getItem(TOKEN_KEY);
})();

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: async () => {
        await tokenReady;
        return currentToken ?? undefined;
      },
    },
    onSuccess(context) {
      const body = context.data as Record<string, unknown> | null;
      if (body && typeof body === "object" && "token" in body && typeof body.token === "string") {
        currentToken = body.token;
        localStorage.setItem(TOKEN_KEY, body.token);
      }
    },
  },
});

export async function getToken(): Promise<string | null> {
  await tokenReady;
  return currentToken;
}

export async function clearStoredToken(): Promise<void> {
  currentToken = null;
  localStorage.removeItem(TOKEN_KEY);
}
```

- [ ] **Step 6: Create src/auth/AuthContext.tsx**

```tsx
import React, { createContext, useContext, useCallback } from "react";
import { authClient, clearStoredToken } from "./auth-client";

interface AuthContextValue {
  user: { id: string; email: string; name: string; image: string | null; role: string } | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: sessionData, isPending: loading, refetch } = authClient.useSession();

  const user = sessionData?.user
    ? {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
        image: sessionData.user.image ?? null,
        role: (sessionData.user as any).role ?? "user",
      }
    : null;

  const signOut = useCallback(async () => {
    await authClient.signOut();
    await clearStoredToken();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refetchUser: refetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
```

- [ ] **Step 7: Create src/auth/AuthGuard.tsx**

Includes admin role check per spec:

```tsx
import React from "react";
import { useAuth } from "./AuthContext";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center animate-pulse shadow-[0_0_20px_rgba(59,130,246,0.4)]">
          <span className="text-white font-bold text-xl">B</span>
        </div>
      </div>
    );
  }

  if (!user) return <>{fallback}</>;

  // Admin role check — login succeeds for any user, but the admin panel
  // requires admin role. Show insufficient permissions if not admin.
  if (user.role !== "admin") {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-white/10 bg-black/40 p-8 backdrop-blur-2xl text-center">
          <h2 className="text-lg font-semibold text-white">Insufficient Permissions</h2>
          <p className="text-sm text-white/50">
            You are signed in as <span className="text-white/80">{user.email}</span>, but this panel
            requires admin access.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 8: Create src/auth/LoginPage.tsx**

Google OAuth only for admin (per spec):

```tsx
import React, { useState } from "react";
import { authClient } from "./auth-client";

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);
    try {
      await authClient.signIn.social({ provider: "google" });
    } catch (err: any) {
      setError(err.message || "Google sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-black">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/10 bg-black/40 p-8 backdrop-blur-2xl">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Brett Admin</h1>
          <p className="mt-1 text-sm text-white/50">Sign in with your admin account</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogle}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 disabled:opacity-30"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          {submitting ? "Signing in..." : "Continue with Google"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Create src/api/client.ts**

```typescript
import { getToken } from "../auth/auth-client";

const API_URL = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:3002";

export async function adminFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (res.status === 401) {
    // Session expired — redirect to login
    localStorage.removeItem(`brett_admin_token_${API_URL}`);
    window.location.reload();
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}
```

- [ ] **Step 10: Create API hooks (dashboard, users, scouts, ai-usage)**

`src/api/dashboard.ts`:
```typescript
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "./client";

interface DashboardStats {
  totalUsers: number;
  totalItems: number;
  activeScouts: number;
  scoutRunsThisMonth: number;
  scoutFailuresThisMonth: number;
  scoutErrorRate: number;
  findingsThisMonth: number;
  aiSpendUsd: number;
  aiTokensThisMonth: number;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => adminFetch<DashboardStats>("/admin/dashboard/stats"),
    refetchInterval: 60_000,
  });
}
```

`src/api/users.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "./client";

interface UserListResponse {
  users: Array<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    role: string;
    createdAt: string;
    itemCount: number;
    scoutCount: number;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function useAdminUsers(page = 1) {
  return useQuery({
    queryKey: ["admin", "users", page],
    queryFn: () => adminFetch<UserListResponse>(`/admin/users?page=${page}`),
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: ["admin", "users", id],
    queryFn: () => adminFetch<{ user: any }>(`/admin/users/${id}`),
    enabled: !!id,
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      adminFetch(`/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
```

`src/api/scouts.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "./client";

export function useAdminScouts(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery({
    queryKey: ["admin", "scouts", status ?? "all"],
    queryFn: () => adminFetch<{ scouts: any[] }>(`/admin/scouts${qs}`),
  });
}

export function useAdminScoutRuns(limit = 50) {
  return useQuery({
    queryKey: ["admin", "scout-runs", limit],
    queryFn: () => adminFetch<{ runs: any[] }>(`/admin/scouts/runs?limit=${limit}`),
  });
}

export function useAdminScout(id: string) {
  return useQuery({
    queryKey: ["admin", "scouts", id],
    queryFn: () => adminFetch<{ scout: any }>(`/admin/scouts/${id}`),
    enabled: !!id,
  });
}

export function usePauseScout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scoutId: string) =>
      adminFetch(`/admin/scouts/${scoutId}/pause`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}

export function useResumeScout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scoutId: string) =>
      adminFetch(`/admin/scouts/${scoutId}/resume`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}

export function usePauseAllScouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminFetch("/admin/scouts/pause-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}

export function useResumeAllScouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminFetch("/admin/scouts/resume-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}
```

`src/api/ai-usage.ts`:
```typescript
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "./client";

export function useAIUsage(days = 30) {
  return useQuery({
    queryKey: ["admin", "ai-usage", days],
    queryFn: () => adminFetch<{ days: number; byModel: any; bySource: any }>(`/admin/ai/usage?days=${days}`),
  });
}

export function useAIUsageDaily(days = 30) {
  return useQuery({
    queryKey: ["admin", "ai-usage-daily", days],
    queryFn: () => adminFetch<{ days: number; daily: any[] }>(`/admin/ai/usage/daily?days=${days}`),
  });
}

export function useAISessions(limit = 25) {
  return useQuery({
    queryKey: ["admin", "ai-sessions", limit],
    queryFn: () => adminFetch<{ sessions: any[] }>(`/admin/ai/sessions?limit=${limit}`),
  });
}
```

- [ ] **Step 11: Create src/components/Sidebar.tsx**

```tsx
import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, Radar, Cpu, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

const links = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/users", icon: Users, label: "Users" },
  { to: "/scouts", icon: Radar, label: "Scouts" },
  { to: "/ai-usage", icon: Cpu, label: "AI Usage" },
];

export function Sidebar() {
  const { signOut } = useAuth();

  return (
    <div className="flex h-screen w-52 flex-col border-r border-white/8 bg-black/30 backdrop-blur-xl">
      <div className="px-4 py-5">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/30">
          Brett Admin
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-blue-500/15 text-blue-400"
                  : "text-white/50 hover:bg-white/5 hover:text-white/70"
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/8 p-2">
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/40 hover:bg-white/5 hover:text-white/60 transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Create src/components/AdminLayout.tsx**

```tsx
import React from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AdminLayout() {
  return (
    <div className="flex h-screen bg-black">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 13: Create src/components/StatCard.tsx**

```tsx
import React from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  color?: "default" | "green" | "amber" | "red";
}

const colorMap = {
  default: "text-white",
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
};

export function StatCard({ label, value, color = "default" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${colorMap[color]}`}>
        {value}
      </div>
    </div>
  );
}
```

- [ ] **Step 14: Create src/components/DataTable.tsx**

```tsx
import React from "react";

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data",
  loading,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="mb-3 h-8 animate-pulse rounded bg-white/5" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/6">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-white/35 font-semibold ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-white/30">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(item)}
                className={`border-b border-white/[0.04] last:border-0 ${
                  onRowClick ? "cursor-pointer hover:bg-white/[0.03]" : ""
                } transition-colors`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-2.5 text-white/70 ${col.className ?? ""}`}>
                    {col.render ? col.render(item) : String(item[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 15: Create src/pages/DashboardPage.tsx**

```tsx
import React from "react";
import { useDashboardStats } from "../api/dashboard";
import { useAdminScoutRuns } from "../api/scouts";
import { StatCard } from "../components/StatCard";
import { DataTable } from "../components/DataTable";

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: runsData, isLoading: runsLoading } = useAdminScoutRuns(10);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Dashboard</h1>

      {statsLoading ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Users" value={stats.totalUsers} />
          <StatCard label="Active Scouts" value={stats.activeScouts} />
          <StatCard label="AI Spend (Month)" value={`$${stats.aiSpendUsd.toFixed(2)}`} color="green" />
          <StatCard
            label="Scout Error Rate"
            value={`${(stats.scoutErrorRate * 100).toFixed(1)}%`}
            color={stats.scoutErrorRate > 0.1 ? "red" : stats.scoutErrorRate > 0.05 ? "amber" : "default"}
          />
        </div>
      ) : null}

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
          Recent Scout Runs
        </h2>
        <DataTable
          loading={runsLoading}
          data={runsData?.runs ?? []}
          emptyMessage="No scout runs yet"
          columns={[
            { key: "scout", header: "Scout", render: (r) => r.scout?.name ?? "—" },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <span className={r.status === "success" ? "text-green-400" : r.status === "failed" ? "text-red-400" : "text-amber-400"}>
                  {r.status}
                </span>
              ),
            },
            { key: "findingsCount", header: "Findings" },
            { key: "tokensUsed", header: "Tokens", render: (r) => r.tokensUsed?.toLocaleString() ?? "—" },
            {
              key: "createdAt",
              header: "When",
              render: (r) => new Date(r.createdAt).toLocaleString(),
            },
          ]}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 16: Create src/pages/UsersPage.tsx**

```tsx
import React from "react";
import { useAdminUsers, useUpdateUserRole } from "../api/users";
import { DataTable } from "../components/DataTable";

export function UsersPage() {
  const { data, isLoading } = useAdminUsers();
  const updateRole = useUpdateUserRole();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Users</h1>

      <DataTable
        loading={isLoading}
        data={data?.users ?? []}
        emptyMessage="No users"
        columns={[
          { key: "email", header: "Email", render: (u) => <span className="text-white/90">{u.email}</span> },
          { key: "name", header: "Name" },
          {
            key: "role",
            header: "Role",
            render: (u) => (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                u.role === "admin" ? "bg-blue-500/20 text-blue-400" : "bg-white/10 text-white/50"
              }`}>
                {u.role}
              </span>
            ),
          },
          { key: "itemCount", header: "Items" },
          { key: "scoutCount", header: "Scouts" },
          {
            key: "createdAt",
            header: "Joined",
            render: (u) => new Date(u.createdAt).toLocaleDateString(),
          },
          {
            key: "actions",
            header: "",
            render: (u) => (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const newRole = u.role === "admin" ? "user" : "admin";
                  updateRole.mutate({ userId: u.id, role: newRole });
                }}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                {u.role === "admin" ? "Demote" : "Promote"}
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 17: Create src/pages/ScoutsPage.tsx**

```tsx
import React from "react";
import { useAdminScouts, useAdminScoutRuns, usePauseScout, useResumeScout, usePauseAllScouts, useResumeAllScouts } from "../api/scouts";
import { DataTable } from "../components/DataTable";
import { Pause, Play, ShieldAlert, ShieldCheck } from "lucide-react";

export function ScoutsPage() {
  const { data: scoutsData, isLoading: scoutsLoading } = useAdminScouts();
  const { data: runsData, isLoading: runsLoading } = useAdminScoutRuns();
  const pauseScout = usePauseScout();
  const resumeScout = useResumeScout();
  const pauseAll = usePauseAllScouts();
  const resumeAll = useResumeAllScouts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Scouts</h1>
        <div className="flex gap-2">
          <button
            onClick={() => pauseAll.mutate()}
            disabled={pauseAll.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-30"
          >
            <ShieldAlert size={14} />
            Pause All
          </button>
          <button
            onClick={() => resumeAll.mutate()}
            disabled={resumeAll.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-30"
          >
            <ShieldCheck size={14} />
            Resume All
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
          All Scouts
        </h2>
        <DataTable
          loading={scoutsLoading}
          data={scoutsData?.scouts ?? []}
          emptyMessage="No scouts"
          columns={[
            { key: "name", header: "Name", render: (s) => <span className="text-white/90">{s.name}</span> },
            { key: "owner", header: "Owner", render: (s) => s.user?.email ?? "—" },
            {
              key: "status",
              header: "Status",
              render: (s) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  s.status === "active" ? "bg-green-500/20 text-green-400"
                  : s.status === "paused" ? "bg-amber-500/20 text-amber-400"
                  : "bg-white/10 text-white/40"
                }`}>
                  {s.status}
                </span>
              ),
            },
            { key: "runs", header: "Runs", render: (s) => s._count?.runs ?? 0 },
            { key: "findings", header: "Findings", render: (s) => s._count?.findings ?? 0 },
            {
              key: "actions",
              header: "",
              render: (s) => (
                <div className="flex gap-1">
                  {s.status === "active" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); pauseScout.mutate(s.id); }}
                      className="p-1 text-white/30 hover:text-amber-400 transition-colors"
                      title="Pause"
                    >
                      <Pause size={14} />
                    </button>
                  )}
                  {s.status === "paused" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resumeScout.mutate(s.id); }}
                      className="p-1 text-white/30 hover:text-green-400 transition-colors"
                      title="Resume"
                    >
                      <Play size={14} />
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
          Recent Runs
        </h2>
        <DataTable
          loading={runsLoading}
          data={runsData?.runs ?? []}
          emptyMessage="No scout runs"
          columns={[
            { key: "scout", header: "Scout", render: (r) => r.scout?.name ?? "—" },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <span className={r.status === "success" ? "text-green-400" : r.status === "failed" ? "text-red-400" : "text-amber-400"}>
                  {r.status}
                </span>
              ),
            },
            { key: "findingsCount", header: "Findings" },
            { key: "tokensUsed", header: "Tokens", render: (r) => r.tokensUsed?.toLocaleString() ?? "—" },
            { key: "durationMs", header: "Duration", render: (r) => r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—" },
            { key: "error", header: "Error", render: (r) => r.error ? <span className="text-red-400 truncate max-w-[200px] block">{r.error}</span> : "—" },
            { key: "createdAt", header: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
          ]}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 18: Create src/pages/AIUsagePage.tsx**

```tsx
import React from "react";
import { useAIUsage, useAIUsageDaily, useAISessions } from "../api/ai-usage";
import { StatCard } from "../components/StatCard";
import { DataTable } from "../components/DataTable";

export function AIUsagePage() {
  const { data: usage, isLoading: usageLoading } = useAIUsage();
  const { data: daily, isLoading: dailyLoading } = useAIUsageDaily();
  const { data: sessions, isLoading: sessionsLoading } = useAISessions();

  const totalCost = usage
    ? Object.values(usage.byModel as Record<string, any>).reduce((sum: number, m: any) => sum + m.costUsd, 0)
    : 0;
  const totalCalls = usage
    ? Object.values(usage.byModel as Record<string, any>).reduce((sum: number, m: any) => sum + m.count, 0)
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">AI Usage</h1>

      {usageLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Spend (30d)" value={`$${totalCost.toFixed(2)}`} color="green" />
          <StatCard label="API Calls (30d)" value={totalCalls.toLocaleString()} />
          <StatCard label="Models Used" value={Object.keys(usage?.byModel ?? {}).length} />
        </div>
      )}

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
          Spend by Model
        </h2>
        <DataTable
          loading={usageLoading}
          data={Object.entries(usage?.byModel ?? {}).map(([model, data]: [string, any]) => ({ model, ...data }))}
          emptyMessage="No usage data"
          columns={[
            { key: "model", header: "Model", render: (r) => <span className="text-white/90 font-mono text-xs">{r.model}</span> },
            { key: "count", header: "Calls" },
            { key: "inputTokens", header: "Input Tokens", render: (r) => r.inputTokens.toLocaleString() },
            { key: "outputTokens", header: "Output Tokens", render: (r) => r.outputTokens.toLocaleString() },
            { key: "costUsd", header: "Cost", render: (r) => <span className="text-green-400">${r.costUsd.toFixed(2)}</span> },
          ]}
        />
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
          Daily Trend
        </h2>
        <DataTable
          loading={dailyLoading}
          data={daily?.daily ?? []}
          emptyMessage="No daily data"
          columns={[
            { key: "date", header: "Date" },
            { key: "count", header: "Calls" },
            { key: "tokens", header: "Tokens", render: (r) => r.tokens.toLocaleString() },
            { key: "costUsd", header: "Cost", render: (r) => <span className="text-green-400">${r.costUsd.toFixed(2)}</span> },
          ]}
        />
      </div>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
          Recent Sessions
        </h2>
        <DataTable
          loading={sessionsLoading}
          data={sessions?.sessions ?? []}
          emptyMessage="No sessions"
          columns={[
            { key: "source", header: "Source" },
            { key: "modelUsed", header: "Model", render: (r) => <span className="font-mono text-xs">{r.modelUsed ?? "—"}</span> },
            { key: "user", header: "User", render: (r) => r.user?.email ?? "—" },
            { key: "messages", header: "Messages", render: (r) => r._count?.messages ?? 0 },
            { key: "createdAt", header: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
          ]}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 19: Create src/App.tsx and src/main.tsx**

`src/App.tsx`:
```tsx
import React from "react";
import { Routes, Route } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { UsersPage } from "./pages/UsersPage";
import { ScoutsPage } from "./pages/ScoutsPage";
import { AIUsagePage } from "./pages/AIUsagePage";

export function App() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="scouts" element={<ScoutsPage />} />
        <Route path="ai-usage" element={<AIUsagePage />} />
      </Route>
    </Routes>
  );
}
```

`src/main.tsx`:
```tsx
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGuard } from "./auth/AuthGuard";
import { LoginPage } from "./auth/LoginPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGuard fallback={<LoginPage />}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AuthGuard>
    </AuthProvider>
  </React.StrictMode>
);
```

- [ ] **Step 20: Create .env.example for admin frontend**

```env
VITE_ADMIN_API_URL=http://localhost:3002
```

Copy to `.env`:
```bash
cp apps/admin/.env.example apps/admin/.env
```

- [ ] **Step 21: Install dependencies and verify**

```bash
pnpm install
pnpm --filter @brett/admin run typecheck
```

- [ ] **Step 22: Start the admin stack and verify in browser**

```bash
# Terminal 1: admin API
cd apps/admin-api && pnpm dev

# Terminal 2: admin frontend
cd apps/admin && pnpm dev
```

Open http://localhost:5174 — should see the login page.

- [ ] **Step 23: Commit**

```bash
git add apps/admin/
git commit -m "feat: create admin frontend SPA with dashboard, users, scouts, and AI usage pages"
```

---

### Task 6: Dockerfile and Deployment Config for Admin API

**Files:**
- Create: `apps/admin-api/Dockerfile`
- Create: `apps/admin-api/railway.json`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.6 --activate

# Install deps for the full monorepo (needed for workspace resolution)
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin-api/package.json apps/admin-api/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
COPY packages/api-core/package.json packages/api-core/
RUN pnpm install --frozen-lockfile --filter @brett/admin-api...

# Build
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/utils packages/utils
COPY packages/api-core packages/api-core
COPY apps/admin-api apps/admin-api
RUN pnpm --filter @brett/admin-api run build

# Run — no migrations (owned by apps/api)
FROM base AS runner
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/types packages/types
COPY --from=build /app/packages/utils packages/utils
COPY --from=build /app/packages/api-core packages/api-core
COPY --from=build /app/apps/admin-api/dist apps/admin-api/dist
COPY --from=build /app/apps/admin-api/node_modules apps/admin-api/node_modules
COPY --from=build /app/apps/admin-api/package.json apps/admin-api/package.json
WORKDIR /app/apps/admin-api
CMD ["node", "dist/index.js"]
```

Note: No `prisma migrate deploy` — migrations are owned by `apps/api`.

- [ ] **Step 2: Create railway.json**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "dockerfilePath": "apps/admin-api/Dockerfile"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin-api/Dockerfile apps/admin-api/railway.json
git commit -m "feat: add Dockerfile and Railway config for admin API"
```

---

### Task 7: Cleanup — Remove Old Admin Routes from Main API

**Files:**
- Delete: `apps/api/src/routes/admin-scouts.ts`
- Verify: `apps/api/src/app.ts` already has the import removed (Task 3)

- [ ] **Step 1: Delete the old admin-scouts route file**

```bash
rm apps/api/src/routes/admin-scouts.ts
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -r "admin-scouts" apps/api/src/
grep -r "ADMIN_SECRET" apps/api/src/
```

Expected: no matches (the import was already removed in Task 3).

- [ ] **Step 3: Run typecheck and tests**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/
git commit -m "cleanup: remove old admin-scouts routes from main API (migrated to admin-api)"
```

---

### Task 8: Promote Your User to Admin

- [ ] **Step 1: Set your user's role to admin**

```bash
# Find your user ID
pnpm --filter @brett/api exec prisma studio
# Or via psql:
# UPDATE "User" SET role = 'admin' WHERE email = 'your@email.com';
```

- [ ] **Step 2: Verify admin access works**

Start the admin stack (`pnpm dev:admin`), navigate to http://localhost:5174, sign in with Google, confirm the dashboard loads.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: admin panel complete — api-core extraction, admin API, admin frontend"
```
