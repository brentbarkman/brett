# Task Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the read-only 400px DetailPanel into a full-featured 550px task editing panel with rich notes, file attachments, Brett conversation thread, due date/reminders, linked items, and recurring tasks.

**Architecture:** Bottom-up — data model and API first, then UI components wired to real endpoints. Each chunk builds on the previous one's schema/API, but UI components within a chunk are self-contained. The panel orchestrates all sub-components and passes callbacks from App.tsx.

**Tech Stack:** Prisma (schema + migrations), Hono (API routes), Tiptap (rich text), @aws-sdk/client-s3 (attachments), rrule (recurrence), TanStack Query (data fetching), React (UI)

**Spec:** See `docs/superpowers/specs/` or memory file `project_task_detail_panel.md` for the approved design.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/src/routes/attachments.ts` | Attachment upload/delete routes |
| `apps/api/src/routes/links.ts` | Item link CRUD routes |
| `apps/api/src/routes/brett.ts` | Brett message + brett-take routes |
| `apps/api/src/__tests__/attachments.test.ts` | Attachment API tests |
| `apps/api/src/__tests__/links.test.ts` | Link API tests |
| `apps/api/src/__tests__/brett.test.ts` | Brett message API tests |
| `apps/api/src/__tests__/recurrence.test.ts` | Recurrence-on-toggle tests |
| `packages/ui/src/TaskDetailPanel.tsx` | Full task detail panel (replaces task path in DetailPanel) |
| `packages/ui/src/RichTextEditor.tsx` | Tiptap editor component |
| `packages/ui/src/AttachmentList.tsx` | Drag-drop file zone + thumbnails |
| `packages/ui/src/BrettThread.tsx` | Collapsible thread + pinned input |
| `packages/ui/src/ScheduleRow.tsx` | 3-card row: due date / reminder / recurrence |
| `packages/ui/src/LinkedItemsList.tsx` | Linked items with add-link search |
| `packages/ui/src/OverflowMenu.tsx` | Dropdown menu (delete, duplicate, move, copy link) |
| `apps/desktop/src/api/attachments.ts` | React Query hooks for attachments |
| `apps/desktop/src/api/brett.ts` | React Query hooks for Brett messages |
| `apps/desktop/src/api/links.ts` | React Query hooks for item links |

### Modified Files

| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | Add fields to Item, add Attachment/ItemLink/BrettMessage models |
| `packages/types/src/index.ts` | Add new interfaces (Attachment, ItemLink, BrettMessage, ThingDetail, recurrence/reminder types) |
| `packages/business/src/index.ts` | Add validation functions for new entities, update itemToThing, add computeNextDueDate |
| `apps/api/src/app.ts` | Mount new route files |
| `apps/api/src/routes/things.ts` | Update GET /:id to include relations, update toggle for recurrence |
| `apps/desktop/src/api/things.ts` | Add useThingDetail hook |
| `apps/desktop/src/App.tsx` | Wire new panel callbacks, pass update/delete handlers |
| `packages/ui/src/DetailPanel.tsx` | Delegate task rendering to TaskDetailPanel |
| `packages/ui/src/index.ts` | Export new components |

---

## Chunk 1: Data Model & Types

### Task 1.1: Prisma Schema Changes

**Files:**
- Modify: `apps/api/prisma/schema.prisma:81-105`

- [ ] **Step 1: Add new fields to Item model**

Add after `brettObservation` (line 93):

```prisma
  notes            String?   @db.Text
  reminder         String?   // "morning_of" | "1_hour_before" | "day_before" | "custom"
  recurrence       String?   // "daily" | "weekly" | "monthly" | "custom"
  recurrenceRule   String?   // iCal RRULE string for custom recurrence
  brettTakeGeneratedAt DateTime?
```

- [ ] **Step 2: Add Attachment model**

```prisma
model Attachment {
  id         String   @id @default(cuid())
  filename   String
  mimeType   String
  sizeBytes  Int
  storageKey String
  itemId     String
  item       Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@index([itemId])
}
```

- [ ] **Step 3: Add ItemLink model**

```prisma
model ItemLink {
  id         String   @id @default(cuid())
  fromItemId String
  fromItem   Item     @relation("linksFrom", fields: [fromItemId], references: [id], onDelete: Cascade)
  toItemId   String   // polymorphic — no FK constraint
  toItemType String   // "task" | "content" | future types
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@unique([fromItemId, toItemId])
  @@index([fromItemId])
  @@index([toItemId])
}
```

- [ ] **Step 4: Add BrettMessage model**

```prisma
model BrettMessage {
  id      String   @id @default(cuid())
  itemId  String
  item    Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  role    String   // "user" | "brett"
  content String   @db.Text
  userId  String
  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@index([itemId, createdAt])
}
```

- [ ] **Step 5: Add relations on Item model**

Add to the Item model:

```prisma
  attachments    Attachment[]
  linksFrom      ItemLink[]     @relation("linksFrom")
  brettMessages  BrettMessage[]
```

- [ ] **Step 6: Add relations on User model**

Add to the User model:

```prisma
  attachments    Attachment[]
  itemLinks      ItemLink[]
  brettMessages  BrettMessage[]
```

- [ ] **Step 7: Run migration**

Run: `cd /Users/brentbarkman/code/brett && pnpm db:migrate`

Migration name: `add_task_detail_panel_models`

Expected: Migration creates new tables and columns successfully.

- [ ] **Step 8: Verify Prisma client generation**

Run: `cd /Users/brentbarkman/code/brett/apps/api && pnpm build`

Expected: Build succeeds, Prisma client has new types.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: add Attachment, ItemLink, BrettMessage models + Item fields for task detail panel"
```

### Task 1.2: Type Definitions

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add recurrence and reminder types**

Add after the `DueDatePrecision` type (line 44):

```typescript
export type ReminderType = "morning_of" | "1_hour_before" | "day_before" | "custom";
export type RecurrenceType = "daily" | "weekly" | "monthly" | "custom";
```

- [ ] **Step 2: Add Attachment interface**

```typescript
export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string; // presigned S3 URL
  createdAt: string; // ISO string
}
```

- [ ] **Step 3: Add ItemLink interface**

```typescript
export interface ItemLink {
  id: string;
  toItemId: string;
  toItemType: string;
  toItemTitle?: string; // resolved on read
  createdAt: string;
}
```

- [ ] **Step 4: Add BrettMessage interface**

```typescript
export interface BrettMessage {
  id: string;
  role: "user" | "brett";
  content: string;
  createdAt: string;
}
```

- [ ] **Step 5: Add ThingDetail interface**

This is the enriched response from `GET /things/:id` — extends Thing with relations:

```typescript
export interface ThingDetail extends Thing {
  notes?: string;
  reminder?: ReminderType;
  recurrence?: RecurrenceType;
  recurrenceRule?: string;
  brettTakeGeneratedAt?: string;
  attachments: Attachment[];
  links: ItemLink[];
  brettMessages: BrettMessage[];
}
```

- [ ] **Step 6: Update UpdateItemInput**

Add to UpdateItemInput (after `snoozedUntil`):

```typescript
  notes?: string | null;
  reminder?: ReminderType | null;
  recurrence?: RecurrenceType | null;
  recurrenceRule?: string | null;
```

- [ ] **Step 7: Add new API input types**

```typescript
export interface CreateAttachmentInput {
  // Multipart — no JSON body, form data with file
}

export interface CreateItemLinkInput {
  toItemId: string;
  toItemType: string;
}

export interface CreateBrettMessageInput {
  content: string;
}
```

