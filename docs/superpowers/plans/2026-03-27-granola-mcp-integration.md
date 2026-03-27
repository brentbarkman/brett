# Granola MCP Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Granola meeting notes into Brett via the official MCP server, auto-creating action items and enabling meeting-aware chat.

**Architecture:** Brett's API server acts as an MCP client to Granola's official MCP server (`https://mcp.granola.ai/mcp`) via Streamable HTTP. Meeting notes are synced into local DB, matched to Google Calendar events, and action items are auto-created as inbox tasks. Three new AI skills enable chat queries about meetings.

**Tech Stack:** Hono API routes, Prisma (Postgres), `@modelcontextprotocol/sdk` for MCP client, AES-256-GCM token encryption, SSE for real-time updates, React Query hooks, shadcn/ui components.

**Spec:** `docs/superpowers/specs/2026-03-27-granola-mcp-integration-design.md`

---

## File Structure

### New Files

```
apps/api/src/
  lib/granola-mcp.ts              — MCP client wrapper (Streamable HTTP, per-user OAuth tokens)
  routes/granola-auth.ts          — OAuth connect/callback/status/disconnect routes
  services/granola-sync.ts        — Sync service (polling, matching, action item extraction)
  services/meeting-matcher.ts     — Meeting-to-CalendarEvent matching algorithm

packages/ai/src/
  skills/query-meeting-notes.ts   — Chat skill: search meeting content
  skills/get-meeting-action-items.ts — Chat skill: on-demand action item extraction
  skills/analyze-meeting-pattern.ts  — Chat skill: recurring meeting analysis

packages/types/src/
  granola.ts                      — Granola-specific type definitions

apps/desktop/src/
  api/granola.ts                  — React Query hooks for Granola account + meetings
```

### Modified Files

```
apps/api/prisma/schema.prisma     — Add GranolaAccount, GranolaMeeting models; add granolaMeetingId to Item
apps/api/src/app.ts               — Register granola-auth routes
apps/api/src/jobs/cron.ts         — Add Granola sync cron jobs
packages/types/src/calendar.ts    — Add SSE event types for Granola
packages/types/src/index.ts       — Export granola types
packages/ai/src/mcp/client.ts     — Expand MCPClient interface (or replace)
packages/ai/src/mcp/granola.ts    — Replace placeholder with real MCP client import
packages/ai/src/skills/index.ts   — Register new Granola skills
packages/ai/src/skills/get-meeting-notes.ts — Rewrite to use local DB instead of MCP placeholder
apps/desktop/src/settings/CalendarSection.tsx — Add Granola row (or rename component)
packages/ui/src/CalendarEventDetailPanel.tsx — Add Meeting Notes section
```

---

## Task 1: Data Model — Prisma Schema & Types

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (after line 285, before `// ── AI tables ──`)
- Modify: `apps/api/prisma/schema.prisma` (Item model, after line 135)
- Create: `packages/types/src/granola.ts`
- Modify: `packages/types/src/index.ts` (add export)
- Modify: `packages/types/src/calendar.ts` (add SSE event types)

- [ ] **Step 1: Add GranolaAccount model to Prisma schema**

In `apps/api/prisma/schema.prisma`, add after line 285 (after `CalendarEventNote` model, before `// ── AI tables ──`):

```prisma
// ── Granola tables ──

model GranolaAccount {
  id              String    @id @default(uuid())
  userId          String    @unique  // one Granola account per user
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  email           String
  accessToken     String    @db.Text  // Encrypted (AES-256-GCM)
  refreshToken    String    @db.Text  // Encrypted (AES-256-GCM)
  tokenExpiresAt  DateTime
  lastSyncAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  meetings        GranolaMeeting[]

  @@index([userId])
}

model GranolaMeeting {
  id                  String    @id @default(uuid())
  granolaDocumentId   String    @unique  // Granola's not_-prefixed ID
  userId              String
  user                User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  granolaAccountId    String
  granolaAccount      GranolaAccount @relation(fields: [granolaAccountId], references: [id], onDelete: Cascade)
  calendarEventId     String?
  calendarEvent       CalendarEvent? @relation(fields: [calendarEventId], references: [id], onDelete: SetNull)
  title               String
  summary             String?   @db.Text
  transcript          Json?     // [{source, speaker, text}]
  actionItems         Json?     // [{title, dueDate?, assignee?}]
  attendees           Json?     // [{name, email}]
  meetingStartedAt    DateTime
  meetingEndedAt      DateTime
  rawData             Json?     // Full MCP response
  syncedAt            DateTime  @default(now())
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  items               Item[]    // Action items created from this meeting

  @@index([userId, meetingStartedAt])
  @@index([granolaAccountId])
  @@index([calendarEventId])
}
```

- [ ] **Step 2: Add granolaMeetingId FK to Item model**

In `apps/api/prisma/schema.prisma`, in the `Item` model, add after line 135 (`conversationSessions ConversationSession[]`):

```prisma
  granolaMeetingId String?
  granolaMeeting   GranolaMeeting? @relation(fields: [granolaMeetingId], references: [id], onDelete: SetNull)
```

- [ ] **Step 3: Add relations to User and CalendarEvent models**

In the `User` model (around line 40-43), add:
```prisma
  granolaAccount         GranolaAccount?
  granolaMeetings        GranolaMeeting[]
```

In the `CalendarEvent` model (around line 266), add:
```prisma
  granolaMeetings        GranolaMeeting[]
```

- [ ] **Step 4: Add SSE event types for Granola**

In `packages/types/src/calendar.ts`, update the `SSEEventType` union (line 128-133) to add:
```typescript
export type SSEEventType =
  | "calendar.event.created"
  | "calendar.event.updated"
  | "calendar.event.deleted"
  | "calendar.sync.complete"
  | "content.extracted"
  | "granola.meeting.synced"
  | "granola.action_items.created"
  | "granola.account.disconnected";
```

- [ ] **Step 5: Create Granola type definitions**

Create `packages/types/src/granola.ts`:

```typescript
// ── Granola types ──

export interface GranolaAccountRecord {
  id: string;
  email: string;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GranolaAccountStatus {
  connected: boolean;
  account: GranolaAccountRecord | null;
}

export interface GranolaMeetingRecord {
  id: string;
  granolaDocumentId: string;
  calendarEventId: string | null;
  title: string;
  summary: string | null;
  attendees: GranolaMeetingAttendee[] | null;
  actionItems: GranolaActionItem[] | null;
  meetingStartedAt: string;
  meetingEndedAt: string;
  syncedAt: string;
}

export interface GranolaMeetingDetail extends GranolaMeetingRecord {
  transcript: GranolaTranscriptTurn[] | null;
}

export interface GranolaTranscriptTurn {
  source: "microphone" | "speaker";
  speaker: string;
  text: string;
}

export interface GranolaMeetingAttendee {
  name: string;
  email: string;
}

export interface GranolaActionItem {
  title: string;
  dueDate?: string;
  assignee?: string;
}
```

- [ ] **Step 6: Export Granola types from index**

In `packages/types/src/index.ts`, add before the `// ─── AI Types ───` comment (line 251):
```typescript
export * from "./granola.js";
```

- [ ] **Step 7: Run Prisma migration**

