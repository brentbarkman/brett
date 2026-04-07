# iOS App Scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational infrastructure for Brett's iOS app — auth, local database, sync engine, API additions — with an unstyled smoke-test screen proving all layers work end-to-end.

**Architecture:** Expo 53 + React Native app with offline-first SQLite (Drizzle ORM), a custom sync engine (mutation queue, push/pull with field-level merge), and API-side additions (sync endpoints, soft deletes, Apple auth). No UI/UX work — just plumbing that junior engineers can build on.

**Tech Stack:** Expo SDK 53, expo-sqlite, Drizzle ORM, Zustand, expo-secure-store, expo-local-authentication, Vitest (API tests), better-auth (Apple provider), Prisma (migrations)

**Spec:** `docs/superpowers/specs/2026-04-07-ios-app-system-design.md`

---

## File Structure

### API-side additions (`apps/api/`)

```
apps/api/
  prisma/
    migrations/YYYYMMDD_soft_deletes/      (new migration)
    migrations/YYYYMMDD_sync_infra/        (new migration)
    schema.prisma                          (MODIFY — add deletedAt, updatedAt, new models)
  src/
    routes/
      sync.ts                              (NEW — POST /sync/pull, POST /sync/push)
      devices.ts                           (NEW — POST /devices/register, DELETE /devices/unregister)
      things.ts                            (MODIFY — soft delete instead of hard delete)
      lists.ts                             (MODIFY — soft delete instead of hard delete)
    middleware/
      soft-delete.ts                       (NEW — Prisma extension to auto-filter deletedAt)
    lib/
      auth.ts                              (MODIFY — add Apple social provider)
      push.ts                              (NEW — FCM/APNs push helper)
      sync-merge.ts                        (NEW — field-level merge logic)
    __tests__/
      sync.test.ts                         (NEW)
      devices.test.ts                      (NEW)
      soft-delete.test.ts                  (NEW)
```

### Mobile-side (`apps/mobile/`)

```
apps/mobile/
  app.config.ts                            (NEW — replaces app.json, Expo 53 config)
  app/
    _layout.tsx                            (MODIFY — auth gate + providers)
    (auth)/
      sign-in.tsx                          (NEW — sign-in screen)
    (app)/
      _layout.tsx                          (NEW — authenticated layout)
      today.tsx                            (NEW — smoke test screen)
  src/
    db/
      schema.ts                            (NEW — Drizzle schema definitions)
      migrations/                          (NEW — Drizzle migration files)
      index.ts                             (NEW — DB initialization + WAL mode)
    sync/
      sync-manager.ts                      (NEW — orchestrates push/pull cycles)
      push-engine.ts                       (NEW — mutation queue processing)
      pull-engine.ts                       (NEW — incremental pull from server)
      mutation-queue.ts                    (NEW — enqueue, compact, persist)
      conflict-resolver.ts                 (NEW — field-level merge with previousValues)
      network-monitor.ts                   (NEW — online/offline detection)
      types.ts                             (NEW — sync-specific types)
    api/
      client.ts                            (NEW — HTTP client with auth interceptor)
      sse.ts                               (NEW — SSE client for foreground real-time)
    auth/
      provider.tsx                         (NEW — AuthContext + sign-in/out logic)
      biometric.ts                         (NEW — Face ID / Touch ID lock)
      token-storage.ts                     (NEW — Keychain read/write via expo-secure-store)
    store/
      items.ts                             (NEW — Zustand items store)
      lists.ts                             (NEW — Zustand lists store)
      sync.ts                              (NEW — Zustand sync health store)
      index.ts                             (NEW — store initialization + hydration)
    hooks/
      use-items.ts                         (NEW — React hook for items data)
      use-lists.ts                         (NEW — React hook for lists data)
      use-sync.ts                          (NEW — React hook for sync status)
    notifications/
      registration.ts                      (NEW — push token registration)
  package.json                             (MODIFY — upgrade deps, add new deps)
  tsconfig.json                            (MODIFY — update for Expo 53)
  metro.config.js                          (MODIFY — update for Expo 53)
```

### Shared packages

```
packages/
  types/src/
    index.ts                               (MODIFY — add sync types)
    sync.ts                                (NEW — SyncPullRequest, SyncPushRequest, etc.)
  utils/src/
    index.ts                               (MODIFY — export generateCuid)
    cuid.ts                                (NEW — CUID2 generation for mobile)
```

---

## Phase 1: API-Side Foundations

These tasks can be implemented independently from mobile. They prepare the server for mobile sync.

---

