# Content Reading System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add content consumption tracking — users save URLs (tweets, articles, videos, PDFs, podcasts) alongside tasks, with inline preview in the detail panel and auto-extraction of metadata/body.

**Architecture:** Extend the existing Item model with content fields (no new tables). Server-side extraction pipeline runs fire-and-forget on content creation, with SSE notification on completion. Detail panel gains a content preview section between schedule row and Brett's Take. Quick-add input auto-detects URLs vs plain text.

**Tech Stack:** `@mozilla/readability` + `jsdom` for article extraction, oEmbed APIs for tweets/videos, sandboxed iframes for all third-party embeds, existing S3/SSE infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-20-content-reading-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/prisma/migrations/YYYYMMDD_content_fields/migration.sql` | Prisma migration adding content columns + index |
| `apps/api/src/lib/content-extractor.ts` | URL detection, metadata extraction, article parsing, oEmbed calls |
| `apps/api/src/lib/url-detector.ts` | URL pattern matching and TLD validation |
| `apps/api/src/lib/ssrf-guard.ts` | Safe fetch wrapper with SSRF protections |
| `apps/api/src/routes/extract.ts` | `POST /things/:id/extract` endpoint |
| `apps/api/src/__tests__/url-detector.test.ts` | URL detection unit tests |
| `apps/api/src/__tests__/content-extractor.test.ts` | Extraction pipeline tests |
| `apps/api/src/__tests__/extract.test.ts` | Extract endpoint integration tests |
| `packages/business/src/__tests__/content-validation.test.ts` | Content field validation tests |
| `packages/ui/src/ContentPreview.tsx` | Content preview renderer (dispatches by contentType) |
| `packages/ui/src/ContentDetailPanel.tsx` | Detail panel variant for content items |
| `packages/ui/src/AppDropZone.tsx` | App-level PDF drag-drop overlay |

### Modified Files

| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | Add content fields to Item model, add index |
| `packages/types/src/index.ts` | Add ContentType, ContentStatus, ContentMetadata types; extend ItemRecord, Thing, ThingDetail, CreateItemInput, UpdateItemInput |
| `packages/types/src/calendar.ts` | Add `content.extracted` to SSEEventType |
| `packages/business/src/index.ts` | Extend itemToThing, validateCreateItem, validateUpdateItem for content fields |
| `apps/api/src/routes/things.ts` | Extend POST/PATCH handlers for content fields, trigger extraction on content create |
| `apps/api/src/app.ts` | Mount extract routes |
| `apps/desktop/src/api/things.ts` | Extend useCreateThing to pass content fields |
| `apps/desktop/src/api/sse.ts` | Add content.extracted SSE handler |
| `packages/ui/src/QuickAddInput.tsx` | Add URL detection, change onAdd signature |
| `packages/ui/src/DetailPanel.tsx` | Route content items to ContentDetailPanel |
| `packages/ui/src/TaskDetailPanel.tsx` | Minor — used as reference for ContentDetailPanel |
| `apps/desktop/src/App.tsx` | Add AppDropZone wrapper |

---

### Task 1: Types — Content Type Definitions

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/calendar.ts`

- [ ] **Step 1: Add content type definitions to types package**

In `packages/types/src/index.ts`, add after line 46 (after `RecurrenceType`):

```typescript
export type ContentType = "tweet" | "article" | "video" | "pdf" | "podcast" | "web_page";
export type ContentStatus = "pending" | "extracted" | "failed";

export type ContentMetadata =
  | { type: "tweet"; embedHtml?: string; author?: string; tweetText?: string }
  | { type: "video"; embedUrl: string; duration?: number; channel?: string }
  | { type: "podcast"; embedUrl: string; provider: "spotify" | "apple"; episodeName?: string; showName?: string }
  | { type: "article"; author?: string; publishDate?: string; wordCount?: number }
  | { type: "web_page" }
  | { type: "pdf" };
```

- [ ] **Step 2: Extend ItemRecord with content fields**

In `packages/types/src/index.ts`, add to the `ItemRecord` interface (after `brettTakeGeneratedAt` field at line 66):

```typescript
  contentType: string | null;
  contentStatus: string | null;
  contentTitle: string | null;
  contentDescription: string | null;
  contentImageUrl: string | null;
  contentBody: string | null;
  contentFavicon: string | null;
  contentDomain: string | null;
  contentMetadata: Record<string, unknown> | null;
```

- [ ] **Step 3: Extend Thing with content fields for list views**

In `packages/types/src/index.ts`, add to the `Thing` interface (after `createdAt` at line 92):

```typescript
  contentType?: ContentType;
  contentStatus?: ContentStatus;
  contentDomain?: string;
  contentImageUrl?: string;
```

- [ ] **Step 4: Extend ThingDetail with full content fields**

In `packages/types/src/index.ts`, add to the `ThingDetail` interface (after `brettTakeGeneratedAt` at line 124):

```typescript
  contentTitle?: string;
  contentDescription?: string;
  contentBody?: string;
  contentFavicon?: string;
  contentMetadata?: ContentMetadata;
```

(Note: `contentType`, `contentStatus`, `contentDomain`, `contentImageUrl` are already inherited from `Thing`.)

- [ ] **Step 5: Extend CreateItemInput with content fields**

In `packages/types/src/index.ts`, add to `CreateItemInput` (after `status` at line 140):

```typescript
  contentType?: ContentType;
```

(Note: `sourceUrl` already exists at line 135. `contentType` is optional — auto-detected if not provided.)

- [ ] **Step 6: Extend UpdateItemInput with content fields**

In `packages/types/src/index.ts`, add to `UpdateItemInput` (after `recurrenceRule` at line 157):

```typescript
  contentType?: ContentType | null;
  contentStatus?: ContentStatus | null;
  contentTitle?: string | null;
  contentDescription?: string | null;
  contentImageUrl?: string | null;
  contentBody?: string | null;
  contentFavicon?: string | null;
  contentDomain?: string | null;
  contentMetadata?: Record<string, unknown> | null;
```

- [ ] **Step 7: Add content.extracted to SSE event types**

In `packages/types/src/calendar.ts`, update the `SSEEventType` at line 128:

```typescript
export type SSEEventType =
  | "calendar.event.created"
  | "calendar.event.updated"
  | "calendar.event.deleted"
  | "calendar.sync.complete"
  | "content.extracted";
```

- [ ] **Step 8: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: Type errors in `packages/business` and `apps/api` because `ItemRecord` now has new required fields not yet handled by `itemToThing`, `validateCreateItem`, etc. That's expected — we fix those in Task 2 and 3.

- [ ] **Step 9: Commit**

```bash
git add packages/types/src/index.ts packages/types/src/calendar.ts
git commit -m "feat: add content type definitions to types package"
```

---

### Task 2: Business Logic — Validation & Mapping

**Files:**
- Modify: `packages/business/src/index.ts`
- Create: `packages/business/src/__tests__/content-validation.test.ts`

- [ ] **Step 1: Write failing tests for content validation**