```bash
cd apps/api && npx prisma migrate dev --name add-granola-tables
```
Expected: Migration creates `GranolaAccount`, `GranolaMeeting` tables and adds `granolaMeetingId` column to `Item`.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS — types compile, Prisma client includes new models.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/ packages/types/src/granola.ts packages/types/src/index.ts packages/types/src/calendar.ts
git commit -m "feat(granola): add data model — GranolaAccount, GranolaMeeting, types"
```

---

## Task 2: Granola MCP Client Library

**Files:**
- Create: `apps/api/src/lib/granola-mcp.ts`
- Modify: `packages/ai/src/mcp/client.ts` (leave as-is or deprecate — real client lives in API)
- Modify: `packages/ai/src/mcp/granola.ts` (update to re-export or mark deprecated)

The MCP client lives in `apps/api/` (not `packages/ai/`) because it needs per-user OAuth tokens from the DB and handles token refresh — it's a server-side concern.

- [ ] **Step 1: Install MCP SDK**

```bash
cd apps/api && pnpm add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Create Granola MCP client**

Create `apps/api/src/lib/granola-mcp.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "./prisma.js";
import { decryptToken, encryptToken } from "./encryption.js";

const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

interface GranolaMeetingListItem {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  attendees?: { name: string; email: string }[];
}

interface GranolaMeetingDetail {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  notes?: string;
  summary?: string;
  attendees?: { name: string; email: string }[];
}

interface GranolaTranscript {
  turns: { source: string; speaker: string; text: string }[];
}

/**
 * Create an authenticated MCP client for a Granola account.
 * Handles token refresh if the access token has expired.
 */
async function getGranolaClient(granolaAccountId: string): Promise<Client> {
  const account = await prisma.granolaAccount.findUniqueOrThrow({
    where: { id: granolaAccountId },
  });

  // Check if token needs refresh
  if (account.tokenExpiresAt < new Date()) {
    const refreshToken = decryptToken(account.refreshToken);
    const newTokens = await refreshGranolaTokens(refreshToken);

    await prisma.granolaAccount.update({
      where: { id: granolaAccountId },
      data: {
        accessToken: encryptToken(newTokens.access_token),
        refreshToken: newTokens.refresh_token
          ? encryptToken(newTokens.refresh_token)
          : account.refreshToken,
        tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
      },
    });

    return createMCPClient(newTokens.access_token);
  }

  const accessToken = decryptToken(account.accessToken);
  return createMCPClient(accessToken);
}

function createMCPClient(accessToken: string): Client {
  const client = new Client({ name: "brett", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(GRANOLA_MCP_URL),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );

  // Note: caller must call client.connect(transport) before using
  (client as any)._transport = transport;
  return client;
}

async function connectClient(client: Client): Promise<void> {
  const transport = (client as any)._transport;
  await client.connect(transport);
}

async function refreshGranolaTokens(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  // Granola uses standard OAuth 2.0 token refresh
  // The exact endpoint is discovered during Dynamic Client Registration
  // For now, use the standard token endpoint pattern
  const resp = await fetch("https://mcp.granola.ai/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status}`);
  }

  return resp.json();
}

// ── Public API ──

export async function listGranolaMeetings(
  granolaAccountId: string,
  timeRange: "this_week" | "last_week" | "last_30_days" | "custom",
  customStart?: string,
  customEnd?: string,
): Promise<GranolaMeetingListItem[]> {
  const client = await getGranolaClient(granolaAccountId);
  await connectClient(client);
  try {
    const args: Record<string, string> = { time_range: timeRange };
    if (timeRange === "custom" && customStart) args.custom_start = customStart;
    if (timeRange === "custom" && customEnd) args.custom_end = customEnd;

    const result = await client.callTool({ name: "list_meetings", arguments: args });
    return (result.content as any)?.[0]?.text
      ? JSON.parse((result.content as any)[0].text)
      : [];
  } finally {
    await client.close();
  }
}

export async function getGranolaMeetings(
  granolaAccountId: string,
  meetingIds: string[],
): Promise<GranolaMeetingDetail[]> {
  const client = await getGranolaClient(granolaAccountId);
  await connectClient(client);
  try {
    // Max 10 per call per Granola docs
    const batches: string[][] = [];
    for (let i = 0; i < meetingIds.length; i += 10) {
      batches.push(meetingIds.slice(i, i + 10));
    }

    const results: GranolaMeetingDetail[] = [];
    for (const batch of batches) {
      const result = await client.callTool({
        name: "get_meetings",
        arguments: { meeting_ids: batch },
      });
      const parsed = (result.content as any)?.[0]?.text
        ? JSON.parse((result.content as any)[0].text)
        : [];
      results.push(...parsed);
    }
    return results;
  } finally {
    await client.close();
  }
}

export async function getGranolaTranscript(
  granolaAccountId: string,
  meetingId: string,
): Promise<GranolaTranscript | null> {
  const client = await getGranolaClient(granolaAccountId);
  await connectClient(client);
  try {
    const result = await client.callTool({
      name: "get_meeting_transcript",
      arguments: { meeting_id: meetingId },
    });
    const text = (result.content as any)?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } finally {
    await client.close();
  }
}