### Task 1: Soft Delete Infrastructure

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/middleware/soft-delete.ts`
- Create: `apps/api/src/__tests__/soft-delete.test.ts`
- Modify: `apps/api/src/routes/things.ts`
- Modify: `apps/api/src/routes/lists.ts`

**Context:** Every synced model needs a `deletedAt` column. All DELETE endpoints must soft-delete (set `deletedAt = now()`) instead of hard-delete. All read queries must exclude soft-deleted records by default. The sync endpoint will use `deletedAt` to return tombstones.

**Affected models:** Item, List, Attachment, BrettMessage, Scout, ScoutFinding, CalendarEventNote

- [ ] **Step 1: Write failing test for soft-delete middleware**

Create `apps/api/src/__tests__/soft-delete.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Soft delete", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("SoftDelete User");
    token = user.token;
  });

  it("DELETE /things/:id soft-deletes (returns 200, item disappears from list)", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "To Delete" }),
    });
    const itemId = ((await createRes.json()) as any).id;

    const delRes = await authRequest(`/things/${itemId}`, token, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    // Item should not appear in normal listing
    const listRes = await authRequest("/things", token);
    const items = (await listRes.json()) as any[];
    expect(items.find((i: any) => i.id === itemId)).toBeUndefined();
  });

  it("DELETE /lists/:id soft-deletes list and its items", async () => {
    // Create list
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Temp List" }),
    });
    const listId = ((await listRes.json()) as any).id;

    // Create item in list
    const itemRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Listed Task", listId }),
    });
    const itemId = ((await itemRes.json()) as any).id;

    // Delete list
    const delRes = await authRequest(`/lists/${listId}`, token, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    // List should not appear
    const listsRes = await authRequest("/lists", token);
    const lists = (await listsRes.json()) as any[];
    expect(lists.find((l: any) => l.id === listId)).toBeUndefined();

    // Item should also be soft-deleted
    const thingsRes = await authRequest("/things", token);
    const things = (await thingsRes.json()) as any[];
    expect(things.find((t: any) => t.id === itemId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- --run src/__tests__/soft-delete.test.ts`
Expected: FAIL — DELETE still hard-deletes, items still disappear from DB entirely.

- [ ] **Step 3: Add `deletedAt` to Prisma schema**

In `apps/api/prisma/schema.prisma`, add `deletedAt DateTime?` to these models:
- `Item` — add `deletedAt DateTime?` after `updatedAt`
- `List` — add `deletedAt DateTime?` after existing fields
- `Attachment` — add `deletedAt DateTime?` AND `updatedAt DateTime @updatedAt`
- `BrettMessage` — add `deletedAt DateTime?` AND `updatedAt DateTime @updatedAt`
- `Scout` — add `deletedAt DateTime?` after existing fields
- `ScoutFinding` — add `deletedAt DateTime?` AND `updatedAt DateTime @updatedAt`
- `CalendarEventNote` — add `deletedAt DateTime?` after existing fields

Also add `updatedAt DateTime @updatedAt` to `Attachment`, `BrettMessage`, and `ScoutFinding` if they don't have it (per review finding A2).

- [ ] **Step 4: Generate and run migration**

Run:
```bash
cd apps/api && npx prisma migrate dev --name soft_deletes_and_updated_at
```
Expected: Migration created and applied to dev database.

- [ ] **Step 5: Create soft-delete Prisma extension**

Create `apps/api/src/middleware/soft-delete.ts`:

```typescript
import { Prisma } from "@prisma/client";

/**
 * Models that support soft delete.
 * All queries on these models auto-filter `deletedAt IS NULL` unless
 * the query explicitly includes `where: { deletedAt: { not: null } }`.
 */
const SOFT_DELETE_MODELS = [
  "Item", "List", "Attachment", "BrettMessage",
  "Scout", "ScoutFinding", "CalendarEventNote",
] as const;

type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return SOFT_DELETE_MODELS.includes(model as SoftDeleteModel);
}

/**
 * Prisma client extension that:
 * 1. Adds `deletedAt IS NULL` filter to all findMany/findFirst/findUnique/count queries
 * 2. Converts delete() calls to update({ deletedAt: new Date() })
 * 3. Converts deleteMany() to updateMany({ deletedAt: new Date() })
 *
 * To query soft-deleted records (e.g., for sync tombstones), use:
 *   prisma.item.findMany({ where: { deletedAt: { not: null } } })
 * The extension detects this and skips the auto-filter.
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: "soft-delete",
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        if (isSoftDeleteModel(model) && !args.where?.deletedAt) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findFirst({ model, args, query }) {
        if (isSoftDeleteModel(model) && !args.where?.deletedAt) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findUnique({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          // findUnique can't filter by deletedAt easily — switch to findFirst
          // Actually, findUnique with compound where is fine, but we need to
          // ensure soft-deleted records aren't returned
          const result = await query(args);
          if (result && (result as any).deletedAt !== null && (result as any).deletedAt !== undefined) {
            return null;
          }
          return result;
        }
        return query(args);
      },
      async count({ model, args, query }) {
        if (isSoftDeleteModel(model) && !args.where?.deletedAt) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async delete({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          // Convert hard delete to soft delete
          return (Prisma as any).getExtensionContext(this)[model.charAt(0).toLowerCase() + model.slice(1)].update({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
      async deleteMany({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          return (Prisma as any).getExtensionContext(this)[model.charAt(0).toLowerCase() + model.slice(1)].updateMany({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
    },
  },
});
```

**Note:** The exact Prisma extension API may need adjustment. The key behavior is: `delete()` becomes `update({ deletedAt: new Date() })`. Read the Prisma extension docs for exact syntax. The approach above shows the intent — implementation may use `$allOperations` or model-specific extensions depending on Prisma version.

- [ ] **Step 6: Apply extension to Prisma client**

In `packages/api-core/src/db.ts` (or wherever the Prisma client singleton is created), apply the extension:

```typescript
import { softDeleteExtension } from "../../../apps/api/src/middleware/soft-delete.js";

// After creating the base client:
export const prisma = basePrismaClient.$extends(softDeleteExtension);
```

**Important:** If `@brett/api-core` exports the Prisma client, the extension must be applied there. Check the exact export path and modify accordingly.

- [ ] **Step 7: Update list deletion to soft-delete items**

In `apps/api/src/routes/lists.ts`, the DELETE handler currently uses a transaction to delete items then delete the list. Change it to soft-delete both:

```typescript
// Before: prisma.item.deleteMany({ where: { listId, userId } })
// After:  prisma.item.updateMany({ where: { listId, userId, deletedAt: null }, data: { deletedAt: new Date() } })
// Then:   prisma.list.update({ where: { id: listId }, data: { deletedAt: new Date() } })
```

The Prisma extension should handle this automatically if `deleteMany` is intercepted, but verify by checking the test.

- [ ] **Step 8: Run tests to verify**

Run: `cd apps/api && pnpm test -- --run src/__tests__/soft-delete.test.ts`
Expected: All tests PASS.

- [ ] **Step 9: Run full test suite to check for regressions**

Run: `cd apps/api && pnpm test`
Expected: All existing tests still pass. Soft-deleted records are auto-filtered from queries, so existing tests should not see deleted records.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(api): add soft-delete infrastructure for mobile sync

Add deletedAt column to Item, List, Attachment, BrettMessage, Scout,
ScoutFinding, CalendarEventNote. Add updatedAt to Attachment, BrettMessage,
ScoutFinding. Prisma extension auto-filters soft-deleted records and converts
delete() to update(deletedAt). List deletion cascades soft-delete to items."
```

---

### Task 2: Sync Types in Shared Package

**Files:**
- Create: `packages/types/src/sync.ts`
- Modify: `packages/types/src/index.ts`

**Context:** Both the API sync endpoints and the mobile sync engine need shared type definitions. These go in `@brett/types` so both sides use the same contracts.

- [ ] **Step 1: Create sync type definitions**

Create `packages/types/src/sync.ts`:

```typescript
// ---- Pull Protocol ----

export interface SyncPullRequest {
  cursors: Record<string, string | null>;  // table → ISO timestamp (null = never synced)
  limit?: number;                          // records per table per page (default 500)
  protocolVersion: number;                 // currently 1
}

export interface SyncTableChanges<T = Record<string, unknown>> {
  upserted: T[];
  deleted: string[];                       // IDs of soft-deleted records
  hasMore: boolean;
}

export interface SyncPullResponse {
  changes: Record<string, SyncTableChanges>;
  cursors: Record<string, string>;         // updated cursors
  serverTime: string;                      // ISO timestamp
  fullSyncRequired?: boolean;              // true if cursor too stale
}

// ---- Push Protocol ----

export type SyncMutationAction = "CREATE" | "UPDATE" | "DELETE";

export interface SyncMutation {
  idempotencyKey: string;                  // client-generated UUID
  entityType: string;                      // 'item', 'list', etc.
  entityId: string;
  action: SyncMutationAction;
  payload: Record<string, unknown>;
  changedFields?: string[];                // UPDATE only
  previousValues?: Record<string, unknown>; // UPDATE only — for field-level merge
  baseUpdatedAt?: string;                  // ISO — record's updatedAt at mutation time
}

export interface SyncPushRequest {
  mutations: SyncMutation[];
  protocolVersion: number;
}

export type SyncMutationResultStatus = "applied" | "merged" | "conflict" | "error" | "not_found";

export interface SyncMutationResult {
  idempotencyKey: string;
  status: SyncMutationResultStatus;
  record?: Record<string, unknown>;        // current server state (always on success)
  conflictedFields?: string[];             // fields where server won
  error?: string;
}

export interface SyncPushResponse {
  results: SyncMutationResult[];
  serverTime: string;
}

// ---- Sync Table Registry ----

/** Tables that participate in sync. Order matters for initial sync (dependencies first). */
export const SYNC_TABLES = [
  "lists",
  "items",
  "calendar_events",
  "calendar_event_notes",
  "scouts",
  "scout_findings",
  "brett_messages",
  "attachments",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/** Map sync table names to Prisma model names */
export const SYNC_TABLE_TO_MODEL: Record<SyncTable, string> = {
  lists: "List",
  items: "Item",
  calendar_events: "CalendarEvent",
  calendar_event_notes: "CalendarEventNote",
  scouts: "Scout",
  scout_findings: "ScoutFinding",
  brett_messages: "BrettMessage",
  attachments: "Attachment",
};

// ---- Allowed mutable entity types (security: server-side allowlist) ----

export const PUSHABLE_ENTITY_TYPES = [
  "item", "list", "calendar_event_note",
] as const;

export type PushableEntityType = (typeof PUSHABLE_ENTITY_TYPES)[number];

// ---- Device Registration ----

export interface DeviceRegistration {
  token: string;
  platform: "ios" | "android";
  appVersion?: string;
}
```

- [ ] **Step 2: Export from index**

In `packages/types/src/index.ts`, add at the end:

```typescript
export * from "./sync.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/sync.ts packages/types/src/index.ts
git commit -m "feat(types): add sync protocol type definitions

SyncPullRequest/Response, SyncPushRequest/Response, SyncMutation,
SyncMutationResult, SYNC_TABLES registry, PUSHABLE_ENTITY_TYPES
allowlist, DeviceRegistration."
```

---

### Task 3: CUID Generation for Mobile

**Files:**
- Create: `packages/utils/src/cuid.ts`
- Modify: `packages/utils/src/index.ts`
- Modify: `packages/utils/package.json` (add `@paralleldrive/cuid2` dependency)

**Context:** The server uses CUIDs (`@default(cuid())` in Prisma). Mobile-created records must use the same ID format. `@paralleldrive/cuid2` is the standard library.

- [ ] **Step 1: Install cuid2**

Run: `cd packages/utils && pnpm add @paralleldrive/cuid2`

- [ ] **Step 2: Create cuid.ts**

Create `packages/utils/src/cuid.ts`:

```typescript
import { createId } from "@paralleldrive/cuid2";

/** Generate a CUID2 — matches Prisma's @default(cuid()) format.
 *  Use this for client-generated IDs when creating records offline. */
export function generateCuid(): string {
  return createId();
}
```

- [ ] **Step 3: Export from index**

In `packages/utils/src/index.ts`, add:

```typescript
export { generateCuid } from "./cuid.js";
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm typecheck`

```bash
git add packages/utils/
git commit -m "feat(utils): add generateCuid() for mobile offline ID generation

Uses @paralleldrive/cuid2 to match Prisma's @default(cuid()) format."
```

---

### Task 4: IdempotencyKey and DeviceToken Models

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/routes/devices.ts`
- Create: `apps/api/src/__tests__/devices.test.ts`
- Modify: `apps/api/src/app.ts` (mount new route)

- [ ] **Step 1: Add models to Prisma schema**

In `apps/api/prisma/schema.prisma`, add:

```prisma
model IdempotencyKey {
  key        String   @id
  response   Json
  statusCode Int
  createdAt  DateTime @default(now())

  @@index([createdAt])
}

model DeviceToken {
  id         String   @id @default(cuid())
  userId     String
  token      String   @unique
  platform   String   // "ios" | "android"
  appVersion String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

Add the `deviceTokens` relation to the `User` model:

```prisma
model User {
  // ... existing fields ...
  deviceTokens    DeviceToken[]
}
```

- [ ] **Step 2: Run migration**

Run: `cd apps/api && npx prisma migrate dev --name sync_infra_tables`

- [ ] **Step 3: Write failing test for device registration**

Create `apps/api/src/__tests__/devices.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Device registration", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Device User");
    token = user.token;
  });

  it("POST /devices/register stores device token", async () => {
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        token: "fake-apns-token-123",
        platform: "ios",
        appVersion: "1.0.0",
      }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /devices/register is idempotent (same token)", async () => {
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        token: "fake-apns-token-123",
        platform: "ios",
        appVersion: "1.0.1",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.appVersion).toBe("1.0.1"); // updated
  });

  it("POST /devices/register rejects invalid platform", async () => {
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({ token: "tok", platform: "windows" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /devices/unregister removes token", async () => {
    const res = await authRequest("/devices/unregister", token, {
      method: "DELETE",
      body: JSON.stringify({ token: "fake-apns-token-123" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /devices/unregister is idempotent (already removed)", async () => {
    const res = await authRequest("/devices/unregister", token, {
      method: "DELETE",
      body: JSON.stringify({ token: "fake-apns-token-123" }),
    });
    expect(res.status).toBe(200);
  });

  it("caps at 10 devices per user", async () => {
    for (let i = 0; i < 10; i++) {
      await authRequest("/devices/register", token, {
        method: "POST",
        body: JSON.stringify({ token: `device-${i}`, platform: "ios" }),
      });
    }
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({ token: "device-11", platform: "ios" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("maximum");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- --run src/__tests__/devices.test.ts`

- [ ] **Step 5: Implement device routes**

Create `apps/api/src/routes/devices.ts`:

```typescript
import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";

const MAX_DEVICES_PER_USER = 10;
const VALID_PLATFORMS = ["ios", "android"];

export const devices = new Hono<AuthEnv>()
  .use("/*", rateLimiter(10))
  .post("/register", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    if (!body.token || typeof body.token !== "string") {
      return c.json({ error: "token is required" }, 400);
    }
    if (!VALID_PLATFORMS.includes(body.platform)) {
      return c.json({ error: `platform must be one of: ${VALID_PLATFORMS.join(", ")}` }, 400);
    }

    // Check if token already registered for this user
    const existing = await prisma.deviceToken.findUnique({
      where: { token: body.token },
    });

    if (existing) {
      // Update existing (may have new appVersion)
      const updated = await prisma.deviceToken.update({
        where: { token: body.token },
        data: { appVersion: body.appVersion ?? null, platform: body.platform },
      });
      return c.json(updated, 200);
    }

    // Check device cap
    const count = await prisma.deviceToken.count({
      where: { userId: user.id },
    });
    if (count >= MAX_DEVICES_PER_USER) {
      return c.json({ error: `Maximum ${MAX_DEVICES_PER_USER} devices per user` }, 400);
    }

    const device = await prisma.deviceToken.create({
      data: {
        userId: user.id,
        token: body.token,
        platform: body.platform,
        appVersion: body.appVersion ?? null,
      },
    });
    return c.json(device, 201);
  })
  .delete("/unregister", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    if (!body.token) {
      return c.json({ error: "token is required" }, 400);
    }

    await prisma.deviceToken.deleteMany({
      where: { token: body.token, userId: user.id },
    });
    return c.json({ ok: true }, 200);
  });
```

- [ ] **Step 6: Mount route in app.ts**

In `apps/api/src/app.ts`, add:

```typescript
import { devices } from "./routes/devices.js";
// Mount with auth middleware (same pattern as other routes)
app.route("/devices", devices);
```

Ensure it's inside the authenticated section (after auth middleware is applied).

- [ ] **Step 7: Run tests**

Run: `cd apps/api && pnpm test -- --run src/__tests__/devices.test.ts`
Expected: All PASS.

- [ ] **Step 8: Run full test suite + typecheck**

Run: `pnpm typecheck && cd apps/api && pnpm test`

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(api): add IdempotencyKey + DeviceToken models and device registration endpoints

POST /devices/register — register push notification device (10 max per user)
DELETE /devices/unregister — remove device token
Rate limited at 10 req/min."
```

---

### Task 5: Sync Pull Endpoint

**Files:**
- Create: `apps/api/src/routes/sync.ts`
- Create: `apps/api/src/__tests__/sync.test.ts`
- Modify: `apps/api/src/app.ts` (mount route)

**Context:** `POST /sync/pull` is the core endpoint mobile uses to get changes since last sync. It queries each table for records with `updatedAt > cursor`, returns them paginated, and includes tombstones (soft-deleted records).

This is the most important API endpoint for mobile. It must:
1. Accept per-table cursors
2. Return upserted + deleted records per table
3. Paginate at `limit` records per table
4. Validate ownership (only return current user's records)
5. Be rate-limited
6. Support protocol versioning

- [ ] **Step 1: Write failing tests for sync pull**

Create `apps/api/src/__tests__/sync.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Sync Pull", () => {
  let token: string;
  let userId: string;
  let itemId: string;
  let listId: string;

  beforeAll(async () => {
    const user = await createTestUser("Sync User");
    token = user.token;
    userId = user.userId;

    // Create test data
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Sync List" }),
    });
    listId = ((await listRes.json()) as any).id;

    const itemRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Sync Task", listId }),
    });
    itemId = ((await itemRes.json()) as any).id;
  });

  it("POST /sync/pull returns changes for all tables", async () => {
    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({
        cursors: {},
        protocolVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.changes).toBeDefined();
    expect(body.changes.items).toBeDefined();
    expect(body.changes.items.upserted).toBeInstanceOf(Array);
    expect(body.changes.items.deleted).toBeInstanceOf(Array);
    expect(body.changes.lists).toBeDefined();
    expect(body.serverTime).toBeDefined();
    expect(body.cursors).toBeDefined();
  });

  it("returns items belonging to the authenticated user only", async () => {
    const user2 = await createTestUser("Sync Other");
    await authRequest("/things", user2.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Other User Task" }),
    });

    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ cursors: {}, protocolVersion: 1 }),
    });
    const body = (await res.json()) as any;
    const itemTitles = body.changes.items.upserted.map((i: any) => i.title);
    expect(itemTitles).not.toContain("Other User Task");
  });

  it("incremental pull only returns records updated after cursor", async () => {
    // Get the current server time from a full pull
    const fullRes = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ cursors: {}, protocolVersion: 1 }),
    });
    const fullBody = (await fullRes.json()) as any;
    const cursor = fullBody.cursors.items;

    // Create a new item after the cursor
    await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "After Cursor" }),
    });

    // Incremental pull should only return the new item
    const incRes = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({
        cursors: { items: cursor, lists: cursor },
        protocolVersion: 1,
      }),
    });
    const incBody = (await incRes.json()) as any;
    expect(incBody.changes.items.upserted.length).toBe(1);
    expect(incBody.changes.items.upserted[0].title).toBe("After Cursor");
  });

  it("returns tombstones for soft-deleted records", async () => {
    // Create and delete an item
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Will Delete" }),
    });
    const delItemId = ((await createRes.json()) as any).id;

    // Get cursor before delete
    const preRes = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ cursors: {}, protocolVersion: 1 }),
    });
    const preCursor = ((await preRes.json()) as any).cursors.items;

    // Delete
    await authRequest(`/things/${delItemId}`, token, { method: "DELETE" });

    // Pull should show it in deleted
    const postRes = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({
        cursors: { items: preCursor },
        protocolVersion: 1,
      }),
    });
    const postBody = (await postRes.json()) as any;
    expect(postBody.changes.items.deleted).toContain(delItemId);
  });

  it("rejects invalid protocol version", async () => {
    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ cursors: {}, protocolVersion: 999 }),
    });
    expect(res.status).toBe(400);
  });

  it("paginates large result sets", async () => {
    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ cursors: {}, limit: 1, protocolVersion: 1 }),
    });
    const body = (await res.json()) as any;
    // With limit=1 and multiple items, hasMore should be true
    if (body.changes.items.upserted.length > 0) {
      // If there are more items than the limit, hasMore should be true
      expect(body.changes.items.upserted.length).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- --run src/__tests__/sync.test.ts`

- [ ] **Step 3: Implement sync pull endpoint**

Create `apps/api/src/routes/sync.ts`. This is a large file — the core sync endpoint. Key implementation details:

```typescript
import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { SYNC_TABLES, SYNC_TABLE_TO_MODEL } from "@brett/types";
import type { SyncPullRequest, SyncPullResponse, SyncTableChanges } from "@brett/types";

const CURRENT_PROTOCOL_VERSION = 1;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const STALE_CURSOR_DAYS = 30;

export const sync = new Hono<AuthEnv>()
  .use("/*", rateLimiter(120))
  .post("/pull", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json()) as SyncPullRequest;

    if (body.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
      return c.json({ error: `Unsupported protocol version. Current: ${CURRENT_PROTOCOL_VERSION}` }, 400);
    }

    const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const serverTime = new Date().toISOString();
    const changes: Record<string, SyncTableChanges> = {};
    const cursors: Record<string, string> = {};

    for (const table of SYNC_TABLES) {
      const modelName = SYNC_TABLE_TO_MODEL[table];
      const cursor = body.cursors[table] ?? null;

      // Check for stale cursor
      if (cursor) {
        const cursorDate = new Date(cursor);
        const staleDays = (Date.now() - cursorDate.getTime()) / (1000 * 60 * 60 * 24);
        if (staleDays > STALE_CURSOR_DAYS) {
          return c.json({ fullSyncRequired: true, serverTime }, 200);
        }
      }

      // Build query: records updated since cursor, belonging to this user
      const where: any = { userId: user.id };
      if (cursor) {
        where.updatedAt = { gt: new Date(cursor) };
      }

      // Use dynamic prisma access
      const model = (prisma as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)];
      if (!model) continue;

      // Get upserted records (including those with deletedAt — we need tombstones)
      // Override the soft-delete filter by explicitly including deletedAt in the query
      const allRecords = await model.findMany({
        where: { ...where, deletedAt: undefined }, // override soft-delete filter
        orderBy: { updatedAt: "asc" },
        take: limit + 1, // fetch one extra to detect hasMore
      });

      // Separate upserted vs deleted
      const hasMore = allRecords.length > limit;
      const records = hasMore ? allRecords.slice(0, limit) : allRecords;
      const upserted = records.filter((r: any) => !r.deletedAt);
      const deleted = records.filter((r: any) => r.deletedAt).map((r: any) => r.id);

      // Compute new cursor: max updatedAt from returned records
      const maxUpdatedAt = records.length > 0
        ? records[records.length - 1].updatedAt?.toISOString()
        : cursor;

      changes[table] = { upserted, deleted, hasMore };
      cursors[table] = maxUpdatedAt ?? serverTime;
    }

    const response: SyncPullResponse = { changes, cursors, serverTime };
    return c.json(response, 200);
  });
```

**Note:** This is a simplified version. The actual implementation needs to handle:
- Tables without `userId` (e.g., Attachment, BrettMessage — join through Item/CalendarEvent to verify ownership)
- Tables with different field names for the user relationship
- The `OR` query for tombstones (need `deletedAt: { not: null }` + `updatedAt > cursor`)
- Calendar event time windowing (last 90 days + future only)

The agent implementing this task should read each model in `schema.prisma` and adjust the ownership query per table.

- [ ] **Step 4: Mount in app.ts**

In `apps/api/src/app.ts`:

```typescript
import { sync } from "./routes/sync.js";
app.route("/sync", sync);
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && pnpm test -- --run src/__tests__/sync.test.ts`
Expected: All PASS.

- [ ] **Step 6: Run full suite + typecheck**

Run: `pnpm typecheck && cd apps/api && pnpm test`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(api): add POST /sync/pull endpoint

Incremental sync pull with per-table cursors. Returns upserted + deleted
(tombstone) records. Paginated, rate-limited (120/min), ownership validated.
Rejects stale cursors (>30 days) with fullSyncRequired flag."
```

---

### Task 6: Sync Push Endpoint with Field-Level Merge

**Files:**
- Create: `apps/api/src/lib/sync-merge.ts`
- Modify: `apps/api/src/routes/sync.ts` (add POST /sync/push)
- Modify: `apps/api/src/__tests__/sync.test.ts` (add push tests)

**Context:** `POST /sync/push` accepts a batch of mutations from the mobile client, processes them with field-level merge using `previousValues`, checks idempotency keys, validates ownership, and returns per-mutation results.

This is the second most critical endpoint. It must:
1. Process mutations sequentially within the batch
2. Check idempotency keys before processing
3. Validate entity ownership
4. Validate entity type against allowlist
5. Run field-level merge for UPDATEs (using previousValues)
6. Return per-mutation results with current server state

- [ ] **Step 1: Write failing tests for sync push**

Add to `apps/api/src/__tests__/sync.test.ts`:

```typescript
describe("Sync Push", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser("Push User");
    token = user.token;
    userId = user.userId;
  });

  it("POST /sync/push creates a new item", async () => {
    const res = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({
        mutations: [{
          idempotencyKey: "test-create-1",
          entityType: "item",
          entityId: "new-item-id-1",
          action: "CREATE",
          payload: { type: "task", title: "Created via sync", status: "active" },
        }],
        protocolVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results[0].status).toBe("applied");
    expect(body.results[0].record.title).toBe("Created via sync");
  });

  it("idempotency key prevents duplicate creates", async () => {
    const res = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({
        mutations: [{
          idempotencyKey: "test-create-1", // same key as above
          entityType: "item",
          entityId: "new-item-id-1",
          action: "CREATE",
          payload: { type: "task", title: "Duplicate" },
        }],
        protocolVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results[0].status).toBe("applied"); // returns cached result
    expect(body.results[0].record.title).toBe("Created via sync"); // original title, not "Duplicate"
  });

  it("field-level merge: non-overlapping fields both apply", async () => {
    // Create an item first
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Original", status: "active" }),
    });
    const item = (await createRes.json()) as any;

    // Update title via desktop (simulating another device)
    await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title: "Desktop Title" }),
    });

    // Push a status change from mobile (doesn't know about title change)
    const pushRes = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({
        mutations: [{
          idempotencyKey: "test-merge-1",
          entityType: "item",
          entityId: item.id,
          action: "UPDATE",
          payload: { status: "done" },
          changedFields: ["status"],
          previousValues: { status: "active" },
          baseUpdatedAt: item.updatedAt,
        }],
        protocolVersion: 1,
      }),
    });
    expect(pushRes.status).toBe(200);
    const body = (await pushRes.json()) as any;
    expect(body.results[0].status).toBe("applied");
    expect(body.results[0].record.title).toBe("Desktop Title"); // preserved
    expect(body.results[0].record.status).toBe("done"); // applied
  });

  it("field-level merge: overlapping field, server wins", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Original" }),
    });
    const item = (await createRes.json()) as any;
    const originalUpdatedAt = item.updatedAt;

    // Desktop changes title
    await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title: "Desktop Title" }),
    });

    // Mobile tries to change title too (based on stale state)
    const pushRes = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({
        mutations: [{
          idempotencyKey: "test-conflict-1",
          entityType: "item",
          entityId: item.id,
          action: "UPDATE",
          payload: { title: "Mobile Title" },
          changedFields: ["title"],
          previousValues: { title: "Original" },
          baseUpdatedAt: originalUpdatedAt,
        }],
        protocolVersion: 1,
      }),
    });
    expect(pushRes.status).toBe(200);
    const body = (await pushRes.json()) as any;
    // Server wins because title was changed by desktop (previousValues.title != current title)
    expect(body.results[0].status).toBe("conflict");
    expect(body.results[0].record.title).toBe("Desktop Title");
    expect(body.results[0].conflictedFields).toContain("title");
  });

  it("rejects mutations for other user's items", async () => {
    const user2 = await createTestUser("Push Other");
    const itemRes = await authRequest("/things", user2.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Secret" }),
    });
    const otherItemId = ((await itemRes.json()) as any).id;

    const res = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({
        mutations: [{
          idempotencyKey: "test-idor-1",
          entityType: "item",
          entityId: otherItemId,
          action: "UPDATE",
          payload: { title: "Hacked" },
          changedFields: ["title"],
          previousValues: { title: "Secret" },
        }],
        protocolVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results[0].status).toBe("not_found"); // hidden from this user
  });

  it("rejects disallowed entity types", async () => {
    const res = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({
        mutations: [{
          idempotencyKey: "test-bad-entity",
          entityType: "user",
          entityId: userId,
          action: "UPDATE",
          payload: { role: "admin" },
          changedFields: ["role"],
          previousValues: { role: "user" },
        }],
        protocolVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results[0].status).toBe("error");
    expect(body.results[0].error).toContain("not allowed");
  });

  it("DELETE via sync push soft-deletes the record", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "To Sync Delete" }),
    });
    const itemId = ((await createRes.json()) as any).id;

    const res = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({
        mutations: [{
          idempotencyKey: "test-delete-1",
          entityType: "item",
          entityId: itemId,
          action: "DELETE",
          payload: {},
        }],
        protocolVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results[0].status).toBe("applied");

    // Item should not appear in normal listing
    const listRes = await authRequest("/things", token);
    const items = (await listRes.json()) as any[];
    expect(items.find((i: any) => i.id === itemId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement field-level merge logic**

Create `apps/api/src/lib/sync-merge.ts`:

```typescript
/**
 * Field-level merge for sync push mutations.
 *
 * Compares each changed field's previousValue against the current server value.
 * If they match → field unchanged on server → apply client's change.
 * If they differ → field was changed elsewhere → server wins (conflict).
 */
export interface MergeResult {
  /** Final merged field values to apply */
  mergedFields: Record<string, unknown>;
  /** Fields where the server value won (client's change was rejected) */
  conflictedFields: string[];
  /** Whether any client changes were applied */
  hasChanges: boolean;
}

export function fieldLevelMerge(
  currentRecord: Record<string, unknown>,
  changedFields: string[],
  payload: Record<string, unknown>,
  previousValues: Record<string, unknown>,
): MergeResult {
  const mergedFields: Record<string, unknown> = {};
  const conflictedFields: string[] = [];

  for (const field of changedFields) {
    const serverValue = currentRecord[field];
    const clientPrevValue = previousValues[field];
    const clientNewValue = payload[field];

    // Compare: has the server's value changed from what the client expected?
    // Use JSON.stringify for deep equality (handles dates, nulls, objects)
    const serverUnchanged = JSON.stringify(serverValue) === JSON.stringify(clientPrevValue);

    if (serverUnchanged) {
      // Server hasn't touched this field → apply client's value
      mergedFields[field] = clientNewValue;
    } else {
      // Server changed this field → server wins
      conflictedFields.push(field);
    }
  }

  return {
    mergedFields,
    conflictedFields,
    hasChanges: Object.keys(mergedFields).length > 0,
  };
}
```

- [ ] **Step 3: Implement sync push endpoint**

Add to `apps/api/src/routes/sync.ts`:

```typescript
import { fieldLevelMerge } from "../lib/sync-merge.js";
import { PUSHABLE_ENTITY_TYPES } from "@brett/types";
import type { SyncPushRequest, SyncPushResponse, SyncMutationResult } from "@brett/types";
import { validateCreateItem, validateUpdateItem, validateCreateList, validateUpdateList } from "@brett/business";

// Map entity types to Prisma model accessor names
const ENTITY_MODEL_MAP: Record<string, string> = {
  item: "item",
  list: "list",
  calendar_event_note: "calendarEventNote",
};

// Max mutations per push request
const MAX_MUTATIONS_PER_PUSH = 50;

// Add to the sync router:
sync.post("/push", rateLimiter(60), async (c) => {
  const user = c.get("user");
  const body = (await c.req.json()) as SyncPushRequest;

  if (body.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    return c.json({ error: `Unsupported protocol version` }, 400);
  }

  if (!body.mutations || body.mutations.length > MAX_MUTATIONS_PER_PUSH) {
    return c.json({ error: `Maximum ${MAX_MUTATIONS_PER_PUSH} mutations per request` }, 400);
  }

  const results: SyncMutationResult[] = [];
  const serverTime = new Date().toISOString();

  for (const mutation of body.mutations) {
    // 1. Check entity type allowlist
    if (!(PUSHABLE_ENTITY_TYPES as readonly string[]).includes(mutation.entityType)) {
      results.push({
        idempotencyKey: mutation.idempotencyKey,
        status: "error",
        error: `Entity type '${mutation.entityType}' is not allowed for sync push`,
      });
      continue;
    }

    // 2. Check idempotency key
    const existingKey = await prisma.idempotencyKey.findUnique({
      where: { key: mutation.idempotencyKey },
    });
    if (existingKey) {
      results.push(existingKey.response as SyncMutationResult);
      continue;
    }

    // 3. Process mutation
    const modelName = ENTITY_MODEL_MAP[mutation.entityType];
    const model = (prisma as any)[modelName];
    let result: SyncMutationResult;

    try {
      if (mutation.action === "CREATE") {
        result = await processCreate(model, mutation, user.id);
      } else if (mutation.action === "UPDATE") {
        result = await processUpdate(model, mutation, user.id);
      } else if (mutation.action === "DELETE") {
        result = await processDelete(model, mutation, user.id);
      } else {
        result = {
          idempotencyKey: mutation.idempotencyKey,
          status: "error",
          error: `Unknown action: ${mutation.action}`,
        };
      }
    } catch (err: any) {
      result = {
        idempotencyKey: mutation.idempotencyKey,
        status: "error",
        error: err.message ?? "Internal error",
      };
    }

    // 4. Store idempotency key
    await prisma.idempotencyKey.create({
      data: {
        key: mutation.idempotencyKey,
        response: result as any,
        statusCode: result.status === "error" ? 400 : 200,
      },
    }).catch(() => {}); // Ignore duplicate key errors on race condition

    results.push(result);
  }

  const response: SyncPushResponse = { results, serverTime };
  return c.json(response, 200);
});
```

The `processCreate`, `processUpdate`, and `processDelete` helper functions handle each mutation type. The implementing engineer should:
- `processCreate`: Validate payload, insert with client ID + userId, return created record
- `processUpdate`: Fetch record, verify userId ownership, run `fieldLevelMerge()`, apply merged fields, return updated record
- `processDelete`: Fetch record, verify userId ownership, soft-delete, return confirmation

Each helper returns a `SyncMutationResult`.

- [ ] **Step 4: Run tests**

Run: `cd apps/api && pnpm test -- --run src/__tests__/sync.test.ts`

- [ ] **Step 5: Run full suite + typecheck**

Run: `pnpm typecheck && cd apps/api && pnpm test`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): add POST /sync/push with field-level merge

Processes batched mutations (max 50) with idempotency keys, ownership
validation, entity type allowlist, and field-level merge using previousValues.
Rate limited at 60/min. Stores idempotency keys in DB for retry safety."
```

---

### Task 7: Apple Auth Provider

**Files:**
- Modify: `apps/api/src/lib/auth.ts`

**Context:** Add Apple as a social provider in better-auth. Required by App Store if Google OAuth is offered.

- [ ] **Step 1: Read better-auth docs for Apple provider configuration**

Check: `node_modules/better-auth/` for Apple provider setup. The configuration follows the same pattern as Google.

- [ ] **Step 2: Add Apple provider to auth config**

In `apps/api/src/lib/auth.ts`, add Apple to the social providers:

```typescript
socialProviders: {
  google: { /* existing */ },
  apple: {
    clientId: process.env.APPLE_CLIENT_ID!,
    clientSecret: process.env.APPLE_CLIENT_SECRET!,
    // Apple-specific: appBundleIdentifier for native iOS sign-in
    ...(process.env.APPLE_BUNDLE_ID ? { appBundleIdentifier: process.env.APPLE_BUNDLE_ID } : {}),
  },
},
```

**Note:** `APPLE_CLIENT_ID` and `APPLE_CLIENT_SECRET` are optional in dev (like Google). The auth system should not crash if they're missing — just disable the Apple provider.

- [ ] **Step 3: Add env vars to .env.example**

In `apps/api/.env.example`, add:

```
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
APPLE_BUNDLE_ID=com.brett.app
```

- [ ] **Step 4: Add mobile redirect URI to CORS/trusted origins**

In `apps/api/src/lib/auth.ts`, ensure the trusted origins include the mobile app's Universal Links domain:

```typescript
trustedOrigins: [
  // ... existing origins
  "https://brett.app", // Universal Links for mobile OAuth callback
],
```

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`

```bash
git add -A && git commit -m "feat(api): add Sign in with Apple provider to better-auth

Adds Apple social provider config. Env vars optional in dev (same as Google).
Adds mobile Universal Links domain to trusted origins."
```

---

## Phase 2: Mobile App Setup

These tasks build the Expo 53 mobile app from the ground up. They depend on the API-side work being complete for end-to-end testing, but can be developed in parallel.

---

### Task 8: Upgrade to Expo 53 + Configure Project

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/app.config.ts` (replaces app.json)
- Modify: `apps/mobile/metro.config.js`
- Modify: `apps/mobile/tsconfig.json`
- Delete: `apps/mobile/app.json`

**Context:** The scaffold has Expo 51. We need Expo 53 for the synchronous SQLite API, New Architecture, and better native module bridging.

- [ ] **Step 1: Upgrade Expo SDK**

Run from `apps/mobile/`:

```bash
npx expo install expo@^53.0.0 expo-router@^4 react-native@^0.76 \
  react-native-screens react-native-safe-area-context \
  expo-constants expo-linking expo-status-bar expo-notifications
```

Then install new dependencies needed for the scaffold:

```bash
npx expo install expo-sqlite expo-secure-store expo-local-authentication \
  expo-apple-authentication @react-native-community/netinfo
```

Install JS dependencies:

```bash
pnpm add drizzle-orm zustand @paralleldrive/cuid2
pnpm add -D drizzle-kit
```

- [ ] **Step 2: Create app.config.ts**

Create `apps/mobile/app.config.ts`:

```typescript
import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Brett",
  slug: "brett",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "brett",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: "com.brett.app",
    buildNumber: "1",
    supportsTablet: true,
    infoPlist: {
      NSFaceIDUsageDescription: "Unlock Brett with Face ID",
    },
    entitlements: {
      "com.apple.security.application-groups": ["group.com.brett.app"],
      "aps-environment": "development",
    },
    config: {
      usesNonExemptEncryption: false,
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-local-authentication",
    "expo-apple-authentication",
    "expo-sqlite",
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#E8B931" }],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
  },
});
```

Delete `apps/mobile/app.json`.

- [ ] **Step 3: Update metro.config.js for Expo 53**

Replace `apps/mobile/metro.config.js`:

```javascript
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const monorepoRoot = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