- [ ] **Step 8: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/types/
git commit -m "feat: add type definitions for attachments, links, brett messages, and ThingDetail"
```

### Task 1.3: Update Business Logic

**Files:**
- Modify: `packages/business/src/index.ts`

- [ ] **Step 1: Update validateUpdateItem to accept new fields**

Add validation for `notes`, `reminder`, `recurrence`, `recurrenceRule` inside `validateUpdateItem`. After the `source` block (line 323):

```typescript
  // New detail panel fields
  if (obj.notes !== undefined) {
    data.notes = obj.notes === null ? null : typeof obj.notes === "string" ? obj.notes : undefined;
  }

  const VALID_REMINDERS = new Set(["morning_of", "1_hour_before", "day_before", "custom"]);
  if (obj.reminder !== undefined) {
    if (obj.reminder !== null && (typeof obj.reminder !== "string" || !VALID_REMINDERS.has(obj.reminder))) {
      return { ok: false, error: `reminder must be one of: ${[...VALID_REMINDERS].join(", ")}` };
    }
    data.reminder = obj.reminder as ReminderType | null;
  }

  const VALID_RECURRENCES = new Set(["daily", "weekly", "monthly", "custom"]);
  if (obj.recurrence !== undefined) {
    if (obj.recurrence !== null && (typeof obj.recurrence !== "string" || !VALID_RECURRENCES.has(obj.recurrence))) {
      return { ok: false, error: `recurrence must be one of: ${[...VALID_RECURRENCES].join(", ")}` };
    }
    data.recurrence = obj.recurrence as RecurrenceType | null;
  }

  if (obj.recurrenceRule !== undefined) {
    data.recurrenceRule = obj.recurrenceRule === null ? null : typeof obj.recurrenceRule === "string" ? obj.recurrenceRule : undefined;
  }
```

- [ ] **Step 2: Add validation for CreateItemLinkInput**

```typescript
export function validateCreateItemLink(
  input: unknown
): { ok: true; data: { toItemId: string; toItemType: string } } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }
  const obj = input as Record<string, unknown>;

  if (!obj.toItemId || typeof obj.toItemId !== "string") {
    return { ok: false, error: "toItemId is required" };
  }
  if (!obj.toItemType || typeof obj.toItemType !== "string") {
    return { ok: false, error: "toItemType is required" };
  }

  return { ok: true, data: { toItemId: obj.toItemId, toItemType: obj.toItemType } };
}
```

- [ ] **Step 3: Add validation for CreateBrettMessageInput**

```typescript
export function validateCreateBrettMessage(
  input: unknown
): { ok: true; data: { content: string } } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body is required" };
  }
  const obj = input as Record<string, unknown>;

  if (!obj.content || typeof obj.content !== "string" || obj.content.trim() === "") {
    return { ok: false, error: "content is required" };
  }

  return { ok: true, data: { content: obj.content.trim() } };
}
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/business/ packages/types/
git commit -m "feat: add validation for item links, brett messages, and new detail panel fields"
```

---

## Chunk 2: API — Enhanced GET + PATCH for Items

### Task 2.1: Update GET /things/:id to Include Relations

**Files:**
- Modify: `apps/api/src/routes/things.ts:117-126`
- Modify: `apps/api/src/lib/storage.ts` (add presigned URL helper)
- Test: `apps/api/src/__tests__/things.test.ts`

- [ ] **Step 1: Write test for enriched GET /things/:id**

Add to `things.test.ts`:

```typescript
it("GET /things/:id returns ThingDetail with relations", async () => {
  // Create a thing first
  const createRes = await authRequest("/things", token, {
    method: "POST",
    body: JSON.stringify({ type: "task", title: "Detail test", listId }),
  });
  const thing = (await createRes.json()) as any;

  const res = await authRequest(`/things/${thing.id}`, token);
  expect(res.status).toBe(200);
  const detail = (await res.json()) as any;
  expect(detail.id).toBe(thing.id);
  expect(detail.attachments).toEqual([]);
  expect(detail.links).toEqual([]);
  expect(detail.brettMessages).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "ThingDetail with relations"`

Expected: FAIL — `attachments` is undefined.

- [ ] **Step 3: Add presigned URL helper to storage.ts**

Add to `apps/api/src/lib/storage.ts`:

```typescript
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function getPresignedUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: STORAGE_BUCKET,
    Key: storageKey,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
}
```

- [ ] **Step 4: Create itemToThingDetail transform**

Add to `apps/api/src/routes/things.ts` (or a shared helper in the same file):

```typescript
import { getPresignedUrl } from "../lib/storage.js";
import type { ThingDetail, Attachment as AttachmentType, ItemLink as ItemLinkType, BrettMessage as BrettMessageType } from "@brett/types";

type ItemWithRelations = Prisma.ItemGetPayload<{
  include: { list: { select: { name: true } }; attachments: true; linksFrom: true; brettMessages: true };
}>;

async function itemToThingDetail(item: ItemWithRelations): Promise<ThingDetail> {
  const thing = itemToThing(item);

  const attachments: AttachmentType[] = await Promise.all(
    item.attachments.map(async (a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url: await getPresignedUrl(a.storageKey),
      createdAt: a.createdAt.toISOString(),
    }))
  );

  // Resolve link titles
  const linkTargetIds = item.linksFrom.map((l) => l.toItemId);
  const linkTargets = linkTargetIds.length > 0
    ? await prisma.item.findMany({
        where: { id: { in: linkTargetIds } },
        select: { id: true, title: true },
      })
    : [];
  const titleMap = new Map(linkTargets.map((t) => [t.id, t.title]));

  const links: ItemLinkType[] = item.linksFrom.map((l) => ({
    id: l.id,
    toItemId: l.toItemId,
    toItemType: l.toItemType,
    toItemTitle: titleMap.get(l.toItemId),
    createdAt: l.createdAt.toISOString(),
  }));

  const brettMessages: BrettMessageType[] = item.brettMessages
    .slice(0, 20) // last 20
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "brett",
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));

  return {
    ...thing,
    notes: item.notes ?? undefined,
    reminder: (item.reminder as any) ?? undefined,
    recurrence: (item.recurrence as any) ?? undefined,
    recurrenceRule: item.recurrenceRule ?? undefined,
    brettTakeGeneratedAt: item.brettTakeGeneratedAt?.toISOString(),
    attachments,
    links,
    brettMessages,
  };
}
```

- [ ] **Step 5: Update GET /:id route**

Replace the GET /:id handler:

```typescript
things.get("/:id", async (c) => {
  const user = c.get("user");
  const item = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
    include: {
      list: { select: { name: true } },
      attachments: { orderBy: { createdAt: "asc" } },
      linksFrom: { orderBy: { createdAt: "asc" } },
      brettMessages: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(await itemToThingDetail(item));
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "ThingDetail with relations"`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ packages/
git commit -m "feat: enrich GET /things/:id with attachments, links, and brett messages"
```

### Task 2.2: Update PATCH /things/:id for New Fields

**Files:**
- Modify: `apps/api/src/routes/things.ts:165-214`
- Test: `apps/api/src/__tests__/things.test.ts`

- [ ] **Step 1: Write test for updating new fields**

```typescript
it("PATCH /things/:id updates notes, reminder, and recurrence", async () => {
  const createRes = await authRequest("/things", token, {
    method: "POST",
    body: JSON.stringify({ type: "task", title: "Update fields test", listId }),
  });
  const thing = (await createRes.json()) as any;

  const res = await authRequest(`/things/${thing.id}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      notes: "# Hello\nSome **bold** text",
      reminder: "morning_of",
      recurrence: "weekly",
    }),
  });
  expect(res.status).toBe(200);

  // Fetch detail to verify
  const detailRes = await authRequest(`/things/${thing.id}`, token);
  const detail = (await detailRes.json()) as any;
  expect(detail.notes).toBe("# Hello\nSome **bold** text");
  expect(detail.reminder).toBe("morning_of");
  expect(detail.recurrence).toBe("weekly");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "updates notes, reminder"`

Expected: FAIL

- [ ] **Step 3: Add new fields to PATCH handler**

In the PATCH /:id route, add after the `snoozedUntil` block:

```typescript
  if (data.notes !== undefined)
    updateData.notes = data.notes;
  if (data.reminder !== undefined)
    updateData.reminder = data.reminder;
  if (data.recurrence !== undefined)
    updateData.recurrence = data.recurrence;
  if (data.recurrenceRule !== undefined)
    updateData.recurrenceRule = data.recurrenceRule;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "updates notes, reminder"`

Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ packages/
git commit -m "feat: support notes, reminder, recurrence fields in PATCH /things/:id"
```

---

## Chunk 3: API — Attachments

### Task 3.1: Attachment Upload & Delete Routes

**Files:**
- Create: `apps/api/src/routes/attachments.ts`
- Create: `apps/api/src/__tests__/attachments.test.ts`
- Modify: `apps/api/src/app.ts:34` (mount route)

- [ ] **Step 1: Write attachment route tests**

