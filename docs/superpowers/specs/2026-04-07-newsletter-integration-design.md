# Newsletter Email Integration Design

## Overview

Ingest email newsletters as content items in Brett via email forwarding through Postmark Inbound Parse. Newsletters arrive in Inbox as single content items (one per issue), with auto-discovery of new senders requiring user approval via an in-app task. Designed to work with any email newsletter — starting with Colossus and TLDR Tech.

## Ingestion Flow

```
User's Gmail → forwarding rule → ingest@{user-domain} (Postmark MX)
    → Postmark POSTs JSON to POST /webhooks/email/ingest/:secret
    → API validates URL secret
    → Sender lookup in NewsletterSender table
    → Known sender: sanitize HTML → create Item in Inbox → trigger embedding
    → Unknown sender: store in PendingNewsletter → create approval task in Inbox
    → Return 200 OK
```

Postmark delivers a JSON payload with `From`, `FromName`, `Subject`, `HtmlBody`, `TextBody`, `Date`, `MessageID`, and other headers. No Postmark SDK needed — it's a standard webhook POST.

**Important:** Users must use Gmail's **auto-forwarding** (Settings → Forwarding and POP/IMAP → Add a forwarding address), NOT manual "Forward" from individual emails. Auto-forwarding preserves the original `From` header so sender matching works. Manual forwarding rewrites `From` to the Gmail user's address, breaking sender identification.

## Data Model

### New Content Type

Add `"newsletter"` to the `ContentType` union in `@brett/types`:

```typescript
// Existing types + new
type ContentType = "tweet" | "article" | "video" | "pdf" | "podcast" | "web_page" | "newsletter";

// New ContentMetadata variant
| {
    type: "newsletter";
    senderName: string;
    senderEmail: string;
    issueSubject: string;
    receivedAt: string;   // ISO 8601 from Postmark Date header
  }
```

### New Table: `NewsletterSender`

Stores user-approved newsletter senders.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | String | PK, cuid | |
| userId | String | FK → User, indexed | Owner |
| name | String | | Display name ("TLDR Tech") |
| email | String | | Sender email to match against |
| active | Boolean | default: true | Soft disable without deleting |
| createdAt | DateTime | default: now() | |
| updatedAt | DateTime | @updatedAt | |

**Unique constraint:** `(userId, LOWER(email))` — one entry per sender per user. Email matching is always case-insensitive (store normalized to lowercase on write, compare with `LOWER()` on read).

### New Table: `PendingNewsletter`

Holds emails from unknown senders awaiting approval.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | String | PK, cuid | |
| userId | String | FK → User, indexed | Owner |
| senderEmail | String | | From address |
| senderName | String | | Parsed display name from `FromName` |
| subject | String | | Email subject line |
| htmlBody | String | | Raw unsanitized HTML body (sanitized at ingest time, NOT at storage time) |
| textBody | String? | | Plain text fallback |
| postmarkMessageId | String | | For dedup |
| receivedAt | DateTime | | From Postmark `Date` header |
| approvalItemId | String? | FK → Item | The approval task created in Inbox |
| createdAt | DateTime | default: now() | |

**Index:** `(userId, senderEmail)` for lookup.

### Item Field Mapping (for ingested newsletters)

| Item Field | Value | Source |
|------------|-------|--------|
| type | `"content"` | Static |
| status | `"active"` | Lands in Inbox |
| title | Email subject line | Postmark `Subject` |
| contentType | `"newsletter"` | Static |
| contentTitle | Email subject line | Postmark `Subject` |
| contentBody | Sanitized HTML | Postmark `HtmlBody` → DOMPurify |
| contentMetadata | Newsletter metadata object | See type above |
| source | Sender display name | `NewsletterSender.name` |
| sourceId | Postmark MessageID | For dedup |
| listId | null | No list = Inbox |

No changes to the `Item` table schema — all fields already exist.

## Webhook Endpoint

### `POST /webhooks/email/ingest/:secret`