export async function queryGranolaMeetings(
  granolaAccountId: string,
  query: string,
  documentIds?: string[],
): Promise<string> {
  const client = await getGranolaClient(granolaAccountId);
  await connectClient(client);
  try {
    const args: Record<string, unknown> = { query };
    if (documentIds?.length) args.document_ids = documentIds;

    const result = await client.callTool({
      name: "query_granola_meetings",
      arguments: args,
    });
    return (result.content as any)?.[0]?.text ?? "";
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/granola-mcp.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(granola): add MCP client library with Streamable HTTP transport"
```

---

## Task 3: OAuth Routes

**Files:**
- Create: `apps/api/src/routes/granola-auth.ts`
- Modify: `apps/api/src/app.ts` (register route)

Follow the same pattern as `calendar-accounts.ts`: HMAC-signed state, callback HTML page, encrypted token storage.

- [ ] **Step 1: Create granola-auth route file**

Create `apps/api/src/routes/granola-auth.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { generateId } from "@brett/utils";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import type { Context } from "hono";

// Granola MCP OAuth endpoints (Dynamic Client Registration)
const GRANOLA_AUTH_URL = "https://mcp.granola.ai/oauth/authorize";
const GRANOLA_TOKEN_URL = "https://mcp.granola.ai/oauth/token";
const GRANOLA_REGISTER_URL = "https://mcp.granola.ai/oauth/register";

// Cached client credentials from Dynamic Client Registration
let registeredClient: { client_id: string; client_secret?: string } | null = null;

function callbackHtml(
  c: Context,
  { title, message, isError }: { title: string; message: string; isError?: boolean },
) {
  const color = isError ? "#f87171" : "#60a5fa";
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
<div style="text-align:center;max-width:360px;padding:40px;">
<div style="font-size:36px;margin-bottom:16px;">${isError ? "😕" : "✅"}</div>
<h1 style="color:${color};font-size:20px;font-weight:700;margin:0 0 8px;">${title}</h1>
<p style="color:rgba(255,255,255,0.4);font-size:14px;line-height:1.6;margin:0 0 20px;">${message}</p>
<p style="color:rgba(255,255,255,0.2);font-size:12px;">You can close this tab.</p>
<script>setTimeout(()=>window.close(),3000);</script>
</div></body></html>`;
  return c.html(html);
}

/**
 * Register Brett as an OAuth client with Granola (Dynamic Client Registration).
 * Cached after first call — registration persists for the server lifetime.
 */
async function ensureClientRegistered(): Promise<{ client_id: string; client_secret?: string }> {
  if (registeredClient) return registeredClient;

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  const resp = await fetch(GRANOLA_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Brett",
      redirect_uris: [`${baseUrl}/granola/auth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Granola client registration failed: ${resp.status} ${text}`);
  }

  registeredClient = await resp.json();
  return registeredClient!;
}

const granolaAuth = new Hono<AuthEnv>();
granolaAuth.use("*", authMiddleware);

// GET / — Connection status
granolaAuth.get("/", async (c) => {
  const user = c.get("user");

  const account = await prisma.granolaAccount.findUnique({
    where: { userId: user.id },
  });

  if (!account) {
    return c.json({ connected: false, account: null });
  }

  return c.json({
    connected: true,
    account: {
      id: account.id,
      email: account.email,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    },
  });
});

// POST /connect — Initiate OAuth (returns URL)
granolaAuth.post("/connect", async (c) => {
  const user = c.get("user");
  const client = await ensureClientRegistered();

  const nonce = randomBytes(16).toString("hex");
  const hmac = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(user.id + ":" + nonce)
    .digest("hex");
  const state = `${Buffer.from(user.id).toString("base64url")}.${nonce}.${hmac}`;

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: `${baseUrl}/granola/auth/callback`,
    state,
    scope: "openid",
  });

  const url = `${GRANOLA_AUTH_URL}?${params.toString()}`;
  return c.json({ url });
});

// GET /callback — OAuth callback
granolaAuth.get("/callback", async (c) => {
  const error = c.req.query("error");
  if (error) {
    return callbackHtml(c, {
      title: "Access denied",
      message: "Granola access wasn't granted. Head back to Brett and try again from Settings.",
      isError: true,
    });
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return callbackHtml(c, {
      title: "Something went wrong",
      message: "Missing authorization data. Please try connecting again from Brett.",
      isError: true,
    });
  }

  // Verify signed state: base64url(userId).nonce.hmac
  const parts = state.split(".");
  if (parts.length !== 3) {
    return callbackHtml(c, {
      title: "Invalid request",
      message: "The authorization state was malformed. Please try again.",
      isError: true,
    });
  }

  let userId: string;
  try {
    userId = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return callbackHtml(c, {
      title: "Invalid request",
      message: "The authorization state couldn't be read. Please try again.",
      isError: true,
    });
  }

  const expectedHmac = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(userId + ":" + parts[1])
    .digest("hex");

  if (
    parts[2].length !== expectedHmac.length ||
    !timingSafeEqual(
      Buffer.from(expectedHmac, "hex"),
      Buffer.from(parts[2], "hex"),
    )
  ) {
    return callbackHtml(c, {
      title: "Security check failed",
      message: "The authorization signature didn't match. Please try connecting again.",
      isError: true,
    });
  }

  const user = c.get("user");
  if (userId !== user.id) {
    return callbackHtml(c, {
      title: "Session mismatch",
      message: "The authorization was started by a different session. Please try again.",
      isError: true,
    });
  }

  // Exchange code for tokens
  const client = await ensureClientRegistered();
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";

  const tokenResp = await fetch(GRANOLA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${baseUrl}/granola/auth/callback`,
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    }),
  });

  if (!tokenResp.ok) {
    return callbackHtml(c, {
      title: "Authorization failed",
      message: "Couldn't exchange the authorization code. Please try again.",
      isError: true,
    });
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    email?: string;
  };

  if (!tokens.access_token) {
    return callbackHtml(c, {
      title: "Something went wrong",
      message: "Didn't receive an access token from Granola. Please try again.",
      isError: true,
    });
  }

  // Determine email — may come from token response or userinfo
  const email = tokens.email || user.email;

  // Upsert GranolaAccount
  await prisma.granolaAccount.upsert({
    where: { userId: user.id },
    create: {
      id: generateId(),
      userId: user.id,
      email,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token ?? ""),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000),
    },
    update: {
      email,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token ?? ""),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000),
    },
  });

  // Trigger initial sync in background
  import("../services/granola-sync.js")
    .then(({ initialGranolaSync }) => initialGranolaSync(user.id))
    .catch((err) => console.error("[granola-auth] Initial sync failed:", err));

  return callbackHtml(c, {
    title: "Granola connected!",
    message: "Your meeting notes will start syncing. Head back to Brett.",
  });
});

// DELETE / — Disconnect
granolaAuth.delete("/", async (c) => {
  const user = c.get("user");

  const account = await prisma.granolaAccount.findUnique({
    where: { userId: user.id },
  });

  if (!account) {
    return c.json({ error: "Not connected" }, 404);
  }

  // Null out granolaMeetingId on any linked items before cascade delete
  await prisma.item.updateMany({
    where: { granolaMeetingId: { not: null }, userId: user.id },
    data: { granolaMeetingId: null },
  });

  // Cascade delete: GranolaAccount -> GranolaMeeting
  await prisma.granolaAccount.delete({ where: { id: account.id } });

  return c.json({ ok: true });
});

export default granolaAuth;
```

- [ ] **Step 2: Register route in app.ts**

In `apps/api/src/app.ts`, add import after line 21:
```typescript
import granolaAuth from "./routes/granola-auth.js";
```

Add route registration after line 65 (`app.route("/webhooks", webhooks);`):
```typescript
app.route("/granola/auth", granolaAuth);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/granola-auth.ts apps/api/src/app.ts
git commit -m "feat(granola): add OAuth routes — connect, callback, status, disconnect"
```

---

## Task 4: Meeting Matching Algorithm

**Files:**
- Create: `apps/api/src/services/meeting-matcher.ts`
- Test: `apps/api/src/__tests__/meeting-matcher.test.ts`

This is pure logic with no DB dependencies — ideal for unit testing.

- [ ] **Step 1: Write failing tests for matching algorithm**

Create `apps/api/src/__tests__/meeting-matcher.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findBestMatch, type MatchCandidate } from "../services/meeting-matcher.js";

const baseMeeting = {
  title: "Weekly Standup",
  startTime: new Date("2026-03-27T14:00:00Z"),
  endTime: new Date("2026-03-27T14:30:00Z"),
  attendees: [
    { email: "alice@example.com" },
    { email: "bob@example.com" },
  ],
};

describe("findBestMatch", () => {
  it("returns null when no candidates", () => {
    expect(findBestMatch(baseMeeting, [])).toBeNull();
  });

  it("matches exact title and time overlap", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-1",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T14:00:00Z"),
        endTime: new Date("2026-03-27T14:30:00Z"),
        attendees: [{ email: "alice@example.com" }, { email: "bob@example.com" }],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("event-1");
    expect(result!.score).toBeGreaterThan(0.8);
  });

  it("rejects candidates with no time overlap", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-2",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T16:00:00Z"),
        endTime: new Date("2026-03-27T16:30:00Z"),
        attendees: [{ email: "alice@example.com" }],
      },
    ];
    expect(findBestMatch(baseMeeting, candidates)).toBeNull();
  });

  it("allows time overlap within 15-minute tolerance", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-3",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T14:10:00Z"),
        endTime: new Date("2026-03-27T14:40:00Z"),
        attendees: [],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).not.toBeNull();
  });

  it("picks the best match when multiple candidates overlap", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-a",
        title: "Team Sync",
        startTime: new Date("2026-03-27T14:00:00Z"),
        endTime: new Date("2026-03-27T14:30:00Z"),
        attendees: [],
      },
      {
        id: "event-b",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T14:00:00Z"),
        endTime: new Date("2026-03-27T14:30:00Z"),
        attendees: [{ email: "alice@example.com" }, { email: "bob@example.com" }],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("event-b");
  });

  it("returns null when best score is below threshold", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-c",
        title: "Completely Different Meeting",
        startTime: new Date("2026-03-27T13:50:00Z"),
        endTime: new Date("2026-03-27T14:05:00Z"),
        attendees: [{ email: "charlie@example.com" }],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm vitest run src/__tests__/meeting-matcher.test.ts
```
Expected: FAIL — `meeting-matcher.js` does not exist.

- [ ] **Step 3: Implement the matching algorithm**

Create `apps/api/src/services/meeting-matcher.ts`:

```typescript
const TIME_TOLERANCE_MS = 15 * 60 * 1000; // 15 minutes
const CONFIDENCE_THRESHOLD = 0.5;
const TITLE_WEIGHT = 0.6;
const ATTENDEE_WEIGHT = 0.4;

export interface MatchCandidate {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  attendees: { email: string }[];
}

interface MeetingInput {
  title: string;
  startTime: Date;
  endTime: Date;
  attendees: { email: string }[];
}

export interface MatchResult {
  id: string;
  score: number;
}

/**
 * Find the best CalendarEvent match for a Granola meeting.
 * Returns null if no candidate passes the confidence threshold.
 */
export function findBestMatch(
  meeting: MeetingInput,
  candidates: MatchCandidate[],
): MatchResult | null {
  let bestMatch: MatchResult | null = null;

  for (const candidate of candidates) {
    if (!hasTimeOverlap(meeting, candidate)) continue;

    const titleScore = titleSimilarity(meeting.title, candidate.title);
    const attendeeScore = attendeeOverlap(meeting.attendees, candidate.attendees);
    const score = titleScore * TITLE_WEIGHT + attendeeScore * ATTENDEE_WEIGHT;

    if (score >= CONFIDENCE_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: candidate.id, score };
    }
  }

  return bestMatch;
}