Create `apps/api/src/__tests__/attachments.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Attachment routes", () => {
  let token: string;
  let itemId: string;

  beforeAll(async () => {
    const user = await createTestUser("Attachment User");
    token = user.token;

    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Attachment test" }),
    });
    const thing = (await res.json()) as any;
    itemId = thing.id;
  });

  it("POST /things/:id/attachments rejects files over 25MB", async () => {
    // Create a FormData with oversized content-length header
    const res = await authRequest(`/things/${itemId}/attachments`, token, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": "big.zip",
        "Content-Length": String(26 * 1024 * 1024),
      },
      body: "fake",
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/attachments rejects non-existent item", async () => {
    const res = await authRequest("/things/nonexistent/attachments", token, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Filename": "test.txt",
      },
      body: "hello",
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /things/:id/attachments/:attachmentId returns 404 for non-existent", async () => {
    const res = await authRequest(
      `/things/${itemId}/attachments/nonexistent`,
      token,
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);
  });
});
```

Note: Add a vitest mock for the S3 `send` command to test the happy path:

```typescript
import { vi } from "vitest";
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({}) })),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

it("POST /things/:id/attachments uploads a file", async () => {
  const res = await authRequest(`/things/${itemId}/attachments`, token, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-Filename": "test.txt",
    },
    body: "hello world",
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  expect(body.filename).toBe("test.txt");
  expect(body.mimeType).toBe("text/plain");
  expect(body.sizeBytes).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Attachment routes"`

Expected: FAIL (routes don't exist)

- [ ] **Step 3: Implement attachment routes**

Create `apps/api/src/routes/attachments.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { s3, STORAGE_BUCKET } from "../lib/storage.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const attachments = new Hono<AuthEnv>();
attachments.use("*", authMiddleware);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// POST /things/:itemId/attachments
// Expects binary body with X-Filename and Content-Type headers
attachments.post("/:itemId/attachments", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  // Verify item ownership
  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: user.id },
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  const filename = c.req.header("X-Filename") || "unnamed";
  const mimeType = c.req.header("Content-Type") || "application/octet-stream";
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);

  if (contentLength > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 25MB)" }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 25MB)" }, 400);
  }

  const storageKey = `attachments/${user.id}/${itemId}/${randomUUID()}-${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: storageKey,
      Body: Buffer.from(body),
      ContentType: mimeType,
    })
  );

  const attachment = await prisma.attachment.create({
    data: {
      filename,
      mimeType,
      sizeBytes: body.byteLength,
      storageKey,
      itemId,
      userId: user.id,
    },
  });

  return c.json(
    {
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt.toISOString(),
    },
    201
  );
});

// DELETE /things/:itemId/attachments/:attachmentId
attachments.delete("/:itemId/attachments/:attachmentId", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");
  const attachmentId = c.req.param("attachmentId");

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, itemId, userId: user.id },
  });
  if (!attachment) return c.json({ error: "Not found" }, 404);

  // Delete from S3
  await s3.send(
    new DeleteObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: attachment.storageKey,
    })
  );

  await prisma.attachment.delete({ where: { id: attachment.id } });

  return c.json({ ok: true });
});

export { attachments };
```

- [ ] **Step 4: Mount routes in app.ts**

Add to `apps/api/src/app.ts`:

```typescript
import { attachments } from "./routes/attachments.js";
// ...
app.route("/things", attachments);
```

- [ ] **Step 5: Install @aws-sdk/s3-request-presigner**

Run: `cd /Users/brentbarkman/code/brett && pnpm add -F @brett/api @aws-sdk/s3-request-presigner`

- [ ] **Step 6: Run tests**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Attachment routes"`

Expected: PASS for validation/routing tests.

- [ ] **Step 7: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/ packages/ pnpm-lock.yaml
git commit -m "feat: add attachment upload/delete API routes with S3 storage"
```

---

## Chunk 4: API — Item Links

### Task 4.1: Link CRUD Routes

**Files:**
- Create: `apps/api/src/routes/links.ts`
- Create: `apps/api/src/__tests__/links.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write link route tests**

Create `apps/api/src/__tests__/links.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Link routes", () => {
  let token: string;
  let itemAId: string;
  let itemBId: string;

  beforeAll(async () => {
    const user = await createTestUser("Link User");
    token = user.token;

    const resA = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Task A" }),
    });
    itemAId = ((await resA.json()) as any).id;

    const resB = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Task B" }),
    });
    itemBId = ((await resB.json()) as any).id;
  });

  it("POST /things/:id/links creates a link", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemBId, toItemType: "task" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.toItemId).toBe(itemBId);
    expect(body.toItemType).toBe("task");
  });

  it("POST /things/:id/links rejects duplicate link", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemBId, toItemType: "task" }),
    });
    expect(res.status).toBe(409);
  });

  it("GET /things/:id returns links in detail", async () => {
    const res = await authRequest(`/things/${itemAId}`, token);
    const detail = (await res.json()) as any;
    expect(detail.links.length).toBe(1);
    expect(detail.links[0].toItemId).toBe(itemBId);
    expect(detail.links[0].toItemTitle).toBe("Task B");
  });

  it("DELETE /things/:id/links/:linkId removes a link", async () => {
    // Get the link ID
    const detailRes = await authRequest(`/things/${itemAId}`, token);
    const detail = (await detailRes.json()) as any;
    const linkId = detail.links[0].id;

    const res = await authRequest(`/things/${itemAId}/links/${linkId}`, token, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // Verify removed
    const afterRes = await authRequest(`/things/${itemAId}`, token);
    const after = (await afterRes.json()) as any;
    expect(after.links.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Link routes"`

Expected: FAIL

- [ ] **Step 3: Implement link routes**

Create `apps/api/src/routes/links.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateCreateItemLink } from "@brett/business";

const links = new Hono<AuthEnv>();
links.use("*", authMiddleware);

// POST /things/:itemId/links
links.post("/:itemId/links", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: user.id },
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const validation = validateCreateItemLink(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const { data } = validation;

  // Check for duplicate
  const existing = await prisma.itemLink.findUnique({
    where: { fromItemId_toItemId: { fromItemId: itemId, toItemId: data.toItemId } },
  });
  if (existing) return c.json({ error: "Link already exists" }, 409);

  const link = await prisma.itemLink.create({
    data: {
      fromItemId: itemId,
      toItemId: data.toItemId,
      toItemType: data.toItemType,
      userId: user.id,
    },
  });

  return c.json(
    {
      id: link.id,
      toItemId: link.toItemId,
      toItemType: link.toItemType,
      createdAt: link.createdAt.toISOString(),
    },
    201
  );
});

// DELETE /things/:itemId/links/:linkId
links.delete("/:itemId/links/:linkId", async (c) => {
  const user = c.get("user");
  const linkId = c.req.param("linkId");

  const link = await prisma.itemLink.findFirst({
    where: { id: linkId, userId: user.id },
  });
  if (!link) return c.json({ error: "Not found" }, 404);

  await prisma.itemLink.delete({ where: { id: link.id } });
  return c.json({ ok: true });
});

export { links };
```

- [ ] **Step 4: Mount in app.ts**

```typescript
import { links } from "./routes/links.js";
app.route("/things", links);
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Link routes"`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/
git commit -m "feat: add item link CRUD routes"
```

---

## Chunk 5: API — Brett Messages

### Task 5.1: Brett Message Routes

**Files:**
- Create: `apps/api/src/routes/brett.ts`
- Create: `apps/api/src/__tests__/brett.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write brett message tests**