**Not behind auth middleware.** This is a public endpoint called by Postmark, protected by URL secret.

**Request:** Postmark Inbound webhook JSON payload (documented at Postmark's inbound webhook docs). Key fields:

```typescript
{
  From: string;           // "dan@tldrnewsletter.com"
  FromName: string;       // "TLDR Tech"
  Subject: string;        // "TLDR Tech 2026-04-07"
  HtmlBody: string;       // Full HTML content
  TextBody: string;       // Plain text version
  Date: string;           // RFC 2822 date
  MessageID: string;      // Unique message identifier
  To: string;             // "ingest@yourdomain.com"
}
```

**Processing logic:**

```
1. Validate :secret matches NEWSLETTER_INGEST_SECRET env var
   → Use timingSafeEqual for comparison (prevent timing attacks)
   → 401 if mismatch (don't leak info about valid paths)

2. Parse and validate payload (From, Subject required; at least one of HtmlBody or TextBody required)
   → 200 OK if malformed (don't trigger Postmark retries for bad data)
   → If HtmlBody is empty/null, fall back to TextBody wrapped in <pre> tags

3. Resolve user from To address
   → For v1: single-user setup, resolve to the one configured user
   → Future: map ingest addresses to users if multi-user

4. Dedup check: query Item where sourceId = MessageID AND userId = user
   → 200 OK if duplicate (idempotent)

5. Lookup sender: query NewsletterSender where LOWER(email) = LOWER(From) AND userId = user AND active = true
   → If matched but active = false (blocklisted): 200 OK, silently drop

6a. KNOWN SENDER:
    → Sanitize HtmlBody with DOMPurify (strip scripts, event handlers, forms, iframes)
    → Create Item with fields from mapping table above
    → Fire-and-forget: enqueueEmbed(item.id) for search/dedup
    → 200 OK

6b. UNKNOWN SENDER:
    → Dedup check: query PendingNewsletter where postmarkMessageId = MessageID
    → If duplicate pending: 200 OK
    → Store in PendingNewsletter table (full HTML preserved for later ingest)
    → Create approval task Item:
        - type: "task"
        - title: "Approve newsletter sender: {FromName} ({From})"
        - source: "Brett"
        - status: "active" (lands in Inbox)
        - metadata: { newsletterApproval: true, pendingNewsletterId: id }
    → 200 OK
```

**Error handling:**
- All validation/business failures return `200 OK` to prevent Postmark retries on non-retryable errors.
- Only DB/infrastructure errors return `500` — Postmark will retry with exponential backoff.

### User Resolution (v1: Single User)

For the initial implementation, the webhook resolves to a single configured user. The `To` address is the shared ingest address. Add `NEWSLETTER_INGEST_USER_ID` env var to map to the user.

**Future multi-user:** Each user gets a unique ingest address (e.g., `{userId}@ingest.domain.com` or `ingest+{userId}@domain.com`). Parse the `To` field to resolve. Out of scope for v1.

## Sender Approval Flow

When the user sees the approval task in Inbox:

1. **Task detail panel** renders "Approve" and "Block" action buttons when it detects `metadata.newsletterApproval === true`
2. **Approve:**
   - Creates `NewsletterSender` record (name, email, active: true)
   - Retrieves `PendingNewsletter` by ID from task metadata
   - Ingests the pending email as a content Item (same sanitization logic as known sender path — sanitize at ingest time)
   - Also ingests any OTHER pending newsletters from the same sender email, **capped at 10 most recent** (if more exist, log a warning and discard the rest to prevent flood)
   - Marks the approval task as completed
   - Deletes processed `PendingNewsletter` records
3. **Block:**
   - Creates `NewsletterSender` record with `active: false` (acts as blocklist)
   - Deletes `PendingNewsletter` records from this sender
   - Marks the approval task as completed
   - Future emails from this sender are silently dropped (matched but inactive)

### API Routes for Approval Actions

```
POST /newsletters/senders/:pendingId/approve
POST /newsletters/senders/:pendingId/block
```

Both require auth. Both resolve the `pendingNewsletterId` from the request, perform the action, and return the result.

## Newsletter Sender Management

### API Routes — `routes/newsletters.ts`

| Method | Path | Purpose |
|--------|------|---------|
| `GET /newsletters/senders` | List user's senders (approved + blocked) |
| `PATCH /newsletters/senders/:id` | Update name, active flag |
| `DELETE /newsletters/senders/:id` | Remove sender entirely |
| `POST /newsletters/senders/:pendingId/approve` | Approve pending sender |
| `POST /newsletters/senders/:pendingId/block` | Block pending sender |

All protected by auth middleware. Validated with Zod in `@brett/business`.

### Settings UI — `#newsletters` Tab

New section in Settings:

- **Forwarding address display** — shows `ingest@yourdomain.com` with copy button and brief setup instructions ("Forward newsletters to this address from Gmail")
- **Sender list** — table of configured senders with:
  - Name, email, status (active/blocked)
  - Toggle active/blocked
  - Delete button
- **Pending senders** — if any, show with Approve/Block actions (same as task detail panel, but accessible from Settings too)

Add `#newsletters` to the valid Settings tab hashes.

## HTML Sanitization

Newsletter HTML goes through DOMPurify server-side before storage. The sanitization config:

```typescript
const NEWSLETTER_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    // Structure
    'div', 'span', 'p', 'br', 'hr',
    // Text formatting
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
    // Lists
    'ul', 'ol', 'li',
    // Links and images
    'a', 'img',
    // Tables (newsletters use these heavily for layout)
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    // Block
    'blockquote', 'pre', 'code',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'width', 'height',
    'style',  // Needed for newsletter layout; further restricted below
    'class', 'id',
    'target', 'rel',
    'colspan', 'rowspan', 'cellpadding', 'cellspacing',
  ],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],  // All event handlers
  ALLOW_DATA_ATTR: false,
};
```

**Style attribute filtering:** After DOMPurify, run a second pass to strip dangerous CSS properties from inline styles — remove `position: fixed/absolute`, `z-index` values > 100, any `url()` references in CSS (prevents CSS-based data exfiltration). Keep layout-relevant properties: `width`, `height`, `margin`, `padding`, `text-align`, `color`, `background-color`, `font-size`, `font-weight`, `border`, `display`.

**Image handling:** Keep `<img>` tags with `src` attributes pointing to external URLs. Do NOT proxy images in v1 — newsletter images are typically hosted on CDNs and are not sensitive. Note: this means senders can track open rates via image pixels. Acceptable for v1; future enhancement could strip tracking pixels or proxy images.

## Environment & Infrastructure

### New Environment Variables

| Var | Required | Purpose |
|-----|----------|---------|
| `NEWSLETTER_INGEST_SECRET` | Yes (if feature enabled) | Random string for webhook URL path. Generate with `openssl rand -hex 32`. |
| `NEWSLETTER_INGEST_USER_ID` | Yes (if feature enabled) | User ID to assign ingested newsletters to (v1 single-user). |

### DNS Setup (One-Time, Manual)

1. Add MX record: `ingest.yourdomain.com` → Postmark inbound server (`inbound.postmarkapp.com`, priority 10)
2. Create Postmark inbound rule: forward to `https://api.yourdomain.com/webhooks/email/ingest/{SECRET}`

### New Cron Job

Add to `src/jobs/cron.ts`:

- **Pending newsletter cleanup** — daily, delete `PendingNewsletter` records older than 30 days **only if** their associated approval task is already completed/archived or does not exist. If the approval task is still active (user hasn't acted on it), skip the pending record — don't delete data the user hasn't decided on yet. Orphaned approval tasks (pending record deleted) should be archived with a note.

## Dependencies

**No new npm packages.** Uses:
- `isomorphic-dompurify` — already in the project (content extractor)
- `@hono/zod-validator` — already in the project
- Prisma — already in the project

## Security Considerations

### Webhook Authentication (Layered)

1. **Primary: URL secret** — `timingSafeEqual` comparison of `:secret` param against `NEWSLETTER_INGEST_SECRET` env var. This is the main gate.
2. **Secondary: Sender allowlist** — only known, user-approved senders create Items. Unknown senders go to pending review.
3. **Fast-follow: Postmark basic auth** — Postmark supports HTTP basic auth on webhook URLs (`https://user:pass@api.domain.com/...`). Add this as an additional layer once the core flow is proven. Tracked as a post-v1 hardening item.

### Stored XSS Prevention (Defense in Depth)

Newsletter HTML is third-party content rendered in an Electron app — this is the highest-risk surface.

1. **Server-side sanitization** — DOMPurify strips dangerous tags/attributes before storage (see HTML Sanitization section)
2. **CSS property allowlist** — second pass strips dangerous inline CSS after DOMPurify
3. **Iframe sandbox** — rendered in `<iframe sandbox="allow-same-origin">` (no `allow-scripts`) for browser-level isolation
4. **No raw rendering** — `PendingNewsletter.htmlBody` stores unsanitized HTML but it is NEVER rendered directly. Sanitization runs at ingest time (when creating the Item), not at storage time.

### Email Spoofing

The `From` header in email is trivially spoofable. If the webhook URL secret is compromised, an attacker could forge emails from an approved sender. The URL secret is the primary defense. Postmark basic auth (fast-follow) adds a second factor. This is acceptable risk for v1 given the threat model (personal productivity app, not multi-tenant SaaS).

## Content Rendering

In the detail panel, when `contentType === "newsletter"`:

- Render `contentBody` (sanitized HTML) inside an **`<iframe sandbox="allow-same-origin">`** — this provides browser-level isolation as a defense-in-depth layer even if a DOMPurify bypass exists. Do NOT add `allow-scripts` to the sandbox.
- Use the same content rendering approach as `type: "article"` but with newsletter-aware styling:
  - Constrain width to reading column (~680px)
  - Override newsletter font stacks with the app's typography
  - Ensure links open in external browser (`target="_blank"`, `rel="noopener noreferrer"`)
- Show metadata pill: source name + received date
- No extraction step needed — the HTML is already the content (unlike articles where we extract from a URL)

## Scope Boundaries

### In Scope (v1)
- Postmark inbound webhook endpoint
- NewsletterSender and PendingNewsletter tables
- Auto-discovery with approval tasks
- Approve/Block flow from task detail panel
- Settings UI for sender management
- Newsletter content type + metadata
- HTML sanitization
- Embedding for search
- Pending newsletter cleanup cron

### Out of Scope (Future)
- Multi-user ingest address mapping
- Per-article extraction from newsletters (break one issue into multiple items)
- Image proxying / tracking pixel stripping
- Rich consumption UX (reading mode, highlights, etc.)
- Newsletter-specific search filters in UI
- Outbound email (notifications, digests)
- Gmail API integration (direct inbox reading without forwarding)

## Testing Strategy

### Unit Tests
- HTML sanitization: verify script/iframe/event handler stripping, verify layout-relevant tags preserved
- Sender matching logic: exact match, case-insensitive email comparison
- Payload parsing: valid Postmark payload, missing fields, malformed data
- Dedup logic: duplicate MessageID handling

### Integration Tests
- Full webhook flow: POST → Item creation → verify fields
- Unknown sender flow: POST → PendingNewsletter + approval task creation
- Approval flow: approve → sender created + pending ingested + task completed
- Block flow: block → sender created (inactive) + pending deleted + task completed
- Dedup: same MessageID twice → only one Item
- Secret validation: wrong secret → 401, correct secret → processes

### Manual Testing
- Forward a real newsletter from Gmail to the ingest address
- Verify it appears in Inbox with readable HTML
- Verify unknown sender creates approval task
- Approve and verify retroactive ingest
- Block and verify future emails are dropped