function hasTimeOverlap(a: MeetingInput, b: MatchCandidate): boolean {
  const aStart = a.startTime.getTime() - TIME_TOLERANCE_MS;
  const aEnd = a.endTime.getTime() + TIME_TOLERANCE_MS;
  const bStart = b.startTime.getTime();
  const bEnd = b.endTime.getTime();

  return aStart < bEnd && bStart < aEnd;
}

/**
 * Normalized title similarity using bigram overlap (Dice coefficient).
 * Case-insensitive, handles empty strings.
 */
function titleSimilarity(a: string, b: string): number {
  const aNorm = a.toLowerCase().trim();
  const bNorm = b.toLowerCase().trim();

  if (aNorm === bNorm) return 1;
  if (aNorm.length < 2 || bNorm.length < 2) return 0;

  const aBigrams = bigrams(aNorm);
  const bBigrams = bigrams(bNorm);

  let overlap = 0;
  const bCopy = [...bBigrams];
  for (const bg of aBigrams) {
    const idx = bCopy.indexOf(bg);
    if (idx !== -1) {
      overlap++;
      bCopy.splice(idx, 1);
    }
  }

  return (2 * overlap) / (aBigrams.length + bBigrams.length);
}

function bigrams(s: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    result.push(s.slice(i, i + 2));
  }
  return result;
}

/**
 * Ratio of shared attendee emails.
 * Returns 0 if either list is empty (no signal, don't penalize).
 */