Create `apps/api/src/__tests__/brett.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Brett message routes", () => {
  let token: string;
  let itemId: string;

  beforeAll(async () => {
    const user = await createTestUser("Brett User");
    token = user.token;

    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Brett test" }),
    });
    itemId = ((await res.json()) as any).id;
  });

  it("POST /things/:id/brett creates a user message and gets stub response", async () => {
    const res = await authRequest(`/things/${itemId}/brett`, token, {
      method: "POST",
      body: JSON.stringify({ content: "What should I do about this?" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.userMessage.role).toBe("user");
    expect(body.userMessage.content).toBe("What should I do about this?");
    expect(body.brettMessage.role).toBe("brett");
    expect(body.brettMessage.content).toBeTruthy(); // stub response
  });

  it("GET /things/:id/brett returns paginated messages", async () => {
    const res = await authRequest(`/things/${itemId}/brett`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.messages.length).toBe(2); // user + brett from previous test
    expect(body.hasMore).toBe(false);
  });

  it("GET /things/:id/brett supports cursor pagination", async () => {
    // Add more messages
    for (let i = 0; i < 5; i++) {
      await authRequest(`/things/${itemId}/brett`, token, {
        method: "POST",
        body: JSON.stringify({ content: `Message ${i}` }),
      });
    }

    const res = await authRequest(`/things/${itemId}/brett?limit=4`, token);
    const body = (await res.json()) as any;
    expect(body.messages.length).toBe(4);
    expect(body.hasMore).toBe(true);
    expect(body.cursor).toBeTruthy();

    // Fetch next page
    const res2 = await authRequest(
      `/things/${itemId}/brett?limit=20&cursor=${body.cursor}`,
      token
    );
    const body2 = (await res2.json()) as any;
    expect(body2.messages.length).toBeGreaterThan(0);
    expect(body2.hasMore).toBe(false);
  });

  it("POST /things/:id/brett rejects empty content", async () => {
    const res = await authRequest(`/things/${itemId}/brett`, token, {
      method: "POST",
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/brett-take returns a stub observation", async () => {
    const res = await authRequest(`/things/${itemId}/brett-take`, token, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.brettObservation).toBeTruthy();
    expect(body.brettTakeGeneratedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Brett message routes"`

Expected: FAIL

- [ ] **Step 3: Implement brett routes**

Create `apps/api/src/routes/brett.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateCreateBrettMessage } from "@brett/business";

const brett = new Hono<AuthEnv>();
brett.use("*", authMiddleware);

// POST /things/:itemId/brett — send message, get stub response
brett.post("/:itemId/brett", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: user.id },
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const validation = validateCreateBrettMessage(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const userMessage = await prisma.brettMessage.create({
    data: {
      itemId,
      role: "user",
      content: validation.data.content,
      userId: user.id,
    },
  });

  // Stub response — will be replaced with Claude API integration later
  const stubResponse = "I'll think about that and get back to you. (AI responses coming soon)";
  const brettMessage = await prisma.brettMessage.create({
    data: {
      itemId,
      role: "brett",
      content: stubResponse,
      userId: user.id,
    },
  });

  return c.json(
    {
      userMessage: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt.toISOString(),
      },
      brettMessage: {
        id: brettMessage.id,
        role: brettMessage.role,
        content: brettMessage.content,
        createdAt: brettMessage.createdAt.toISOString(),
      },
    },
    201
  );
});

// GET /things/:itemId/brett — paginated messages (newest first)
brett.get("/:itemId/brett", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: user.id },
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
  const cursor = c.req.query("cursor");

  const messages = await prisma.brettMessage.findMany({
    where: {
      itemId,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to check hasMore
  });

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  return c.json({
    messages: page.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    hasMore,
    cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
  });
});

// POST /things/:itemId/brett-take — generate/refresh Brett's observation
brett.post("/:itemId/brett-take", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: user.id },
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  // Stub — will be replaced with Claude API integration
  const observation = `This task "${item.title}" looks interesting. I'll have more to say once AI integration is set up.`;
  const now = new Date();

  await prisma.item.update({
    where: { id: item.id },
    data: { brettObservation: observation, brettTakeGeneratedAt: now },
  });

  return c.json({
    brettObservation: observation,
    brettTakeGeneratedAt: now.toISOString(),
  });
});

export { brett };
```

- [ ] **Step 4: Mount in app.ts**

```typescript
import { brett } from "./routes/brett.js";
app.route("/things", brett);
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Brett message routes"`

Expected: PASS

- [ ] **Step 6: Typecheck + commit**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

```bash
git add apps/api/src/
git commit -m "feat: add Brett message and brett-take API routes with stub responses"
```

---

## Chunk 6: API — Recurring Tasks

### Task 6.1: Recurrence on Toggle

**Files:**
- Modify: `apps/api/src/routes/things.ts:216-235` (toggle handler)
- Create: `apps/api/src/__tests__/recurrence.test.ts`

- [ ] **Step 1: Install rrule in @brett/business**

Run: `cd /Users/brentbarkman/code/brett && pnpm add -F @brett/business rrule && pnpm add -F @brett/business -D @types/rrule`

- [ ] **Step 2: Write recurrence tests**

Create `apps/api/src/__tests__/recurrence.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Recurring task toggle", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Recurrence User");
    token = user.token;
  });

  it("completing a recurring task creates a new task", async () => {
    // Create a recurring task
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Daily standup" }),
    });
    const task = (await createRes.json()) as any;

    // Set recurrence
    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        recurrence: "daily",
        notes: "Check in with team",
      }),
    });

    // Toggle complete
    const toggleRes = await authRequest(`/things/${task.id}/toggle`, token, {
      method: "PATCH",
    });
    const toggled = (await toggleRes.json()) as any;
    expect(toggled.isCompleted).toBe(true);

    // A new task should have been created
    const allRes = await authRequest("/things?status=active", token);
    const all = (await allRes.json()) as any[];
    const newTask = all.find(
      (t: any) => t.title === "Daily standup" && t.id !== task.id
    );
    expect(newTask).toBeTruthy();
    expect(newTask.isCompleted).toBe(false);
  });

  it("completing a non-recurring task does NOT create a new task", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "One-off task" }),
    });
    const task = (await createRes.json()) as any;

    await authRequest(`/things/${task.id}/toggle`, token, {
      method: "PATCH",
    });

    const allRes = await authRequest("/things", token);
    const all = (await allRes.json()) as any[];
    const matches = all.filter((t: any) => t.title === "One-off task");
    expect(matches.length).toBe(1); // only the original
  });

  it("uncompleting a task does NOT create a new task", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Toggle back" }),
    });
    const task = (await createRes.json()) as any;

    // Set recurrence and complete
    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "weekly" }),
    });
    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    // Now uncomplete — should NOT create another
    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    const allRes = await authRequest("/things", token);
    const all = (await allRes.json()) as any[];
    const matches = all.filter((t: any) => t.title === "Toggle back");
    // Original + 1 from first completion = 2. Uncomplete should not add a 3rd.
    expect(matches.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Recurring task toggle"`

Expected: FAIL

- [ ] **Step 4: Implement recurrence in toggle handler**

Update the toggle handler in `things.ts`:

```typescript
things.patch("/:id/toggle", async (c) => {
  const user = c.get("user");
  const existing = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
    include: { list: { select: { name: true } }, linksFrom: true },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const isCompleted = existing.completedAt !== null;
  const item = await prisma.item.update({
    where: { id: existing.id },
    data: {
      completedAt: isCompleted ? null : new Date(),
      status: isCompleted ? "active" : "done",
    },
    include: { list: { select: { name: true } } },
  });

  // If completing a recurring task, spawn a new independent task
  if (!isCompleted && existing.recurrence) {
    const newDueDate = computeNextDueDate(
      existing.dueDate,
      existing.recurrence,
      existing.recurrenceRule
    );

    const newItem = await prisma.item.create({
      data: {
        type: existing.type,
        title: existing.title,
        notes: existing.notes,
        description: existing.description,
        source: existing.source,
        dueDate: newDueDate,
        dueDatePrecision: existing.dueDatePrecision,
        recurrence: existing.recurrence,
        recurrenceRule: existing.recurrenceRule,
        listId: existing.listId,
        userId: existing.userId,
        // NOT carried over: attachments, brettMessages, completedAt, brettObservation
      },
    });

    // Copy links (not attachments or brett messages per spec)
    if (existing.linksFrom.length > 0) {
      await prisma.itemLink.createMany({
        data: existing.linksFrom.map((l) => ({
          fromItemId: newItem.id,
          toItemId: l.toItemId,
          toItemType: l.toItemType,
          userId: user.id,
        })),
      });
    }
  }

  return c.json(itemToThing(item));
});
```

- [ ] **Step 5: Add computeNextDueDate to @brett/business**

Add to `packages/business/src/index.ts` (this is domain logic, not route logic):