Create `packages/business/src/__tests__/content-validation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateCreateItem, validateUpdateItem, itemToThing } from "../index";
import type { ItemRecord } from "@brett/types";

function makeContentItem(overrides: Partial<ItemRecord> = {}): ItemRecord & { list: { name: string } } {
  return {
    id: "item-1",
    type: "content",
    status: "active",
    title: "Test Article",
    description: null,
    source: "medium.com",
    sourceUrl: "https://medium.com/test-article",
    dueDate: null,
    dueDatePrecision: null,
    completedAt: null,
    snoozedUntil: null,
    brettObservation: null,
    notes: null,
    reminder: null,
    recurrence: null,
    recurrenceRule: null,
    brettTakeGeneratedAt: null,
    contentType: "article",
    contentStatus: "extracted",
    contentTitle: "Original Title",
    contentDescription: "An article about testing",
    contentImageUrl: "https://miro.medium.com/image.jpg",
    contentBody: "# Article body\n\nSome content here.",
    contentFavicon: "https://medium.com/favicon.ico",
    contentDomain: "medium.com",
    contentMetadata: { type: "article", author: "Test Author", publishDate: "2026-03-01" },
    listId: null,
    userId: "user-1",
    createdAt: new Date("2026-03-10T10:00:00Z"),
    updatedAt: new Date("2026-03-13T10:00:00Z"),
    list: { name: "Reading" },
    ...overrides,
  };
}

describe("validateCreateItem — content", () => {
  it("accepts content type with sourceUrl", () => {
    const result = validateCreateItem({
      type: "content",
      title: "https://medium.com/article",
      sourceUrl: "https://medium.com/article",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts content type with contentType", () => {
    const result = validateCreateItem({
      type: "content",
      title: "https://youtube.com/watch?v=abc",
      sourceUrl: "https://youtube.com/watch?v=abc",
      contentType: "video",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.contentType).toBe("video");
  });

  it("rejects invalid contentType", () => {
    const result = validateCreateItem({
      type: "content",
      title: "Test",
      sourceUrl: "https://example.com",
      contentType: "banana",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdateItem — content fields", () => {
  it("accepts contentStatus update", () => {
    const result = validateUpdateItem({ contentStatus: "extracted" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.contentStatus).toBe("extracted");
  });

  it("rejects invalid contentStatus", () => {
    const result = validateUpdateItem({ contentStatus: "banana" });
    expect(result.ok).toBe(false);
  });

  it("accepts contentBody within size limit", () => {
    const result = validateUpdateItem({ contentBody: "Some article text" });
    expect(result.ok).toBe(true);
  });

  it("rejects contentBody over 500KB", () => {
    const result = validateUpdateItem({ contentBody: "x".repeat(500_001) });
    expect(result.ok).toBe(false);
  });

  it("accepts contentMetadata as object", () => {
    const result = validateUpdateItem({
      contentMetadata: { type: "article", author: "Test" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts null to clear content fields", () => {
    const result = validateUpdateItem({
      contentBody: null,
      contentTitle: null,
      contentDescription: null,
    });
    expect(result.ok).toBe(true);
  });
});

describe("itemToThing — content fields", () => {
  it("maps content fields to Thing", () => {
    const item = makeContentItem();
    const thing = itemToThing(item);
    expect(thing.contentType).toBe("article");
    expect(thing.contentStatus).toBe("extracted");
    expect(thing.contentDomain).toBe("medium.com");
    expect(thing.contentImageUrl).toBe("https://miro.medium.com/image.jpg");
  });

  it("omits content fields for tasks", () => {
    const item = makeContentItem({
      type: "task",
      contentType: null,
      contentStatus: null,
      contentDomain: null,
      contentImageUrl: null,
    });
    const thing = itemToThing(item);
    expect(thing.contentType).toBeUndefined();
    expect(thing.contentStatus).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/business test`

Expected: FAIL — `makeContentItem` has fields not in `ItemRecord` yet (if Task 1 isn't done) or `itemToThing` doesn't map content fields.

- [ ] **Step 3: Extend itemToThing for content fields**

In `packages/business/src/index.ts`, update the `itemToThing` function (lines 145-170). Add content fields to the return object after `createdAt`:

```typescript
    createdAt: item.createdAt.toISOString(),
    contentType: (item.contentType as ContentType) ?? undefined,
    contentStatus: (item.contentStatus as ContentStatus) ?? undefined,
    contentDomain: item.contentDomain ?? undefined,
    contentImageUrl: item.contentImageUrl ?? undefined,
```

Add imports at top of file:

```typescript
import type { ..., ContentType, ContentStatus } from "@brett/types";
```

- [ ] **Step 4: Extend validateCreateItem for content fields**

In `packages/business/src/index.ts`, update `validateCreateItem` (around line 232-249). Add `contentType` validation before the return statement:

```typescript
  const VALID_CONTENT_TYPES = new Set(["tweet", "article", "video", "pdf", "podcast", "web_page"]);
  if (obj.contentType !== undefined && obj.contentType !== null) {
    if (typeof obj.contentType !== "string" || !VALID_CONTENT_TYPES.has(obj.contentType)) {
      return { ok: false, error: `contentType must be one of: ${[...VALID_CONTENT_TYPES].join(", ")}` };
    }
  }
```

And add `contentType` to the return data object:

```typescript
      contentType: typeof obj.contentType === "string" ? obj.contentType as ContentType : undefined,
```

- [ ] **Step 5: Extend validateUpdateItem for content fields**

In `packages/business/src/index.ts`, update `validateUpdateItem` (after the recurrenceRule block around line 358). Add:

```typescript
  // Content fields
  const VALID_CONTENT_TYPES = new Set(["tweet", "article", "video", "pdf", "podcast", "web_page"]);
  if (obj.contentType !== undefined) {
    if (obj.contentType !== null && (typeof obj.contentType !== "string" || !VALID_CONTENT_TYPES.has(obj.contentType))) {
      return { ok: false, error: `contentType must be one of: ${[...VALID_CONTENT_TYPES].join(", ")}` };
    }
    data.contentType = obj.contentType as ContentType | null;
  }

  const VALID_CONTENT_STATUSES = new Set(["pending", "extracted", "failed"]);
  if (obj.contentStatus !== undefined) {
    if (obj.contentStatus !== null && (typeof obj.contentStatus !== "string" || !VALID_CONTENT_STATUSES.has(obj.contentStatus))) {
      return { ok: false, error: `contentStatus must be one of: ${[...VALID_CONTENT_STATUSES].join(", ")}` };
    }
    data.contentStatus = obj.contentStatus as ContentStatus | null;
  }

  // Nullable string content fields
  if (obj.contentTitle !== undefined) {
    data.contentTitle = obj.contentTitle === null ? null : typeof obj.contentTitle === "string" ? obj.contentTitle : undefined;
  }
  if (obj.contentDescription !== undefined) {
    data.contentDescription = obj.contentDescription === null ? null : typeof obj.contentDescription === "string" ? obj.contentDescription : undefined;
  }
  if (obj.contentImageUrl !== undefined) {
    data.contentImageUrl = obj.contentImageUrl === null ? null : typeof obj.contentImageUrl === "string" ? obj.contentImageUrl : undefined;
  }
  if (obj.contentBody !== undefined) {
    data.contentBody = obj.contentBody === null ? null : typeof obj.contentBody === "string" ? obj.contentBody : undefined;
  }
  if (data.contentBody !== undefined && data.contentBody !== null && data.contentBody.length > 500_000) {
    return { ok: false, error: "contentBody must be 500KB or less" };
  }
  if (obj.contentFavicon !== undefined) {
    data.contentFavicon = obj.contentFavicon === null ? null : typeof obj.contentFavicon === "string" ? obj.contentFavicon : undefined;
  }
  if (obj.contentDomain !== undefined) {
    data.contentDomain = obj.contentDomain === null ? null : typeof obj.contentDomain === "string" ? obj.contentDomain : undefined;
  }
  if (obj.contentMetadata !== undefined) {
    data.contentMetadata = obj.contentMetadata === null ? null : (typeof obj.contentMetadata === "object" && !Array.isArray(obj.contentMetadata)) ? obj.contentMetadata as Record<string, unknown> : undefined;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/business test`

Expected: All tests PASS.

- [ ] **Step 7: Run full typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: May still have errors in `apps/api` where `itemToThingDetail` and `POST /things` don't handle new fields yet. That's Task 3.

- [ ] **Step 8: Commit**

```bash
git add packages/business/src/index.ts packages/business/src/__tests__/content-validation.test.ts
git commit -m "feat: extend business logic for content validation and mapping"
```

---

### Task 3: Prisma Schema & API — Content Fields

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/routes/things.ts`
- Modify: `apps/api/src/__tests__/things.test.ts`

- [ ] **Step 1: Add content fields to Prisma schema**

In `apps/api/prisma/schema.prisma`, update the Item model (lines 87-119). After `brettTakeGeneratedAt` (line 104) add:

```prisma
  contentType        String?   // "tweet" | "article" | "video" | "pdf" | "podcast" | "web_page"
  contentStatus      String?   // "pending" | "extracted" | "failed"
  contentTitle       String?
  contentDescription String?
  contentImageUrl    String?
  contentBody        String?   @db.Text
  contentFavicon     String?
  contentDomain      String?
  contentMetadata    Json?
```

Update the `type` comment on line 89:

```prisma
  type             String    // "task" | "content"
```

Add index after existing indexes (line 118):

```prisma
  @@index([userId, contentType])
```

- [ ] **Step 2: Run Prisma migration**

Run: `cd /Users/brentbarkman/code/brett && pnpm db:migrate`

When prompted for migration name, use: `add_content_fields`

Expected: Migration created and applied successfully.

- [ ] **Step 2b: Add data migration SQL for legacy type values**

After the migration is created, edit the generated migration SQL file to append data migration at the end:

```sql
-- Migrate legacy type values to new "content" type
UPDATE "Item" SET type = 'content', "contentType" = 'web_page', "contentStatus" = 'pending' WHERE type = 'saved_web';
UPDATE "Item" SET type = 'content', "contentType" = 'tweet', "contentStatus" = 'pending' WHERE type = 'saved_tweet';
```

Then re-apply: `cd /Users/brentbarkman/code/brett && npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma`

- [ ] **Step 3: Write failing tests for content API endpoints**

Add to `apps/api/src/__tests__/things.test.ts`, inside the existing `describe("Things routes")` block:

```typescript
  it("POST /things creates a content item with sourceUrl", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://medium.com/some-article",
        sourceUrl: "https://medium.com/some-article",
        source: "medium.com",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.type).toBe("content");
    expect(body.sourceUrl).toBe("https://medium.com/some-article");
    expect(body.source).toBe("medium.com");
  });

  it("POST /things creates content with contentType", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://youtube.com/watch?v=abc",
        sourceUrl: "https://youtube.com/watch?v=abc",
        contentType: "video",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.contentType).toBe("video");
    expect(body.contentStatus).toBe("pending");
  });

  it("GET /things/:id returns content detail fields", async () => {
    // Create a content item
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "Test Article",
        sourceUrl: "https://example.com/article",
      }),
    });
    const created = (await createRes.json()) as any;

    // Update with extracted content
    await authRequest(`/things/${created.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        contentType: "article",
        contentStatus: "extracted",
        contentTitle: "Original Title",
        contentDescription: "A great article",
        contentBody: "# Hello\n\nWorld",
        contentDomain: "example.com",
        contentFavicon: "https://example.com/favicon.ico",
        contentMetadata: { type: "article", author: "Test" },
      }),
    });

    // Fetch detail
    const detailRes = await authRequest(`/things/${created.id}`, token);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as any;
    expect(detail.contentType).toBe("article");
    expect(detail.contentStatus).toBe("extracted");
    expect(detail.contentTitle).toBe("Original Title");
    expect(detail.contentDescription).toBe("A great article");
    expect(detail.contentBody).toBe("# Hello\n\nWorld");
    expect(detail.contentDomain).toBe("example.com");
    expect(detail.contentMetadata).toEqual({ type: "article", author: "Test" });
  });

  it("GET /things filters by type=content", async () => {
    const res = await authRequest("/things?type=content", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    for (const item of body) {
      expect(item.type).toBe("content");
    }
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test`

Expected: FAIL — POST handler doesn't pass `contentType` to Prisma, PATCH handler doesn't pass content fields, `itemToThingDetail` doesn't return content fields.

- [ ] **Step 5: Extend POST /things handler for content fields**

In `apps/api/src/routes/things.ts`, update the `POST /` handler (lines 229-242). Add content fields to the `prisma.item.create` data:

```typescript
    const item = await prisma.item.create({
      data: {
        type: data.type,
        title: data.title,
        description: data.description,
        source: data.source ?? (data.type === "content" && data.sourceUrl
          ? new URL(data.sourceUrl).hostname : "Brett"),
        sourceUrl: data.sourceUrl,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        dueDatePrecision: data.dueDatePrecision ?? null,
        brettObservation: data.brettObservation,
        status: data.status ?? "active",
        listId: data.listId ?? null,
        userId: user.id,
        // Content fields
        contentType: data.contentType ?? null,
        contentStatus: data.type === "content" ? "pending" : null,
      },
      include: { list: { select: { name: true } } },
    });
```

- [ ] **Step 6: Extend PATCH /things handler for content fields**

In `apps/api/src/routes/things.ts`, update the PATCH handler (around lines 314-338). Add after the `recurrenceRule` mapping:

```typescript
  if (data.contentType !== undefined) updateData.contentType = data.contentType;
  if (data.contentStatus !== undefined) updateData.contentStatus = data.contentStatus;
  if (data.contentTitle !== undefined) updateData.contentTitle = data.contentTitle;
  if (data.contentDescription !== undefined) updateData.contentDescription = data.contentDescription;
  if (data.contentImageUrl !== undefined) updateData.contentImageUrl = data.contentImageUrl;
  if (data.contentBody !== undefined) updateData.contentBody = data.contentBody;
  if (data.contentFavicon !== undefined) updateData.contentFavicon = data.contentFavicon;
  if (data.contentDomain !== undefined) updateData.contentDomain = data.contentDomain;
  if (data.contentMetadata !== undefined) updateData.contentMetadata = data.contentMetadata;
```

- [ ] **Step 7: Extend itemToThingDetail for content fields**

In `apps/api/src/routes/things.ts`, update the `itemToThingDetail` function (around lines 74-84). Add content fields to the return:

```typescript
  return {
    ...thing,
    notes: item.notes ?? undefined,
    reminder: item.reminder ?? undefined,
    recurrence: item.recurrence ?? undefined,
    recurrenceRule: item.recurrenceRule ?? undefined,
    brettTakeGeneratedAt: item.brettTakeGeneratedAt?.toISOString(),
    // Content detail fields
    contentTitle: item.contentTitle ?? undefined,
    contentDescription: item.contentDescription ?? undefined,
    contentBody: item.contentBody ?? undefined,
    contentFavicon: item.contentFavicon ?? undefined,
    contentMetadata: item.contentMetadata ?? undefined,
    attachments,
    links,
    brettMessages,
  };
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test`

Expected: All tests PASS.

- [ ] **Step 9: Run full typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS (or only unrelated warnings).

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/ apps/api/src/routes/things.ts apps/api/src/__tests__/things.test.ts
git commit -m "feat: add content fields to schema, API create/update/detail"
```

---

### Task 4: URL Detection

**Files:**
- Create: `apps/api/src/lib/url-detector.ts`
- Create: `apps/api/src/__tests__/url-detector.test.ts`

- [ ] **Step 1: Write failing tests for URL detection**

Create `apps/api/src/__tests__/url-detector.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectUrl, detectContentType } from "../lib/url-detector.js";