- [ ] **Step 4: Update tsconfig.json**

Update `apps/mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@brett/types": ["../../packages/types/src"],
      "@brett/utils": ["../../packages/utils/src"],
      "@brett/business": ["../../packages/business/src"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", "app.config.ts"]
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd apps/mobile && npx expo start --no-dev --minify` (test compilation)

Then cancel. Or run: `cd apps/mobile && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(mobile): upgrade to Expo 53 + configure project

Replace app.json with app.config.ts. Add expo-sqlite, expo-secure-store,
expo-local-authentication, expo-apple-authentication, drizzle-orm, zustand.
Update metro.config.js and tsconfig.json for Expo 53."
```

---

### Task 9: Local SQLite Database + Drizzle Schema

**Files:**
- Create: `apps/mobile/src/db/schema.ts`
- Create: `apps/mobile/src/db/index.ts`

**Context:** Define the local SQLite schema using Drizzle ORM. This mirrors the server's Prisma schema but with sync metadata columns. Initialize the database with WAL mode on app start.

- [ ] **Step 1: Create Drizzle schema definitions**

Create `apps/mobile/src/db/schema.ts`:

```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ---- Data Tables (mirror server Prisma models) ----

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),            // "task" | "content"
  status: text("status").notNull(),        // "active" | "snoozed" | "done" | "archived"
  title: text("title").notNull(),
  description: text("description"),
  notes: text("notes"),
  source: text("source").default("Brett"),
  sourceId: text("source_id"),
  sourceUrl: text("source_url"),
  dueDate: text("due_date"),              // ISO string
  dueDatePrecision: text("due_date_precision"), // "day" | "week"
  completedAt: text("completed_at"),       // ISO string
  snoozedUntil: text("snoozed_until"),
  brettObservation: text("brett_observation"),
  reminder: text("reminder"),
  recurrence: text("recurrence"),
  recurrenceRule: text("recurrence_rule"),
  brettTakeGeneratedAt: text("brett_take_generated_at"),
  contentType: text("content_type"),
  contentStatus: text("content_status"),
  contentTitle: text("content_title"),
  contentBody: text("content_body"),
  contentDescription: text("content_description"),
  contentImageUrl: text("content_image_url"),
  contentFavicon: text("content_favicon"),
  contentDomain: text("content_domain"),
  listId: text("list_id"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").default("synced"), // synced | pending_create | pending_update | pending_delete | provisional
  _baseUpdatedAt: text("_base_updated_at"),
  _lastError: text("_last_error"),
  _provisionalParentId: text("_provisional_parent_id"),
});

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  colorClass: text("color_class").default("bg-gray-500"),
  sortOrder: integer("sort_order").default(0),
  archivedAt: text("archived_at"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  _syncStatus: text("_sync_status").default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
  _lastError: text("_last_error"),
});

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  googleEventId: text("google_event_id"),
  calendarId: text("calendar_id"),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isAllDay: integer("is_all_day", { mode: "boolean" }).default(false),
  status: text("status"),
  myResponseStatus: text("my_response_status"),
  meetingLink: text("meeting_link"),
  organizer: text("organizer"),            // JSON string
  attendees: text("attendees"),            // JSON string
  brettObservation: text("brett_observation"),
  calendarColor: text("calendar_color"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  _syncStatus: text("_sync_status").default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const scouts = sqliteTable("scouts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  goal: text("goal").notNull(),
  context: text("context"),
  sources: text("sources"),                // JSON string
  sensitivity: text("sensitivity").default("medium"),
  analysisTier: text("analysis_tier").default("standard"),
  cadenceIntervalHours: real("cadence_interval_hours"),
  budgetUsed: integer("budget_used").default(0),
  budgetTotal: integer("budget_total"),
  status: text("status").default("active"),
  statusLine: text("status_line"),
  nextRunAt: text("next_run_at"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  _syncStatus: text("_sync_status").default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const scoutFindings = sqliteTable("scout_findings", {
  id: text("id").primaryKey(),
  scoutId: text("scout_id").notNull(),
  type: text("type").notNull(),            // "insight" | "article" | "task"
  title: text("title").notNull(),
  description: text("description"),
  sourceUrl: text("source_url"),
  sourceName: text("source_name"),
  relevanceScore: real("relevance_score"),
  reasoning: text("reasoning"),
  feedbackUseful: integer("feedback_useful", { mode: "boolean" }),
  itemId: text("item_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  _syncStatus: text("_sync_status").default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const brettMessages = sqliteTable("brett_messages", {
  id: text("id").primaryKey(),
  itemId: text("item_id"),
  calendarEventId: text("calendar_event_id"),
  role: text("role").notNull(),            // "user" | "brett"
  content: text("content").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  _syncStatus: text("_sync_status").default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  url: text("url"),                        // presigned URL (short-lived)
  itemId: text("item_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  _syncStatus: text("_sync_status").default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const userProfile = sqliteTable("user_profile", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  assistantName: text("assistant_name").default("Brett"),
  timezone: text("timezone").default("America/Los_Angeles"),
  city: text("city"),
  countryCode: text("country_code"),
  tempUnit: text("temp_unit").default("auto"),
  weatherEnabled: integer("weather_enabled", { mode: "boolean" }).default(false),
  backgroundStyle: text("background_style").default("photography"),
  updatedAt: text("updated_at").notNull(),
});

// ---- Sync Infrastructure Tables ----

export const mutationQueue = sqliteTable("_mutation_queue", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),        // CREATE | UPDATE | DELETE
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),        // POST | PATCH | DELETE
  payload: text("payload").notNull(),      // JSON
  changedFields: text("changed_fields"),   // JSON array
  previousValues: text("previous_values"), // JSON
  baseUpdatedAt: text("base_updated_at"),
  beforeSnapshot: text("before_snapshot"), // JSON — full record state before mutation
  dependsOn: text("depends_on"),           // another mutation's ID
  batchId: text("batch_id"),
  status: text("status").default("pending"), // pending | in_flight | failed | dead | blocked
  retryCount: integer("retry_count").default(0),
  error: text("error"),
  errorCode: integer("error_code"),
  createdAt: text("created_at").notNull(),
});

export const syncCursors = sqliteTable("_sync_cursors", {
  tableName: text("table_name").primaryKey(),
  lastSyncedAt: text("last_synced_at"),
  isInitialSyncComplete: integer("is_initial_sync_complete", { mode: "boolean" }).default(false),
});

export const conflictLog = sqliteTable("_conflict_log", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  mutationId: text("mutation_id"),
  localValues: text("local_values").notNull(),   // JSON
  serverValues: text("server_values").notNull(), // JSON
  conflictedFields: text("conflicted_fields"),   // JSON array
  resolution: text("resolution").notNull(),       // server_wins | merged
  resolvedAt: text("resolved_at").notNull(),
});

export const syncHealth = sqliteTable("_sync_health", {
  id: text("id").primaryKey().default("singleton"),
  lastSuccessfulPushAt: text("last_successful_push_at"),
  lastSuccessfulPullAt: text("last_successful_pull_at"),
  pendingMutationCount: integer("pending_mutation_count").default(0),
  deadMutationCount: integer("dead_mutation_count").default(0),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").default(0),
});
```

