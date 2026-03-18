# Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Google Calendar with real-time sync, event detail panel, and full calendar page views.

**Architecture:** Google Calendar API via OAuth (separate from sign-in auth) → server-side sync engine with webhooks → SSE event bus for real-time UI updates → React Query cache invalidation. Reusable SSE infrastructure for future real-time features.

**Tech Stack:** Google Calendar API v3, Hono SSE streaming, Prisma, AES-256-GCM token encryption, React Query, TipTap, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-17-calendar-integration-design.md`

---

## File Structure

### New Files — API
| File | Responsibility |
|------|---------------|
| `apps/api/src/lib/token-encryption.ts` | AES-256-GCM encrypt/decrypt for OAuth tokens |
| `apps/api/src/lib/google-calendar.ts` | Google Calendar API client wrapper (auth, refresh, API calls) |
| `apps/api/src/lib/sse.ts` | SSE connection registry + event publisher |
| `apps/api/src/services/calendar-sync.ts` | Sync engine: initial, incremental, full, on-demand |
| `apps/api/src/services/calendar-colors.ts` | Google colorId → glass morphism CSS mapping |
| `apps/api/src/services/meeting-link.ts` | Extract Zoom/Meet/Teams URLs from events |
| `apps/api/src/routes/calendar.ts` | Calendar event routes (list, detail, RSVP, notes, brett) |
| `apps/api/src/routes/calendar-accounts.ts` | Account connection routes (connect, callback, disconnect, calendars) |
| `apps/api/src/routes/webhooks.ts` | Google push notification webhook receiver |
| `apps/api/src/routes/sse.ts` | SSE stream endpoint |
| `apps/api/src/jobs/cron.ts` | Webhook renewal + periodic reconciliation |

### New Files — Types & Business
| File | Responsibility |
|------|---------------|
| `packages/types/src/calendar.ts` | All calendar-related TypeScript interfaces |
| `packages/business/src/calendar-validation.ts` | Validation for calendar inputs (RSVP, notes) |

### New Files — Desktop
| File | Responsibility |
|------|---------------|
| `apps/desktop/src/api/calendar.ts` | React Query hooks for calendar events |
| `apps/desktop/src/api/calendar-accounts.ts` | React Query hooks for account management |
| `apps/desktop/src/api/sse.ts` | `useEventStream()` hook — SSE connection + cache invalidation |
| `apps/desktop/src/pages/CalendarPage.tsx` | Full calendar page with view switcher |
| `apps/desktop/src/components/calendar/CalendarDayView.tsx` | Day view time grid |
| `apps/desktop/src/components/calendar/CalendarWeekView.tsx` | Week/X-day view multi-column grid |
| `apps/desktop/src/components/calendar/CalendarMonthView.tsx` | Month grid with event pills |
| `apps/desktop/src/components/calendar/CalendarHeader.tsx` | Navigation bar: view switcher, date nav, today button |
| `apps/desktop/src/components/calendar/EventTooltip.tsx` | Progressive disclosure hover tooltip (re-exports from `@brett/ui`) |
| `apps/desktop/src/settings/CalendarSection.tsx` | Connected accounts settings UI |

### New Files — UI Package
| File | Responsibility |
|------|---------------|
| `packages/ui/src/CalendarEventDetailPanel.tsx` | Event detail slideout panel content |

### Modified Files
| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | Add GoogleAccount, CalendarList, CalendarEvent, CalendarEventNote; modify BrettMessage |
| `apps/api/src/app.ts` | Mount new routes (calendar, calendar-accounts, webhooks, sse) |
| `packages/types/src/index.ts` | Re-export from `calendar.ts`, rename existing CalendarEvent → CalendarEventDisplay |
| `packages/business/src/index.ts` | Re-export from `calendar-validation.ts` |
| `packages/ui/src/DetailPanel.tsx` | Support CalendarEvent type discrimination |
| `packages/ui/src/CalendarTimeline.tsx` | Real data, live time indicator, conflicts, countdown, buffer |
| `packages/ui/src/LeftNav.tsx` | Add calendar nav entry with CalendarDays icon from lucide-react |
| `packages/ui/src/index.ts` | Export CalendarEventDetailPanel, EventHoverTooltip |
| `apps/desktop/src/App.tsx` | Add /calendar route (standalone, not in MainLayout), wire CalendarEventDetailPanel + calendar callbacks, init SSE, replace mockEvents with real data |
| `apps/desktop/src/data/mockData.ts` | Update mock CalendarEvent shape or remove |
| `apps/desktop/src/settings/SettingsPage.tsx` | Add CalendarSection |
| `apps/desktop/src/auth/auth-client.ts` | Export helper for calendar-specific OAuth |
| `apps/desktop/electron/main.ts` | Handle calendar OAuth callback deep link |

---

## Chunk 1: Data Model & Token Encryption

### Task 1.1: Prisma Schema — New Calendar Models

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add GoogleAccount model**

Add after the existing `Account` model (better-auth):

```prisma
model GoogleAccount {
  id              String    @id @default(uuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  googleEmail     String
  googleUserId    String
  accessToken     String    @db.Text
  refreshToken    String    @db.Text
  tokenExpiresAt  DateTime
  connectedAt     DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  calendars       CalendarList[]
  events          CalendarEvent[]

  @@unique([userId, googleUserId])
  @@index([userId])
}
```

- [ ] **Step 2: Add CalendarList model**

```prisma
model CalendarList {
  id                String    @id @default(uuid())
  googleAccountId   String
  googleAccount     GoogleAccount @relation(fields: [googleAccountId], references: [id], onDelete: Cascade)
  googleCalendarId  String
  name              String
  color             String
  isVisible         Boolean   @default(true)
  isPrimary         Boolean   @default(false)
  watchChannelId    String?
  watchResourceId   String?
  watchToken        String?
  watchExpiration   DateTime?
  syncToken         String?

  events            CalendarEvent[]

  @@unique([googleAccountId, googleCalendarId])
  @@index([googleAccountId])
}
```

- [ ] **Step 3: Add CalendarEvent model**

```prisma
model CalendarEvent {
  id                String    @id @default(uuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  googleAccountId   String
  googleAccount     GoogleAccount @relation(fields: [googleAccountId], references: [id], onDelete: Cascade)
  calendarListId    String
  calendarList      CalendarList @relation(fields: [calendarListId], references: [id], onDelete: Cascade)
  googleEventId     String
  title             String
  description       String?   @db.Text
  location          String?
  startTime         DateTime
  endTime           DateTime
  isAllDay          Boolean   @default(false)
  status            String    @default("confirmed")
  myResponseStatus  String    @default("needsAction")
  recurrence        String?
  recurringEventId  String?
  meetingLink       String?
  googleColorId     String?
  organizer         Json?
  attendees         Json?
  attachments       Json?
  rawGoogleEvent    Json?
  syncedAt          DateTime  @default(now())
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  notes             CalendarEventNote[]
  brettMessages     BrettMessage[]

  @@unique([googleAccountId, googleEventId])
  @@index([userId, startTime])
  @@index([calendarListId])
}
```

- [ ] **Step 4: Add CalendarEventNote model**

```prisma
model CalendarEventNote {
  id                String    @id @default(uuid())
  calendarEventId   String
  calendarEvent     CalendarEvent @relation(fields: [calendarEventId], references: [id], onDelete: Cascade)
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  content           String    @db.Text
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([calendarEventId, userId])
  @@index([userId])
}
```

- [ ] **Step 5: Add relations to User model**

Add to existing `User` model:

```prisma
  googleAccounts    GoogleAccount[]
  calendarEvents    CalendarEvent[]
  calendarEventNotes CalendarEventNote[]
```

- [ ] **Step 6: Modify BrettMessage — dual nullable FKs**

Change existing `BrettMessage` model from:
```prisma
model BrettMessage {
  id        String   @id @default(uuid())
  itemId    String
  item      Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  role      String
  content   String   @db.Text
  createdAt DateTime @default(now())

  @@index([itemId, createdAt])
}
```

To:
```prisma
model BrettMessage {
  id                String    @id @default(uuid())
  itemId            String?
  item              Item?     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  calendarEventId   String?
  calendarEvent     CalendarEvent? @relation(fields: [calendarEventId], references: [id], onDelete: Cascade)
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role              String
  content           String    @db.Text
  createdAt         DateTime  @default(now())

  @@index([itemId, createdAt])
  @@index([calendarEventId, createdAt])
  @@index([userId])
}
```

**Important:** The `userId` and `user` relation MUST be retained from the existing model — they are required fields. Only `itemId` changes from required to optional, and `calendarEventId` is added.

- [ ] **Step 7: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name add-calendar-models
```

- [ ] **Step 8: Verify Prisma client generates**

```bash
cd apps/api && npx prisma generate
```

- [ ] **Step 9: Typecheck**

```bash
pnpm typecheck
```

Note: BrettMessage `itemId` becoming nullable may cause type errors in `apps/api/src/routes/brett.ts` — the existing route filters by `itemId` which is still valid, but Prisma types will require the field to be `string | null`. Fix any resulting type errors by adding non-null assertions where the route guarantees `itemId` is set (the route param `:itemId` ensures it).

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add calendar models and BrettMessage dual FK migration"
```

### Task 1.2: Token Encryption Utility

**Files:**
- Create: `apps/api/src/lib/token-encryption.ts`
- Test: `apps/api/src/lib/__tests__/token-encryption.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/lib/__tests__/token-encryption.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "../token-encryption";

describe("token-encryption", () => {
  beforeAll(() => {
    // Set test key (32 bytes hex = 64 chars)
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("encrypts and decrypts a token round-trip", () => {
    const token = "ya29.a0AfH6SMA_test_access_token_value";
    const encrypted = encryptToken(token);
    expect(encrypted).not.toBe(token);
    expect(encrypted).toContain(":"); // iv:ciphertext:tag format
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(token);
  });

  it("produces different ciphertexts for same input (random IV)", () => {
    const token = "same_token";
    const a = encryptToken(token);
    const b = encryptToken(token);
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptToken("test");
    const parts = encrypted.split(":");
    parts[1] = parts[1].replace(/^./, "f"); // tamper
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });

  it("throws if key is missing", () => {
    const origKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
    delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("test")).toThrow("CALENDAR_TOKEN_ENCRYPTION_KEY");
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = origKey;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run src/lib/__tests__/token-encryption.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement token encryption**

```typescript
// apps/api/src/lib/token-encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const hex = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY environment variable is required");
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const [ivHex, encHex, tagHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run src/lib/__tests__/token-encryption.test.ts
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/token-encryption.ts apps/api/src/lib/__tests__/token-encryption.test.ts
git commit -m "feat: AES-256-GCM token encryption for Google OAuth tokens"
```

### Task 1.3: Calendar TypeScript Types

**Files:**
- Create: `packages/types/src/calendar.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create calendar types**

```typescript
// packages/types/src/calendar.ts

// ── Database record types ──

export interface GoogleAccountRecord {
  id: string;
  userId: string;
  googleEmail: string;
  googleUserId: string;
  connectedAt: string;
  updatedAt: string;
}

export interface CalendarListRecord {
  id: string;
  googleAccountId: string;
  googleCalendarId: string;
  name: string;
  color: string;
  isVisible: boolean;
  isPrimary: boolean;
}

export interface CalendarEventRecord {
  id: string;
  userId: string;
  googleAccountId: string;
  calendarListId: string;
  googleEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string; // ISO
  endTime: string; // ISO
  isAllDay: boolean;
  status: string;
  myResponseStatus: CalendarRsvpStatus;
  recurrence: string | null;
  recurringEventId: string | null;
  meetingLink: string | null;
  googleColorId: string | null;
  organizer: CalendarAttendee | null;
  attendees: CalendarAttendee[];
  attachments: CalendarAttachment[];
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ── View model types ──

export interface CalendarEventDisplay {
  id: string;
  title: string;
  startTime: string; // "HH:MM" for timeline, ISO for full calendar
  endTime: string;
  durationMinutes: number;
  color: CalendarGlassColor;
  location?: string;
  attendees?: { name: string; initials: string; email?: string; responseStatus?: string }[];
  brettObservation?: string;
  hasBrettContext: boolean;
  meetingLink?: string;
  isAllDay: boolean;
  myResponseStatus: CalendarRsvpStatus;
  recurrence?: string;
  calendarName?: string;
  description?: string;
  googleEventId: string;
}

export interface CalendarEventDetail extends CalendarEventRecord {
  calendarName: string;
  calendarColor: string;
  notes: string | null;
  brettMessages: BrettMessageRecord[];
  brettObservation: string | null;
  brettTakeGeneratedAt: string | null;
}

// ── Attendee & Attachment ──

export interface CalendarAttendee {
  name: string;
  email: string;
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  organizer?: boolean;
}

export interface CalendarAttachment {
  title: string;
  url: string;
  mimeType?: string;
}

// ── RSVP ──

export type CalendarRsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

export interface RsvpInput {
  status: CalendarRsvpStatus;
  comment?: string;
}

// ── Color mapping ──

export interface CalendarGlassColor {
  bg: string;      // e.g. "rgba(59,130,246,0.15)"
  border: string;  // e.g. "rgba(59,130,246,0.4)"
  text: string;    // e.g. "rgba(59,130,246,0.9)"
  name: string;    // e.g. "blue"
}

// ── Account management ──

export interface ConnectedCalendarAccount {
  id: string;
  googleEmail: string;
  connectedAt: string;
  calendars: CalendarListRecord[];
}

// ── SSE event types ──

export type SSEEventType =
  | "calendar.event.created"
  | "calendar.event.updated"
  | "calendar.event.deleted"
  | "calendar.sync.complete";

export interface SSEEvent {
  type: SSEEventType;
  payload: Record<string, unknown>;
}

// ── API response types ──

export interface CalendarEventsResponse {
  events: CalendarEventRecord[];
}

export interface CalendarEventDetailResponse extends CalendarEventDetail {}

export interface BrettMessageRecord {
  id: string;
  role: "user" | "brett";
  content: string;
  createdAt: string;
}

// ── Notes ──

export interface CalendarEventNoteInput {
  content: string;
}
```

- [ ] **Step 2: Update types index — rename existing CalendarEvent, re-export**

In `packages/types/src/index.ts`, find the existing `CalendarEvent` interface and rename it. Then add re-export.

The existing `CalendarEvent` type (used by CalendarTimeline mock data) should be replaced by importing `CalendarEventDisplay` from the new file. Find and rename:

```typescript
// Old: export interface CalendarEvent { ... }
// New: remove it entirely — CalendarEventDisplay in calendar.ts replaces it
```

Add at the bottom of `packages/types/src/index.ts`:

```typescript
export * from "./calendar";
```

- [ ] **Step 3: Update mockData.ts to use CalendarEventDisplay**

In `apps/desktop/src/data/mockData.ts`, update the import from `CalendarEvent` to `CalendarEventDisplay` and adjust the mock data shape to match the new interface.

- [ ] **Step 4: Update CalendarTimeline.tsx imports**

Change `CalendarEvent` → `CalendarEventDisplay` in `packages/ui/src/CalendarTimeline.tsx`.

- [ ] **Step 5: Update DetailPanel.tsx imports and discrimination**

Change `CalendarEvent` → `CalendarEventDisplay` in `packages/ui/src/DetailPanel.tsx`. Update type discrimination to use a more explicit check (e.g., `'googleEventId' in item` or add a `type` discriminator field).

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/types/ packages/ui/src/CalendarTimeline.tsx packages/ui/src/DetailPanel.tsx apps/desktop/src/data/mockData.ts
git commit -m "feat(types): add calendar types, rename CalendarEvent → CalendarEventDisplay"
```

### Task 1.4: Calendar Validation Functions

**Files:**
- Create: `packages/business/src/calendar-validation.ts`
- Test: `packages/business/src/__tests__/calendar-validation.test.ts`
- Modify: `packages/business/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/business/src/__tests__/calendar-validation.test.ts
import { describe, it, expect } from "vitest";
import { validateRsvpInput, validateCalendarNoteInput } from "../calendar-validation";

describe("validateRsvpInput", () => {
  it("accepts valid RSVP with status only", () => {
    const result = validateRsvpInput({ status: "accepted" });
    expect(result.ok).toBe(true);
  });

  it("accepts valid RSVP with comment", () => {
    const result = validateRsvpInput({ status: "tentative", comment: "Running late" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.comment).toBe("Running late");
  });

  it("rejects invalid status", () => {
    const result = validateRsvpInput({ status: "maybe" as any });
    expect(result.ok).toBe(false);
  });

  it("rejects missing status", () => {
    const result = validateRsvpInput({} as any);
    expect(result.ok).toBe(false);
  });

  it("rejects comment over 500 chars", () => {
    const result = validateRsvpInput({ status: "accepted", comment: "x".repeat(501) });
    expect(result.ok).toBe(false);
  });
});

describe("validateCalendarNoteInput", () => {
  it("accepts valid note", () => {
    const result = validateCalendarNoteInput({ content: "My notes" });
    expect(result.ok).toBe(true);
  });

  it("rejects empty content", () => {
    const result = validateCalendarNoteInput({ content: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects content over 50KB", () => {
    const result = validateCalendarNoteInput({ content: "x".repeat(50 * 1024 + 1) });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/business && npx vitest run src/__tests__/calendar-validation.test.ts
```

- [ ] **Step 3: Implement validation**

**Important:** Follow the existing codebase validation pattern — return `{ ok: true, data }` or `{ ok: false, error }` result objects, NOT throwing. Match the pattern in `validateCreateItem`, `validateCreateBrettMessage`, etc.

```typescript
// packages/business/src/calendar-validation.ts
import type { RsvpInput, CalendarEventNoteInput } from "@brett/types";

const VALID_RSVP_STATUSES = ["accepted", "declined", "tentative", "needsAction"];
const MAX_COMMENT_LENGTH = 500;
const MAX_NOTE_SIZE = 50 * 1024; // 50KB

type ValidationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function validateRsvpInput(input: RsvpInput): ValidationResult<RsvpInput> {
  if (!input.status || !VALID_RSVP_STATUSES.includes(input.status)) {
    return { ok: false, error: `Invalid status: must be one of ${VALID_RSVP_STATUSES.join(", ")}` };
  }
  if (input.comment !== undefined && input.comment.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `comment must be ${MAX_COMMENT_LENGTH} characters or fewer` };
  }
  return { ok: true, data: input };
}

export function validateCalendarNoteInput(input: CalendarEventNoteInput): ValidationResult<CalendarEventNoteInput> {
  if (!input.content || input.content.length === 0) {
    return { ok: false, error: "content is required" };
  }
  if (input.content.length > MAX_NOTE_SIZE) {
    return { ok: false, error: `content must be ${MAX_NOTE_SIZE} bytes or fewer` };
  }
  return { ok: true, data: input };
}
```

- [ ] **Step 4: Re-export from business index**

Add to `packages/business/src/index.ts`:

```typescript
export { validateRsvpInput, validateCalendarNoteInput } from "./calendar-validation";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/business && npx vitest run src/__tests__/calendar-validation.test.ts
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/business/src/calendar-validation.ts packages/business/src/__tests__/calendar-validation.test.ts packages/business/src/index.ts
git commit -m "feat(business): add calendar RSVP and note validation"
```

---

## Chunk 2: Google Calendar API Client & Sync Engine

### Task 2.1: Google Calendar API Client

**Files:**
- Create: `apps/api/src/lib/google-calendar.ts`
- Test: `apps/api/src/lib/__tests__/google-calendar.test.ts`

- [ ] **Step 1: Install googleapis dependency**

```bash
cd apps/api && pnpm add googleapis
```

- [ ] **Step 2: Write the Google Calendar client**

```typescript
// apps/api/src/lib/google-calendar.ts
import { google, calendar_v3 } from "googleapis";
import { prisma } from "./prisma";
import { encryptToken, decryptToken } from "./token-encryption";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
  "profile",
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BETTER_AUTH_URL}/calendar/accounts/callback`
  );
}

/** Generate OAuth URL for calendar connection */
export function getCalendarAuthUrl(state: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

/** Exchange auth code for tokens */
export async function exchangeCalendarCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/** Get an authenticated Calendar API client for a GoogleAccount */
export async function getCalendarClient(
  googleAccountId: string
): Promise<calendar_v3.Calendar> {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
  });

  const client = getOAuth2Client();
  const accessToken = decryptToken(account.accessToken);
  const refreshToken = decryptToken(account.refreshToken);

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.tokenExpiresAt.getTime(),
  });

  // Auto-refresh: listen for token refresh events
  client.on("tokens", async (tokens) => {
    const updates: Record<string, unknown> = {};
    if (tokens.access_token) {
      updates.accessToken = encryptToken(tokens.access_token);
    }
    if (tokens.refresh_token) {
      updates.refreshToken = encryptToken(tokens.refresh_token);
    }
    if (tokens.expiry_date) {
      updates.tokenExpiresAt = new Date(tokens.expiry_date);
    }
    if (Object.keys(updates).length > 0) {
      await prisma.googleAccount.update({
        where: { id: googleAccountId },
        data: updates,
      });
    }
  });

  return google.calendar({ version: "v3", auth: client });
}

/** Fetch all calendars for an account */
export async function fetchCalendarList(
  calendarClient: calendar_v3.Calendar
): Promise<calendar_v3.Schema$CalendarListEntry[]> {
  const res = await calendarClient.calendarList.list();
  return res.data.items ?? [];
}

/** Fetch events with optional sync token for incremental sync */
export async function fetchEvents(
  calendarClient: calendar_v3.Calendar,
  calendarId: string,
  options: {
    syncToken?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  } = {}
): Promise<{
  events: calendar_v3.Schema$Event[];
  nextSyncToken: string | undefined;
}> {
  const allEvents: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      maxResults: options.maxResults ?? 250,
      singleEvents: true,
      orderBy: "startTime",
      pageToken,
    };

    if (options.syncToken) {
      params.syncToken = options.syncToken;
    } else {
      if (options.timeMin) params.timeMin = options.timeMin;
      if (options.timeMax) params.timeMax = options.timeMax;
    }

    const res = await calendarClient.events.list(params);
    allEvents.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
    nextSyncToken = res.data.nextSyncToken ?? undefined;
  } while (pageToken);

  return { events: allEvents, nextSyncToken };
}

/** Update RSVP status on an event */
export async function updateRsvp(
  calendarClient: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
  selfEmail: string,
  status: string,
  comment?: string
): Promise<void> {
  const event = await calendarClient.events.get({
    calendarId,
    eventId,
  });

  const attendees = event.data.attendees ?? [];
  const selfAttendee = attendees.find(
    (a) => a.email?.toLowerCase() === selfEmail.toLowerCase() || a.self
  );

  if (selfAttendee) {
    selfAttendee.responseStatus = status;
    if (comment !== undefined) {
      selfAttendee.comment = comment;
    }
  }

  await calendarClient.events.patch({
    calendarId,
    eventId,
    requestBody: { attendees },
  });
}

/** Register a webhook watch on a calendar */
export async function watchCalendar(
  calendarClient: calendar_v3.Calendar,
  calendarId: string,
  channelId: string,
  token: string
): Promise<{ resourceId: string; expiration: number }> {
  const webhookUrl = `${process.env.GOOGLE_WEBHOOK_BASE_URL}/webhooks/google-calendar`;
  const res = await calendarClient.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      token,
      params: { ttl: "604800" }, // 7 days
    },
  });

  return {
    resourceId: res.data.resourceId!,
    expiration: Number(res.data.expiration!),
  };
}