describe("detectUrl", () => {
  // Definite URLs (has protocol)
  it("detects https:// URLs", () => {
    expect(detectUrl("https://medium.com/article")).toEqual({ isUrl: true, url: "https://medium.com/article" });
  });

  it("detects http:// URLs", () => {
    expect(detectUrl("http://example.com")).toEqual({ isUrl: true, url: "http://example.com" });
  });

  // Domain-like patterns (no protocol)
  it("detects youtube.com without protocol", () => {
    expect(detectUrl("youtube.com/watch?v=abc")).toEqual({ isUrl: true, url: "https://youtube.com/watch?v=abc" });
  });

  it("detects x.com/user/status/123", () => {
    expect(detectUrl("x.com/user/status/123")).toEqual({ isUrl: true, url: "https://x.com/user/status/123" });
  });

  it("detects lennysnewsletter.substack.com/p/some-post", () => {
    expect(detectUrl("lennysnewsletter.substack.com/p/some-post")).toEqual({
      isUrl: true, url: "https://lennysnewsletter.substack.com/p/some-post",
    });
  });

  it("detects somesite.com/article", () => {
    expect(detectUrl("somesite.com/article")).toEqual({ isUrl: true, url: "https://somesite.com/article" });
  });

  // Not URLs
  it("rejects plain text", () => {
    expect(detectUrl("buy groceries")).toEqual({ isUrl: false });
  });

  it("rejects text with spaces even with dot", () => {
    expect(detectUrl("fix the api.controller bug")).toEqual({ isUrl: false });
  });

  it("rejects version numbers", () => {
    expect(detectUrl("v2.0.1")).toEqual({ isUrl: false });
  });

  it("rejects file.pdf (no domain structure)", () => {
    expect(detectUrl("file.pdf")).toEqual({ isUrl: false });
  });

  it("rejects config.local", () => {
    expect(detectUrl("config.local")).toEqual({ isUrl: false });
  });

  it("rejects myapp.test", () => {
    expect(detectUrl("myapp.test")).toEqual({ isUrl: false });
  });
});