- [ ] **Step 2: Create database initialization**

Create `apps/mobile/src/db/index.ts`:

```typescript
import * as SQLite from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: SQLite.SQLiteDatabase | null = null;

export function getDatabase() {
  if (!_db) {
    _sqlite = SQLite.openDatabaseSync("brett.db");

    // Enable WAL mode for concurrent reads during writes
    _sqlite.execSync("PRAGMA journal_mode=WAL;");
    _sqlite.execSync("PRAGMA busy_timeout=5000;");
    _sqlite.execSync("PRAGMA foreign_keys=OFF;");

    _db = drizzle(_sqlite, { schema });

    // Create tables if they don't exist
    // Drizzle push/migrate will handle this in production;
    // for now, use raw SQL to create tables on first run
    createTablesIfNeeded(_sqlite);
  }
  return _db;
}

export function getSQLite(): SQLite.SQLiteDatabase {
  if (!_sqlite) {
    getDatabase(); // initializes both
  }
  return _sqlite!;
}

function createTablesIfNeeded(db: SQLite.SQLiteDatabase) {
  // This is a simplified approach — in production, use Drizzle migrations.
  // For the scaffold, we create tables directly from the schema.
  // The implementing engineer should set up proper Drizzle migrations.
  db.execSync(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      notes TEXT,
      source TEXT DEFAULT 'Brett',
      source_id TEXT,
      source_url TEXT,
      due_date TEXT,
      due_date_precision TEXT,
      completed_at TEXT,
      snoozed_until TEXT,
      brett_observation TEXT,
      reminder TEXT,
      recurrence TEXT,
      recurrence_rule TEXT,
      brett_take_generated_at TEXT,
      content_type TEXT,
      content_status TEXT,
      content_title TEXT,
      content_body TEXT,
      content_description TEXT,
      content_image_url TEXT,
      content_favicon TEXT,
      content_domain TEXT,
      list_id TEXT,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      _sync_status TEXT DEFAULT 'synced',
      _base_updated_at TEXT,
      _last_error TEXT,
      _provisional_parent_id TEXT
    );

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color_class TEXT DEFAULT 'bg-gray-500',
      sort_order INTEGER DEFAULT 0,
      archived_at TEXT,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      _sync_status TEXT DEFAULT 'synced',
      _base_updated_at TEXT,
      _last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS _mutation_queue (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      payload TEXT NOT NULL,
      changed_fields TEXT,
      previous_values TEXT,
      base_updated_at TEXT,
      before_snapshot TEXT,
      depends_on TEXT,
      batch_id TEXT,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      error_code INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS _sync_cursors (
      table_name TEXT PRIMARY KEY,
      last_synced_at TEXT,
      is_initial_sync_complete INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS _sync_health (
      id TEXT PRIMARY KEY DEFAULT 'singleton',
      last_successful_push_at TEXT,
      last_successful_pull_at TEXT,
      pending_mutation_count INTEGER DEFAULT 0,
      dead_mutation_count INTEGER DEFAULT 0,
      last_error TEXT,
      consecutive_failures INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS _conflict_log (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      mutation_id TEXT,
      local_values TEXT NOT NULL,
      server_values TEXT NOT NULL,
      conflicted_fields TEXT,
      resolution TEXT NOT NULL,
      resolved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      assistant_name TEXT DEFAULT 'Brett',
      timezone TEXT DEFAULT 'America/Los_Angeles',
      city TEXT,
      country_code TEXT,
      temp_unit TEXT DEFAULT 'auto',
      weather_enabled INTEGER DEFAULT 0,
      background_style TEXT DEFAULT 'photography',
      updated_at TEXT NOT NULL
    );
  `);
  // Note: calendar_events, scouts, scout_findings, brett_messages, attachments
  // tables should also be created here. Omitted for brevity — follow the same pattern
  // using the column definitions from schema.ts.
}