/** Stop a webhook watch */
export async function stopWatch(
  calendarClient: calendar_v3.Calendar,
  channelId: string,
  resourceId: string
): Promise<void> {
  await calendarClient.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}

/** Fetch Google's color definitions */
export async function fetchColors(
  calendarClient: calendar_v3.Calendar
): Promise<calendar_v3.Schema$Colors> {
  const res = await calendarClient.colors.get();
  return res.data;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/google-calendar.ts apps/api/package.json apps/api/pnpm-lock.yaml
git commit -m "feat: Google Calendar API client wrapper"
```

### Task 2.2: Meeting Link Extraction

**Files:**
- Create: `apps/api/src/services/meeting-link.ts`
- Test: `apps/api/src/services/__tests__/meeting-link.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/__tests__/meeting-link.test.ts
import { describe, it, expect } from "vitest";
import { extractMeetingLink } from "../meeting-link";

describe("extractMeetingLink", () => {
  it("extracts from conferenceData (Google Meet)", () => {
    const event = {
      conferenceData: {
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        ],
      },
    };
    expect(extractMeetingLink(event)).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("extracts Zoom from location", () => {
    const event = { location: "https://zoom.us/j/123456789" };
    expect(extractMeetingLink(event)).toBe("https://zoom.us/j/123456789");
  });

  it("extracts Teams from description", () => {
    const event = {
      description: "Join here: https://teams.microsoft.com/l/meetup-join/abc123 see you",
    };
    expect(extractMeetingLink(event)).toContain("teams.microsoft.com");
  });

  it("prioritizes conferenceData over location", () => {
    const event = {
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/xxx" }],
      },
      location: "https://zoom.us/j/999",
    };
    expect(extractMeetingLink(event)).toBe("https://meet.google.com/xxx");
  });

  it("returns null when no meeting link found", () => {
    const event = { location: "Conference Room A", description: "Agenda: ..." };
    expect(extractMeetingLink(event)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run src/services/__tests__/meeting-link.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/services/meeting-link.ts
import type { calendar_v3 } from "googleapis";

const MEETING_URL_PATTERNS = [
  /https?:\/\/meet\.google\.com\/[a-z\-]+/i,
  /https?:\/\/[\w.]*zoom\.us\/j\/\d+[^\s"]*/i,
  /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"]*/i,
  /https?:\/\/[\w.]*webex\.com\/[^\s"]*/i,
];

export function extractMeetingLink(
  event: Partial<calendar_v3.Schema$Event>
): string | null {
  // Priority 1: conferenceData
  if (event.conferenceData?.entryPoints) {
    const video = event.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === "video"
    );
    if (video?.uri) return video.uri;
  }

  // Priority 2: location field
  if (event.location) {
    for (const pattern of MEETING_URL_PATTERNS) {
      const match = event.location.match(pattern);
      if (match) return match[0];
    }
  }

  // Priority 3: description field
  if (event.description) {
    for (const pattern of MEETING_URL_PATTERNS) {
      const match = event.description.match(pattern);
      if (match) return match[0];
    }
  }

  return null;
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx vitest run src/services/__tests__/meeting-link.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/meeting-link.ts apps/api/src/services/__tests__/meeting-link.test.ts
git commit -m "feat: meeting link extraction from Google Calendar events"
```

### Task 2.3: Calendar Color Mapping

**Files:**
- Create: `apps/api/src/services/calendar-colors.ts`
- Test: `apps/api/src/services/__tests__/calendar-colors.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/__tests__/calendar-colors.test.ts
import { describe, it, expect } from "vitest";
import { googleColorToGlass, getGlassColorForEvent } from "../calendar-colors";

describe("googleColorToGlass", () => {
  it("maps a blue-ish hex to blue glass", () => {
    const result = googleColorToGlass("#4285f4");
    expect(result.name).toBe("blue");
    expect(result.bg).toContain("rgba");
  });

  it("maps a red-ish hex to red glass", () => {
    const result = googleColorToGlass("#dc2626");
    expect(result.name).toBe("red");
  });

  it("maps a green-ish hex to green glass", () => {
    const result = googleColorToGlass("#16a765");
    expect(result.name).toBe("green");
  });

  it("returns a default for unknown colors", () => {
    const result = googleColorToGlass("#000000");
    expect(result.name).toBeDefined();
  });
});

describe("getGlassColorForEvent", () => {
  it("uses event colorId when present", () => {
    const result = getGlassColorForEvent("1", "5", {
      event: { "1": { background: "#a4bdfc" } },
      calendar: { "5": { background: "#ff0000" } },
    });
    expect(result.name).toBeDefined();
  });

  it("falls back to calendar colorId", () => {
    const result = getGlassColorForEvent(null, "5", {
      event: {},
      calendar: { "5": { background: "#ff0000" } },
    });
    expect(result.name).toBe("red");
  });

  it("returns default when no color info", () => {
    const result = getGlassColorForEvent(null, null, { event: {}, calendar: {} });
    expect(result.name).toBe("blue");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run src/services/__tests__/calendar-colors.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/services/calendar-colors.ts
import type { CalendarGlassColor } from "@brett/types";

interface ColorDefs {
  event: Record<string, { background: string }>;
  calendar: Record<string, { background: string }>;
}

const GLASS_COLORS: Record<string, CalendarGlassColor> = {
  blue: { bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.4)", text: "rgba(59,130,246,0.9)", name: "blue" },
  red: { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.4)", text: "rgba(239,68,68,0.9)", name: "red" },
  green: { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.4)", text: "rgba(16,185,129,0.9)", name: "green" },
  purple: { bg: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.4)", text: "rgba(139,92,246,0.9)", name: "purple" },
  amber: { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)", text: "rgba(245,158,11,0.9)", name: "amber" },
  teal: { bg: "rgba(20,184,166,0.15)", border: "rgba(20,184,166,0.4)", text: "rgba(20,184,166,0.9)", name: "teal" },
  pink: { bg: "rgba(236,72,153,0.15)", border: "rgba(236,72,153,0.4)", text: "rgba(236,72,153,0.9)", name: "pink" },
  indigo: { bg: "rgba(99,102,241,0.15)", border: "rgba(99,102,241,0.4)", text: "rgba(99,102,241,0.9)", name: "indigo" },
  orange: { bg: "rgba(249,115,22,0.15)", border: "rgba(249,115,22,0.4)", text: "rgba(249,115,22,0.9)", name: "orange" },
  cyan: { bg: "rgba(6,182,212,0.15)", border: "rgba(6,182,212,0.4)", text: "rgba(6,182,212,0.9)", name: "cyan" },
};

const DEFAULT_COLOR = GLASS_COLORS.blue;

/** Map a hex color to the nearest glass morphism variant */
export function googleColorToGlass(hex: string): CalendarGlassColor {
  const rgb = hexToRgb(hex);
  if (!rgb) return DEFAULT_COLOR;

  const hue = rgbToHue(rgb.r, rgb.g, rgb.b);
  const saturation = rgbToSaturation(rgb.r, rgb.g, rgb.b);

  // Low saturation → default blue
  if (saturation < 15) return DEFAULT_COLOR;

  // Map hue ranges to named colors
  if (hue < 15 || hue >= 345) return GLASS_COLORS.red;
  if (hue < 40) return GLASS_COLORS.orange;
  if (hue < 65) return GLASS_COLORS.amber;
  if (hue < 160) return GLASS_COLORS.green;
  if (hue < 190) return GLASS_COLORS.teal;
  if (hue < 220) return GLASS_COLORS.cyan;
  if (hue < 255) return GLASS_COLORS.blue;
  if (hue < 275) return GLASS_COLORS.indigo;
  if (hue < 310) return GLASS_COLORS.purple;
  return GLASS_COLORS.pink;
}

/** Get glass color for a specific event, resolving colorId hierarchy */
export function getGlassColorForEvent(
  eventColorId: string | null,
  calendarColorId: string | null,
  colorDefs: ColorDefs
): CalendarGlassColor {
  // Event color takes priority
  if (eventColorId && colorDefs.event[eventColorId]) {
    return googleColorToGlass(colorDefs.event[eventColorId].background);
  }
  // Fall back to calendar color
  if (calendarColorId && colorDefs.calendar[calendarColorId]) {
    return googleColorToGlass(colorDefs.calendar[calendarColorId].background);
  }
  return DEFAULT_COLOR;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function rgbToHue(r: number, g: number, b: number): number {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return h;
}

function rgbToSaturation(r: number, g: number, b: number): number {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0) return 0;
  return ((max - min) / max) * 100;
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx vitest run src/services/__tests__/calendar-colors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/calendar-colors.ts apps/api/src/services/__tests__/calendar-colors.test.ts
git commit -m "feat: Google calendar color to glass morphism mapping"
```

### Task 2.4: Calendar Sync Engine

**Files:**
- Create: `apps/api/src/services/calendar-sync.ts`

- [ ] **Step 1: Implement sync service**

```typescript
// apps/api/src/services/calendar-sync.ts
import { prisma } from "../lib/prisma";
import { getCalendarClient, fetchCalendarList, fetchEvents, watchCalendar } from "../lib/google-calendar";
import { extractMeetingLink } from "./meeting-link";
import { publishSSE } from "../lib/sse";
import { generateId } from "@brett/utils";
import { createHmac } from "crypto";
import type { calendar_v3 } from "googleapis";

/** Initial sync: fetch calendar list + events, register webhooks */
export async function initialSync(googleAccountId: string): Promise<void> {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
    include: { calendars: true },
  });

  const client = await getCalendarClient(googleAccountId);

  // 1. Fetch calendar list
  const googleCalendars = await fetchCalendarList(client);

  for (const gcal of googleCalendars) {
    if (!gcal.id) continue;

    const existing = account.calendars.find(
      (c) => c.googleCalendarId === gcal.id
    );

    const calendarList = existing
      ? await prisma.calendarList.update({
          where: { id: existing.id },
          data: {
            name: gcal.summary ?? "Untitled",
            color: gcal.backgroundColor ?? "#4285f4",
            isPrimary: gcal.primary ?? false,
          },
        })
      : await prisma.calendarList.create({
          data: {
            id: generateId(),
            googleAccountId,
            googleCalendarId: gcal.id,
            name: gcal.summary ?? "Untitled",
            color: gcal.backgroundColor ?? "#4285f4",
            isVisible: true,
            isPrimary: gcal.primary ?? false,
          },
        });

    // 2. Fetch events (30 days back, 90 days forward)
    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const { events, nextSyncToken } = await fetchEvents(client, gcal.id, {
      timeMin,
      timeMax,
    });

    // Upsert events
    await upsertEvents(events, account.userId, googleAccountId, calendarList.id);

    // Store sync token per-calendar (not per-account!)
    if (nextSyncToken) {
      await prisma.calendarList.update({
        where: { id: calendarList.id },
        data: { syncToken: nextSyncToken },
      });
    }

    // 3. Register webhook
    if (process.env.GOOGLE_WEBHOOK_BASE_URL) {
      await registerWebhook(client, calendarList.id, gcal.id);
    }
  }

  publishSSE(account.userId, {
    type: "calendar.sync.complete",
    payload: { accountId: googleAccountId },
  });
}

/** Incremental sync using per-calendar syncTokens */
export async function incrementalSync(googleAccountId: string): Promise<void> {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
    include: { calendars: { where: { isVisible: true } } },
  });

  const client = await getCalendarClient(googleAccountId);

  for (const cal of account.calendars) {
    if (!cal.syncToken) {
      // No sync token for this calendar — do initial fetch for it
      const now = new Date();
      const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const { events, nextSyncToken } = await fetchEvents(client, cal.googleCalendarId, { timeMin, timeMax });
      await upsertEvents(events, account.userId, googleAccountId, cal.id);
      if (nextSyncToken) {
        await prisma.calendarList.update({ where: { id: cal.id }, data: { syncToken: nextSyncToken } });
      }
      continue;
    }

    try {
      const { events, nextSyncToken } = await fetchEvents(
        client,
        cal.googleCalendarId,
        { syncToken: cal.syncToken }
      );

      await upsertEvents(events, account.userId, googleAccountId, cal.id);

      if (nextSyncToken) {
        await prisma.calendarList.update({
          where: { id: cal.id },
          data: { syncToken: nextSyncToken },
        });
      }
    } catch (err: any) {
      // syncToken invalid — clear and re-sync this calendar
      if (err.code === 410) {
        await prisma.calendarList.update({
          where: { id: cal.id },
          data: { syncToken: null },
        });
        // Will be picked up on next iteration as no-syncToken case
        return;
      }
      throw err;
    }
  }

  publishSSE(account.userId, {
    type: "calendar.sync.complete",
    payload: { accountId: googleAccountId },
  });
}

/** On-demand fetch for a date range outside the sync window */
export async function onDemandFetch(
  googleAccountId: string,
  timeMin: string,
  timeMax: string
): Promise<void> {
  const account = await prisma.googleAccount.findUniqueOrThrow({
    where: { id: googleAccountId },
    include: { calendars: { where: { isVisible: true } } },
  });

  const client = await getCalendarClient(googleAccountId);

  for (const cal of account.calendars) {
    const { events } = await fetchEvents(client, cal.googleCalendarId, {
      timeMin,
      timeMax,
    });
    await upsertEvents(events, account.userId, googleAccountId, cal.id);
  }
}

/** Upsert Google events into CalendarEvent table */
async function upsertEvents(
  events: calendar_v3.Schema$Event[],
  userId: string,
  googleAccountId: string,
  calendarListId: string
): Promise<void> {
  for (const event of events) {
    if (!event.id) continue;

    // Handle cancelled events (deletions)
    if (event.status === "cancelled") {
      const existing = await prisma.calendarEvent.findUnique({
        where: {
          googleAccountId_googleEventId: {
            googleAccountId,
            googleEventId: event.id,
          },
        },
      });
      if (existing) {
        await prisma.calendarEvent.delete({ where: { id: existing.id } });
        publishSSE(userId, {
          type: "calendar.event.deleted",
          payload: { eventId: existing.id },
        });
      }
      continue;
    }

    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : event.start?.date
        ? new Date(event.start.date)
        : new Date();

    const endTime = event.end?.dateTime
      ? new Date(event.end.dateTime)
      : event.end?.date
        ? new Date(event.end.date)
        : new Date();

    const isAllDay = !event.start?.dateTime;

    const selfAttendee = event.attendees?.find((a) => a.self);
    const myResponseStatus = selfAttendee?.responseStatus ?? "needsAction";

    const attendees = (event.attendees ?? []).map((a) => ({
      name: a.displayName ?? a.email ?? "Unknown",
      email: a.email ?? "",
      responseStatus: a.responseStatus ?? "needsAction",
      organizer: a.organizer ?? false,
    }));

    const organizer = event.organizer
      ? { name: event.organizer.displayName ?? event.organizer.email ?? "", email: event.organizer.email ?? "" }
      : null;

    const attachments = (event.attachments ?? []).map((a) => ({
      title: a.title ?? a.fileUrl ?? "",
      url: a.fileUrl ?? "",
      mimeType: a.mimeType ?? undefined,
    }));

    const data = {
      userId,
      googleAccountId,
      calendarListId,
      googleEventId: event.id,
      title: event.summary ?? "Untitled",
      description: event.description ?? null,
      location: event.location ?? null,
      startTime,
      endTime,
      isAllDay,
      status: event.status ?? "confirmed",
      myResponseStatus,
      recurrence: event.recurrence?.join("\n") ?? null,
      recurringEventId: event.recurringEventId ?? null,
      meetingLink: extractMeetingLink(event),
      googleColorId: event.colorId ?? null,
      organizer,
      attendees,
      attachments,
      rawGoogleEvent: event as any,
      syncedAt: new Date(),
    };

    const existing = await prisma.calendarEvent.findUnique({
      where: {
        googleAccountId_googleEventId: {
          googleAccountId,
          googleEventId: event.id,
        },
      },
    });

    if (existing) {
      await prisma.calendarEvent.update({
        where: { id: existing.id },
        data,
      });
      publishSSE(userId, {
        type: "calendar.event.updated",
        payload: { eventId: existing.id },
      });
    } else {
      const created = await prisma.calendarEvent.create({
        data: { id: generateId(), ...data },
      });
      publishSSE(userId, {
        type: "calendar.event.created",
        payload: { eventId: created.id },
      });
    }
  }
}

/** Register a webhook for a calendar */
async function registerWebhook(
  client: calendar_v3.Calendar,
  calendarListId: string,
  googleCalendarId: string
): Promise<void> {
  const channelId = generateId();
  const hmacKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY ?? "";
  const token = createHmac("sha256", hmacKey).update(channelId).digest("hex");

  try {
    const { resourceId, expiration } = await watchCalendar(
      client,
      googleCalendarId,
      channelId,
      token
    );

    await prisma.calendarList.update({
      where: { id: calendarListId },
      data: {
        watchChannelId: channelId,
        watchResourceId: resourceId,
        watchToken: token,
        watchExpiration: new Date(expiration),
      },
    });
  } catch (err) {
    // Non-fatal: webhook registration can fail for non-primary calendars
    console.error(`Failed to register webhook for calendar ${calendarListId}:`, err);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/calendar-sync.ts
git commit -m "feat: calendar sync engine — initial, incremental, on-demand"
```

---

## Chunk 3: SSE Event Bus & Webhook Receiver

### Task 3.1: SSE Connection Registry & Publisher

**Files:**
- Create: `apps/api/src/lib/sse.ts`

- [ ] **Step 1: Implement SSE registry**

```typescript
// apps/api/src/lib/sse.ts
import type { SSEEvent } from "@brett/types";

interface SSEConnection {
  controller: ReadableStreamDefaultController;
  userId: string;
}

const connections = new Map<string, SSEConnection[]>();

/** Register a new SSE connection for a user */
export function addSSEConnection(
  userId: string,
  controller: ReadableStreamDefaultController
): () => void {
  const conn: SSEConnection = { controller, userId };
  const userConns = connections.get(userId) ?? [];
  userConns.push(conn);
  connections.set(userId, userConns);

  // Return cleanup function
  return () => {
    const conns = connections.get(userId);
    if (conns) {
      const idx = conns.indexOf(conn);
      if (idx !== -1) conns.splice(idx, 1);
      if (conns.length === 0) connections.delete(userId);
    }
  };
}

/** Publish an SSE event to all connections for a user */
export function publishSSE(userId: string, event: SSEEvent): void {
  const conns = connections.get(userId);
  if (!conns) return;

  const data = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  const encoder = new TextEncoder();
  const chunk = encoder.encode(data);

  for (const conn of conns) {
    try {
      conn.controller.enqueue(chunk);
    } catch {
      // Connection closed — will be cleaned up on close
    }
  }
}

/** Send heartbeat to all connections */
export function sendHeartbeats(): void {
  const encoder = new TextEncoder();
  const chunk = encoder.encode(": heartbeat\n\n");

  for (const conns of connections.values()) {
    for (const conn of conns) {
      try {
        conn.controller.enqueue(chunk);
      } catch {
        // Connection closed
      }
    }
  }
}

/** Get active connection count (for monitoring) */
export function getConnectionCount(): number {
  let count = 0;
  for (const conns of connections.values()) {
    count += conns.length;
  }
  return count;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/sse.ts
git commit -m "feat: SSE connection registry and event publisher"
```

### Task 3.2: SSE Stream Endpoint

**Files:**
- Create: `apps/api/src/routes/sse.ts`

- [ ] **Step 1: Implement SSE route**

**Important:** Do NOT use global `authMiddleware` on this router. EventSource can't send custom headers, so the client passes the bearer token as a query param. Inline auth checks the query param first, then falls back to the Authorization header.

```typescript
// apps/api/src/routes/sse.ts
import { Hono } from "hono";
import { addSSEConnection } from "../lib/sse";
import { auth } from "../lib/auth";

const router = new Hono();

router.get("/stream", async (c) => {
  // SSE can't send custom headers — accept token as query param
  const token = c.req.query("token");
  const headers = new Headers(c.req.raw.headers);
  if (token && !headers.get("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const session = await auth.api.getSession({ headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const user = session.user;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ userId: user.id })}\n\n`)
      );

      // Register connection
      const cleanup = addSSEConnection(user.id, controller);

      // Handle client disconnect
      c.req.raw.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/sse.ts
git commit -m "feat: SSE stream endpoint for real-time events"
```

### Task 3.3: Google Webhook Receiver

**Files:**
- Create: `apps/api/src/routes/webhooks.ts`

- [ ] **Step 1: Implement webhook route**

```typescript
// apps/api/src/routes/webhooks.ts
import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { createHmac } from "crypto";

const router = new Hono();

// Debounce map: calendarListId → timeout
const syncDebounce = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2000;

router.post("/google-calendar", async (c) => {
  const channelId = c.req.header("X-Goog-Channel-ID");
  const resourceId = c.req.header("X-Goog-Resource-ID");
  const channelToken = c.req.header("X-Goog-Channel-Token");

  if (!channelId || !resourceId) {
    return c.json({ error: "Missing channel headers" }, 400);
  }

  // Find the calendar by watch IDs
  const calendarList = await prisma.calendarList.findFirst({
    where: { watchChannelId: channelId, watchResourceId: resourceId },
    include: { googleAccount: true },
  });

  if (!calendarList) {
    return c.json({ error: "Unknown channel" }, 404);
  }

  // Verify HMAC token
  if (calendarList.watchToken && channelToken !== calendarList.watchToken) {
    const hmacKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY ?? "";
    const expectedToken = createHmac("sha256", hmacKey).update(channelId).digest("hex");
    if (channelToken !== expectedToken) {
      return c.json({ error: "Invalid token" }, 403);
    }
  }

  // Debounced sync: coalesce rapid webhooks
  const key = calendarList.id;
  if (syncDebounce.has(key)) {
    clearTimeout(syncDebounce.get(key)!);
  }

  syncDebounce.set(
    key,
    setTimeout(async () => {
      syncDebounce.delete(key);
      try {
        const { incrementalSync } = await import("../services/calendar-sync");
        await incrementalSync(calendarList.googleAccountId);
      } catch (err) {
        console.error(`Webhook sync failed for account ${calendarList.googleAccountId}:`, err);
      }
    }, DEBOUNCE_MS)
  );

  // Google expects 200 quickly
  return c.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/webhooks.ts
git commit -m "feat: Google Calendar webhook receiver with debounce"
```

### Task 3.4: Cron Jobs — Webhook Renewal & Reconciliation

**Files:**
- Create: `apps/api/src/jobs/cron.ts`

- [ ] **Step 1: Install node-cron**

```bash
cd apps/api && pnpm add node-cron && pnpm add -D @types/node-cron
```

- [ ] **Step 2: Implement cron jobs**

```typescript
// apps/api/src/jobs/cron.ts
import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { getCalendarClient, watchCalendar, stopWatch } from "../lib/google-calendar";
import { incrementalSync } from "../services/calendar-sync";
import { sendHeartbeats } from "../lib/sse";
import { generateId } from "@brett/utils";
import { createHmac } from "crypto";

/** Start all cron jobs */
export function startCronJobs(): void {
  // SSE heartbeat every 30 seconds
  cron.schedule("*/30 * * * * *", () => {
    sendHeartbeats();
  });

  // Webhook renewal — every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    try {
      await renewExpiringWebhooks();
    } catch (err) {
      console.error("Webhook renewal failed:", err);
    }
  });

  // Periodic reconciliation — every 4 hours
  cron.schedule("0 2,6,10,14,18,22 * * *", async () => {
    try {
      await reconcileAllAccounts();
    } catch (err) {
      console.error("Reconciliation failed:", err);
    }
  });
}

async function renewExpiringWebhooks(): Promise<void> {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000); // expiring within 24h
  const expiring = await prisma.calendarList.findMany({
    where: {
      watchExpiration: { lt: soon },
      watchChannelId: { not: null },
    },
    include: { googleAccount: true },
  });

  for (const cal of expiring) {
    try {
      const client = await getCalendarClient(cal.googleAccountId);

      // Stop old watch
      if (cal.watchChannelId && cal.watchResourceId) {
        try {
          await stopWatch(client, cal.watchChannelId, cal.watchResourceId);
        } catch { /* may already be expired */ }
      }

      // Register new watch
      const channelId = generateId();
      const hmacKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY ?? "";
      const token = createHmac("sha256", hmacKey).update(channelId).digest("hex");

      const { resourceId, expiration } = await watchCalendar(
        client,
        cal.googleCalendarId,
        channelId,
        token
      );

      await prisma.calendarList.update({
        where: { id: cal.id },
        data: {
          watchChannelId: channelId,
          watchResourceId: resourceId,
          watchToken: token,
          watchExpiration: new Date(expiration),
        },
      });
    } catch (err) {
      console.error(`Failed to renew webhook for calendar ${cal.id}:`, err);
    }
  }
}

async function reconcileAllAccounts(): Promise<void> {
  const accounts = await prisma.googleAccount.findMany();
  for (const account of accounts) {
    try {
      await incrementalSync(account.id);
    } catch (err) {
      console.error(`Reconciliation failed for account ${account.id}:`, err);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jobs/cron.ts apps/api/package.json
git commit -m "feat: cron jobs for SSE heartbeat, webhook renewal, reconciliation"
```

### Task 3.5: Mount New Routes in App

**Files:**
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Add route imports and mount points**

Add to `apps/api/src/app.ts`:

```typescript
import sse from "./routes/sse";
import webhooks from "./routes/webhooks";
import { startCronJobs } from "./jobs/cron";

// Mount after existing routes
app.route("/events", sse);
app.route("/webhooks", webhooks);

// Start cron jobs
startCronJobs();
```

Note: Calendar account and event routes will be mounted in a later task.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat: mount SSE and webhook routes, start cron jobs"
```

---

## Chunk 4: Calendar API Routes

### Task 4.1: Calendar Account Routes (OAuth + Management)

**Files:**
- Create: `apps/api/src/routes/calendar-accounts.ts`

- [ ] **Step 1: Implement account routes**

```typescript
// apps/api/src/routes/calendar-accounts.ts
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { getCalendarAuthUrl, exchangeCalendarCode, getCalendarClient, stopWatch } from "../lib/google-calendar";
import { encryptToken } from "../lib/token-encryption";
import { initialSync } from "../services/calendar-sync";
import { generateId } from "@brett/utils";
import { google } from "googleapis";

const router = new Hono<AuthEnv>();

router.use("*", authMiddleware);

/** List connected accounts with their calendars */
router.get("/", async (c) => {
  const user = c.get("user");
  const accounts = await prisma.googleAccount.findMany({
    where: { userId: user.id },
    include: { calendars: { orderBy: { isPrimary: "desc" } } },
    orderBy: { connectedAt: "desc" },
  });

  return c.json(
    accounts.map((a) => ({
      id: a.id,
      googleEmail: a.googleEmail,
      connectedAt: a.connectedAt.toISOString(),
      calendars: a.calendars.map((cal) => ({
        id: cal.id,
        googleAccountId: cal.googleAccountId,
        googleCalendarId: cal.googleCalendarId,
        name: cal.name,
        color: cal.color,
        isVisible: cal.isVisible,
        isPrimary: cal.isPrimary,
      })),
    }))
  );
});

/** Initiate Google Calendar OAuth */
router.post("/connect", async (c) => {
  const user = c.get("user");
  // State encodes user ID for callback verification
  const state = Buffer.from(JSON.stringify({ userId: user.id })).toString("base64url");
  const url = getCalendarAuthUrl(state);
  return c.json({ url });
});

/** OAuth callback — exchange code, store tokens, trigger sync.
 * NOTE: For desktop, the OAuth redirect goes to localhost (same pattern as existing
 * Google sign-in in electron/main.ts). The Electron app spins up an ephemeral
 * localhost server, catches the callback, extracts the code, then forwards it
 * to this API endpoint with the user's bearer token. See Task 9.1 Step 3. */
router.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.json({ error: `Google OAuth error: ${error}` }, 400);
  }

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  // Decode state
  let stateData: { userId: string };
  try {
    stateData = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return c.json({ error: "Invalid state" }, 400);
  }

  const user = c.get("user");
  if (stateData.userId !== user.id) {
    return c.json({ error: "State mismatch" }, 403);
  }

  // Exchange code for tokens
  const tokens = await exchangeCalendarCode(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    return c.json({ error: "Failed to get tokens — try reconnecting" }, 400);
  }

  // Get Google user info to identify the account
  const oauth2 = google.oauth2({ version: "v2", auth: new google.auth.OAuth2() });
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: tokens.access_token });
  const userInfo = await google.oauth2({ version: "v2", auth }).userinfo.get();

  const googleUserId = userInfo.data.id!;
  const googleEmail = userInfo.data.email!;

  // Upsert account (handles re-connecting same account)
  const account = await prisma.googleAccount.upsert({
    where: {
      userId_googleUserId: { userId: user.id, googleUserId },
    },
    create: {
      id: generateId(),
      userId: user.id,
      googleEmail,
      googleUserId,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
    },
    update: {
      googleEmail,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
    },
  });

  // Trigger initial sync in background
  initialSync(account.id).catch((err) => {
    console.error(`Initial sync failed for account ${account.id}:`, err);
  });

  return c.json({ id: account.id, googleEmail });
});

/** Disconnect an account */
router.delete("/:id", async (c) => {
  const user = c.get("user");
  const accountId = c.req.param("id");

  const account = await prisma.googleAccount.findFirst({
    where: { id: accountId, userId: user.id },
    include: { calendars: true },
  });

  if (!account) {
    return c.json({ error: "Account not found" }, 404);
  }

  // Stop all webhook watches
  try {
    const client = await getCalendarClient(accountId);
    for (const cal of account.calendars) {
      if (cal.watchChannelId && cal.watchResourceId) {
        try {
          await stopWatch(client, cal.watchChannelId, cal.watchResourceId);
        } catch { /* best effort */ }
      }
    }
  } catch { /* token may be revoked already */ }

  // Cascade delete: account → calendars → events → notes, messages
  await prisma.googleAccount.delete({ where: { id: accountId } });

  return c.json({ ok: true });
});

/** Toggle calendar visibility */
router.patch("/:accountId/calendars/:calId", async (c) => {
  const user = c.get("user");
  const calId = c.req.param("calId");
  const body = await c.req.json<{ isVisible: boolean }>();

  const cal = await prisma.calendarList.findFirst({
    where: { id: calId, googleAccount: { userId: user.id } },
  });

  if (!cal) {
    return c.json({ error: "Calendar not found" }, 404);
  }

  const updated = await prisma.calendarList.update({
    where: { id: calId },
    data: { isVisible: body.isVisible },
  });

  return c.json({
    id: updated.id,
    isVisible: updated.isVisible,
  });
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/calendar-accounts.ts
git commit -m "feat: calendar account routes — connect, callback, disconnect, visibility"
```

### Task 4.2: Calendar Event Routes

**Files:**
- Create: `apps/api/src/routes/calendar.ts`

- [ ] **Step 1: Implement event routes**

```typescript
// apps/api/src/routes/calendar.ts
import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { getCalendarClient, updateRsvp } from "../lib/google-calendar";
import { validateRsvpInput, validateCalendarNoteInput } from "@brett/business";
import { validateCreateBrettMessage } from "@brett/business";
import { generateId } from "@brett/utils";
import { onDemandFetch } from "../services/calendar-sync";

const router = new Hono<AuthEnv>();

router.use("*", authMiddleware);

/** List events for a date range */
router.get("/events", async (c) => {
  const user = c.get("user");
  const date = c.req.query("date"); // YYYY-MM-DD
  const startDate = c.req.query("startDate"); // ISO
  const endDate = c.req.query("endDate"); // ISO

  let timeMin: Date;
  let timeMax: Date;

  if (date) {
    // Single day
    timeMin = new Date(`${date}T00:00:00Z`);
    timeMax = new Date(`${date}T23:59:59.999Z`);
  } else if (startDate && endDate) {
    timeMin = new Date(startDate);
    timeMax = new Date(endDate);
  } else {
    return c.json({ error: "Provide date or startDate+endDate" }, 400);
  }

  // Get visible calendar IDs
  const visibleCalendars = await prisma.calendarList.findMany({
    where: {
      googleAccount: { userId: user.id },
      isVisible: true,
    },
    select: { id: true },
  });

  const calendarIds = visibleCalendars.map((c) => c.id);

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: user.id,
      calendarListId: { in: calendarIds },
      startTime: { lte: timeMax },
      endTime: { gte: timeMin },
      status: { not: "cancelled" },
    },
    include: {
      calendarList: { select: { name: true, color: true } },
    },
    orderBy: { startTime: "asc" },
  });

  return c.json({
    events: events.map((e) => ({
      ...eventToRecord(e),
      calendarName: e.calendarList.name,
      calendarColor: e.calendarList.color,
    })),
  });
});

/** Get single event with full detail */
router.get("/events/:id", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
    include: {
      calendarList: { select: { name: true, color: true } },
      notes: { where: { userId: user.id }, take: 1 },
      brettMessages: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!event) {
    return c.json({ error: "Event not found" }, 404);
  }

  return c.json({
    ...eventToRecord(event),
    calendarName: event.calendarList.name,
    calendarColor: event.calendarList.color,
    notes: event.notes[0]?.content ?? null,
    brettMessages: event.brettMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    brettObservation: null, // mocked for now
    brettTakeGeneratedAt: null,
  });
});

/** Update RSVP */
router.patch("/events/:id/rsvp", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const body = await c.req.json();

  const validation = validateRsvpInput(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
    include: {
      calendarList: true,
      googleAccount: true,
    },
  });

  if (!event) {
    return c.json({ error: "Event not found" }, 404);
  }

  // Update on Google
  const client = await getCalendarClient(event.googleAccountId);
  await updateRsvp(
    client,
    event.calendarList.googleCalendarId,
    event.googleEventId,
    event.googleAccount.googleEmail,
    validation.data.status,
    validation.data.comment
  );

  // Update local cache
  const updated = await prisma.calendarEvent.update({
    where: { id: eventId },
    data: { myResponseStatus: body.status },
  });

  return c.json({ myResponseStatus: updated.myResponseStatus });
});

/** Get private notes */
router.get("/events/:id/notes", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const note = await prisma.calendarEventNote.findUnique({
    where: { calendarEventId_userId: { calendarEventId: eventId, userId: user.id } },
  });

  return c.json({ content: note?.content ?? null });
});

/** Upsert private notes */
router.put("/events/:id/notes", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const body = await c.req.json();

  const noteValidation = validateCalendarNoteInput(body);
  if (!noteValidation.ok) return c.json({ error: noteValidation.error }, 400);

  // Verify event ownership
  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) {
    return c.json({ error: "Event not found" }, 404);
  }

  const note = await prisma.calendarEventNote.upsert({
    where: { calendarEventId_userId: { calendarEventId: eventId, userId: user.id } },
    create: {
      id: generateId(),
      calendarEventId: eventId,
      userId: user.id,
      content: body.content,
    },
    update: { content: body.content },
  });

  return c.json({ content: note.content, updatedAt: note.updatedAt.toISOString() });
});

/** Brett messages for calendar events */
router.get("/events/:id/brett", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 50);
  const cursor = c.req.query("cursor");

  // Verify ownership
  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) {
    return c.json({ error: "Event not found" }, 404);
  }

  const where: any = { calendarEventId: eventId };
  if (cursor) {
    where.createdAt = { lt: new Date(cursor) };
  }

  const [messages, totalCount] = await Promise.all([
    prisma.brettMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1, // fetch one extra to determine hasMore
    }),
    prisma.brettMessage.count({ where: { calendarEventId: eventId } }),
  ]);

  const hasMore = messages.length > limit;
  if (hasMore) messages.pop(); // remove the extra

  return c.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    hasMore,
    cursor: messages.length > 0 ? messages[messages.length - 1].createdAt.toISOString() : null,
    totalCount,
  });
});

/** Send Brett message for calendar event */
router.post("/events/:id/brett", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const body = await c.req.json();

  // Use result-object pattern matching existing codebase
  const validation = validateCreateBrettMessage(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) {
    return c.json({ error: "Event not found" }, 404);
  }

  const userMsg = await prisma.brettMessage.create({
    data: {
      id: generateId(),
      calendarEventId: eventId,
      userId: user.id, // REQUIRED — BrettMessage has non-nullable userId
      role: "user",
      content: validation.data.content,
    },
  });

  // Stub Brett response (mocked)
  const brettMsg = await prisma.brettMessage.create({
    data: {
      id: generateId(),
      calendarEventId: eventId,
      userId: user.id, // REQUIRED
      role: "brett",
      content: "I'll have more to say about this event soon. For now, I'm just getting set up with your calendar!",
    },
  });

  return c.json(
    {
      userMessage: { id: userMsg.id, role: userMsg.role, content: userMsg.content, createdAt: userMsg.createdAt.toISOString() },
      brettMessage: { id: brettMsg.id, role: brettMsg.role, content: brettMsg.content, createdAt: brettMsg.createdAt.toISOString() },
    },
    201
  );
});

/** On-demand fetch for date ranges outside sync window */
router.post("/events/fetch-range", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ startDate: string; endDate: string }>();

  const accounts = await prisma.googleAccount.findMany({
    where: { userId: user.id },
  });

  for (const account of accounts) {
    await onDemandFetch(account.id, body.startDate, body.endDate);
  }

  return c.json({ ok: true });
});

// Helper: Prisma record → API response
function eventToRecord(event: any) {
  return {
    id: event.id,
    userId: event.userId,
    googleAccountId: event.googleAccountId,
    calendarListId: event.calendarListId,
    googleEventId: event.googleEventId,
    title: event.title,
    description: event.description,
    location: event.location,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    isAllDay: event.isAllDay,
    status: event.status,
    myResponseStatus: event.myResponseStatus,
    recurrence: event.recurrence,
    recurringEventId: event.recurringEventId,
    meetingLink: event.meetingLink,
    googleColorId: event.googleColorId,
    organizer: event.organizer,
    attendees: event.attendees,
    attachments: event.attachments,
    syncedAt: event.syncedAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export default router;
```

- [ ] **Step 2: Mount calendar routes in app.ts**

Add to `apps/api/src/app.ts`:

```typescript
import calendar from "./routes/calendar";
import calendarAccounts from "./routes/calendar-accounts";

app.route("/calendar", calendar);
app.route("/calendar/accounts", calendarAccounts);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/calendar.ts apps/api/src/routes/calendar-accounts.ts apps/api/src/app.ts
git commit -m "feat: calendar event and account API routes"
```

---

## Chunk 5: Desktop — SSE Hook & Calendar API Hooks

### Task 5.1: SSE Event Stream Hook

**Files:**
- Create: `apps/desktop/src/api/sse.ts`

- [ ] **Step 1: Implement useEventStream hook**

```typescript
// apps/desktop/src/api/sse.ts
import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "../auth/auth-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

type EventHandler = (data: any) => void;

const handlers = new Map<string, Set<EventHandler>>();

export function useSSEHandler(eventType: string, handler: EventHandler): void {
  useEffect(() => {
    const set = handlers.get(eventType) ?? new Set();
    set.add(handler);
    handlers.set(eventType, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) handlers.delete(eventType);
    };
  }, [eventType, handler]);
}

export function useEventStream(): void {
  const qc = useQueryClient();
  const retryDelay = useRef(1000);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    // EventSource doesn't support custom headers, use URL param
    const url = `${API_URL}/events/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      retryDelay.current = 1000; // Reset backoff on success
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, 30000);
      setTimeout(connect, delay);
    };

    // Calendar events → invalidate calendar queries
    const calendarHandler = (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-event-detail"] });

      // Dispatch to registered handlers
      const eventHandlers = handlers.get(e.type);
      if (eventHandlers) {
        for (const h of eventHandlers) h(data);
      }
    };

    es.addEventListener("calendar.event.created", calendarHandler);
    es.addEventListener("calendar.event.updated", calendarHandler);
    es.addEventListener("calendar.event.deleted", calendarHandler);
    es.addEventListener("calendar.sync.complete", (e) => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
    });
  }, [qc]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);
}
```

**Note:** EventSource doesn't support custom headers. The SSE endpoint needs to accept `?token=` query param as an auth alternative. Update the SSE route (`apps/api/src/routes/sse.ts`) to also check `c.req.query("token")` if no Authorization header is present. This is a common pattern for SSE auth.

- [ ] **Step 2: Update SSE route to accept token query param**

In `apps/api/src/routes/sse.ts`, replace the authMiddleware with inline auth that checks both header and query param:

```typescript
router.get("/stream", async (c) => {
  // SSE can't send custom headers — accept token as query param
  const token = c.req.query("token");
  if (token) {
    c.req.raw.headers.set("Authorization", `Bearer ${token}`);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const user = session.user;

  // ... rest of SSE handler using user
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/api/sse.ts apps/api/src/routes/sse.ts
git commit -m "feat: SSE event stream hook with auto-reconnect and cache invalidation"
```

### Task 5.2: Calendar API Hooks

**Files:**
- Create: `apps/desktop/src/api/calendar.ts`
- Create: `apps/desktop/src/api/calendar-accounts.ts`

- [ ] **Step 1: Implement calendar event hooks**

```typescript
// apps/desktop/src/api/calendar.ts
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch } from "./client";
import type {
  CalendarEventsResponse,
  CalendarEventDetailResponse,
  RsvpInput,
  CalendarEventNoteInput,
  BrettMessageRecord,
} from "@brett/types";

export function useCalendarEvents(params: { date?: string; startDate?: string; endDate?: string }) {
  const queryString = new URLSearchParams(
    Object.entries(params).filter(([_, v]) => v != null) as [string, string][]
  ).toString();

  return useQuery({
    queryKey: ["calendar-events", params],
    queryFn: () => apiFetch<CalendarEventsResponse>(`/calendar/events?${queryString}`),
    enabled: !!(params.date || (params.startDate && params.endDate)),
  });
}

export function useCalendarEventDetail(id: string | null) {
  return useQuery({
    queryKey: ["calendar-event-detail", id],
    queryFn: () => apiFetch<CalendarEventDetailResponse>(`/calendar/events/${id}`),
    enabled: !!id,
  });
}

export function useUpdateRsvp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ...data }: RsvpInput & { eventId: string }) =>
      apiFetch(`/calendar/events/${eventId}/rsvp`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: ["calendar-event-detail", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useCalendarEventNotes(eventId: string | null) {
  return useQuery({
    queryKey: ["calendar-event-notes", eventId],
    queryFn: () => apiFetch<{ content: string | null }>(`/calendar/events/${eventId}/notes`),
    enabled: !!eventId,
  });
}

export function useUpdateCalendarEventNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, content }: { eventId: string; content: string }) =>
      apiFetch(`/calendar/events/${eventId}/notes`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: ["calendar-event-notes", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-event-detail", eventId] });
    },
  });
}

export function useCalendarEventBrettMessages(eventId: string | null) {
  const query = useInfiniteQuery({
    queryKey: ["calendar-brett-messages", eventId],
    queryFn: ({ pageParam }) => {
      const url = pageParam
        ? `/calendar/events/${eventId}/brett?cursor=${encodeURIComponent(pageParam)}`
        : `/calendar/events/${eventId}/brett`;
      return apiFetch<{
        messages: BrettMessageRecord[];
        hasMore: boolean;
        cursor: string | null;
        totalCount: number;
      }>(url);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: !!eventId,
  });

  const messages = useMemo(
    () => query.data?.pages.flatMap((p) => p.messages) ?? [],
    [query.data]
  );

  const totalCount = query.data?.pages[0]?.totalCount ?? 0;

  return {
    messages,
    totalCount,
    hasMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: query.fetchNextPage,
    isLoading: query.isLoading,
  };
}

export function useSendCalendarBrettMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, content }: { eventId: string; content: string }) =>
      apiFetch(`/calendar/events/${eventId}/brett`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: ["calendar-brett-messages", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-event-detail", eventId] });
    },
  });
}

export function useFetchCalendarRange() {
  return useMutation({
    mutationFn: (params: { startDate: string; endDate: string }) =>
      apiFetch("/calendar/events/fetch-range", {
        method: "POST",
        body: JSON.stringify(params),
      }),
  });
}
```

- [ ] **Step 2: Implement account management hooks**

```typescript
// apps/desktop/src/api/calendar-accounts.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ConnectedCalendarAccount } from "@brett/types";

export function useCalendarAccounts() {
  return useQuery({
    queryKey: ["calendar-accounts"],
    queryFn: () => apiFetch<ConnectedCalendarAccount[]>("/calendar/accounts"),
  });
}

export function useConnectCalendar() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiFetch<{ url: string }>("/calendar/accounts/connect", {
        method: "POST",
      });
      // Open in system browser
      window.open(url, "_blank");
      return url;
    },
  });
}

export function useDisconnectCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch(`/calendar/accounts/${accountId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useToggleCalendarVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      calendarId,
      isVisible,
    }: {
      accountId: string;
      calendarId: string;
      isVisible: boolean;
    }) =>
      apiFetch(`/calendar/accounts/${accountId}/calendars/${calendarId}`, {
        method: "PATCH",
        body: JSON.stringify({ isVisible }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/api/calendar.ts apps/desktop/src/api/calendar-accounts.ts
git commit -m "feat: React Query hooks for calendar events and account management"
```

---

## Chunk 6: UI — Calendar Event Detail Panel

### Task 6.1: CalendarEventDetailPanel Component

**Files:**
- Create: `packages/ui/src/CalendarEventDetailPanel.tsx`

- [ ] **Step 1: Implement the event detail panel**

This component follows the same pattern as `TaskDetailPanel.tsx` but with calendar-specific sections. It receives the event detail and callback props, renders:

1. Header — title, date/time, calendar badge, location + join link, recurrence
2. RSVP — Accept/Tentative/Decline buttons + note field
3. Brett's Take (mocked)
4. Agenda — description + Google attachments/links
5. Attendees — max 4 visible, "+X more" expandable
6. Your Notes — RichTextEditor, placeholder "Not synced to Google"
7. BrettThread — pinned at bottom

Key implementation details:
- RSVP note field always visible; pre-populate from existing attendee `comment` (extract current user's attendee entry from `detail.attendees`); fires on RSVP click (carrying note content), or on blur/panel-close if RSVP already selected
- Attendees: state `showAllAttendees` toggled by clicking "+X more"
- Join meeting button: opens `meetingLink` via `window.open()`
- Recurrence: displayed as badge in header (from `recurrence` field)
- Calendar badge: colored dot + calendar name from `detail.calendarName` + `detail.calendarColor`
- Your Notes: empty state placeholder text "Not synced to Google" (not a header)
- Uses same glass morphism styling as TaskDetailPanel

Props interface:
```typescript
interface CalendarEventDetailPanelProps {
  detail: CalendarEventDetailResponse;
  onUpdateRsvp: (status: CalendarRsvpStatus, comment?: string) => void;
  onUpdateNotes: (content: string) => void;
  brettMessages: BrettMessageRecord[];
  brettTotalCount: number;
  brettHasMore: boolean;
  onSendBrettMessage: (content: string) => void;
  onLoadMoreBrettMessages: () => void;
  isSendingBrettMessage: boolean;
  isLoadingMoreBrettMessages: boolean;
}
```

The full component implementation should follow the design spec panel mockup sections exactly, using the same Tailwind classes documented in DESIGN_GUIDE.md (glass morphism, section headers as `font-mono text-xs uppercase tracking-wider text-white/40 font-semibold`, etc.).

- [ ] **Step 2: Update DetailPanel.tsx to route to CalendarEventDetailPanel**

Modify `packages/ui/src/DetailPanel.tsx` to:
- Import `CalendarEventDetailPanel`
- Add props for calendar event callbacks
- **Replace** the existing `"startTime" in item` check with `"googleEventId" in item` — both old and new types have `startTime`, so the old check would break. Use `googleEventId` as the discriminator for calendar events.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/CalendarEventDetailPanel.tsx packages/ui/src/DetailPanel.tsx
git commit -m "feat: CalendarEventDetailPanel with RSVP, notes, attendees, Brett thread"
```

### Task 6.2: Event Hover Tooltip (Progressive Disclosure)

**Files:**
- Create: `packages/ui/src/EventHoverTooltip.tsx`

- [ ] **Step 1: Implement progressive tooltip**

Component that shows compact info on hover, expands after ~1.5s dwell:

```typescript
interface EventHoverTooltipProps {
  event: CalendarEventDisplay;
  children: React.ReactNode;
  side?: "left" | "right" | "top" | "bottom";
}
```

Implementation:
- `onMouseEnter`: show compact tooltip, start 1.5s timer
- Timer fires: expand tooltip (CSS transition, add more sections)
- `onMouseLeave`: clear timer, hide tooltip
- Compact: title, time+location, description snippet (2-line clamp), attendee count
- Expanded: + RSVP badge, full description, attendees (max 4 + "+X more"), recurrence
- Positioned with portal to body, similar to how AttachmentList does image preview
- Glass morphism: `bg-black/85 backdrop-blur-xl border border-white/12 rounded-xl`

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/EventHoverTooltip.tsx
git commit -m "feat: progressive disclosure hover tooltip for calendar events"
```

---

## Chunk 7: UI — Enhanced Calendar Sidebar

### Task 7.1: Upgrade CalendarTimeline to Real Data

**Files:**
- Modify: `packages/ui/src/CalendarTimeline.tsx`

- [ ] **Step 1: Replace mock data with props**

Update CalendarTimeline to accept real data via props:

```typescript
interface CalendarTimelineProps {
  events: CalendarEventDisplay[];
  onEventClick: (event: CalendarEventDisplay) => void;
  isLoading?: boolean;
}
```

- [ ] **Step 2: Implement real-time current time indicator**

Replace hardcoded `10:45` with:
```typescript
const [currentTime, setCurrentTime] = useState(new Date());
useEffect(() => {
  const interval = setInterval(() => setCurrentTime(new Date()), 60000);
  return () => clearInterval(interval);
}, []);
```

Position the red dot+line based on `currentTime.getHours()` and `currentTime.getMinutes()`. Auto-scroll the timeline to keep current time visible on mount.

- [ ] **Step 3: Add event countdown badge**

For the next upcoming event (first event where `startTime > now`), show a badge: "Starts in X min". Update every minute. Show "Now" during the event. Hide after event ends.

- [ ] **Step 4: Add conflict detection (side-by-side rendering)**

Detect overlapping events (event A's startTime < event B's endTime AND event B's startTime < event A's endTime). Render overlapping events side-by-side with narrower widths. Add a subtle amber warning border.

- [ ] **Step 5: Add buffer indicators**

Between consecutive events where the gap is < 15 minutes, show a small label: "0 min buffer" (red text) or "5 min" (amber text). Only between back-to-back events.

- [ ] **Step 6: Add join meeting icon**

If event has `meetingLink`, show a small video camera icon on the card. Clicking opens the link in system browser.

- [ ] **Step 7: Wrap events with EventHoverTooltip**

Each event card wrapped in `<EventHoverTooltip event={event}>`.

- [ ] **Step 8: Add right-click context menu for quick RSVP**

On right-click, show a small context menu with Accept / Tentative / Decline options. Use same glass morphism dropdown style as ScheduleRow.

- [ ] **Step 9: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/CalendarTimeline.tsx
git commit -m "feat: enhanced calendar sidebar — real data, live time, conflicts, countdown"
```

---

## Chunk 8: Full Calendar Page

### Task 8.1: Calendar Header Component

**Files:**
- Create: `apps/desktop/src/components/calendar/CalendarHeader.tsx`

- [ ] **Step 1: Implement header with view switcher and date nav**

```typescript
interface CalendarHeaderProps {
  view: "day" | "week" | "month";
  onViewChange: (view: "day" | "week" | "month") => void;
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onToday: () => void;
  daysPerWeek: number;
  onDaysPerWeekChange: (days: number) => void;
}
```

Layout:
- Left: back/forward arrows + "Today" button + date range label (e.g., "March 2026", "Mar 15-21, 2026")
- Right: Day | Week | Month toggle buttons + X-days dropdown (2-14)
- Glass morphism styling consistent with app header

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/components/calendar/CalendarHeader.tsx
git commit -m "feat: calendar header — view switcher, date navigation, X-days config"
```

### Task 8.2: Day View

**Files:**
- Create: `apps/desktop/src/components/calendar/CalendarDayView.tsx`

- [ ] **Step 1: Implement day view time grid**

Full-height time grid (24 hours, scrolled to working hours on mount). Same rendering logic as CalendarTimeline but full width. All-day events in a top strip. Current time red line. Events wrapped in EventHoverTooltip. Click → opens detail panel.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/components/calendar/CalendarDayView.tsx
git commit -m "feat: calendar day view with time grid and all-day events"
```

### Task 8.3: Week View

**Files:**
- Create: `apps/desktop/src/components/calendar/CalendarWeekView.tsx`

- [ ] **Step 1: Implement week/X-day view**

Multi-column grid. `daysPerWeek` columns (default 7). Time grid on left. Column headers: day name + date, today highlighted. Events positioned within their day column. Conflicts side-by-side within column. All-day events top strip spanning columns.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/components/calendar/CalendarWeekView.tsx
git commit -m "feat: calendar week view with configurable X-day columns"
```

### Task 8.4: Month View

**Files:**
- Create: `apps/desktop/src/components/calendar/CalendarMonthView.tsx`

- [ ] **Step 1: Implement month grid**

Traditional calendar grid (6 rows x 7 columns). Events as colored pills, max 3 per day, "+N more" overflow badge. Click day → switches to day view. Click event → opens detail panel. Today cell highlighted.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/components/calendar/CalendarMonthView.tsx
git commit -m "feat: calendar month view with event pills and overflow"
```

### Task 8.5: Calendar Page Assembly

**Files:**
- Create: `apps/desktop/src/pages/CalendarPage.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Implement CalendarPage**

Composes CalendarHeader + the active view component. Manages state: `view`, `currentDate`, `daysPerWeek` (persist `daysPerWeek` to localStorage). Fetches events via `useCalendarEvents({ startDate, endDate })` based on the visible date range. Handles on-demand fetch (via `useFetchCalendarRange` hook from `apps/desktop/src/api/calendar.ts`) when navigating outside the sync window.

```typescript
export default function CalendarPage({ onEventClick }: { onEventClick: (event: CalendarEventDisplay) => void }) {
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [daysPerWeek, setDaysPerWeek] = useState(() =>
    Number(localStorage.getItem("brett-calendar-days") ?? 7)
  );

  // Persist preference
  useEffect(() => { localStorage.setItem("brett-calendar-days", String(daysPerWeek)); }, [daysPerWeek]);

  // Compute date range based on view
  const { startDate, endDate } = useMemo(() => computeDateRange(view, currentDate, daysPerWeek), [view, currentDate, daysPerWeek]);

  const { data, isLoading } = useCalendarEvents({ startDate, endDate });

  return (
    <div className="flex flex-col h-full">
      <CalendarHeader ... />
      <div className="flex-1 overflow-hidden">
        {view === "day" && <CalendarDayView events={...} onEventClick={onEventClick} />}
        {view === "week" && <CalendarWeekView events={...} onEventClick={onEventClick} daysPerWeek={daysPerWeek} />}
        {view === "month" && <CalendarMonthView events={...} onEventClick={onEventClick} onDayClick={(date) => { setCurrentDate(date); setView("day"); }} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add LeftNav entry for /calendar**

Modify `packages/ui/src/LeftNav.tsx`:
- Import `CalendarDays` icon from lucide-react (the existing `Calendar` icon is used for "Today")
- Add a new `NavItem` for `/calendar` with the `CalendarDays` icon and label "Calendar"
- Update LeftNav props if needed to support the new route

- [ ] **Step 3: Add /calendar route in App.tsx (standalone, NOT inside MainLayout)**

The calendar page needs full width — the right sidebar (CalendarTimeline) would be redundant. Add the route at the same level as SettingsPage, outside of MainLayout:

```typescript
<Route path="/calendar" element={<CalendarPage onEventClick={handleItemClick} />} />
```

- [ ] **Step 4: Wire calendar-specific detail panel callbacks in App.tsx**

When `selectedItem` has `googleEventId` (is a calendar event), App.tsx needs to:
- Use `useCalendarEventDetail(selectedItem.id)` for detail data
- Use `useUpdateRsvp()` for RSVP callbacks
- Use `useUpdateCalendarEventNotes()` for notes
- Use `useCalendarEventBrettMessages(selectedItem.id)` for Brett thread
- Use `useSendCalendarBrettMessage()` for sending messages
- Pass these as props through `DetailPanel` → `CalendarEventDetailPanel`

This mirrors the existing pattern for task callbacks (lines ~447-493 of current App.tsx).

- [ ] **Step 5: Replace mockEvents with real data in MainLayout**

In `App.tsx`, the `MainLayout` currently passes `mockEvents` to `CalendarTimeline`. Replace with:
```typescript
const { data: todayEvents } = useCalendarEvents({ date: new Date().toISOString().split("T")[0] });
```
Pass `todayEvents?.events ?? []` (mapped to `CalendarEventDisplay[]`) to `CalendarTimeline`.

- [ ] **Step 6: Initialize SSE in App.tsx**

Call `useEventStream()` at the top of the `App()` function body, before the return statement. This must be inside the React component, not alongside QueryClient.

- [ ] **Step 7: Add color map to client**

Add a `useCalendarColorMap()` hook or include color definitions in the calendar events API response. The client needs Google's color definitions to resolve `googleColorId` → glass morphism colors at render time. Options:
- (Simple) Include the resolved glass color in each event response from the API
- (Better) Fetch color map once via `GET /calendar/colors` and cache client-side, then resolve at render time

For v1, include resolved colors in the events API response to keep the client simple.

- [ ] **Step 8: Export new components from packages/ui/src/index.ts**

Add exports for `CalendarEventDetailPanel` and `EventHoverTooltip` to `packages/ui/src/index.ts`.

- [ ] **Step 9: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/pages/CalendarPage.tsx apps/desktop/src/App.tsx packages/ui/src/LeftNav.tsx packages/ui/src/index.ts
git commit -m "feat: full calendar page with day/week/month views, SSE init, real data wiring"
```

---

## Chunk 9: Settings UI & OAuth Flow

### Task 9.1: Calendar Settings Section

**Files:**
- Create: `apps/desktop/src/settings/CalendarSection.tsx`
- Modify: `apps/desktop/src/settings/SettingsPage.tsx`

- [ ] **Step 1: Implement CalendarSection**

"Connected Calendars" section with:
- "Connect Google Calendar" button → calls `useConnectCalendar()` which opens OAuth in system browser
- Per connected account: email, "Last synced" relative timestamp, calendar checkboxes for visibility, "Disconnect" button with confirmation
- Glass morphism card styling matching existing settings sections

- [ ] **Step 2: Add CalendarSection to SettingsPage**

Insert between SecuritySection and SignOutSection.

- [ ] **Step 3: Handle OAuth callback in Electron**

Update `apps/desktop/electron/main.ts` to handle the calendar OAuth callback URL. When the system browser redirects back after Google OAuth, the app needs to catch the callback. This likely uses the same deep link / localhost redirect pattern as the existing Google sign-in flow. Forward the auth code to the API's `/calendar/accounts/callback` endpoint.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/CalendarSection.tsx apps/desktop/src/settings/SettingsPage.tsx apps/desktop/electron/main.ts
git commit -m "feat: calendar settings — connect/disconnect accounts, calendar visibility"
```

---

## Chunk 10: Integration Testing & Polish

### Task 10.1: End-to-End Wiring Verification

- [ ] **Step 1: Add env vars to .env.example files**

Add `CALENDAR_TOKEN_ENCRYPTION_KEY` and `GOOGLE_WEBHOOK_BASE_URL` to `apps/api/.env.example` with development defaults.

- [ ] **Step 2: Update .gitignore for .superpowers/**

If not already present, add `.superpowers/` to `.gitignore`.

- [ ] **Step 3: Full typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Run existing tests to verify no regressions**

```bash
pnpm test
```

- [ ] **Step 5: Fix any BrettMessage-related type errors from the nullable itemId migration**

The existing `apps/api/src/routes/brett.ts` routes filter by `itemId` which is now nullable. Ensure the route param `:itemId` is properly asserted as non-null when creating BrettMessage records for items. Add a `where: { itemId: itemId }` filter (Prisma handles nullable correctly).

- [ ] **Step 6: Commit all fixes**

```bash
git add -A
git commit -m "fix: integration wiring — env vars, type fixes, BrettMessage nullable FK"
```

### Task 10.2: Update Mock Data & Remove Stale Mocks

- [ ] **Step 1: Update or remove mock calendar data**

The old `mockEvents` in `mockData.ts` used the old `CalendarEvent` shape. Either:
- Update to `CalendarEventDisplay` shape for fallback/empty state
- Or remove entirely if the sidebar shows empty state when no accounts connected

- [ ] **Step 2: Add empty states**

- CalendarTimeline: "Connect Google Calendar in Settings" message when no accounts
- CalendarPage: Same empty state
- Settings CalendarSection: encouraging message to connect

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/data/mockData.ts packages/ui/src/CalendarTimeline.tsx
git commit -m "chore: update mock data, add empty states for calendar"
```

### Task 10.3: Final Typecheck & Lint

- [ ] **Step 1: Full typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

- [ ] **Step 3: Fix any issues**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: typecheck and lint fixes for calendar integration"
```