describe("detectContentType", () => {
  it("detects tweet from x.com/user/status/", () => {
    expect(detectContentType("https://x.com/user/status/123456")).toBe("tweet");
  });

  it("detects tweet from twitter.com", () => {
    expect(detectContentType("https://twitter.com/user/status/123456")).toBe("tweet");
  });

  it("detects article from x.com/user/article/", () => {
    expect(detectContentType("https://x.com/user/article/some-title")).toBe("article");
  });

  it("detects video from youtube.com", () => {
    expect(detectContentType("https://youtube.com/watch?v=abc")).toBe("video");
  });

  it("detects video from youtu.be", () => {
    expect(detectContentType("https://youtu.be/abc")).toBe("video");
  });

  it("detects podcast from spotify episode", () => {
    expect(detectContentType("https://open.spotify.com/episode/abc")).toBe("podcast");
  });

  it("detects podcast from apple podcasts", () => {
    expect(detectContentType("https://podcasts.apple.com/us/podcast/show/id123")).toBe("podcast");
  });

  it("detects pdf from .pdf extension", () => {
    expect(detectContentType("https://example.com/doc.pdf")).toBe("pdf");
  });

  it("detects article from medium.com", () => {
    expect(detectContentType("https://medium.com/some-article")).toBe("article");
  });

  it("detects article from substack", () => {
    expect(detectContentType("https://lennysnewsletter.substack.com/p/some-post")).toBe("article");
  });

  it("defaults to web_page for unknown URLs", () => {
    expect(detectContentType("https://example.com/page")).toBe("web_page");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test -- url-detector`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement URL detector**

Create `apps/api/src/lib/url-detector.ts`:

```typescript
import type { ContentType } from "@brett/types";

// Common TLDs — conservative list to avoid false positives
const VALID_TLDS = new Set([
  "com", "org", "net", "io", "co", "dev", "app", "me", "info", "edu", "gov",
  "biz", "us", "uk", "de", "fr", "jp", "au", "ca", "in", "br", "it", "nl",
  "es", "ch", "se", "no", "fi", "dk", "at", "be", "pl", "ru", "kr", "cn",
  "tw", "sg", "nz", "ie", "za", "mx", "ar", "cl", "pt", "cz", "hu", "il",
]);

export function detectUrl(input: string): { isUrl: true; url: string } | { isUrl: false } {
  const trimmed = input.trim();

  // Contains spaces → not a URL
  if (/\s/.test(trimmed)) return { isUrl: false };

  // Has protocol → definitely a URL
  if (/^https?:\/\//i.test(trimmed)) {
    return { isUrl: true, url: trimmed };
  }

  // No protocol — check if it looks like a domain
  // Must have at least one dot
  if (!trimmed.includes(".")) return { isUrl: false };

  // Extract the TLD: take the part after the last dot before any path
  const hostPart = trimmed.split("/")[0];
  const segments = hostPart.split(".");
  if (segments.length < 2) return { isUrl: false };

  const tld = segments[segments.length - 1].toLowerCase();

  // Check if TLD is valid
  if (!VALID_TLDS.has(tld)) return { isUrl: false };

  // Must have a non-empty domain name before the TLD
  const domainName = segments[segments.length - 2];
  if (!domainName || domainName.length === 0) return { isUrl: false };

  // Looks like a URL — prepend https://
  return { isUrl: true, url: `https://${trimmed}` };
}

// URL patterns for content type detection (order matters — more specific first)
const CONTENT_TYPE_PATTERNS: [RegExp, ContentType][] = [
  // Twitter/X
  [/^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/article\//i, "article"],
  [/^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\//i, "tweet"],
  // Video
  [/^https?:\/\/(www\.)?youtube\.com\/watch/i, "video"],
  [/^https?:\/\/(www\.)?youtu\.be\//i, "video"],
  // Podcast
  [/^https?:\/\/open\.spotify\.com\/episode\//i, "podcast"],
  [/^https?:\/\/podcasts\.apple\.com\/.+\/podcast\//i, "podcast"],
  // PDF
  [/\.pdf(\?.*)?$/i, "pdf"],
  // Known article domains
  [/^https?:\/\/(www\.)?medium\.com\//i, "article"],
  [/^https?:\/\/[^/]+\.substack\.com\//i, "article"],
];

export function detectContentType(url: string): ContentType {
  for (const [pattern, type] of CONTENT_TYPE_PATTERNS) {
    if (pattern.test(url)) return type;
  }
  return "web_page";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test -- url-detector`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/url-detector.ts apps/api/src/__tests__/url-detector.test.ts
git commit -m "feat: URL detection and content type pattern matching"
```

---

### Task 5: SSRF Guard & Content Extraction

**Files:**
- Create: `apps/api/src/lib/ssrf-guard.ts`
- Create: `apps/api/src/lib/content-extractor.ts`
- Create: `apps/api/src/__tests__/content-extractor.test.ts`

- [ ] **Step 1: Implement SSRF guard**

Create `apps/api/src/lib/ssrf-guard.ts`:

```typescript
import { lookup } from "node:dns/promises";

const PRIVATE_RANGES = [
  /^127\./,           // 127.0.0.0/8
  /^10\./,            // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,      // 192.168.0.0/16
  /^169\.254\./,      // 169.254.0.0/16
  /^0\./,             // 0.0.0.0/8
];

function isPrivateIP(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return PRIVATE_RANGES.some((re) => re.test(ip));
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxSizeBytes?: number;
  maxRedirects?: number;
}

/**
 * Fetch a URL with SSRF protections:
 * - Resolves DNS and rejects private IPs
 * - Pins resolved IP to prevent DNS rebinding
 * - Enforces timeout and response size limits
 * - Only allows http/https protocols
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const { timeoutMs = 10_000, maxSizeBytes = 5 * 1024 * 1024, maxRedirects = 5 } = options;

  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }

  // Resolve DNS, validate IP, and pin it to prevent DNS rebinding
  const { address } = await lookup(parsed.hostname);
  if (isPrivateIP(address)) {
    throw new Error(`Blocked private IP: ${address}`);
  }

  // Connect directly to the resolved IP with Host header set
  // This prevents DNS rebinding attacks where re-resolution returns a different IP
  const pinnedUrl = new URL(url);
  pinnedUrl.hostname = address;
  const hostHeader = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(pinnedUrl.href, {
      signal: controller.signal,
      redirect: "manual", // Handle redirects manually to re-check IPs
      headers: {
        Host: hostHeader,
        "User-Agent": "Brett/1.0 (+https://brett.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    // Handle redirects manually — re-validate each redirect target
    if (response.status >= 300 && response.status < 400 && maxRedirects > 0) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect with no Location header");
      const redirectUrl = new URL(location, url).href;
      return safeFetch(redirectUrl, { ...options, maxRedirects: maxRedirects - 1 });
    }

    // Check content length before reading body
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new Error(`Response too large: ${contentLength} bytes (max ${maxSizeBytes})`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Write failing tests for content extractor**

Create `apps/api/src/__tests__/content-extractor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractMetadata, parseOgTags } from "../lib/content-extractor.js";

describe("parseOgTags", () => {
  it("extracts og:title and og:description", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Test Title" />
        <meta property="og:description" content="Test Description" />
        <meta property="og:image" content="https://example.com/image.jpg" />
        <meta property="og:type" content="article" />
        <link rel="icon" href="/favicon.ico" />
      </head><body></body></html>
    `;
    const tags = parseOgTags(html, "https://example.com/page");
    expect(tags.title).toBe("Test Title");
    expect(tags.description).toBe("Test Description");
    expect(tags.imageUrl).toBe("https://example.com/image.jpg");
    expect(tags.ogType).toBe("article");
  });

  it("extracts favicon from link rel=icon", () => {
    const html = `<html><head><link rel="icon" href="/favicon.ico" /></head><body></body></html>`;
    const tags = parseOgTags(html, "https://example.com/page");
    expect(tags.favicon).toBe("https://example.com/favicon.ico");
  });

  it("extracts domain from URL", () => {
    const tags = parseOgTags("<html></html>", "https://sub.medium.com/article");
    expect(tags.domain).toBe("sub.medium.com");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test -- content-extractor`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement content extractor**

Create `apps/api/src/lib/content-extractor.ts`:

```typescript
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { safeFetch } from "./ssrf-guard.js";
import { detectContentType } from "./url-detector.js";
import { prisma } from "./prisma.js";
import { publishSSE } from "./sse.js";
import type { ContentType, ContentMetadata, ContentStatus } from "@brett/types";

export interface OgTags {
  title?: string;
  description?: string;
  imageUrl?: string;
  favicon?: string;
  domain: string;
  ogType?: string;
}

export function parseOgTags(html: string, url: string): OgTags {
  const parsed = new URL(url);
  const domain = parsed.hostname;

  // Simple regex-based OG tag extraction (avoids full DOM parse for metadata)
  const getMetaContent = (property: string): string | undefined => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, "i");
    const altRe = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, "i");
    return re.exec(html)?.[1] ?? altRe.exec(html)?.[1];
  };

  // Favicon extraction
  const faviconRe = /<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']*)["']/i;
  const altFaviconRe = /<link[^>]+href=["']([^"']*)["'][^>]+rel=["'](?:icon|shortcut icon)["']/i;
  const faviconHref = faviconRe.exec(html)?.[1] ?? altFaviconRe.exec(html)?.[1];
  const favicon = faviconHref
    ? faviconHref.startsWith("http") ? faviconHref : new URL(faviconHref, url).href
    : `${parsed.origin}/favicon.ico`;

  return {
    title: getMetaContent("og:title") ?? getMetaContent("twitter:title"),
    description: getMetaContent("og:description") ?? getMetaContent("twitter:description") ?? getMetaContent("description"),
    imageUrl: getMetaContent("og:image") ?? getMetaContent("twitter:image"),
    favicon,
    domain,
    ogType: getMetaContent("og:type"),
  };
}

function extractArticle(html: string, url: string): { content: string; wordCount: number } | null {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article?.textContent) return null;

  // Convert to a simplified markdown-ish format
  // Readability returns HTML in article.content — we store the text content for now
  // and can enhance to proper markdown later
  const content = article.content;
  const wordCount = article.textContent.split(/\s+/).length;

  return { content, wordCount };
}

async function fetchOEmbed(
  providerUrl: string,
  contentUrl: string
): Promise<Record<string, unknown> | null> {
  try {
    const oembedUrl = `${providerUrl}?url=${encodeURIComponent(contentUrl)}&format=json`;
    const res = await safeFetch(oembedUrl, { timeoutMs: 5000, maxSizeBytes: 100_000 });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildSpotifyEmbedUrl(url: string): string | null {
  // https://open.spotify.com/episode/abc → https://open.spotify.com/embed/episode/abc
  const match = url.match(/open\.spotify\.com\/(episode\/[^?#]+)/);
  return match ? `https://open.spotify.com/embed/${match[1]}` : null;
}

function buildApplePodcastEmbedUrl(url: string): string | null {
  // https://podcasts.apple.com/us/podcast/show/id123 → https://embed.podcasts.apple.com/us/podcast/show/id123
  const match = url.match(/podcasts\.apple\.com(\/[^?#]+)/);
  return match ? `https://embed.podcasts.apple.com${match[1]}` : null;
}

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([^&#]+)/,
    /youtu\.be\/([^?&#]+)/,
  ];
  for (const re of patterns) {
    const match = url.match(re);
    if (match) return match[1];
  }
  return null;
}

interface ExtractionResult {
  contentType: ContentType;
  contentStatus: ContentStatus;
  contentTitle: string | null;
  contentDescription: string | null;
  contentImageUrl: string | null;
  contentBody: string | null;
  contentFavicon: string | null;
  contentDomain: string;
  contentMetadata: ContentMetadata;
  title?: string; // Updated title from OG tags
}

export async function extractContent(url: string): Promise<ExtractionResult> {
  const contentType = detectContentType(url);

  // For PDFs from URLs, download and store via attachment system
  // (drag-dropped PDFs are handled separately in the frontend)
  if (contentType === "pdf") {
    const parsed = new URL(url);
    return {
      contentType: "pdf",
      contentStatus: "extracted",
      contentTitle: null,
      contentDescription: null,
      contentImageUrl: null,
      contentBody: null,
      contentFavicon: `${parsed.origin}/favicon.ico`,
      contentDomain: parsed.hostname,
      contentMetadata: { type: "pdf" },
      // Note: PDF download + S3 upload happens in runExtraction after this returns
      // using safeFetch with 60s timeout and 50MB limit
      _needsPdfDownload: true,
    } as ExtractionResult & { _needsPdfDownload?: boolean };
  }

  // Fetch the page
  const response = await safeFetch(url, {
    timeoutMs: 10_000,
    maxSizeBytes: 5 * 1024 * 1024,
  });

  // Check if response is actually a PDF by content-type
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("application/pdf")) {
    const parsed = new URL(url);
    return {
      contentType: "pdf",
      contentStatus: "extracted",
      contentTitle: null,
      contentDescription: null,
      contentImageUrl: null,
      contentBody: null,
      contentFavicon: `${parsed.origin}/favicon.ico`,
      contentDomain: parsed.hostname,
      contentMetadata: { type: "pdf" },
    };
  }

  const html = await response.text();
  const ogTags = parseOgTags(html, url);

  const base: Omit<ExtractionResult, "contentType" | "contentMetadata" | "contentBody"> = {
    contentStatus: "extracted",
    contentTitle: ogTags.title ?? null,
    contentDescription: ogTags.description ?? null,
    contentImageUrl: ogTags.imageUrl ?? null,
    contentFavicon: ogTags.favicon ?? null,
    contentDomain: ogTags.domain,
    title: ogTags.title,
  };

  switch (contentType) {
    case "tweet": {
      const oembed = await fetchOEmbed("https://publish.twitter.com/oembed", url);
      return {
        ...base,
        contentType: "tweet",
        contentBody: null,
        contentMetadata: {
          type: "tweet",
          embedHtml: oembed?.html as string | undefined,
          author: oembed?.author_name as string | undefined,
          tweetText: ogTags.description ?? undefined,
        },
      };
    }

    case "video": {
      const videoId = extractYouTubeVideoId(url);
      const embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : undefined;
      const oembed = await fetchOEmbed("https://www.youtube.com/oembed", url);
      return {
        ...base,
        contentType: "video",
        contentBody: null,
        contentMetadata: {
          type: "video",
          embedUrl: embedUrl ?? url,
          channel: oembed?.author_name as string | undefined,
        },
      };
    }

    case "podcast": {
      const spotifyEmbed = buildSpotifyEmbedUrl(url);
      const appleEmbed = buildApplePodcastEmbedUrl(url);
      const embedUrl = spotifyEmbed ?? appleEmbed ?? url;
      const provider = spotifyEmbed ? "spotify" as const : "apple" as const;
      return {
        ...base,
        contentType: "podcast",
        contentBody: null,
        contentMetadata: {
          type: "podcast",
          embedUrl,
          provider,
          episodeName: ogTags.title ?? undefined,
        },
      };
    }

    case "article": {
      const article = extractArticle(html, url);
      const body = article?.content ?? null;
      // Truncate at 500KB
      const truncatedBody = body && body.length > 500_000 ? body.slice(0, 500_000) : body;
      return {
        ...base,
        contentType: "article",
        contentBody: truncatedBody,
        contentMetadata: {
          type: "article",
          wordCount: article?.wordCount,
        },
      };
    }

    default: {
      // web_page — try article extraction as well, in case OG type is article
      let articleBody: string | null = null;
      let effectiveType: ContentType = "web_page";

      if (ogTags.ogType === "article") {
        const article = extractArticle(html, url);
        if (article) {
          articleBody = article.content.length > 500_000
            ? article.content.slice(0, 500_000)
            : article.content;
          effectiveType = "article";
        }
      }

      return {
        ...base,
        contentType: effectiveType,
        contentBody: articleBody,
        contentMetadata: effectiveType === "article"
          ? { type: "article" }
          : { type: "web_page" },
      };
    }
  }
}

/**
 * Fire-and-forget content extraction.
 * Called after creating a content item. Updates the item in DB and publishes SSE.
 */
export async function runExtraction(itemId: string, url: string, userId: string): Promise<void> {
  try {
    const result = await extractContent(url) as ExtractionResult & { _needsPdfDownload?: boolean };

    // For URL-based PDFs, download the file and store as attachment
    if (result._needsPdfDownload) {
      try {
        const pdfResponse = await safeFetch(url, { timeoutMs: 60_000, maxSizeBytes: 50 * 1024 * 1024 });
        const buffer = Buffer.from(await pdfResponse.arrayBuffer());
        const filename = new URL(url).pathname.split("/").pop() || "document.pdf";
        // Upload to S3 via the storage module (same as attachment system)
        const { uploadToStorage } = await import("./storage.js");
        const storageKey = `attachments/${userId}/${itemId}/${crypto.randomUUID()}-${filename}`;
        await uploadToStorage(storageKey, buffer, "application/pdf");
        await prisma.attachment.create({
          data: { itemId, userId, filename, mimeType: "application/pdf", sizeBytes: buffer.length, storageKey },
        });
      } catch (pdfErr) {
        console.error(`[content-extractor] PDF download failed for ${url}:`, pdfErr);
        // Continue with extraction — PDF preview will fall back to external URL
      }
    }

    const updateData: Record<string, unknown> = {
      contentType: result.contentType,
      contentStatus: result.contentStatus,
      contentTitle: result.contentTitle,
      contentDescription: result.contentDescription,
      contentImageUrl: result.contentImageUrl,
      contentBody: result.contentBody,
      contentFavicon: result.contentFavicon,
      contentDomain: result.contentDomain,
      contentMetadata: result.contentMetadata,
      source: result.contentDomain,
    };

    // Update title from OG tags only if the current title is the URL (user hasn't renamed it)
    if (result.title) {
      const current = await prisma.item.findUnique({ where: { id: itemId }, select: { title: true, sourceUrl: true } });
      if (current && current.title === current.sourceUrl) {
        updateData.title = result.title;
      }
    }

    await prisma.item.update({
      where: { id: itemId },
      data: updateData,
    });

    publishSSE(userId, {
      type: "content.extracted",
      payload: { itemId, contentStatus: "extracted" },
    });
  } catch (error) {
    console.error(`[content-extractor] Failed to extract ${url}:`, error);

    // Check if this was a DNS/connection failure — auto-convert to task
    const isDnsOrConnectionError = error instanceof Error &&
      (error.message.includes("ENOTFOUND") || error.message.includes("Blocked") ||
       error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));

    if (isDnsOrConnectionError) {
      // URL is not reachable — convert to task
      await prisma.item.update({
        where: { id: itemId },
        data: { type: "task", contentStatus: null, contentType: null, source: "Brett" },
      });
      publishSSE(userId, {
        type: "content.extracted",
        payload: { itemId, contentStatus: "converted_to_task" },
      });
    } else {
      await prisma.item.update({
        where: { id: itemId },
        data: { contentStatus: "failed" },
      });
      publishSSE(userId, {
        type: "content.extracted",
        payload: { itemId, contentStatus: "failed" },
      });
    }
  }
}
```

- [ ] **Step 5: Install dependencies**

Run: `cd /Users/brentbarkman/code/brett/apps/api && pnpm add @mozilla/readability jsdom && pnpm add -D @types/jsdom`

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test -- content-extractor`

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/ssrf-guard.ts apps/api/src/lib/content-extractor.ts apps/api/src/__tests__/content-extractor.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat: content extraction pipeline with SSRF guard"
```

---

### Task 6: Extract Endpoint & Trigger on Create

**Files:**
- Create: `apps/api/src/routes/extract.ts`
- Create: `apps/api/src/__tests__/extract.test.ts`
- Modify: `apps/api/src/routes/things.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write failing tests for extract endpoint**

Create `apps/api/src/__tests__/extract.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Extract endpoint", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Extract User");
    token = user.token;
  });

  it("POST /things/:id/extract returns 400 for non-content items", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "A task" }),
    });
    const task = (await createRes.json()) as any;

    const res = await authRequest(`/things/${task.id}/extract`, token, {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/extract returns 400 for already extracted items", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://example.com",
        sourceUrl: "https://example.com",
      }),
    });
    const item = (await createRes.json()) as any;

    // Mark as extracted
    await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ contentStatus: "extracted" }),
    });

    const res = await authRequest(`/things/${item.id}/extract`, token, {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/extract accepts failed items for retry", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://example.com/retry",
        sourceUrl: "https://example.com/retry",
      }),
    });
    const item = (await createRes.json()) as any;

    // Mark as failed
    await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ contentStatus: "failed" }),
    });

    const res = await authRequest(`/things/${item.id}/extract`, token, {
      method: "POST",
    });
    // Should accept (202) — extraction runs async
    expect(res.status).toBe(202);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test -- extract`

Expected: FAIL — route not found.

- [ ] **Step 3: Implement extract endpoint**

Create `apps/api/src/routes/extract.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { runExtraction } from "../lib/content-extractor.js";

const extract = new Hono<AuthEnv>();

// POST /things/:id/extract — trigger or retry content extraction
extract.post("/:id/extract", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const item = await prisma.item.findFirst({
    where: { id, userId: user.id },
    select: { id: true, type: true, sourceUrl: true, contentStatus: true, userId: true },
  });

  if (!item) return c.json({ error: "Not found" }, 404);
  if (item.type !== "content") return c.json({ error: "Not a content item" }, 400);
  if (!item.sourceUrl) return c.json({ error: "No source URL" }, 400);
  if (item.contentStatus === "extracted") return c.json({ error: "Already extracted" }, 400);

  // Atomic update to prevent race conditions
  // Include "pending" for stuck items (e.g., server crashed during extraction)
  const result = await prisma.item.updateMany({
    where: { id: item.id, contentStatus: { in: ["failed", "pending", null] } },
    data: { contentStatus: "pending" },
  });

  if (result.count === 0) {
    return c.json({ error: "Extraction already in progress or already extracted" }, 409);
  }

  // Fire-and-forget
  runExtraction(item.id, item.sourceUrl, item.userId).catch((err) =>
    console.error(`[extract] Background extraction failed for ${item.id}:`, err)
  );

  return c.json({ status: "pending" }, 202);
});

export default extract;
```

- [ ] **Step 4: Mount extract routes in app.ts**

In `apps/api/src/app.ts`, add the import and route mount. Find where other routes are mounted (look for `app.route`) and add:

```typescript
import extract from "./routes/extract.js";
// ...
app.route("/things", extract);
```

Note: This mounts on `/things` so the full path is `/things/:id/extract`.

- [ ] **Step 5: Trigger extraction on content creation**

In `apps/api/src/routes/things.ts`, update the POST handler. After `return c.json(itemToThing(item), 201);` (line 246), add extraction trigger. Restructure to:

```typescript
    const thing = itemToThing(item);

    // Fire-and-forget extraction for content items
    if (data.type === "content" && data.sourceUrl) {
      import("../lib/content-extractor.js").then(({ runExtraction }) =>
        runExtraction(item.id, data.sourceUrl!, user.id).catch((err) =>
          console.error(`[things] Background extraction failed for ${item.id}:`, err)
        )
      );
    }

    return c.json(thing, 201);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test -- extract`

Expected: All tests PASS.

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/brentbarkman/code/brett && pnpm --filter @brett/api test`

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/extract.ts apps/api/src/__tests__/extract.test.ts apps/api/src/routes/things.ts apps/api/src/app.ts
git commit -m "feat: extract endpoint with retry, trigger extraction on content create"
```

---

### Task 7: Quick-Add URL Detection (Frontend)

**Files:**
- Modify: `packages/business/src/index.ts` (add `detectUrl` export — shared between server and client)
- Modify: `packages/ui/src/QuickAddInput.tsx`
- Modify: `apps/desktop/src/api/things.ts`
- Modify: `apps/api/src/lib/url-detector.ts` (import `detectUrl` from `@brett/business` instead of duplicating)

**Important: DRY.** The URL detection logic (`detectUrl`) must live in `packages/business` so it's shared between the API server (Task 4's `url-detector.ts`) and the frontend (`QuickAddInput`). Move the `detectUrl` function and TLD list from `apps/api/src/lib/url-detector.ts` to `packages/business/src/index.ts`, then import it in both places. `detectContentType` stays in `apps/api/src/lib/url-detector.ts` since it's server-only.

- [ ] **Step 1: Move detectUrl to business package**

In `packages/business/src/index.ts`, add the `detectUrl` function and `VALID_TLDS` set (from Task 4). Export it.

Then in `apps/api/src/lib/url-detector.ts`, replace the local `detectUrl` and `VALID_TLDS` with:

```typescript
export { detectUrl } from "@brett/business";
```

- [ ] **Step 2: Update QuickAddInput to use shared detectUrl**

Update `packages/ui/src/QuickAddInput.tsx`:

```typescript
import React, { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { Plus, Link } from "lucide-react";
import { detectUrl } from "@brett/business";

export interface QuickAddInputHandle {
  focus: () => void;
}

interface QuickAddInputProps {
  placeholder?: string;
  onAdd: (title: string) => void;
  onAddContent?: (url: string) => void;
  onFocusChange?: (focused: boolean) => void;
}
```

Update `handleSubmit`:

```typescript
    const handleSubmit = () => {
      if (!value.trim()) return;
      const detected = looksLikeUrl(value.trim());
      if (detected.isUrl && onAddContent) {
        onAddContent(detected.url);
      } else {
        onAdd(value.trim());
      }
      setValue("");
      inputRef.current?.focus();
    };
```

Add a URL indicator icon when input looks like a URL. In the JSX, replace the Plus icon:

```typescript
    const isUrlLike = value.trim() && !value.trim().includes(" ") && looksLikeUrl(value.trim()).isUrl;

    // In the JSX:
    {isUrlLike ? (
      <Link size={15} className="text-amber-400" />
    ) : (
      <Plus size={15} className={isFocused ? "text-blue-400" : "text-white/20"} />
    )}
```

- [ ] **Step 2: Wire up onAddContent in the parent component**

Find where `QuickAddInput` is used in the desktop app and wire up `onAddContent`. This will use `useCreateThing` with `type: "content"` and `sourceUrl`.

In the parent component (wherever `QuickAddInput` is rendered), add:

```typescript
const createThing = useCreateThing();

const handleAddContent = (url: string) => {
  createThing.mutate({
    type: "content",
    title: url,
    sourceUrl: url,
  });
};

// Pass to QuickAddInput:
<QuickAddInput
  onAdd={handleAddTask}
  onAddContent={handleAddContent}
/>
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/QuickAddInput.tsx apps/desktop/src/
git commit -m "feat: quick-add URL detection with amber link indicator"
```

---

### Task 8: SSE Handler for Content Extraction

**Files:**
- Modify: `apps/desktop/src/api/sse.ts`

- [ ] **Step 1: Add content.extracted SSE handler**

In `apps/desktop/src/api/sse.ts`, add after the calendar event listeners (around line 93, before the closing `}, [qc]`):

```typescript
    // Content extraction events
    es.addEventListener("content.extracted", (e: MessageEvent) => {
      let data: { itemId?: string; contentStatus?: string } | undefined;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      // Invalidate the specific thing detail + things list
      if (data?.itemId) {
        qc.invalidateQueries({ queryKey: ["thing-detail", data.itemId] });
      }
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
    });
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/api/sse.ts
git commit -m "feat: SSE handler for content extraction events"
```

---

### Task 9: Content Preview Component

**Files:**
- Create: `packages/ui/src/ContentPreview.tsx`

- [ ] **Step 1: Create ContentPreview component**

Create `packages/ui/src/ContentPreview.tsx`:

```typescript
import React, { useMemo } from "react";
import { ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import DOMPurify from "dompurify";
import type { ContentType, ContentStatus, ContentMetadata } from "@brett/types";

// Sanitize HTML from Readability extraction to prevent XSS in Electron
function ArticleBody({ html }: { html: string }) {
  const sanitized = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "img", "ul", "ol", "li",
      "blockquote", "pre", "code", "em", "strong", "br", "hr", "figure", "figcaption"],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
    ALLOW_DATA_ATTR: false,
  }), [html]);
  return (
    <div
      className="prose prose-invert prose-sm max-w-none max-h-[50vh] overflow-y-auto
        text-white/70 prose-headings:text-white/90 prose-a:text-blue-400
        scrollbar-thin scrollbar-thumb-white/10"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

interface ContentPreviewProps {
  contentType?: ContentType;
  contentStatus?: ContentStatus;
  sourceUrl?: string;
  contentTitle?: string;
  contentDescription?: string;
  contentImageUrl?: string;
  contentBody?: string;
  contentFavicon?: string;
  contentDomain?: string;
  contentMetadata?: ContentMetadata;
  onRetry?: () => void;
}

function LoadingSkeleton({ type }: { type?: ContentType }) {
  if (type === "video") {
    return (
      <div className="w-full aspect-video bg-white/5 rounded-lg animate-pulse flex items-center justify-center">
        <span className="text-white/20 text-xs">Extracting content...</span>
      </div>
    );
  }
  return (
    <div className="space-y-2 p-3 bg-white/5 rounded-lg animate-pulse">
      <div className="h-3 w-3/4 bg-white/10 rounded" />
      <div className="h-3 w-1/2 bg-white/10 rounded" />
      <div className="h-3 w-2/3 bg-white/10 rounded" />
      <span className="text-white/20 text-[10px]">Extracting content...</span>
    </div>
  );
}

function ErrorCard({ sourceUrl, onRetry }: { sourceUrl?: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
      <AlertCircle size={16} className="text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/60">Couldn't load preview</p>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline truncate block">
            {sourceUrl}
          </a>
        )}
      </div>
      {onRetry && (
        <button onClick={onRetry}
          className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1">
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

function TweetPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  if (metadata?.type === "tweet" && metadata.embedHtml) {
    return (
      <div className="rounded-lg overflow-hidden bg-white/5">
        <iframe
          srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;background:transparent;}</style></head><body>${metadata.embedHtml}</body></html>`}
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="w-full min-h-[200px] border-0"
          title="Tweet embed"
        />
      </div>
    );
  }
  // Fallback
  const author = metadata?.type === "tweet" ? metadata.author : undefined;
  const text = metadata?.type === "tweet" ? metadata.tweetText : undefined;
  return (
    <div className="p-3 bg-white/5 rounded-lg border border-white/10">
      {author && <p className="text-xs text-white/40 mb-1">@{author}</p>}
      {text && <p className="text-sm text-white/70">{text}</p>}
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:underline mt-2 inline-flex items-center gap-1">
          View on X <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

function VideoPreview({ metadata }: { metadata?: ContentMetadata }) {
  const embedUrl = metadata?.type === "video" ? metadata.embedUrl : undefined;
  if (!embedUrl) return null;
  return (
    <div className="w-full aspect-video rounded-lg overflow-hidden bg-black">
      <iframe
        src={embedUrl}
        sandbox="allow-scripts allow-same-origin allow-popups"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full border-0"
        title="Video embed"
      />
    </div>
  );
}

function PodcastPreview({ metadata, sourceUrl }: { metadata?: ContentMetadata; sourceUrl?: string }) {
  const embedUrl = metadata?.type === "podcast" ? metadata.embedUrl : undefined;
  if (!embedUrl) {
    return (
      <div className="p-3 bg-white/5 rounded-lg">
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
          className="text-sm text-blue-400 hover:underline flex items-center gap-1">
          Open in podcast app <ExternalLink size={12} />
        </a>
      </div>
    );
  }
  const isSpotify = embedUrl.includes("spotify.com");
  return (
    <div className="rounded-lg overflow-hidden">
      <iframe
        src={embedUrl}
        sandbox="allow-scripts allow-same-origin allow-popups"
        className={`w-full border-0 ${isSpotify ? "h-[152px]" : "h-[175px]"}`}
        allow="autoplay; clipboard-write; encrypted-media"
        title="Podcast embed"
      />
    </div>
  );
}

function ArticlePreview({ contentBody, contentFavicon, contentDomain, sourceUrl }: {
  contentBody?: string;
  contentFavicon?: string;
  contentDomain?: string;
  sourceUrl?: string;
}) {
  return (
    <div className="space-y-2">
      {/* Source bar */}
      <div className="flex items-center gap-2 text-xs text-white/40">
        {contentFavicon && (
          <img src={contentFavicon} alt="" className="w-3.5 h-3.5 rounded-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        {contentDomain && <span>{contentDomain}</span>}
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto text-blue-400 hover:underline flex items-center gap-1">
            Open original <ExternalLink size={10} />
          </a>
        )}
      </div>
      {/* Article body — sanitized to prevent XSS in Electron renderer */}
      {contentBody && (
        <ArticleBody html={contentBody} />
      )}
    </div>
  );
}

function WebPagePreview({ contentImageUrl, contentTitle, contentDescription, contentFavicon, contentDomain, sourceUrl }: {
  contentImageUrl?: string;
  contentTitle?: string;
  contentDescription?: string;
  contentFavicon?: string;
  contentDomain?: string;
  sourceUrl?: string;
}) {
  return (
    <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
      className="block p-3 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 transition-colors group">
      {contentImageUrl && (
        <img src={contentImageUrl} alt="" className="w-full h-32 object-cover rounded-md mb-2"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      )}
      <div className="flex items-start gap-2">
        {contentFavicon && (
          <img src={contentFavicon} alt="" className="w-4 h-4 rounded-sm mt-0.5 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="min-w-0">
          {contentTitle && <p className="text-sm text-white/80 font-medium truncate">{contentTitle}</p>}
          {contentDescription && <p className="text-xs text-white/50 line-clamp-2 mt-0.5">{contentDescription}</p>}
          {contentDomain && (
            <p className="text-[10px] text-white/30 mt-1 flex items-center gap-1">
              {contentDomain}
              <ExternalLink size={8} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

function PdfPreview({ sourceUrl, attachmentUrl }: { sourceUrl?: string; attachmentUrl?: string }) {
  const pdfUrl = attachmentUrl ?? sourceUrl;
  if (!pdfUrl) return null;
  return (
    <div className="w-full h-[50vh] rounded-lg overflow-hidden bg-white/5">
      <iframe
        src={pdfUrl}
        className="w-full h-full border-0"
        title="PDF viewer"
      />
    </div>
  );
}

export function ContentPreview(props: ContentPreviewProps) {
  const { contentType, contentStatus, sourceUrl, onRetry, contentMetadata } = props;

  if (contentStatus === "pending") {
    return <LoadingSkeleton type={contentType} />;
  }

  if (contentStatus === "failed") {
    return <ErrorCard sourceUrl={sourceUrl} onRetry={onRetry} />;
  }

  if (contentStatus !== "extracted") return null;

  switch (contentType) {
    case "tweet":
      return <TweetPreview metadata={contentMetadata} sourceUrl={sourceUrl} />;
    case "video":
      return <VideoPreview metadata={contentMetadata} />;
    case "podcast":
      return <PodcastPreview metadata={contentMetadata} sourceUrl={sourceUrl} />;
    case "article":
      return <ArticlePreview {...props} />;
    case "pdf":
      return <PdfPreview sourceUrl={sourceUrl} />;
    case "web_page":
    default:
      return <WebPagePreview {...props} />;
  }
}
```

- [ ] **Step 2: Install DOMPurify**

Run: `cd /Users/brentbarkman/code/brett/packages/ui && pnpm add dompurify && pnpm add -D @types/dompurify`

- [ ] **Step 3: Export from UI package**

Add to `packages/ui/src/index.ts`:

```typescript
export { ContentPreview } from "./ContentPreview";
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ContentPreview.tsx packages/ui/src/index.ts packages/ui/package.json
git commit -m "feat: ContentPreview component with type-specific renderers"
```

---

### Task 10: Content Detail Panel

**Files:**
- Create: `packages/ui/src/ContentDetailPanel.tsx`
- Modify: `packages/ui/src/DetailPanel.tsx`

- [ ] **Step 1: Create ContentDetailPanel**

Create `packages/ui/src/ContentDetailPanel.tsx`. This is a variant of `TaskDetailPanel` with the content preview section inserted between schedule row and Brett's Take. Follow the exact same structure as `TaskDetailPanel.tsx` (lines 51-261) but:

1. Add `ContentPreview` between the `ScheduleRow` and Brett's Take section
2. Pass content fields from `ThingDetail` to `ContentPreview`
3. Add `onRetryExtraction` prop for the retry button

The component should accept all the same props as `TaskDetailPanel` plus:
- `onRetryExtraction?: () => void`

Key structural difference from `TaskDetailPanel`:

```tsx
{/* After ScheduleRow, before Brett's Take */}
{detail && detail.contentType && (
  <ContentPreview
    contentType={detail.contentType}
    contentStatus={detail.contentStatus}
    sourceUrl={item.sourceUrl}
    contentTitle={detail.contentTitle}
    contentDescription={detail.contentDescription}
    contentImageUrl={detail.contentImageUrl}
    contentBody={detail.contentBody}
    contentFavicon={detail.contentFavicon}
    contentDomain={detail.contentDomain}
    contentMetadata={detail.contentMetadata}
    onRetry={onRetryExtraction}
  />
)}
```

- [ ] **Step 2: Update DetailPanel to route content items**

In `packages/ui/src/DetailPanel.tsx`, update the routing logic. Currently it checks if item is a calendar event vs task. Add content routing:

```typescript
import { ContentDetailPanel } from "./ContentDetailPanel";

// In the render logic, check item type:
if (item && "type" in item && (item as Thing).type === "content") {
  return <ContentDetailPanel /* ...same props as TaskDetailPanel, plus onRetryExtraction */ />;
}
```

- [ ] **Step 3: Export ContentDetailPanel from UI package**

Add to `packages/ui/src/index.ts`:

```typescript
export { ContentDetailPanel } from "./ContentDetailPanel";
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ContentDetailPanel.tsx packages/ui/src/DetailPanel.tsx packages/ui/src/index.ts
git commit -m "feat: ContentDetailPanel with inline preview section"
```

---

### Task 11: Content Type Icons in List Views

**Files:**
- Modify the list item component (wherever `Thing` items are rendered in list views)

- [ ] **Step 1: Add content type icon mapping**

Create a helper or add to the list item component:

```typescript
import { Twitter, FileText, Play, File, Headphones, Globe } from "lucide-react";

function ContentTypeIcon({ contentType }: { contentType?: string }) {
  const iconProps = { size: 14, className: "text-amber-400" };
  switch (contentType) {
    case "tweet": return <Twitter {...iconProps} />;
    case "article": return <FileText {...iconProps} />;
    case "video": return <Play {...iconProps} />;
    case "pdf": return <File {...iconProps} />;
    case "podcast": return <Headphones {...iconProps} />;
    case "web_page": default: return <Globe {...iconProps} />;
  }
}
```

- [ ] **Step 2: Use content type icon in list items**

Where task items render a checkbox, add a conditional:

```tsx
{item.type === "content" ? (
  <button onClick={() => onToggle(item.id)} className="p-1 hover:opacity-80">
    <ContentTypeIcon contentType={item.contentType} />
  </button>
) : (
  /* existing checkbox */
)}
```

- [ ] **Step 3: Add domain subtitle for content items**

Where task items show the due date label, add content subtitle:

```tsx
{item.type === "content" && item.contentDomain && (
  <span className="text-xs text-white/40">{item.contentDomain}</span>
)}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/
git commit -m "feat: content type icons and domain subtitle in list views"
```

---

### Task 12: Type Filter Toggle

**Files:**
- Modify list view header components

- [ ] **Step 1: Add filter pills to list headers**

Add a simple toggle with three options:

```tsx
function TypeFilter({ value, onChange }: { value: FilterType; onChange: (v: FilterType) => void }) {
  const options: FilterType[] = ["All", "Tasks", "Content"];
  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            value === opt
              ? "bg-white/10 text-white/80"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
```

`FilterType` is already defined in `packages/types/src/index.ts` (line 199).

- [ ] **Step 2: Wire filter to API query**

The existing `GET /things` endpoint already supports `?type=content` and `?type=task` filters. Pass the selected filter:

```typescript
const typeFilter = filter === "Tasks" ? "task" : filter === "Content" ? "content" : undefined;
const things = useThings({ type: typeFilter, ...otherFilters });
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ apps/desktop/src/
git commit -m "feat: type filter toggle (All/Tasks/Content) in list headers"
```

---

### Task 13: App-Level PDF Drag & Drop

**Files:**
- Create: `packages/ui/src/AppDropZone.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Create AppDropZone component**

Create `packages/ui/src/AppDropZone.tsx`:

```typescript
import React, { useState, useCallback } from "react";
import { FileText } from "lucide-react";

interface AppDropZoneProps {
  children: React.ReactNode;
  onDropPdf: (file: File) => void;
}

function cleanFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AppDropZone({ children, onDropPdf }: AppDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items);
    const hasPdf = items.some(
      (item) => item.kind === "file" && (item.type === "application/pdf" || item.type === "")
    );
    if (hasPdf) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const pdfFiles = files.filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"));

    for (const file of pdfFiles) {
      onDropPdf(file);
    }
  }, [onDropPdf]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-full h-full"
    >
      {children}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center
          border-2 border-dashed border-amber-400/40 rounded-xl m-2 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <FileText size={32} className="text-amber-400" />
            <p className="text-white/80 text-sm font-medium">Drop PDF to save</p>
          </div>
        </div>
      )}
    </div>
  );
}

export { cleanFilename };
```

- [ ] **Step 2: Export from UI package**

Add to `packages/ui/src/index.ts`:

```typescript
export { AppDropZone, cleanFilename } from "./AppDropZone";
```

- [ ] **Step 3: Wire up in App.tsx**

In `apps/desktop/src/App.tsx`, wrap the main layout with `AppDropZone`:

```typescript
import { AppDropZone, cleanFilename } from "@brett/ui";

// In the component:
const createThing = useCreateThing();
const uploadAttachment = useUploadAttachment();

const handleDropPdf = useCallback(async (file: File) => {
  const title = cleanFilename(file.name);
  const result = await createThing.mutateAsync({
    type: "content",
    title,
    contentType: "pdf",
  });
  // Upload the PDF as an attachment
  uploadAttachment.mutate({ itemId: result.id, file });
}, [createThing, uploadAttachment]);

// Wrap the layout:
<AppDropZone onDropPdf={handleDropPdf}>
  {/* existing layout */}
</AppDropZone>
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/AppDropZone.tsx packages/ui/src/index.ts apps/desktop/src/App.tsx
git commit -m "feat: app-level PDF drag-and-drop zone"
```

---

### Task 14: Full Typecheck & Integration Test

**Files:** None new — verification only.

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`

Expected: PASS with no errors.

- [ ] **Step 2: Run all tests**

Run: `cd /Users/brentbarkman/code/brett && pnpm test`

Expected: All tests PASS.

- [ ] **Step 3: Run lint**

Run: `cd /Users/brentbarkman/code/brett && pnpm lint`

Expected: PASS (or only pre-existing warnings).

- [ ] **Step 4: Manual smoke test**

Start the dev environment:

```bash
cd /Users/brentbarkman/code/brett && pnpm dev:full
```

Test:
1. Paste a YouTube URL into quick-add → should create content item with pending status, then update with video embed
2. Paste a Medium/Substack article URL → should extract and show reader view
3. Paste a tweet URL → should show tweet embed
4. Drag a PDF onto the app → should create content item with PDF viewer
5. Open content detail panel → should show schedule row, content preview, notes, Brett thread
6. Toggle filter to "Content" → should show only content items
7. Mark content as complete → should move to done state

- [ ] **Step 5: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix: integration fixes from smoke testing"
```