/** Wipe all data (used on logout) */
export function wipeDatabase() {
  const sqlite = getSQLite();
  const tables = [
    "items", "lists", "calendar_events", "calendar_event_notes",
    "scouts", "scout_findings", "brett_messages", "attachments",
    "user_profile", "_mutation_queue", "_sync_cursors",
    "_sync_health", "_conflict_log",
  ];
  for (const table of tables) {
    sqlite.execSync(`DELETE FROM ${table};`);
  }
}

export { schema };
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mobile): add SQLite database with Drizzle schema

Local schema mirrors server Prisma models with sync metadata columns.
Includes mutation queue, sync cursors, conflict log, sync health tables.
WAL mode enabled. Foreign keys disabled (intentional for partial sync)."
```

---

### Task 10: API Client + Token Storage

**Files:**
- Create: `apps/mobile/src/auth/token-storage.ts`
- Create: `apps/mobile/src/api/client.ts`

**Context:** The HTTP client handles all API communication. It injects auth tokens, handles 401 refresh, and detects offline state. Token storage uses expo-secure-store (iOS Keychain).

- [ ] **Step 1: Create token storage**

Create `apps/mobile/src/auth/token-storage.ts`:

```typescript
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "auth_token";
const USER_ID_KEY = "user_id";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_ID_KEY);
}

export async function getUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_ID_KEY);
}