function attendeeOverlap(
  a: { email: string }[],
  b: { email: string }[],
): number {
  if (a.length === 0 || b.length === 0) return 0;

  const aEmails = new Set(a.map((x) => x.email.toLowerCase()));
  const bEmails = new Set(b.map((x) => x.email.toLowerCase()));

  let shared = 0;
  for (const email of aEmails) {
    if (bEmails.has(email)) shared++;
  }

  // Jaccard-like: shared / union
  const union = new Set([...aEmails, ...bEmails]).size;
  return union > 0 ? shared / union : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm vitest run src/__tests__/meeting-matcher.test.ts
```
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/meeting-matcher.ts apps/api/src/__tests__/meeting-matcher.test.ts
git commit -m "feat(granola): add meeting-to-event matching algorithm with tests"
```

---

## Task 5: Sync Service

**Files:**
- Create: `apps/api/src/services/granola-sync.ts`

- [ ] **Step 1: Create sync service**

Create `apps/api/src/services/granola-sync.ts`:

```typescript
import { prisma } from "../lib/prisma.js";
import {
  listGranolaMeetings,
  getGranolaMeetings,
  getGranolaTranscript,
} from "../lib/granola-mcp.js";
import { findBestMatch, type MatchCandidate } from "./meeting-matcher.js";
import { publishSSE } from "../lib/sse.js";
import { validateCreateItem } from "@brett/business";

// Working hours gate: 8am-7pm in user's timezone
const WORKING_HOURS_START = 8;
const WORKING_HOURS_END = 19;

function isWithinWorkingHours(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    return hour >= WORKING_HOURS_START && hour < WORKING_HOURS_END;
  } catch {
    // Fallback: assume working hours
    return true;
  }
}

/**
 * Initial sync after connecting Granola — fetch last 30 days of meetings.
 */
export async function initialGranolaSync(userId: string): Promise<void> {
  const account = await prisma.granolaAccount.findUnique({
    where: { userId },
  });
  if (!account) return;

  console.log(`[granola-sync] Initial sync for user ${userId}`);

  try {
    const meetings = await listGranolaMeetings(account.id, "last_30_days");
    await syncMeetings(account.id, userId, meetings);

    await prisma.granolaAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date() },
    });

    publishSSE(userId, {
      type: "granola.meeting.synced",
      payload: { count: meetings.length },
    });
  } catch (err) {
    console.error(`[granola-sync] Initial sync failed for user ${userId}:`, err);
  }
}

/**
 * Incremental sync — fetch meetings since last sync.
 * Called by cron (periodic sweep) and calendar-event-driven trigger.
 */
export async function incrementalGranolaSync(userId: string): Promise<void> {
  const account = await prisma.granolaAccount.findUnique({
    where: { userId },
    include: { user: { select: { timezone: true } } },
  });
  if (!account) return;

  // Working hours gate
  if (!isWithinWorkingHours(account.user.timezone)) return;

  try {
    // Fetch today's meetings (catches new ones since last sync)
    const meetings = await listGranolaMeetings(account.id, "custom",
      new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
      new Date().toISOString(),
    );
    const newCount = await syncMeetings(account.id, userId, meetings);

    await prisma.granolaAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date() },
    });

    if (newCount > 0) {
      publishSSE(userId, {
        type: "granola.meeting.synced",
        payload: { count: newCount },
      });
    }
  } catch (err) {
    console.error(`[granola-sync] Incremental sync failed for user ${userId}:`, err);
  }
}

/**
 * Calendar-event-driven sync — called ~5 min after a calendar event ends.
 * Fetches Granola meetings in a narrow time window around the event.
 */
export async function syncAfterMeeting(
  userId: string,
  eventStartTime: Date,
  eventEndTime: Date,
): Promise<void> {
  const account = await prisma.granolaAccount.findUnique({
    where: { userId },
  });
  if (!account) return;

  try {
    // Fetch meetings in a window around the event
    const start = new Date(eventStartTime.getTime() - 15 * 60 * 1000); // 15 min before
    const end = new Date(eventEndTime.getTime() + 30 * 60 * 1000);     // 30 min after
    const meetings = await listGranolaMeetings(
      account.id, "custom",
      start.toISOString(),
      end.toISOString(),
    );
    await syncMeetings(account.id, userId, meetings);
  } catch (err) {
    console.error(`[granola-sync] Post-meeting sync failed for user ${userId}:`, err);
  }
}

/**
 * Core sync logic: for each meeting from Granola, fetch details, match to
 * calendar events, extract action items, and store.
 * Returns count of newly synced meetings.
 */
async function syncMeetings(
  granolaAccountId: string,
  userId: string,
  meetingList: { id: string; title: string; start_time: string; end_time: string; attendees?: { name: string; email: string }[] }[],
): Promise<number> {
  if (meetingList.length === 0) return 0;

  // Filter to only new meetings we haven't synced
  const existingIds = await prisma.granolaMeeting.findMany({
    where: {
      granolaDocumentId: { in: meetingList.map((m) => m.id) },
      userId,
    },
    select: { granolaDocumentId: true },
  });
  const existingSet = new Set(existingIds.map((e) => e.granolaDocumentId));
  const newMeetings = meetingList.filter((m) => !existingSet.has(m.id));

  if (newMeetings.length === 0) return 0;

  // Fetch full details for new meetings
  const details = await getGranolaMeetings(
    granolaAccountId,
    newMeetings.map((m) => m.id),
  );

  // Load calendar events for matching (same day window)
  const earliest = new Date(
    Math.min(...newMeetings.map((m) => new Date(m.start_time).getTime())),
  );
  const latest = new Date(
    Math.max(...newMeetings.map((m) => new Date(m.end_time).getTime())),
  );
  const calendarEvents = await prisma.calendarEvent.findMany({
    where: {
      userId,
      startTime: { gte: new Date(earliest.getTime() - 60 * 60 * 1000) },
      endTime: { lte: new Date(latest.getTime() + 60 * 60 * 1000) },
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      attendees: true,
    },
  });

  // Build match candidates
  const candidates: MatchCandidate[] = calendarEvents.map((e) => ({
    id: e.id,
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
    attendees: Array.isArray(e.attendees)
      ? (e.attendees as { email: string }[])
      : [],
  }));

  let syncedCount = 0;

  for (const detail of details) {
    try {
      // Fetch transcript
      let transcript = null;
      try {
        transcript = await getGranolaTranscript(granolaAccountId, detail.id);
      } catch {
        console.warn(`[granola-sync] Failed to fetch transcript for ${detail.id}`);
      }

      // Match to calendar event
      const meetingAttendees = detail.attendees?.map((a) => ({ email: a.email })) ?? [];
      const match = findBestMatch(
        {
          title: detail.title,
          startTime: new Date(detail.start_time),
          endTime: new Date(detail.end_time),
          attendees: meetingAttendees,
        },
        candidates,
      );

      // Store meeting
      const meeting = await prisma.granolaMeeting.create({
        data: {
          granolaDocumentId: detail.id,
          userId,
          granolaAccountId,
          calendarEventId: match?.id ?? null,
          title: detail.title,
          summary: detail.summary ?? detail.notes ?? null,
          transcript: transcript?.turns ?? null,
          attendees: detail.attendees ?? null,
          meetingStartedAt: new Date(detail.start_time),
          meetingEndedAt: new Date(detail.end_time),
          rawData: detail as any,
        },
      });

      // Extract and create action items
      await extractAndCreateActionItems(meeting.id, userId, detail.summary ?? detail.notes ?? "");

      syncedCount++;
    } catch (err) {
      console.error(`[granola-sync] Failed to sync meeting ${detail.id}:`, err);
    }
  }

  return syncedCount;
}

/**
 * Extract action items from meeting summary using AI, then create them as tasks.
 * Falls back to simple pattern matching if no AI provider is configured.
 */
async function extractAndCreateActionItems(
  granolaMeetingId: string,
  userId: string,
  summaryText: string,
): Promise<void> {
  if (!summaryText.trim()) return;

  // Simple pattern-based extraction for v1
  // Look for lines starting with action-item-like patterns
  const actionItemPatterns = [
    /^[-*•]\s*(?:action item|todo|task|follow[- ]?up):\s*(.+)/gim,
    /^[-*•]\s*\[[ x]?\]\s*(.+)/gim,  // Checkbox items
    /^(?:action item|todo|task|follow[- ]?up):\s*(.+)/gim,
  ];

  const items: { title: string }[] = [];
  for (const pattern of actionItemPatterns) {
    let match;
    while ((match = pattern.exec(summaryText)) !== null) {
      const title = match[1].trim();
      if (title.length > 3 && title.length < 200) {
        items.push({ title });
      }
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Store extracted items on the meeting record
  if (unique.length > 0) {
    await prisma.granolaMeeting.update({
      where: { id: granolaMeetingId },
      data: { actionItems: unique },
    });
  }

  // Create tasks for each action item
  for (const actionItem of unique) {
    const validation = validateCreateItem({
      type: "task",
      title: actionItem.title,
      source: "Granola",
    });

    if (!validation.ok) continue;

    await prisma.item.create({
      data: {
        type: "task",
        title: validation.data.title,
        source: "Granola",
        status: "active",
        userId,
        granolaMeetingId,
      },
    });
  }

  if (unique.length > 0) {
    publishSSE(userId, {
      type: "granola.action_items.created",
      payload: { count: unique.length, granolaMeetingId },
    });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/granola-sync.ts
git commit -m "feat(granola): add sync service — polling, matching, action item extraction"
```

---

## Task 6: Cron Job Integration

**Files:**
- Modify: `apps/api/src/jobs/cron.ts`

- [ ] **Step 1: Add Granola sync cron jobs**

In `apps/api/src/jobs/cron.ts`, add a new guard flag after line 9:
```typescript
let granolaSyncRunning = false;
```

Add the following cron jobs before the final `console.log` at line 129:

```typescript
  // Granola: calendar-event-driven sync — every 5 minutes
  // Checks for recently ended calendar events and syncs Granola notes
  cron.schedule("*/5 * * * *", async () => {
    if (granolaSyncRunning) return;
    granolaSyncRunning = true;
    try {
      const { syncAfterMeeting } = await import("../services/granola-sync.js");

      // Find users with connected Granola accounts
      const granolaAccounts = await prisma.granolaAccount.findMany({
        select: { userId: true, user: { select: { timezone: true } } },
      });

      for (const account of granolaAccounts) {
        try {
          // Find calendar events that ended 5-10 minutes ago
          const now = new Date();
          const fiveMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
          const tenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

          const recentlyEnded = await prisma.calendarEvent.findMany({
            where: {
              userId: account.userId,
              endTime: { gte: tenMinAgo, lte: fiveMinAgo },
              isAllDay: false,
            },
            select: { startTime: true, endTime: true },
          });

          for (const event of recentlyEnded) {
            await syncAfterMeeting(account.userId, event.startTime, event.endTime);
          }
        } catch (err) {
          console.error(`[cron] Granola post-meeting sync failed for ${account.userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Granola post-meeting sync failed:", err);
    } finally {
      granolaSyncRunning = false;
    }
  });

  // Granola: periodic sweep — every 30 minutes
  // Safety net that catches any meetings missed by the event-driven trigger
  cron.schedule("*/30 * * * *", async () => {
    try {
      const { incrementalGranolaSync } = await import("../services/granola-sync.js");

      const granolaAccounts = await prisma.granolaAccount.findMany({
        select: { userId: true },
      });

      for (const account of granolaAccounts) {
        try {
          await incrementalGranolaSync(account.userId);
        } catch (err) {
          console.error(`[cron] Granola sweep sync failed for ${account.userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Granola sweep sync failed:", err);
    }
  });
```

Update the final console.log (line 129-131) to include Granola jobs:
```typescript
  console.log(
    "[cron] Started: SSE heartbeat (30s), webhook renewal (6h), reconciliation (4h), granola post-meeting (5m), granola sweep (30m)",
  );
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jobs/cron.ts
git commit -m "feat(granola): add cron jobs — post-meeting sync (5m) + periodic sweep (30m)"
```

---

## Task 7: AI Skills — Meeting Chat Integration

**Files:**
- Create: `packages/ai/src/skills/query-meeting-notes.ts`
- Create: `packages/ai/src/skills/get-meeting-action-items.ts`
- Create: `packages/ai/src/skills/analyze-meeting-pattern.ts`
- Modify: `packages/ai/src/skills/get-meeting-notes.ts` (rewrite)
- Modify: `packages/ai/src/skills/index.ts` (register)

- [ ] **Step 1: Rewrite get-meeting-notes skill to query local DB**

Replace contents of `packages/ai/src/skills/get-meeting-notes.ts`:

```typescript
import type { Skill } from "./types.js";

export const getMeetingNotesSkill: Skill = {
  name: "get_meeting_notes",
  description:
    "Retrieve meeting notes and summaries. Use when the user asks about what happened in a meeting, what was discussed, or wants meeting notes. Can search by calendar event ID, date, or text query.",
  parameters: {
    type: "object",
    properties: {
      calendarEventId: {
        type: "string",
        description: "Calendar event ID to get meeting notes for",
      },
      query: {
        type: "string",
        description: "Search query (meeting title, topic, or date like '2026-03-27')",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as { calendarEventId?: string; query?: string };

    // Search by calendar event ID first (most specific)
    if (p.calendarEventId) {
      const meeting = await ctx.prisma.granolaMeeting.findFirst({
        where: { calendarEventId: p.calendarEventId, userId: ctx.userId },
      });
      if (!meeting) {
        return { success: true, message: "No meeting notes found for this event." };
      }
      return {
        success: true,
        data: {
          title: meeting.title,
          summary: meeting.summary,
          meetingDate: meeting.meetingStartedAt,
        },
        message: `**${meeting.title}**\n\n${meeting.summary ?? "No summary available."}`,
      };
    }

    // Search by query (title match or date)
    if (p.query) {
      const meetings = await ctx.prisma.granolaMeeting.findMany({
        where: {
          userId: ctx.userId,
          OR: [
            { title: { contains: p.query, mode: "insensitive" } },
            // Date search: if query looks like a date
            ...(isDateLike(p.query)
              ? [
                  {
                    meetingStartedAt: {
                      gte: new Date(p.query + "T00:00:00Z"),
                      lt: new Date(p.query + "T23:59:59Z"),
                    },
                  },
                ]
              : []),
          ],
        },
        orderBy: { meetingStartedAt: "desc" },
        take: 5,
      });

      if (meetings.length === 0) {
        return { success: true, message: `No meeting notes found matching "${p.query}".` };
      }

      const summaries = meetings
        .map((m) => `**${m.title}** (${m.meetingStartedAt.toISOString().split("T")[0]})\n${m.summary ?? "No summary"}`)
        .join("\n\n---\n\n");

      return { success: true, data: { count: meetings.length }, message: summaries };
    }

    // No params — return most recent meetings
    const recent = await ctx.prisma.granolaMeeting.findMany({
      where: { userId: ctx.userId },
      orderBy: { meetingStartedAt: "desc" },
      take: 3,
    });

    if (recent.length === 0) {
      return { success: true, message: "No meeting notes synced yet. Connect Granola in Settings to get started." };
    }

    const list = recent
      .map((m) => `- **${m.title}** (${m.meetingStartedAt.toISOString().split("T")[0]})`)
      .join("\n");

    return {
      success: true,
      message: `Recent meetings:\n${list}\n\nAsk about a specific meeting for details.`,
    };
  },
};

function isDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
```

- [ ] **Step 2: Create get-meeting-action-items skill**

Create `packages/ai/src/skills/get-meeting-action-items.ts`:

```typescript
import type { Skill } from "./types.js";
import { validateCreateItem } from "@brett/business";

export const getMeetingActionItemsSkill: Skill = {
  name: "get_meeting_action_items",
  description:
    "Get action items from a meeting. Use when the user asks for action items, todos, or follow-ups from a specific meeting. Can also create them as tasks.",
  parameters: {
    type: "object",
    properties: {
      calendarEventId: {
        type: "string",
        description: "Calendar event ID to get action items for",
      },
      meetingTitle: {
        type: "string",
        description: "Meeting title to search for",
      },
      createTasks: {
        type: "boolean",
        description: "If true, create tasks for the action items",
      },
    },
  },
  modelTier: "small",
  requiresAI: false,

  async execute(params, ctx) {
    const p = params as {
      calendarEventId?: string;
      meetingTitle?: string;
      createTasks?: boolean;
    };

    // Find the meeting
    let meeting = await ctx.prisma.granolaMeeting.findFirst({
      where: {
        userId: ctx.userId,
        ...(p.calendarEventId
          ? { calendarEventId: p.calendarEventId }
          : p.meetingTitle
            ? { title: { contains: p.meetingTitle, mode: "insensitive" as const } }
            : {}),
      },
      orderBy: { meetingStartedAt: "desc" },
    });

    // On-demand fallback: if no local data, trigger a sync via MCP before giving up
    if (!meeting) {
      const granolaAccount = await ctx.prisma.granolaAccount.findUnique({
        where: { userId: ctx.userId },
      });
      if (!granolaAccount) {
        return {
          success: true,
          message: "Granola is not connected. Connect it in Settings to access meeting notes.",
        };
      }

      // Trigger an on-demand sync for recent meetings, then retry the query
      try {
        const { incrementalGranolaSync } = await import(
          // @ts-expect-error — cross-package dynamic import from ai skill to api service
          "../../../../apps/api/src/services/granola-sync.js"
        );
        await incrementalGranolaSync(ctx.userId);
      } catch {
        // Sync module not available in this context — fall through
      }

      // Retry after sync
      const retried = await ctx.prisma.granolaMeeting.findFirst({
        where: {
          userId: ctx.userId,
          ...(p.calendarEventId
            ? { calendarEventId: p.calendarEventId }
            : p.meetingTitle
              ? { title: { contains: p.meetingTitle, mode: "insensitive" as const } }
              : {}),
        },
        orderBy: { meetingStartedAt: "desc" },
      });

      if (!retried) {
        return {
          success: true,
          message: "No meeting notes found yet — Granola may still be processing. Try again in a few minutes.",
        };
      }

      // Use the retried meeting
      meeting = retried;
    }

    const actionItems = (meeting.actionItems as { title: string; dueDate?: string }[]) ?? [];

    if (actionItems.length === 0) {
      return {
        success: true,
        message: `No action items found in **${meeting.title}**.`,
      };
    }

    // Optionally create tasks
    if (p.createTasks) {
      let created = 0;
      for (const item of actionItems) {
        const validation = validateCreateItem({
          type: "task",
          title: item.title,
          source: "Granola",
          dueDate: item.dueDate,
        });
        if (!validation.ok) continue;

        await ctx.prisma.item.create({
          data: {
            type: "task",
            title: validation.data.title,
            source: "Granola",
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            status: "active",
            userId: ctx.userId,
            granolaMeetingId: meeting.id,
          },
        });
        created++;
      }

      return {
        success: true,
        data: { created },
        displayHint: { type: "confirmation" },
        message: `Created ${created} task${created !== 1 ? "s" : ""} from **${meeting.title}**.`,
      };
    }

    // Just list them
    const list = actionItems
      .map((item, i) => `${i + 1}. ${item.title}${item.dueDate ? ` (due ${item.dueDate})` : ""}`)
      .join("\n");

    return {
      success: true,
      data: { actionItems, meetingTitle: meeting.title },
      message: `Action items from **${meeting.title}**:\n\n${list}\n\nSay "create these as tasks" to add them to your inbox.`,
    };
  },
};
```

- [ ] **Step 3: Create analyze-meeting-pattern skill**

Create `packages/ai/src/skills/analyze-meeting-pattern.ts`:

```typescript
import type { Skill } from "./types.js";

export const analyzeMeetingPatternSkill: Skill = {
  name: "analyze_meeting_pattern",
  description:
    "Analyze patterns across recurring meetings. Use when the user asks about trends, recurring topics, or patterns in a meeting series (e.g., 'what keeps coming up in our standup?').",
  parameters: {
    type: "object",
    properties: {
      meetingTitle: {
        type: "string",
        description: "Meeting series title to analyze (e.g., 'Weekly Standup')",
      },
      calendarEventId: {
        type: "string",
        description: "A calendar event ID from the recurring series",
      },
    },
    required: ["meetingTitle"],
  },
  modelTier: "large",
  requiresAI: true,

  async execute(params, ctx) {
    const p = params as { meetingTitle: string; calendarEventId?: string };

    if (!ctx.provider) {
      return {
        success: false,
        message: "AI provider required for meeting pattern analysis. Configure one in Settings.",
      };
    }

    // Find all meetings in this series (fuzzy title match)
    const meetings = await ctx.prisma.granolaMeeting.findMany({
      where: {
        userId: ctx.userId,
        title: { contains: p.meetingTitle, mode: "insensitive" },
      },
      orderBy: { meetingStartedAt: "asc" },
      select: {
        title: true,
        summary: true,
        transcript: true,
        actionItems: true,
        meetingStartedAt: true,
        attendees: true,
      },
    });

    if (meetings.length < 2) {
      return {
        success: true,
        message: meetings.length === 0
          ? `No meetings found matching "${p.meetingTitle}".`
          : `Only one meeting found for "${p.meetingTitle}". Need at least two for pattern analysis.`,
      };
    }

    // Build context for AI analysis
    const meetingContext = meetings
      .map((m) => {
        const date = m.meetingStartedAt.toISOString().split("T")[0];
        const actionItems = (m.actionItems as { title: string }[]) ?? [];
        return [
          `## ${date}: ${m.title}`,
          m.summary ? `Summary: ${m.summary}` : "",
          actionItems.length > 0
            ? `Action items: ${actionItems.map((a) => a.title).join("; ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n---\n\n");

    // Use AI to analyze patterns
    const prompt = `Analyze these ${meetings.length} meetings from the recurring series "${p.meetingTitle}". Identify:
1. Recurring topics or themes
2. Action items that keep reappearing (may be stale/unresolved)
3. Attendance trends (who shows up consistently, who dropped off)
4. Any notable shifts in focus over time

Be concise and actionable. Focus on insights that help the user prepare for the next meeting.

Meeting history:
${meetingContext}`;

    const response = await ctx.provider.generateText({
      model: "medium",
      messages: [{ role: "user", content: prompt }],
    });

    return {
      success: true,
      data: { meetingCount: meetings.length },
      message: response.text,
    };
  },
};
```

- [ ] **Step 4: Register new skills**

In `packages/ai/src/skills/index.ts`, add imports after line 38:
```typescript
import { getMeetingActionItemsSkill } from "./get-meeting-action-items.js";
import { analyzeMeetingPatternSkill } from "./analyze-meeting-pattern.js";
```

Replace the MCP section (lines 78-80) with:
```typescript
  // MCP / Granola (3)
  registry.register(getMeetingNotesSkill);
  registry.register(getMeetingActionItemsSkill);
  registry.register(analyzeMeetingPatternSkill);
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/skills/
git commit -m "feat(granola): add meeting chat skills — notes, action items, pattern analysis"
```

---

## Task 8: Desktop API Hooks

**Files:**
- Create: `apps/desktop/src/api/granola.ts`

- [ ] **Step 1: Create Granola React Query hooks**

Create `apps/desktop/src/api/granola.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./fetch.js";
import type { GranolaAccountStatus, GranolaMeetingRecord } from "@brett/types";

export function useGranolaAccount() {
  return useQuery({
    queryKey: ["granola", "account"],
    queryFn: () => apiFetch<GranolaAccountStatus>("/granola/auth"),
  });
}

export function useConnectGranola() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiFetch<{ url: string }>("/granola/auth/connect", {
        method: "POST",
      });
      // Open in system browser (same pattern as Google Calendar OAuth)
      window.open(url, "_blank");
      return url;
    },
    onSuccess: () => {
      // Poll for connection status after OAuth flow
      const interval = setInterval(async () => {
        const status = await apiFetch<GranolaAccountStatus>("/granola/auth");
        if (status.connected) {
          clearInterval(interval);
          queryClient.invalidateQueries({ queryKey: ["granola"] });
        }
      }, 2000);
      // Stop polling after 2 minutes
      setTimeout(() => clearInterval(interval), 120_000);
    },
  });
}

export function useDisconnectGranola() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/granola/auth", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola"] });
    },
  });
}

export function useGranolaMeetingForEvent(calendarEventId: string | null) {
  return useQuery({
    queryKey: ["granola", "meeting", calendarEventId],
    queryFn: () =>
      apiFetch<GranolaMeetingRecord | null>(
        `/granola/auth/meetings/by-event/${calendarEventId}`,
      ),
    enabled: !!calendarEventId,
  });
}
```

- [ ] **Step 2: Add meetings-by-event endpoint to granola-auth route**

In `apps/api/src/routes/granola-auth.ts`, add before the `export default`:

```typescript
// GET /meetings/by-event/:eventId — Get Granola meeting linked to a calendar event
granolaAuth.get("/meetings/by-event/:eventId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");

  const meeting = await prisma.granolaMeeting.findFirst({
    where: { calendarEventId: eventId, userId: user.id },
    select: {
      id: true,
      granolaDocumentId: true,
      calendarEventId: true,
      title: true,
      summary: true,
      attendees: true,
      actionItems: true,
      meetingStartedAt: true,
      meetingEndedAt: true,
      syncedAt: true,
    },
  });

  return c.json(meeting);
});
```

Note: This route is registered under `/granola/auth` but could be split into a separate `/granola` route later. For now, keeping it simple.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/api/granola.ts apps/api/src/routes/granola-auth.ts
git commit -m "feat(granola): add desktop API hooks and meetings-by-event endpoint"
```

---

## Task 9: Settings UI — Granola Section

**Files:**
- Modify: `apps/desktop/src/settings/CalendarSection.tsx` (add Granola section)

- [ ] **Step 1: Read the current CalendarSection component**

Read `apps/desktop/src/settings/CalendarSection.tsx` to understand the exact UI pattern.

- [ ] **Step 2: Add Granola connection UI to Settings**

After the Google Calendar connected accounts section in `CalendarSection.tsx`, add a new "Granola" section. Follow the same glassmorphism card pattern:

```tsx
// Add imports at the top:
import { useGranolaAccount, useConnectGranola, useDisconnectGranola } from "../api/granola";

// Add after the Google Calendar section (inside the component return):
{/* Granola */}
<div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6 space-y-4">
  <div className="flex items-center justify-between">
    <h3 className="text-xs uppercase tracking-wider text-white/40 font-medium">
      Meeting Notes
    </h3>
  </div>

  {granolaAccount?.connected ? (
    <div className="bg-white/5 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
            <span className="text-amber-400 text-sm font-bold">G</span>
          </div>
          <div>
            <p className="text-sm font-medium text-white/80">
              {granolaAccount.account?.email}
            </p>
            <p className="text-xs text-white/30">
              {granolaAccount.account?.lastSyncAt
                ? `Last synced ${new Date(granolaAccount.account.lastSyncAt).toLocaleString()}`
                : "Syncing..."}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm("Disconnect Granola? Synced meeting notes will be removed, but tasks created from action items will remain.")) {
              disconnectGranola.mutate();
            }
          }}
          className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  ) : (
    <button
      onClick={() => connectGranola.mutate()}
      disabled={connectGranola.isPending}
      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/60 hover:text-white/80 transition-all"
    >
      Connect Granola
    </button>
  )}
</div>
```

Wire up the hooks inside the component:
```tsx
const { data: granolaAccount } = useGranolaAccount();
const connectGranola = useConnectGranola();
const disconnectGranola = useDisconnectGranola();
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/settings/CalendarSection.tsx
git commit -m "feat(granola): add Granola connection UI to Settings page"
```

---

## Task 10: Calendar Event Detail — Meeting Notes Section

**Files:**
- Modify: `packages/ui/src/CalendarEventDetailPanel.tsx`

- [ ] **Step 1: Read the current CalendarEventDetailPanel**

Read `packages/ui/src/CalendarEventDetailPanel.tsx` to understand the exact section pattern (around lines 280-350).

- [ ] **Step 2: Add Meeting Notes section**

The meeting notes section should go between the "Agenda" section (event description) and the "Attendees" section. Add a new prop for Granola meeting data and render the section.

Add to the component props interface:
```typescript
granolaMeeting?: {
  title: string;
  summary: string | null;
  transcript: { source: string; speaker: string; text: string }[] | null;
  actionItems: { title: string; dueDate?: string }[] | null;
  meetingStartedAt: string;
} | null;
onCreateActionItem?: (title: string, dueDate?: string) => void;
```

Add between the Agenda and Attendees sections:
```tsx
{/* Meeting Notes (Granola) */}
{granolaMeeting && (
  <div className="space-y-3">
    <h4 className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
      Meeting Notes
    </h4>

    {/* Summary */}
    {granolaMeeting.summary && (
      <div className="text-sm text-white/60 leading-relaxed whitespace-pre-wrap">
        {granolaMeeting.summary}
      </div>
    )}

    {/* Action Items */}
    {granolaMeeting.actionItems && granolaMeeting.actionItems.length > 0 && (
      <div className="space-y-2">
        <h5 className="text-[10px] uppercase tracking-wider text-white/25">
          Action Items
        </h5>
        {granolaMeeting.actionItems.map((item, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 text-sm text-white/50"
          >
            <span>• {item.title}</span>
            {onCreateActionItem && (
              <button
                onClick={() => onCreateActionItem(item.title, item.dueDate)}
                className="text-[10px] text-amber-400/50 hover:text-amber-400 transition-colors shrink-0"
              >
                + Task
              </button>
            )}
          </div>
        ))}
      </div>
    )}

    {/* Transcript (expandable) */}
    {granolaMeeting.transcript && granolaMeeting.transcript.length > 0 && (
      <details className="group">
        <summary className="text-[10px] uppercase tracking-wider text-white/25 cursor-pointer hover:text-white/40 transition-colors">
          Transcript ({granolaMeeting.transcript.length} turns)
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto space-y-1.5 text-xs">
          {granolaMeeting.transcript.map((turn, i) => (
            <div key={i} className="text-white/40">
              <span className="text-white/60 font-medium">{turn.speaker}: </span>
              {turn.text}
            </div>
          ))}
        </div>
      </details>
    )}
  </div>
)}
```

- [ ] **Step 3: Wire up the meeting data in the parent component**

In the page/view that renders `CalendarEventDetailPanel`, use the `useGranolaMeetingForEvent` hook to pass meeting data:

```typescript
const { data: granolaMeeting } = useGranolaMeetingForEvent(event?.id ?? null);

// Pass to panel:
<CalendarEventDetailPanel
  detail={detail}
  granolaMeeting={granolaMeeting}
  onCreateActionItem={(title, dueDate) => {
    // Create task via API
  }}
  // ... other props
/>
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/CalendarEventDetailPanel.tsx
git commit -m "feat(granola): add Meeting Notes section to calendar event detail panel"
```

---

## Task 11: Inbox Task Provenance — "From Meeting" Indicator

**Files:**
- Modify: `packages/types/src/index.ts` (add granolaMeetingTitle to Thing)
- Modify: `packages/business/src/index.ts` (update itemToThing)
- Modify: Task card component (ThingCard or InboxItemRow)

- [ ] **Step 1: Add granola provenance to Thing type**

In `packages/types/src/index.ts`, add to the `Thing` interface (around line 117):
```typescript
  granolaMeetingTitle?: string; // Shows "from meeting: {title}" for Granola-created tasks
```

- [ ] **Step 2: Update itemToThing to include provenance**

In `packages/business/src/index.ts`, update the `itemToThing()` function:

First, update the input type. The current function signature accepts `item: ItemRecord & { list: { name: string } | null }`. Expand it to also accept the Granola meeting relation:

```typescript
// Update the type parameter — add granolaMeeting to the intersection type:
type ItemWithRelations = ItemRecord & {
  list: { name: string } | null;
  granolaMeeting?: { title: string } | null;
};

export function itemToThing(item: ItemWithRelations): Thing {
```

Then add the mapping inside the returned object:
```typescript
  granolaMeetingTitle: item.granolaMeeting?.title ?? undefined,
```

This is a backward-compatible change — `granolaMeeting` is optional, so existing callers that don't include it will still work (the field will be `undefined`).

- [ ] **Step 3: Update things route query to include granolaMeeting**

In `apps/api/src/routes/things.ts`, update the Prisma queries that fetch items to include the Granola meeting relation:
```typescript
include: { list: { select: { name: true } }, granolaMeeting: { select: { title: true } } }
```

- [ ] **Step 4: Add "from meeting" indicator to task card**

In the task card component (check `ThingCard` and `InboxItemRow`), add a small indicator below the task title for Granola-sourced tasks:
```tsx
{thing.source === "Granola" && thing.granolaMeetingTitle && (
  <span className="text-[10px] text-amber-400/40">
    from {thing.granolaMeetingTitle}
  </span>
)}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/index.ts packages/business/src/index.ts apps/api/src/routes/things.ts packages/ui/src/
git commit -m "feat(granola): add 'from meeting' provenance indicator on Granola-created tasks"
```

---

## Task 12: Update MCP Placeholder Package

**Files:**
- Modify: `packages/ai/src/mcp/client.ts`
- Modify: `packages/ai/src/mcp/granola.ts`

Clean up the placeholder MCP code now that the real client lives in `apps/api/src/lib/granola-mcp.ts`.

- [ ] **Step 1: Update placeholder to note real implementation location**

Replace `packages/ai/src/mcp/granola.ts`:
```typescript
/**
 * @deprecated Real Granola MCP client lives in apps/api/src/lib/granola-mcp.ts
 * This file is kept for backward compatibility with the skill imports.
 * Skills now query the local DB directly instead of calling MCP.
 */

// No-op — skills use Prisma directly, MCP client is server-side only
export function createGranolaClient(): null {
  return null;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/mcp/
git commit -m "refactor(granola): deprecate MCP placeholder — real client is server-side"
```

---

## Task 13: Final Integration Test & Typecheck

- [ ] **Step 1: Full typecheck across monorepo**

```bash
pnpm typecheck
```
Expected: PASS across all packages.

- [ ] **Step 2: Run existing tests to verify no regressions**

```bash
pnpm test
```
Expected: All existing tests pass.

- [ ] **Step 3: Run the matching algorithm tests**

```bash
cd apps/api && pnpm vitest run src/__tests__/meeting-matcher.test.ts
```
Expected: All matching tests pass.

- [ ] **Step 4: Manual verification checklist**

Run `pnpm dev:full` and verify:
- [ ] Settings page shows Granola section (disconnected state)
- [ ] "Connect Granola" button opens system browser
- [ ] After OAuth, account shows as connected with email
- [ ] Calendar event detail panel shows "Meeting Notes" section when data exists
- [ ] Chat queries about meetings return results
- [ ] Action items created from meetings show "from meeting" indicator
- [ ] Disconnect removes Granola data, tasks remain

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "feat(granola): integration cleanup and verification"
```