```typescript
import { RRule } from "rrule";

export function computeNextDueDate(
  currentDueDate: Date | null,
  recurrence: string,
  recurrenceRule: string | null
): Date | null {
  if (!currentDueDate) return null;

  const base = new Date(currentDueDate);

  switch (recurrence) {
    case "daily":
      base.setUTCDate(base.getUTCDate() + 1);
      return base;
    case "weekly":
      base.setUTCDate(base.getUTCDate() + 7);
      return base;
    case "monthly":
      base.setUTCMonth(base.getUTCMonth() + 1);
      return base;
    case "custom":
      if (recurrenceRule) {
        try {
          const rule = RRule.fromString(recurrenceRule);
          const next = rule.after(currentDueDate);
          return next || null;
        } catch {
          return null;
        }
      }
      return null;
    default:
      return null;
  }
}
```

Note: Install rrule in @brett/business instead of @brett/api: `pnpm add -F @brett/business rrule`

Then import in `things.ts`:

```typescript
import { computeNextDueDate } from "@brett/business";
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/brentbarkman/code/brett && pnpm test -- --grep "Recurring task toggle"`

Expected: PASS

- [ ] **Step 7: Typecheck + commit**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

```bash
git add apps/api/src/ pnpm-lock.yaml
git commit -m "feat: spawn new task on recurring task completion"
```

---

## Chunk 7: Desktop Hooks & Panel Shell

### Task 7.1: React Query Hooks for New APIs

**Files:**
- Create: `apps/desktop/src/api/attachments.ts`
- Create: `apps/desktop/src/api/brett.ts`
- Create: `apps/desktop/src/api/links.ts`
- Modify: `apps/desktop/src/api/things.ts`

- [ ] **Step 1: Add useThingDetail hook**

Add to `apps/desktop/src/api/things.ts`:

```typescript
import type { ThingDetail } from "@brett/types";

export function useThingDetail(id: string | null) {
  return useQuery({
    queryKey: ["thing-detail", id],
    queryFn: () => apiFetch<ThingDetail>(`/things/${id}`),
    enabled: !!id,
  });
}
```

- [ ] **Step 2: Create attachment hooks**

Create `apps/desktop/src/api/attachments.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Attachment } from "@brett/types";

export function useUploadAttachment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const buffer = await file.arrayBuffer();
      return apiFetch<Attachment>(`/things/${itemId}/attachments`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        body: buffer,
      });
    },
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, attachmentId }: { itemId: string; attachmentId: string }) =>
      apiFetch(`/things/${itemId}/attachments/${attachmentId}`, { method: "DELETE" }),
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}
```

- [ ] **Step 3: Create brett hooks**

Create `apps/desktop/src/api/brett.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { BrettMessage } from "@brett/types";

interface BrettMessagesResponse {
  messages: BrettMessage[];
  hasMore: boolean;
  cursor: string | null;
}

interface BrettSendResponse {
  userMessage: BrettMessage;
  brettMessage: BrettMessage;
}

export function useBrettMessages(itemId: string | null) {
  return useQuery({
    queryKey: ["brett-messages", itemId],
    queryFn: () => apiFetch<BrettMessagesResponse>(`/things/${itemId}/brett`),
    enabled: !!itemId,
  });
}

export function useSendBrettMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, content }: { itemId: string; content: string }) =>
      apiFetch<BrettSendResponse>(`/things/${itemId}/brett`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["brett-messages", itemId] });
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}

export function useRefreshBrettTake() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<{ brettObservation: string; brettTakeGeneratedAt: string }>(
        `/things/${itemId}/brett-take`,
        { method: "POST" }
      ),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
      qc.invalidateQueries({ queryKey: ["things"] });
    },
  });
}
```

- [ ] **Step 4: Create link hooks**

Create `apps/desktop/src/api/links.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ItemLink } from "@brett/types";

export function useCreateLink() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      itemId,
      toItemId,
      toItemType,
    }: {
      itemId: string;
      toItemId: string;
      toItemType: string;
    }) =>
      apiFetch<ItemLink>(`/things/${itemId}/links`, {
        method: "POST",
        body: JSON.stringify({ toItemId, toItemType }),
      }),
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}

export function useDeleteLink() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, linkId }: { itemId: string; linkId: string }) =>
      apiFetch(`/things/${itemId}/links/${linkId}`, { method: "DELETE" }),
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/api/
git commit -m "feat: add React Query hooks for attachments, brett messages, and links"
```

### Task 7.2: TaskDetailPanel Shell

**Files:**
- Create: `packages/ui/src/TaskDetailPanel.tsx`
- Create: `packages/ui/src/OverflowMenu.tsx`
- Modify: `packages/ui/src/DetailPanel.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create OverflowMenu component**

Create `packages/ui/src/OverflowMenu.tsx`:

```typescript
import React, { useState, useRef } from "react";
import { MoreHorizontal, Trash2, Copy, ArrowRight, Link2 } from "lucide-react";
import { useClickOutside } from "./useClickOutside";

interface OverflowMenuProps {
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToList: () => void;
  onCopyLink: () => void;
}

export function OverflowMenu({ onDelete, onDuplicate, onMoveToList, onCopyLink }: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setIsOpen(false));

  const items = [
    { icon: Copy, label: "Duplicate", action: onDuplicate },
    { icon: ArrowRight, label: "Move to List…", action: onMoveToList },
    { icon: Link2, label: "Copy Link", action: onCopyLink },
    { icon: Trash2, label: "Delete", action: onDelete, danger: true },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 shadow-xl z-10 py-1">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.action();
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                item.danger
                  ? "text-red-400 hover:bg-red-500/10"
                  : "text-white/80 hover:bg-white/10"
              }`}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create TaskDetailPanel component**

Create `packages/ui/src/TaskDetailPanel.tsx`. This is the main orchestrator — starts as a shell with inline editing and actions, then sub-components are added in later tasks.

```typescript
import React, { useState, useRef, useEffect } from "react";
import { CheckCircle, RotateCw } from "lucide-react";
import type { ThingDetail } from "@brett/types";
import { OverflowMenu } from "./OverflowMenu";

interface TaskDetailPanelProps {
  detail: ThingDetail;
  onUpdate: (updates: Record<string, unknown>) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMoveToList: (id: string) => void;
}