export async function setUserId(id: string): Promise<void> {
  await SecureStore.setItemAsync(USER_ID_KEY, id, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
```

- [ ] **Step 2: Create API client**

Create `apps/mobile/src/api/client.ts`:

```typescript
import { getToken, setToken, clearToken } from "../auth/token-storage";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";

const API_URL = Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:3001";
const DEFAULT_TIMEOUT = 30_000;

export class OfflineError extends Error {
  constructor() {
    super("Device is offline");
    this.name = "OfflineError";
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "AuthExpiredError";
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshToken(): Promise<boolean> {
  // Mutex: only one refresh at a time
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const token = await getToken();
      if (!token) return false;

      const res = await fetch(`${API_URL}/api/auth/get-session`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const body = await res.json();
        if (body.session?.token) {
          await setToken(body.session.token);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T = unknown>(
  path: string,
  init?: RequestInit & { timeout?: number },
): Promise<{ status: number; data: T }> {
  // Check network
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    throw new OfflineError();
  }

  const token = await getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeout ?? DEFAULT_TIMEOUT);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    // Handle 401 — attempt refresh, retry once
    if (res.status === 401 && token) {
      const refreshed = await refreshToken();
      if (refreshed) {
        const newToken = await getToken();
        const retryRes = await fetch(`${API_URL}${path}`, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newToken}`,
            ...(init?.headers ?? {}),
          },
        });

        if (retryRes.status === 401) {
          await clearToken();
          throw new AuthExpiredError();
        }

        const data = retryRes.headers.get("content-type")?.includes("json")
          ? await retryRes.json()
          : null;
        return { status: retryRes.status, data: data as T };
      }

      await clearToken();
      throw new AuthExpiredError();
    }

    const data = res.headers.get("content-type")?.includes("json")
      ? await res.json()
      : null;
    return { status: res.status, data: data as T };
  } finally {
    clearTimeout(timeout);
  }
}

export function getApiUrl(): string {
  return API_URL;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mobile): add API client with auth interceptor + token storage

Keychain-backed token storage (WHEN_UNLOCKED_THIS_DEVICE_ONLY).
API client with offline detection, 401 refresh + retry, timeout handling."
```

---

### Task 11: Auth Provider + Sign-In Screen

**Files:**
- Create: `apps/mobile/src/auth/provider.tsx`
- Create: `apps/mobile/app/(auth)/sign-in.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/(app)/_layout.tsx`

**Context:** Auth provider manages sign-in state, gates navigation between auth and app screens, and handles sign-out (including the pending mutation warning from the spec).

- [ ] **Step 1: Create auth provider**

Create `apps/mobile/src/auth/provider.tsx`:

```typescript
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getToken, setToken, setUserId, clearToken, getUserId } from "./token-storage";
import { apiRequest, AuthExpiredError } from "../api/client";
import { wipeDatabase } from "../db";

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserIdState] = useState<string | null>(null);

  // Check for existing token on mount
  useEffect(() => {
    (async () => {
      const token = await getToken();
      const uid = await getUserId();
      if (token && uid) {
        setIsAuthenticated(true);
        setUserIdState(uid);
      }
      setIsLoading(false);
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { status, data } = await apiRequest<any>("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (status !== 200 || !data?.token) {
      throw new Error(data?.message ?? "Sign-in failed");
    }

    await setToken(data.token);
    await setUserId(data.user.id);
    setUserIdState(data.user.id);
    setIsAuthenticated(true);
  }, []);

  const signOut = useCallback(async () => {
    // TODO: Check pending mutation count and warn user (spec section 2.17)
    await clearToken();
    wipeDatabase();
    setIsAuthenticated(false);
    setUserIdState(null);
  }, []);

  return (
    <AuthContext.Provider value={{ isLoading, isAuthenticated, userId, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 2: Create sign-in screen**

Create `apps/mobile/app/(auth)/sign-in.tsx`:

```typescript
import { useState } from "react";
import { View, Text, TextInput, Button, ActivityIndicator } from "react-native";
import { useAuth } from "../../src/auth/provider";

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message ?? "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: "bold", marginBottom: 24 }}>
        Sign in to Brett
      </Text>

      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 12, marginBottom: 12, borderRadius: 8 }}
      />

      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 12, marginBottom: 12, borderRadius: 8 }}
      />

      {error && <Text style={{ color: "red", marginBottom: 12 }}>{error}</Text>}

      {loading ? (
        <ActivityIndicator />
      ) : (
        <Button title="Sign In" onPress={handleSignIn} />
      )}
    </View>
  );
}
```

- [ ] **Step 3: Update root layout**

Replace `apps/mobile/app/_layout.tsx`:

```typescript
import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "../src/auth/provider";

function AuthGate() {
  const { isLoading, isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!isAuthenticated && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (isAuthenticated && inAuthGroup) {
      router.replace("/(app)/today");
    }
  }, [isLoading, isAuthenticated, segments]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Create authenticated layout**

Create `apps/mobile/app/(app)/_layout.tsx`:

```typescript
import { Stack } from "expo-router";

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(mobile): add auth provider + sign-in screen + navigation gate

AuthProvider with sign-in/sign-out, Keychain token storage.
Expo Router auth gate redirects based on auth state.
Basic sign-in screen (unstyled — scaffold only)."
```

---

### Task 12: Sync Engine Core — Mutation Queue + Push Engine

**Files:**
- Create: `apps/mobile/src/sync/types.ts`
- Create: `apps/mobile/src/sync/mutation-queue.ts`
- Create: `apps/mobile/src/sync/push-engine.ts`
- Create: `apps/mobile/src/sync/conflict-resolver.ts`

**Context:** This is the heart of the offline-first system. The mutation queue persists writes to SQLite, compacts them before push, and the push engine sends them to `/sync/push`. The conflict resolver handles the server's merge responses.

The implementing engineer should follow the spec closely (section 2.3-2.5, Addendum A fixes). Key behaviors:
- Mutations are persisted to `_mutation_queue` table (survives crashes)
- Compaction runs on every enqueue (eager, per fix A10)
- Push processes mutations sequentially via `POST /sync/push`
- Idempotency keys prevent duplicate application
- Field-level conflict resolution uses `previousValues`
- `before_snapshot` is stored for rollback on rejection
- Dependencies (`dependsOn`) are respected in push ordering
- Failed mutations: network errors retry indefinitely, 400s go to `dead` status

This task creates the files with full implementations. The code is too large to inline entirely here — the implementing engineer should follow the interfaces defined in `types.ts` and the behavioral spec in the design doc sections 2.3-2.9.

- [ ] **Step 1: Create sync types**

Create `apps/mobile/src/sync/types.ts` with local sync-specific types (MutationRecord, SyncState, CompactedMutation, etc.)

- [ ] **Step 2: Implement mutation queue**

Create `apps/mobile/src/sync/mutation-queue.ts` with:
- `enqueue(mutation)` — writes to `_mutation_queue` table, runs eager compaction
- `compact()` — merges UPDATE+UPDATE, CREATE+UPDATE, removes CREATE+DELETE pairs
- `dequeue(id)` — removes processed mutation
- `getPending()` — returns pending mutations in FIFO order, respecting `dependsOn`
- `markInFlight(id)` / `markFailed(id, error)` / `markDead(id)`
- `resetInFlight()` — called on app start to reset crashed in-flight mutations
- `getPendingCount()` / `getDeadCount()`

- [ ] **Step 3: Implement conflict resolver**

Create `apps/mobile/src/sync/conflict-resolver.ts` with:
- `resolveConflict(localMutation, serverResult)` — logs to `_conflict_log`, returns resolved record
- Uses the server's `conflictedFields` to identify which fields the server won on

- [ ] **Step 4: Implement push engine**

Create `apps/mobile/src/sync/push-engine.ts` with:
- `push()` — drains mutation queue, sends to `/sync/push` in batches of 50
- Handles each result status: applied, merged, conflict, error, not_found
- On `applied`/`merged`: update local SQLite with server response, dequeue
- On `conflict`: run conflict resolver, update local with server state, dequeue
- On `error` (400): rollback from `before_snapshot`, mark `dead`
- On network error: stop, leave in queue for retry

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(mobile): add sync engine core — mutation queue + push engine

Persistent mutation queue with eager compaction, dependency ordering.
Push engine sends batches to /sync/push with field-level merge handling.
Conflict resolver logs all resolutions to _conflict_log."
```

---

### Task 13: Sync Engine — Pull Engine + Sync Manager

**Files:**
- Create: `apps/mobile/src/sync/pull-engine.ts`
- Create: `apps/mobile/src/sync/network-monitor.ts`
- Create: `apps/mobile/src/sync/sync-manager.ts`

**Context:** The pull engine fetches changes from `/sync/pull`, upserts into local SQLite, and handles tombstones. The network monitor detects online/offline state. The sync manager orchestrates push-then-pull cycles, manages locks, and triggers sync on various events (foreground, network restore, pull-to-refresh).

- [ ] **Step 1: Implement network monitor**

Create `apps/mobile/src/sync/network-monitor.ts`:
- Wraps `@react-native-community/netinfo`
- Emits `online`/`offline` events
- Provides `isOnline()` check
- On network restore: emits event that SyncManager listens to

- [ ] **Step 2: Implement pull engine**

Create `apps/mobile/src/sync/pull-engine.ts`:
- `pull()` — reads cursors from `_sync_cursors`, calls `POST /sync/pull`, upserts results
- Upsert logic: if `_syncStatus == "synced"` → overwrite. If `pending_*` → skip (don't clobber local changes).
- Tombstone handling: delete local records for IDs in `deleted` arrays
- Provisional replacement: when upserting items, check for matching provisionals and replace
- Updates cursors in `_sync_cursors` after successful pull
- Paginated: if `hasMore`, pull again for that table

- [ ] **Step 3: Implement sync manager**

Create `apps/mobile/src/sync/sync-manager.ts`:
- `sync()` — push first, then pull (with locks)
- `pushLock` and `pullLock` — prevents concurrent operations
- Triggers: `syncOnForeground()`, `syncOnNetworkRestore()`, `syncOnMutation(debounced 1s)`, `syncOnPullToRefresh()`
- Updates `_sync_health` table after each cycle
- Exposes: `getSyncStatus()`, `getPendingCount()`, `isSyncing()`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(mobile): add pull engine + network monitor + sync manager

Pull engine with cursor-based incremental sync, tombstone handling,
provisional replacement. Network monitor wraps NetInfo. Sync manager
orchestrates push-then-pull with locks and debounced triggers."
```

---

### Task 14: Zustand Stores + Data Hooks

**Files:**
- Create: `apps/mobile/src/store/items.ts`
- Create: `apps/mobile/src/store/lists.ts`
- Create: `apps/mobile/src/store/sync.ts`
- Create: `apps/mobile/src/store/index.ts`
- Create: `apps/mobile/src/hooks/use-items.ts`
- Create: `apps/mobile/src/hooks/use-lists.ts`
- Create: `apps/mobile/src/hooks/use-sync.ts`

**Context:** Zustand stores hold in-memory state hydrated from SQLite. React hooks provide convenient access for components. All writes go through the stores, which dispatch to the mutation queue.

- [ ] **Step 1: Create items store**

Create `apps/mobile/src/store/items.ts`:
- `items: Map<string, Item>`
- `hydrate()` — load from SQLite (async, active items only on first load)
- `createItem(input)` — write to SQLite, enqueue mutation, update store
- `updateItem(id, changes)` — write to SQLite with before_snapshot, enqueue, update store
- `toggleItem(id)` — optimistic toggle, handle recurrence provisionals, enqueue
- `deleteItem(id)` — soft-delete locally, enqueue mutation
- `upsertFromSync(records)` — called by pull engine, bulk update store from server data
- Selectors: `getToday()`, `getInbox()`, `getUpcoming()`, `getByList(listId)`

- [ ] **Step 2: Create lists store**

Create `apps/mobile/src/store/lists.ts`:
- `lists: List[]`
- `hydrate()`, `createList()`, `updateList()`, `deleteList()`, `reorderLists()`
- `upsertFromSync(records)`
- Selectors: `getActive()`, `getArchived()`

- [ ] **Step 3: Create sync status store**

Create `apps/mobile/src/store/sync.ts`:
- `syncHealth: SyncHealth`
- `pendingCount: number`
- `isSyncing: boolean`
- `lastSyncedAt: string | null`
- Updated by sync manager after each cycle

- [ ] **Step 4: Create store initialization**

Create `apps/mobile/src/store/index.ts`:
- `initializeStores()` — hydrates all stores from SQLite on app start
- Called once after auth is confirmed

- [ ] **Step 5: Create React hooks**

Create hooks that wrap Zustand selectors:
- `useItems(filter?)` — returns filtered items + loading state
- `useLists()` — returns lists
- `useSyncStatus()` — returns sync health

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(mobile): add Zustand stores + React data hooks

Items store with CRUD + optimistic updates + sync upsert.
Lists store with CRUD. Sync status store. React hooks for components.
All writes dispatch to mutation queue for offline-safe sync."
```

---

### Task 15: Smoke Test — Today Screen + Debug Panel

**Files:**
- Create: `apps/mobile/app/(app)/today.tsx`

**Context:** The smoke test screen. Unstyled, functional. Proves every layer works end-to-end: auth → sync → SQLite → Zustand → React → mutation queue → push → pull.

- [ ] **Step 1: Create the Today screen**

Create `apps/mobile/app/(app)/today.tsx`:

```typescript
import { useEffect, useState } from "react";
import {
  View, Text, FlatList, TextInput, Button, Pressable,
  RefreshControl, SafeAreaView, ScrollView,
} from "react-native";
import { useAuth } from "../../src/auth/provider";
import { useItems } from "../../src/hooks/use-items";
import { useLists } from "../../src/hooks/use-lists";
import { useSyncStatus } from "../../src/hooks/use-sync";
import { initializeStores } from "../../src/store";
import { getSyncManager } from "../../src/sync/sync-manager";

export default function TodayScreen() {
  const { signOut, userId } = useAuth();
  const { todayItems, createItem, toggleItem } = useItems();
  const { lists } = useLists();
  const { syncHealth, pendingCount, isSyncing, lastSyncedAt } = useSyncStatus();
  const [newTitle, setNewTitle] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Initialize stores + start first sync on mount
  useEffect(() => {
    (async () => {
      await initializeStores();
      setInitialized(true);
      getSyncManager().sync();
    })();
  }, []);

  async function handleAddTask() {
    if (!newTitle.trim()) return;
    await createItem({ type: "task", title: newTitle.trim(), status: "active" });
    setNewTitle("");
  }

  async function handleRefresh() {
    setRefreshing(true);
    await getSyncManager().sync();
    setRefreshing(false);
  }

  if (!initialized) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        style={{ flex: 1, padding: 16 }}
      >
        {/* Header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: "bold" }}>Today</Text>
          <Button title="Sign Out" onPress={signOut} />
        </View>

        {/* Sync Status */}
        <View style={{ backgroundColor: "#f0f0f0", padding: 8, borderRadius: 8, marginBottom: 16 }}>
          <Text style={{ fontSize: 12, color: "#666" }}>
            Sync: {isSyncing ? "syncing..." : lastSyncedAt ? `synced ${lastSyncedAt}` : "never synced"}
          </Text>
          <Text style={{ fontSize: 12, color: "#666" }}>
            Pending mutations: {pendingCount}
          </Text>
        </View>

        {/* Task List */}
        <Text style={{ fontSize: 14, fontWeight: "600", marginBottom: 8 }}>
          Tasks ({todayItems.length})
        </Text>

        {todayItems.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => toggleItem(item.id)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 12,
              paddingHorizontal: 8,
              borderBottomWidth: 1,
              borderBottomColor: "#eee",
            }}
          >
            <Text style={{ fontSize: 18, marginRight: 12 }}>
              {item.status === "done" ? "[x]" : "[ ]"}
            </Text>
            <Text
              style={{
                fontSize: 16,
                textDecorationLine: item.status === "done" ? "line-through" : "none",
                color: item.status === "done" ? "#999" : "#000",
              }}
            >
              {item.title}
            </Text>
          </Pressable>
        ))}

        {todayItems.length === 0 && (
          <Text style={{ color: "#999", paddingVertical: 24, textAlign: "center" }}>
            No tasks today
          </Text>
        )}

        {/* Quick Add */}
        <View style={{ flexDirection: "row", marginTop: 16, gap: 8 }}>
          <TextInput
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Add a task..."
            onSubmitEditing={handleAddTask}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: "#ccc",
              padding: 12,
              borderRadius: 8,
            }}
          />
          <Button title="Add" onPress={handleAddTask} />
        </View>

        {/* Debug Panel */}
        <View style={{ marginTop: 32, padding: 12, backgroundColor: "#f8f8f8", borderRadius: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: "bold", marginBottom: 8 }}>Debug Panel</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>User ID: {userId}</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>Items in store: {todayItems.length}</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>Lists: {lists.length}</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>Pending: {pendingCount}</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>Dead: {syncHealth?.deadMutationCount ?? 0}</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>Last push: {syncHealth?.lastSuccessfulPushAt ?? "never"}</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>Last pull: {syncHealth?.lastSuccessfulPullAt ?? "never"}</Text>
          <Text style={{ fontSize: 11, color: "#666" }}>
            Last error: {syncHealth?.lastError ?? "none"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Delete the old placeholder index.tsx**

Remove `apps/mobile/app/index.tsx` if it still exists (Expo Router will use the (auth) and (app) groups now).

- [ ] **Step 3: Test end-to-end**

1. Start the API: `pnpm dev:api` (requires Postgres running)
2. Start the mobile app: `cd apps/mobile && npx expo start`
3. Open on iOS simulator or scan QR on device
4. Sign in with an existing account
5. Verify: tasks appear from sync, sync status shows "synced"
6. Create a task → appears in list, pending count briefly shows 1, then syncs
7. Toggle a task complete → checkbox updates immediately
8. Pull-to-refresh → pulls any changes from desktop
9. Open desktop, create a task → pull-to-refresh on phone → task appears
10. Kill app, reopen → tasks still there (SQLite persistence)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(mobile): add smoke test Today screen with debug panel

Unstyled Today view proving all layers: auth gate → initial sync →
SQLite persistence → Zustand hydration → task CRUD with optimistic
updates → mutation queue → push/pull sync. Debug panel shows sync health."
```

---

### Task 16: Push Notification Registration

**Files:**
- Create: `apps/mobile/src/notifications/registration.ts`
- Modify: `apps/mobile/app/(app)/_layout.tsx`

**Context:** Register the device for push notifications after auth. Sends the token to `POST /devices/register`.

- [ ] **Step 1: Create registration module**

Create `apps/mobile/src/notifications/registration.ts`:

```typescript
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiRequest } from "../api/client";