export function TaskDetailPanel({
  detail,
  onUpdate,
  onToggle,
  onDelete,
  onDuplicate,
  onMoveToList,
}: TaskDetailPanelProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(detail.title);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleValue(detail.title);
  }, [detail.title]);

  useEffect(() => {
    if (editingTitle) titleRef.current?.focus();
  }, [editingTitle]);

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== detail.title) {
      onUpdate({ title: trimmed });
    } else {
      setTitleValue(detail.title);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="p-6 space-y-6">
        {/* Header label + recurrence badge */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold">
            Task
          </span>
          {detail.recurrence && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/20">
              <RotateCw size={10} />
              {detail.recurrence}
            </span>
          )}
        </div>

        {/* Editable title */}
        {editingTitle ? (
          <input
            ref={titleRef}
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleValue(detail.title);
                setEditingTitle(false);
              }
            }}
            className="w-full text-2xl font-semibold text-white bg-transparent border-b border-blue-500/30 outline-none pb-1"
          />
        ) : (
          <h2
            onClick={() => setEditingTitle(true)}
            className="text-2xl font-semibold text-white leading-tight cursor-text hover:border-b hover:border-white/20 pb-1 transition-colors"
          >
            {detail.title}
          </h2>
        )}

        {/* Metadata badges */}
        <div className="flex flex-wrap gap-2">
          <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70 cursor-pointer hover:bg-white/10 transition-colors">
            List: {detail.list}
          </div>
          <div className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/40">
            Source: {detail.source}
          </div>
        </div>

        {/* Brett's Take */}
        {detail.brettObservation && (
          <div className="bg-blue-500/10 border-l-2 border-blue-500 p-4 rounded-r-lg">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="text-xs font-mono uppercase text-blue-400 font-semibold">
                Brett's Take
              </span>
            </div>
            <p className="text-sm italic text-blue-300/90 leading-relaxed">
              "{detail.brettObservation}"
            </p>
          </div>
        )}

        {/* Placeholder sections — replaced by real components in later tasks */}
        {/* Schedule Row: Task 8.1 */}
        {/* Rich Notes Editor: Task 9.1 */}
        {/* Attachment List: Task 10.1 */}
        {/* Linked Items: Task 11.1 */}

        {/* Description (plain text fallback until rich notes) */}
        {detail.description && !detail.notes && (
          <div className="text-sm text-white/80 leading-relaxed">
            {detail.description}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={() => onToggle(detail.id)}
            className="flex-1 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white py-2.5 rounded-lg transition-colors font-medium text-sm border border-white/10"
          >
            <CheckCircle size={16} />
            {detail.isCompleted ? "Mark Incomplete" : "Mark Complete"}
          </button>
          <OverflowMenu
            onDelete={() => onDelete(detail.id)}
            onDuplicate={() => onDuplicate(detail.id)}
            onMoveToList={() => onMoveToList(detail.id)}
            onCopyLink={() => navigator.clipboard.writeText(`brett://things/${detail.id}`)}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update DetailPanel to delegate to TaskDetailPanel**

Modify `packages/ui/src/DetailPanel.tsx` to use TaskDetailPanel for tasks and fetch detail data. The DetailPanel becomes a shell (slide-in container + header + close button) that delegates content rendering.

Update the props:

```typescript
interface DetailPanelProps {
  isOpen: boolean;
  item: Thing | CalendarEvent | null;
  detail: ThingDetail | null;
  isLoadingDetail: boolean;
  onClose: () => void;
  onToggle?: (id: string) => void;
  onUpdate?: (id: string, updates: Record<string, unknown>) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onMoveToList?: (id: string) => void;
}
```

Change the panel width from `w-[400px]` to `w-[550px]`.

For tasks, render `<TaskDetailPanel>` instead of the current inline task content. Keep calendar event rendering as-is.

- [ ] **Step 4: Update App.tsx to pass new props**

Wire `useThingDetail`, `useUpdateThing`, `useDeleteThing` to DetailPanel.

Add new imports and hooks:

```typescript
import { useThingDetail } from "./api/things";
import { useUpdateThing, useDeleteThing } from "./api/things";
```

Add state and callbacks:

```typescript
const selectedId = selectedItem?.id ?? null;
const { data: thingDetail, isLoading: isLoadingDetail } = useThingDetail(
  isDetailOpen && selectedItem && !("startTime" in selectedItem) ? selectedId : null
);
const updateThing = useUpdateThing();
const deleteThing = useDeleteThing();

const handleUpdateThing = (id: string, updates: Record<string, unknown>) => {
  updateThing.mutate({ id, ...updates } as any);
};

const handleDeleteThing = (id: string) => {
  deleteThing.mutate(id);
  handleCloseDetail();
};

const handleDuplicateThing = (id: string) => {
  if (thingDetail) {
    createThing.mutate({
      type: thingDetail.type,
      title: `${thingDetail.title} (copy)`,
      description: thingDetail.description,
      listId: thingDetail.listId ?? undefined,
      dueDate: thingDetail.dueDate,
      dueDatePrecision: thingDetail.dueDatePrecision,
    });
  }
};
```

Pass to DetailPanel:

```jsx
<DetailPanel
  isOpen={isDetailOpen}
  item={selectedItem}
  detail={thingDetail ?? null}
  isLoadingDetail={isLoadingDetail}
  onClose={handleCloseDetail}
  onToggle={handleToggle}
  onUpdate={handleUpdateThing}
  onDelete={handleDeleteThing}
  onDuplicate={handleDuplicateThing}
  onMoveToList={(id) => handleTriageOpen("list-first", [id], thingDetail ? { listId: thingDetail.listId } : undefined)}
/>
```

- [ ] **Step 5: Export new components from index.ts**

Add to `packages/ui/src/index.ts`:

```typescript
export { TaskDetailPanel } from "./TaskDetailPanel";
export { OverflowMenu } from "./OverflowMenu";
```

- [ ] **Step 6: Typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS

- [ ] **Step 7: Manual smoke test**

Run: `cd /Users/brentbarkman/code/brett && pnpm dev`

Verify:
- Panel opens at 550px width
- Title is clickable to edit
- Badges show correctly
- Mark Complete works
- Overflow menu opens with all 4 options
- Delete closes panel

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/ apps/desktop/src/
git commit -m "feat: task detail panel shell with editable title, actions, and overflow menu"
```

---

## Chunk 8: UI — Schedule Row

### Task 8.1: ScheduleRow Component

**Files:**
- Create: `packages/ui/src/ScheduleRow.tsx`
- Modify: `packages/ui/src/TaskDetailPanel.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create ScheduleRow component**

Create `packages/ui/src/ScheduleRow.tsx`:

Three equal-width cards in a row: Due Date, Reminder, Recurrence. Each card is a clickable glass card that opens a small dropdown/popover for editing.

```typescript
import React, { useState, useRef } from "react";
import { Calendar, Bell, RotateCw } from "lucide-react";
import { useClickOutside } from "./useClickOutside";
import type { ReminderType, RecurrenceType, DueDatePrecision } from "@brett/types";

interface ScheduleRowProps {
  dueDate?: string;
  dueDateLabel?: string;
  dueDatePrecision?: DueDatePrecision;
  reminder?: ReminderType;
  recurrence?: RecurrenceType;
  onUpdateDueDate: (dueDate: string | null, precision: DueDatePrecision) => void;
  onUpdateReminder: (reminder: ReminderType | null) => void;
  onUpdateRecurrence: (recurrence: RecurrenceType | null) => void;
}

function ScheduleCard({
  icon: Icon,
  label,
  value,
  onSelect,
  children,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onSelect?: () => void; // called by parent to close after selection
  children: (close: () => void) => React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setIsOpen(false));
  const close = () => setIsOpen(false);

  return (
    <div className="relative flex-1" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex flex-col items-center gap-1.5 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
      >
        <Icon size={14} className="text-white/40" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
          {label}
        </span>
        <span className="text-xs text-white/70 font-medium">{value}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 shadow-xl z-10 p-2">
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function ScheduleRow({
  dueDate,
  dueDateLabel,
  reminder,
  recurrence,
  onUpdateDueDate,
  onUpdateReminder,
  onUpdateRecurrence,
}: ScheduleRowProps) {
  const reminderLabels: Record<string, string> = {
    morning_of: "Morning of",
    "1_hour_before": "1hr before",
    day_before: "Day before",
    custom: "Custom",
  };

  const recurrenceLabels: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    custom: "Custom",
  };

  const dueDateOptions = [
    { label: "Today", action: () => onUpdateDueDate(new Date().toISOString(), "day") },
    { label: "Tomorrow", action: () => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() + 1);
      onUpdateDueDate(d.toISOString(), "day");
    }},
    { label: "This Week", action: () => {
      const d = new Date();
      const day = d.getUTCDay();
      const daysUntilSun = day === 0 ? 7 : 7 - day;
      d.setUTCDate(d.getUTCDate() + daysUntilSun);
      onUpdateDueDate(d.toISOString(), "week");
    }},
    { label: "No date", action: () => onUpdateDueDate(null, "day") },
  ];

  const reminderOptions: { label: string; value: ReminderType | null }[] = [
    { label: "Morning of", value: "morning_of" },
    { label: "1 hour before", value: "1_hour_before" },
    { label: "Day before", value: "day_before" },
    { label: "No reminder", value: null },
  ];

  const recurrenceOptions: { label: string; value: RecurrenceType | null }[] = [
    { label: "Daily", value: "daily" },
    { label: "Weekly", value: "weekly" },
    { label: "Monthly", value: "monthly" },
    { label: "No recurrence", value: null },
  ];

  return (
    <div>
      <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2 block">
        Schedule
      </span>
      <div className="flex gap-2">
        <ScheduleCard icon={Calendar} label="Due" value={dueDateLabel || "Not set"}>
          {(close) => dueDateOptions.map((opt) => (
            <button
              key={opt.label}
              onClick={() => { opt.action(); close(); }}
              className="w-full text-left px-2 py-1.5 text-xs text-white/80 hover:bg-white/10 rounded transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </ScheduleCard>

        <ScheduleCard
          icon={Bell}
          label="Reminder"
          value={reminder ? reminderLabels[reminder] : "None"}
        >
          {(close) => reminderOptions.map((opt) => (
            <button
              key={opt.label}
              onClick={() => { onUpdateReminder(opt.value); close(); }}
              className={`w-full text-left px-2 py-1.5 text-xs hover:bg-white/10 rounded transition-colors ${
                reminder === opt.value ? "text-blue-400" : "text-white/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </ScheduleCard>

        <ScheduleCard
          icon={RotateCw}
          label="Repeat"
          value={recurrence ? recurrenceLabels[recurrence] : "None"}
        >
          {(close) => recurrenceOptions.map((opt) => (
            <button
              key={opt.label}
              onClick={() => { onUpdateRecurrence(opt.value); close(); }}
              className={`w-full text-left px-2 py-1.5 text-xs hover:bg-white/10 rounded transition-colors ${
                recurrence === opt.value ? "text-blue-400" : "text-white/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </ScheduleCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire ScheduleRow into TaskDetailPanel**

Add between metadata badges and Brett's Take:

```typescript
<ScheduleRow
  dueDate={detail.dueDate}
  dueDateLabel={detail.dueDateLabel}
  dueDatePrecision={detail.dueDatePrecision}
  reminder={detail.reminder}
  recurrence={detail.recurrence}
  onUpdateDueDate={(date, precision) =>
    onUpdate({ dueDate: date, dueDatePrecision: precision })
  }
  onUpdateReminder={(reminder) => onUpdate({ reminder })}
  onUpdateRecurrence={(recurrence) => onUpdate({ recurrence })}
/>
```

- [ ] **Step 3: Export and typecheck**

Add to `packages/ui/src/index.ts`:

```typescript
export { ScheduleRow } from "./ScheduleRow";
```

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/
git commit -m "feat: add ScheduleRow component with due date, reminder, and recurrence cards"
```

---

## Chunk 9: UI — Rich Notes Editor

### Task 9.1: Tiptap RichTextEditor

**Files:**
- Create: `packages/ui/src/RichTextEditor.tsx`
- Modify: `packages/ui/src/TaskDetailPanel.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Install Tiptap packages**

Run: `cd /Users/brentbarkman/code/brett && pnpm add -F @brett/ui @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder tiptap-markdown`

- [ ] **Step 2: Create RichTextEditor component**

Create `packages/ui/src/RichTextEditor.tsx`:

```typescript
import React, { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { Bold, Italic, List, ListOrdered, Heading2, Code } from "lucide-react";

interface RichTextEditorProps {
  content: string; // markdown
  onChange: (markdown: string) => void;
  placeholder?: string;
}

function ToolbarButton({
  onClick,
  isActive,
  children,
}: {
  onClick: () => void;
  isActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? "bg-white/20 text-white"
          : "text-white/40 hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ content, onChange, placeholder = "Add notes…" }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, transformCopiedText: true }),
    ],
    content, // Markdown extension handles parsing markdown → ProseMirror
    onBlur: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      onChange(md);
    },
    editorProps: {
      attributes: {
        class: "prose prose-invert prose-sm max-w-none focus:outline-none min-h-[100px] text-white/80",
      },
    },
  });

  // Sync external content changes (e.g., refetch after save)
  useEffect(() => {
    if (editor && !editor.isFocused) {
      const currentMd = editor.storage.markdown.getMarkdown();
      if (currentMd !== content) {
        editor.commands.setContent(content || "");
      }
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/10">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive("heading", { level: 2 })}
        >
          <Heading2 size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive("codeBlock")}
        >
          <Code size={14} />
        </ToolbarButton>
      </div>

      {/* Editor */}
      <div className="p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into TaskDetailPanel**

Add after the schedule row, before description fallback:

```typescript
{/* Rich Notes Editor */}
<div>
  <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2 block">
    Notes
  </span>
  <RichTextEditor
    content={detail.notes || ""}
    onChange={(md) => onUpdate({ notes: md || null })}
  />
</div>
```

Remove the plain-text description fallback once notes editor is in place.

- [ ] **Step 4: Export and typecheck**

Add to `packages/ui/src/index.ts`:

```typescript
export { RichTextEditor } from "./RichTextEditor";
```

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

- [ ] **Step 5: Manual smoke test**

Run dev, open a task detail, verify:
- Tiptap editor renders with toolbar
- Can type, format with toolbar and Cmd+B/Cmd+I
- Content saves on blur
- Reopen panel — content persists

- [ ] **Step 6: Commit**

```bash
git add packages/ui/ pnpm-lock.yaml
git commit -m "feat: add Tiptap rich text editor for task notes"
```

---

## Chunk 10: UI — Attachments

### Task 10.1: AttachmentList Component

**Files:**
- Create: `packages/ui/src/AttachmentList.tsx`
- Modify: `packages/ui/src/TaskDetailPanel.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create AttachmentList component**

Create `packages/ui/src/AttachmentList.tsx`:

```typescript
import React, { useRef, useCallback } from "react";
import { Paperclip, X, FileText, Image, Film, Music } from "lucide-react";
import type { Attachment } from "@brett/types";

interface AttachmentListProps {
  attachments: Attachment[];
  onUpload: (file: File) => void;
  onDelete: (attachmentId: string) => void;
  isUploading?: boolean;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.startsWith("video/")) return Film;
  if (mimeType.startsWith("audio/")) return Music;
  return FileText;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mimeType: string) {
  return mimeType.startsWith("image/");
}

export function AttachmentList({ attachments, onUpload, onDelete, isUploading }: AttachmentListProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      files.forEach(onUpload);
    },
    [onUpload]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      files.forEach(onUpload);
    },
    [onUpload]
  );

  return (
    <div>
      <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2 block">
        Attachments
      </span>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onPaste={handlePaste}
        className="rounded-lg border border-dashed border-white/10 hover:border-white/20 transition-colors"
      >
        {attachments.length > 0 && (
          <div className="p-2 space-y-1.5">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/5 group"
              >
                {isImageMime(att.mimeType) ? (
                  <img
                    src={att.url}
                    alt={att.filename}
                    className="w-10 h-10 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
                    {React.createElement(getFileIcon(att.mimeType), {
                      size: 16,
                      className: "text-white/40",
                    })}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-white/80 hover:text-white truncate block"
                  >
                    {att.filename}
                  </a>
                  <span className="text-[10px] text-white/40">{formatSize(att.sizeBytes)}</span>
                </div>
                <button
                  onClick={() => onDelete(att.id)}
                  className="p-1 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload button / drop hint */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 p-3 text-xs text-white/30 hover:text-white/50 transition-colors"
        >
          <Paperclip size={14} />
          {isUploading ? "Uploading…" : "Drop files or click to attach"}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            Array.from(e.target.files || []).forEach(onUpload);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into TaskDetailPanel**

Add after notes editor:

```typescript
<AttachmentList
  attachments={detail.attachments}
  onUpload={(file) => onUploadAttachment({ itemId: detail.id, file })}
  onDelete={(attachmentId) => onDeleteAttachment({ itemId: detail.id, attachmentId })}
  isUploading={isUploadingAttachment}
/>
```

Add props to TaskDetailPanel:

```typescript
onUploadAttachment: (args: { itemId: string; file: File }) => void;
onDeleteAttachment: (args: { itemId: string; attachmentId: string }) => void;
isUploadingAttachment?: boolean;
```

Wire from App.tsx:

```typescript
import { useUploadAttachment, useDeleteAttachment } from "./api/attachments";

const uploadAttachment = useUploadAttachment();
const deleteAttachment = useDeleteAttachment();
```

- [ ] **Step 3: Export and typecheck**

```typescript
export { AttachmentList } from "./AttachmentList";
```

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ apps/desktop/src/
git commit -m "feat: add AttachmentList component with drag-drop, thumbnails, and S3 upload"
```

---

## Chunk 11: UI — Linked Items

### Task 11.1: LinkedItemsList Component

**Files:**
- Create: `packages/ui/src/LinkedItemsList.tsx`
- Modify: `packages/ui/src/TaskDetailPanel.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create LinkedItemsList component**

Create `packages/ui/src/LinkedItemsList.tsx`:

```typescript
import React, { useState, useRef } from "react";
import { Link2, Plus, X, Zap, BookOpen } from "lucide-react";
import { useClickOutside } from "./useClickOutside";
import type { ItemLink, Thing } from "@brett/types";

interface LinkedItemsListProps {
  links: ItemLink[];
  onAddLink: (toItemId: string, toItemType: string) => void;
  onRemoveLink: (linkId: string) => void;
  searchItems: (query: string) => Promise<Thing[]>;
}

export function LinkedItemsList({ links, onAddLink, onRemoveLink, searchItems }: LinkedItemsListProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Thing[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  useClickOutside(searchRef, () => {
    setIsSearching(false);
    setQuery("");
    setResults([]);
  });

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length >= 2) {
      const items = await searchItems(q.trim());
      // Filter out already-linked items
      const linkedIds = new Set(links.map((l) => l.toItemId));
      setResults(items.filter((i) => !linkedIds.has(i.id)));
    } else {
      setResults([]);
    }
  };

  const typeIcon = (type: string) => {
    if (type === "task") return <Zap size={12} className="text-blue-400" />;
    return <BookOpen size={12} className="text-amber-400" />;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold">
          Linked Items
        </span>
        <button
          onClick={() => setIsSearching(true)}
          className="p-1 text-white/30 hover:text-white/60 transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Search */}
      {isSearching && (
        <div ref={searchRef} className="mb-2 relative">
          <input
            autoFocus
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search tasks to link…"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/30"
          />
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 shadow-xl max-h-40 overflow-y-auto z-10">
              {results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onAddLink(item.id, item.type);
                    setIsSearching(false);
                    setQuery("");
                    setResults([]);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                >
                  {typeIcon(item.type)}
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Links list */}
      {links.length > 0 ? (
        <div className="space-y-1">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5 group"
            >
              {typeIcon(link.toItemType)}
              <span className="flex-1 text-xs text-white/70 truncate">
                {link.toItemTitle || link.toItemId}
              </span>
              <button
                onClick={() => onRemoveLink(link.id)}
                className="p-0.5 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        !isSearching && (
          <div className="flex items-center gap-2 text-xs text-white/20 py-2">
            <Link2 size={12} />
            No linked items
          </div>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into TaskDetailPanel**

Add `searchItems` prop and wire LinkedItemsList:

```typescript
<LinkedItemsList
  links={detail.links}
  onAddLink={(toItemId, toItemType) =>
    onCreateLink({ itemId: detail.id, toItemId, toItemType })
  }
  onRemoveLink={(linkId) => onDeleteLink({ itemId: detail.id, linkId })}
  searchItems={searchItems}
/>
```

The `searchItems` function comes from App.tsx, using the existing things query:

```typescript
const searchItems = async (query: string): Promise<Thing[]> => {
  const items = await apiFetch<Thing[]>(`/things?status=active`);
  return items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
};
```

- [ ] **Step 3: Export and typecheck**

```typescript
export { LinkedItemsList } from "./LinkedItemsList";
```

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ apps/desktop/src/
git commit -m "feat: add LinkedItemsList component with search and link management"
```

---

## Chunk 12: UI — Brett Thread

### Task 12.1: BrettThread Component

**Files:**
- Create: `packages/ui/src/BrettThread.tsx`
- Modify: `packages/ui/src/TaskDetailPanel.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create BrettThread component**

Create `packages/ui/src/BrettThread.tsx`:

The thread is pinned at the bottom of the panel. History is collapsible (collapsed by default). The input is always visible.

```typescript
import React, { useState, useRef } from "react";
import { ChevronDown, ChevronUp, Send, Bot, User } from "lucide-react";
import type { BrettMessage } from "@brett/types";

interface BrettThreadProps {
  messages: BrettMessage[];
  hasMore: boolean;
  onSend: (content: string) => void;
  onLoadMore: () => void;
  isSending?: boolean;
}

export function BrettThread({ messages, hasMore, onSend, onLoadMore, isSending }: BrettThreadProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const content = input.trim();
    if (!content || isSending) return;
    onSend(content);
    setInput("");
  };

  // Messages come newest-first from API; reverse for display
  const displayMessages = [...messages].reverse();

  return (
    <div className="border-t border-white/10">
      {/* Collapsible history */}
      {messages.length > 0 && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-white/40 hover:text-white/60 transition-colors"
        >
          <span className="font-mono uppercase tracking-wider">
            Brett Thread ({messages.length})
          </span>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      )}

      {isExpanded && (
        <div className="max-h-60 overflow-y-auto px-4 pb-2 space-y-3">
          {hasMore && (
            <button
              onClick={onLoadMore}
              className="w-full text-center text-xs text-white/30 hover:text-white/50 py-1"
            >
              Load older messages…
            </button>
          )}
          {displayMessages.map((msg) => (
            <div key={msg.id} className="flex gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === "brett"
                  ? "bg-blue-500/20"
                  : "bg-white/10"
              }`}>
                {msg.role === "brett" ? (
                  <Bot size={12} className="text-blue-400" />
                ) : (
                  <User size={12} className="text-white/50" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-relaxed ${
                  msg.role === "brett" ? "text-blue-300/80" : "text-white/70"
                }`}>
                  {msg.content}
                </p>
                <span className="text-[10px] text-white/20">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pinned input */}
      <div className="p-3 bg-gradient-to-t from-black/40 to-transparent">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Ask Brett about this task…"
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/30 resize-none"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isSending}
            className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into TaskDetailPanel layout**

The BrettThread is pinned at the bottom of the panel, outside the scrollable area. Update the TaskDetailPanel structure:

```typescript
return (
  <>
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="p-6 space-y-6">
        {/* ... all existing sections ... */}
      </div>
    </div>
    {/* Brett thread pinned at bottom */}
    <BrettThread
      messages={brettMessages}
      hasMore={brettHasMore}
      onSend={(content) => onSendBrettMessage({ itemId: detail.id, content })}
      onLoadMore={onLoadMoreBrettMessages}
      isSending={isSendingBrettMessage}
    />
  </>
);
```

Add the necessary props to TaskDetailPanel:

```typescript
brettMessages: BrettMessage[];
brettHasMore: boolean;
onSendBrettMessage: (args: { itemId: string; content: string }) => void;
onLoadMoreBrettMessages: () => void;
isSendingBrettMessage?: boolean;
```

Wire from App.tsx using the brett hooks.

- [ ] **Step 3: Export and typecheck**

```typescript
export { BrettThread } from "./BrettThread";
```

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ apps/desktop/src/
git commit -m "feat: add BrettThread component with collapsible history and pinned input"
```

---

## Chunk 13: Integration & Polish

### Task 13.1: Final Wiring & Typecheck

**Files:**
- Modify: `apps/desktop/src/App.tsx` (final wiring pass)
- Modify: `packages/ui/src/DetailPanel.tsx` (final integration)
- Modify: `packages/ui/src/TaskDetailPanel.tsx` (final props)

- [ ] **Step 1: Ensure all hooks are wired in App.tsx**

Verify every new hook is imported and passed to DetailPanel → TaskDetailPanel:

- `useThingDetail` → `detail` prop
- `useUpdateThing` → `onUpdate`
- `useDeleteThing` → `onDelete`
- `useUploadAttachment` / `useDeleteAttachment` → attachment callbacks
- `useSendBrettMessage` / `useBrettMessages` → brett callbacks
- `useCreateLink` / `useDeleteLink` → link callbacks
- `searchItems` function → link search

- [ ] **Step 2: Full typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS with zero errors

- [ ] **Step 3: Run all API tests**

Run: `cd /Users/brentbarkman/code/brett && pnpm test`

Expected: All tests PASS

- [ ] **Step 4: Full manual smoke test**

Run: `cd /Users/brentbarkman/code/brett && pnpm dev`

Test each feature:
1. Open a task → 550px panel, editable title
2. Edit due date, reminder, recurrence via schedule row
3. Type rich notes with bold/italic/lists, verify save on blur
4. Upload a file, verify thumbnail, verify delete
5. Link another task, verify it shows, verify unlink
6. Send a Brett message, verify stub response
7. Complete a recurring task, verify new task appears
8. Delete a task via overflow menu
9. Duplicate a task
10. Escape closes panel

- [ ] **Step 5: Lint**

Run: `cd /Users/brentbarkman/code/brett && pnpm lint`

Fix any issues.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete task detail panel — rich notes, attachments, brett thread, scheduling, links, recurrence"
```