export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  // Get Expo push token (wraps FCM/APNs)
  const tokenData = await Notifications.getExpoPushTokenAsync();
  const pushToken = tokenData.data;

  // Register with server
  try {
    await apiRequest("/devices/register", {
      method: "POST",
      body: JSON.stringify({
        token: pushToken,
        platform: Platform.OS,
        appVersion: "1.0.0",
      }),
    });
  } catch (err) {
    console.warn("Failed to register push token:", err);
  }

  return pushToken;
}

export async function unregisterPushNotifications(token: string): Promise<void> {
  try {
    await apiRequest("/devices/unregister", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    console.warn("Failed to unregister push token:", err);
  }
}
```

- [ ] **Step 2: Register on app launch**

In `apps/mobile/app/(app)/_layout.tsx`, call registration after mount:

```typescript
import { useEffect } from "react";
import { Stack } from "expo-router";
import { registerForPushNotifications } from "../../src/notifications/registration";

export default function AppLayout() {
  useEffect(() => {
    registerForPushNotifications();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mobile): add push notification registration

Request permissions on app launch, register device token with server.
Expo push token wraps APNs for iOS delivery."
```

---

### Task 17: SSE Client for Foreground Real-Time

**Files:**
- Create: `apps/mobile/src/api/sse.ts`

**Context:** When the app is foregrounded, maintain an SSE connection for real-time updates. On event received, trigger a targeted sync pull. On disconnect, reconnect with backoff.

- [ ] **Step 1: Create SSE client**

Create `apps/mobile/src/api/sse.ts`:

```typescript
import { getToken } from "../auth/token-storage";
import { getApiUrl } from "./client";
import { getSyncManager } from "../sync/sync-manager";
import { AppState, AppStateStatus } from "react-native";

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_BACKOFF = 30_000;

async function connect() {
  const token = await getToken();
  if (!token) return;

  const apiUrl = getApiUrl();

  try {
    // Get SSE ticket
    const ticketRes = await fetch(`${apiUrl}/events/ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!ticketRes.ok) return;
    const { ticket } = await ticketRes.json();

    // Connect to SSE stream
    // Note: React Native doesn't have native EventSource.
    // Use a fetch-based SSE reader or react-native-sse.
    // This is a simplified placeholder — the implementing engineer
    // should use a proper SSE library compatible with Expo 53.
    const response = await fetch(`${apiUrl}/events/stream?ticket=${ticket}`, {
      headers: { Accept: "text/event-stream" },
    });

    if (!response.body) return;

    reconnectAttempts = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Read SSE stream
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      // Parse SSE events and trigger targeted sync
      // The implementing engineer should parse SSE format (event: type\ndata: json\n\n)
      // and call getSyncManager().sync() on relevant events
    }
  } catch (err) {
    // Connection failed or dropped — schedule reconnect
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const backoff = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_BACKOFF);
  reconnectAttempts++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoff);
}

export function startSSE() {
  connect();

  // Listen for app state changes
  const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") {
      connect();
    } else if (state === "background") {
      disconnect();
    }
  });

  return () => {
    subscription.remove();
    disconnect();
  };
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Close any active connection
  eventSource = null;
}
```

- [ ] **Step 2: Start SSE after initial sync**

In the app layout or sync manager initialization, call `startSSE()` after the first successful sync.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mobile): add SSE client for foreground real-time updates

Connects to /events/stream when app is foregrounded. Disconnects on
background. Exponential backoff reconnection (max 30s). Triggers
incremental sync on events. Full pull on reconnect."
```

---

## Verification

After all tasks are complete, run this verification checklist:

- [ ] `pnpm typecheck` — all packages and apps pass
- [ ] `cd apps/api && pnpm test` — all API tests pass (existing + new sync/devices/soft-delete)
- [ ] Mobile app compiles: `cd apps/mobile && npx tsc --noEmit`
- [ ] Mobile app runs on iOS simulator
- [ ] End-to-end flow works:
  1. Sign in on mobile
  2. Tasks sync from server
  3. Create task on mobile → appears on desktop after refresh
  4. Create task on desktop → pull-to-refresh on mobile → appears
  5. Toggle task complete on mobile → syncs to server
  6. Kill app → reopen → data persists
  7. Airplane mode → create task → disable airplane mode → task syncs
  8. Debug panel shows accurate sync health

---

## What's NOT in This Plan (for future tasks)

- UI/UX design, styling, animations, navigation structure
- All screens beyond Today (Inbox, Upcoming, Calendar, Scouts, Settings)
- Face ID/Touch ID biometric lock (module created, not wired up)
- Sign in with Apple (provider configured server-side, not wired in mobile UI)
- Google OAuth on mobile (needs ASWebAuthenticationSession)
- Widget bridge Expo Module (Swift, WidgetKit integration)
- Siri Intents, Live Activities, Share Extension
- Attachment upload saga
- Background sync (BGTaskScheduler)
- Silent push notification handling
- Certificate pinning — **RELEASE BLOCKER: must be implemented before TestFlight external / App Store submission**
- App switcher blur protection
- Tombstone cleanup cron (45-day retention per spec addendum A13)

---

## Addendum: Review Findings & Required Corrections

Two review passes were run against this plan: a peer engineering review and a security review. The findings below are **mandatory corrections** that must be applied by the implementing engineer. Each finding references the task it affects.

### Critical Corrections (will not work without these)

**R1. Import Prisma from local re-export, not directly from api-core** (affects Tasks 4, 5, 6)

Every existing route imports `prisma` from `"../lib/prisma.js"`, not from `"@brett/api-core"`. The new route files (`sync.ts`, `devices.ts`) must follow this convention:

```typescript
// WRONG: import { prisma } from "@brett/api-core";
// RIGHT:
import { prisma } from "../lib/prisma.js";
```

**R2. Soft-delete extension Prisma API is wrong** (affects Task 1)

The `delete()` override in the plan uses `Prisma.getExtensionContext(this)` which is not valid. The correct approach is to structure the extension as a factory that receives the base client:

```typescript
// In packages/api-core/src/prisma.ts (where client is created)
const basePrisma = new PrismaClient();

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async delete({ model, args, query }) {
        if (isSoftDeleteModel(model)) {
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          // Use the BASE client (before extension) to avoid recursion
          return (basePrisma as any)[modelKey].update({
            where: args.where,
            data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
      // ... same pattern for deleteMany
    },
  },
});
```

The extension must be applied in `packages/api-core/src/prisma.ts` (NOT `db.ts` which does not exist).

**R3. Tombstone query bypass (`deletedAt: undefined`) does not work** (affects Task 5)

Setting `deletedAt: undefined` in the `where` clause does NOT override the soft-delete extension's auto-filter. The extension checks `!args.where?.deletedAt` — `undefined` is falsy so the filter is still added.

Fix: The soft-delete extension's filter check must use `'deletedAt' in (args.where ?? {})`:

```typescript
// In the extension's findMany override:
if (isSoftDeleteModel(model) && !('deletedAt' in (args.where ?? {}))) {
  args.where = { ...args.where, deletedAt: null };
}
```

Then the sync pull endpoint can bypass it with:
```typescript
// Fetch active + soft-deleted records:
where: { ...baseWhere, deletedAt: {} }  // key exists → extension skips filter
```

And use two separate queries for the sync pull — one for upserted (active records after cursor), one for tombstone IDs:
```typescript
// Active records:
const upserted = await model.findMany({ where: { userId: user.id, updatedAt: cursor ? { gt: new Date(cursor) } : undefined }, ... });
// Tombstones (IDs only):
const tombstones = await model.findMany({
  where: { userId: user.id, deletedAt: { not: null, ...(cursor ? { gt: new Date(cursor) } : {}) } },
  select: { id: true },
});
const deleted = tombstones.map((r: any) => r.id);
```

**R4. CalendarEvent missing from soft-delete models** (affects Task 1)

Add `CalendarEvent` to the `SOFT_DELETE_MODELS` array and add `deletedAt DateTime?` to the `CalendarEvent` model in the Prisma migration.

**R5. Auth middleware must be applied to sync and device routes** (affects Tasks 4, 5, 6)

Without `authMiddleware`, `c.get("user")` is undefined and the rate limiter (which reads `user.id`) will crash:

```typescript
// In both sync.ts and devices.ts:
import { authMiddleware } from "../middleware/auth.js";

const sync = new Hono<AuthEnv>()
  .use("/*", authMiddleware)
  .use("/*", rateLimiter(120))
  // ... routes
```

**R6. Token refresh is fundamentally broken — better-auth bearer doesn't have refresh tokens** (affects Task 10)

The plan's `refreshToken()` function calls `GET /api/auth/get-session` with the expired token, which will also return 401. better-auth's bearer plugin does not issue separate refresh tokens.

Fix: Remove the refresh logic. On 401, clear the token and route to sign-in. Session lifetime should be configured to be long-lived (e.g., 30 days) in better-auth config. The "refresh" is simply re-authenticating. Update the API client:

```typescript
// On 401: no refresh attempt — just expire the session
if (res.status === 401 && token) {
  await clearToken();
  throw new AuthExpiredError();
}
```

**R7. processCreate must inject userId from auth context, never from client payload** (affects Task 6)

The sync push `processCreate` helper must always set `userId: user.id` regardless of what the client sends. The client payload must NEVER control `userId`:

```typescript
async function processCreate(model, mutation, userId) {
  const data = {
    ...mutation.payload,
    id: mutation.entityId,
    userId,  // ALWAYS from auth context
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  // ... validate and create
}
```

### High Corrections

**R8. Apple provider config must be conditional** (affects Task 7)

The plan uses non-null assertions (`process.env.APPLE_CLIENT_ID!`) which will crash better-auth if env vars are missing. And the config change goes in `packages/api-core/src/auth.ts`, not `apps/api/src/lib/auth.ts`:

```typescript
// In packages/api-core/src/auth.ts:
socialProviders: {
  google: { /* existing */ },
  ...(process.env.APPLE_CLIENT_ID ? {
    apple: {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    },
  } : {}),
},
```

**R9. Expo 53 ships with React Native 0.79, not 0.76** (affects Task 8)

Change the install command:
```bash
npx expo install expo@^53.0.0 expo-router@^4 react-native react-native-screens react-native-safe-area-context
```
Let `npx expo install` resolve the correct React Native version instead of pinning.

**R10. createTablesIfNeeded SQL is incomplete** (affects Task 9)

The plan omits CREATE TABLE statements for `calendar_events`, `calendar_event_notes`, `scouts`, `scout_findings`, `brett_messages`, and `attachments`. A junior engineer hitting this will get crashes on first sync. Either provide complete SQL for all tables, or use Drizzle's `migrate()` function. Recommended: use `drizzle-kit push` in development which auto-creates tables from the schema definition.

**R11. findUnique soft-delete override must convert to findFirst** (affects Task 1)

The post-fetch `deletedAt` check on `findUnique` doesn't prevent Prisma from loading relations. Convert to `findFirst`:

```typescript
async findUnique({ model, args, query }) {
  if (isSoftDeleteModel(model)) {
    // Convert to findFirst with deletedAt filter
    return (basePrisma as any)[modelKey].findFirst({
      where: { ...args.where, deletedAt: null },
      ...(args.include ? { include: args.include } : {}),
      ...(args.select ? { select: args.select } : {}),
    });
  }
  return query(args);
}
```

**R12. Expo push token requires projectId in SDK 53** (affects Task 16)

```typescript
const tokenData = await Notifications.getExpoPushTokenAsync({
  projectId: Constants.expoConfig?.extra?.eas?.projectId,
});
```

**R13. SSE implementation needs a real library** (affects Task 17)

React Native's `fetch` does not support `ReadableStream`. The plan's SSE code will not compile. Use `react-native-sse` or `eventsource` polyfill. Add to Task 8 dependencies:

```bash
pnpm add react-native-sse
```

**R14. Missing `(auth)/_layout.tsx` file** (affects Task 11)

Expo Router requires a layout file for each route group. Create `apps/mobile/app/(auth)/_layout.tsx`:

```typescript
import { Stack } from "expo-router";
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Security Corrections

**R15. Sync push must validate changedFields against mutable field allowlist** (affects Task 6)

Add a per-entity-type allowlist of mutable fields. Reject any `changedFields` entry not in the list:

```typescript
const MUTABLE_FIELDS: Record<string, string[]> = {
  item: ["title", "description", "notes", "status", "dueDate", "dueDatePrecision",
         "completedAt", "snoozedUntil", "reminder", "recurrence", "recurrenceRule",
         "listId", "brettObservation", "contentType", "contentStatus"],
  list: ["name", "colorClass", "sortOrder", "archivedAt"],
  calendar_event_note: ["content"],
};

// In processUpdate, before merge:
const allowed = MUTABLE_FIELDS[mutation.entityType] ?? [];
const illegal = (mutation.changedFields ?? []).filter(f => !allowed.includes(f));
if (illegal.length > 0) {
  return { status: "error", error: `Fields not mutable: ${illegal.join(", ")}` };
}
```

**R16. NSFileProtectionComplete must be set on SQLite database** (affects Task 9)

After creating the database, set file protection:

```typescript
import * as FileSystem from "expo-file-system";

// After openDatabaseSync:
const dbPath = `${FileSystem.documentDirectory}SQLite/brett.db`;
// expo-file-system doesn't expose setAttributes directly
// Use a native module or set via Info.plist: NSFileProtectionComplete
// At minimum, add to app.config.ts:
// ios.infoPlist.UIFileSharingEnabled = false
// ios.infoPlist.LSSupportsOpeningDocumentsInPlace = false
```

Note: Full NSFileProtectionComplete requires native code or an Expo config plugin. For the scaffold, ensure `UIFileSharingEnabled` is false (prevents iTunes file access) and document that the full file protection implementation is a release blocker.

**R17. OAuth callback MUST NOT use custom URL scheme** (affects future OAuth work)

Add this explicit warning to the "What's NOT in This Plan" section:

> **SECURITY WARNING:** When implementing Google OAuth on mobile, DO NOT use the `brett://` custom URL scheme for OAuth callbacks. Custom URL schemes can be hijacked by any app. You MUST use Universal Links (`https://brett.app/auth/callback`) with PKCE. This requires setting up an Apple App Site Association file and configuring better-auth for PKCE. See spec Addendum B, finding B3.

**R18. Idempotency key `.catch(() => {})` must only catch duplicate key errors** (affects Task 6)

```typescript
await prisma.idempotencyKey.create({ ... }).catch((err: any) => {
  // Only swallow duplicate key (P2002), re-throw everything else
  if (err.code !== "P2002") throw err;
});
```

**R19. Add 1MB body size limit to sync push** (affects Task 6)

```typescript
sync.post("/push", rateLimiter(60), async (c) => {
  const contentLength = parseInt(c.req.header("content-length") ?? "0", 10);
  if (contentLength > 1_048_576) {
    return c.json({ error: "Request body too large (max 1MB)" }, 413);
  }
  // ... rest of handler
});
```

**R20. Sync pull must use two separate queries, not load full soft-deleted records** (affects Task 5)

The pull endpoint must NOT load full soft-deleted records into memory (they contain user PII). Use two queries — one for active records, one for tombstone IDs only:

```typescript
// Active records (upserted):
const upserted = await model.findMany({
  where: { userId: user.id, ...(cursor ? { updatedAt: { gt: new Date(cursor) } } : {}) },
  orderBy: { updatedAt: "asc" },
  take: limit + 1,
});

// Tombstone IDs only:
const tombstones = await model.findMany({
  where: {
    userId: user.id,
    deletedAt: { not: null, ...(cursor ? { gt: new Date(cursor) } } : {}) },
  },
  select: { id: true, updatedAt: true },
  orderBy: { updatedAt: "asc" },
});
const deleted = tombstones.map((r: any) => r.id);
```
