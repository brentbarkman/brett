# Content Reading System — Design Spec

## Overview

Add content consumption tracking to Brett. Users can save tweets, articles, videos, PDFs, and podcasts alongside their tasks. Content items share all task features (due dates, reminders, notes, attachments, linked items, completion, Brett thread) and add inline content preview in the detail panel.

Content is added by pasting/typing a URL into the existing quick-add input (auto-detected) or by dragging a PDF onto the app. The system auto-detects content type from the URL and extracts metadata + body content server-side. Content items live alongside tasks in all views, with type filtering to narrow by tasks or content.

## Content Types

Six rendering strategies, auto-detected from URL patterns:

| contentType | Detection | Rendering |
|------------|-----------|-----------|
| `tweet` | `x.com/*/status/*`, `twitter.com/*/status/*` | Twitter oEmbed HTML rendered in sandboxed iframe. Fallback: blockquote with tweet text + "View on X" link |
| `article` | `x.com/*/article/*`, `medium.com/*`, `*.substack.com/*`, pages with `<article>` tag or OG `type: article` | Reader-mode markdown via Readability extraction. Source bar (favicon + domain + date). "Open original" link |
| `video` | `youtube.com/watch*`, `youtu.be/*` | YouTube iframe embed (16:9). Title, channel, duration below |
| `pdf` | URL ending in `.pdf`, Content-Type `application/pdf`, or drag-dropped PDF file | Upload to S3, render in embedded PDF viewer (`<iframe>`). Title from filename |
| `podcast` | `open.spotify.com/episode/*` → Spotify embed. `podcasts.apple.com/*/podcast/*` → Apple Podcasts embed | Native embed player (Spotify or Apple). Fallback: episode metadata + "Open in app" link |
| `web_page` | Everything else | OG card: image + title + description + favicon + domain. "Open in browser" link |

### Embed Security

All third-party embeds (Twitter, YouTube, Spotify, Apple Podcasts) render inside sandboxed `<iframe>` elements with `sandbox="allow-scripts allow-same-origin allow-popups"`. No third-party scripts are loaded directly into the Electron renderer process. This avoids CSP complications and isolates third-party code.

### oEmbed Fallback Strategy

| Provider | Primary | Fallback (on API failure) |
|----------|---------|--------------------------|
| Twitter/X | `publish.twitter.com/oembed` → embed HTML in sandboxed iframe | Fetch page, extract tweet text/author via meta tags → blockquote card |
| YouTube | `youtube.com/oembed` → extract video ID → standard embed iframe | Parse video ID from URL → embed iframe directly (no metadata) |
| Spotify | No oEmbed — construct embed URL from episode URL (`open.spotify.com/embed/episode/...`) | Show episode metadata from OG tags + "Open in Spotify" link |
| Apple Podcasts | No oEmbed — construct embed URL (`embed.podcasts.apple.com/...`) | Show episode metadata from OG tags + "Open in Apple Podcasts" link |

## Data Model

No new tables. Content fields added to the existing `Item` model:

```
contentType        String?   — tweet | article | video | pdf | podcast | web_page
contentStatus      String?   — pending | extracted | failed
contentTitle       String?   — extracted original title (separate from user-editable title)
contentDescription String?   — OG description / article summary
contentImageUrl    String?   — OG image / thumbnail URL
contentBody        String?   @db.Text — extracted article text as markdown (articles, X articles). Max 500KB.
contentFavicon     String?   — source site favicon URL
contentDomain      String?   — display domain (e.g., "medium.com")
contentMetadata    Json?     — type-specific data (video duration, podcast episode, author, publish date, embed HTML, etc.)
```

**URL storage:** Reuse the existing `sourceUrl` field on Item for the content source URL. No new `contentUrl` field. For content items, `sourceUrl` is the URL the user provided. The `source` field is set to the domain name (e.g., "medium.com", "x.com") rather than the default "Brett".

**Content body limits:** `contentBody` uses Postgres `TEXT` type (via `@db.Text`) for large articles. Extraction truncates at 500KB. Validation on `PATCH` also enforces the 500KB limit.

Content items use `type: 'content'` on the existing Item type field. All existing relations (attachments, links, Brett messages, list membership) work automatically with no changes.

**PDF storage:** Drag-dropped PDFs upload to S3 via the existing attachment system. `sourceUrl` is left null (no external URL). The PDF renders from the attachment's presigned URL.

**Prisma schema cleanup:** Update the stale comment on `Item.type` from `"task" | "saved_web" | "saved_tweet"` to `"task" | "content"`. Verify no production rows use the old type values; if any exist, migrate them to `type: 'content'` with appropriate `contentType`.

## Type Interface Changes

All of these need content field additions:

- **`ItemRecord`** (`packages/types`) — add all content fields to mirror Prisma model
- **`Thing`** (`packages/types`) — add `contentType`, `contentStatus`, `contentDomain`, `contentImageUrl` (needed for list view icons and subtitles)
- **`ThingDetail`** (extends `Thing`) — add remaining content fields: `contentTitle`, `contentDescription`, `contentBody`, `contentFavicon`, `contentMetadata`
- **`CreateItemInput`** (`packages/types`) — add `sourceUrl` (already exists?), `contentType` (optional, auto-detected)
- **`UpdateItemInput`** (`packages/types`) — add content fields that can be updated post-extraction
- **`validateCreateItem`** (`packages/business`) — accept and validate content fields
- **`validateUpdateItem`** (`packages/business`) — accept and validate content fields, enforce 500KB `contentBody` limit
- **`itemToThing`** (`packages/business`) — map content fields to `Thing`
- **`itemToThingDetail`** (`apps/api`) — map content fields to `ThingDetail`

Add type definitions:

```typescript
type ContentType = 'tweet' | 'article' | 'video' | 'pdf' | 'podcast' | 'web_page'
type ContentStatus = 'pending' | 'extracted' | 'failed'
```

## Adding Content

### Quick-Add (URL Auto-Detection)

The existing quick-add input gains URL detection:

1. User types/pastes into quick-add, hits enter
2. If starts with `http://` or `https://` → definitely content
3. If looks like a URL without protocol — must match: no spaces, contains at least one dot, and the part before the first dot or slash is a recognized TLD pattern or known domain. Examples:
   - `youtube.com/watch?v=abc` → content (known domain)
   - `lennysnewsletter.substack.com/p/some-post` → content (known domain)
   - `x.com/user/status/123` → content (known domain)
   - `somesite.com/article` → content (has TLD pattern `.com`)
   - `v2.0.1` → task (no TLD pattern — `.0` is not a TLD)
   - `file.pdf` → task (single segment with extension, no domain structure)
   - `fix the api.controller bug` → task (contains spaces)
4. Plain text with spaces → task (existing behavior)
5. Extraction pipeline kicks off. If URL resolution fails (HEAD request 4xx/5xx or DNS failure) → auto-convert to task with original text as title, subtle toast notification: "Couldn't reach URL — saved as task instead"

### PDF Drag & Drop

1. User drags a PDF anywhere onto the app window
2. Full-window drop zone overlay appears (similar to existing attachment drop zone, but app-level)
3. On drop: create content item with `contentType: pdf`, upload file to S3 via existing attachment system
4. Title set to cleaned filename (strip extension, replace hyphens/underscores with spaces, title-case)
5. New content item has no list and no due date — lands in inbox. User can assign a list/date from the detail panel.

## Extraction Pipeline

Fire-and-forget async processing. `POST /things` creates the item immediately with `contentStatus: pending` and returns it. Extraction runs in a background promise (not awaited). Client receives the pending item and shows loading state. When extraction completes, SSE pushes an update.

### Steps

1. **Item created** — `contentStatus: pending`, title set to URL temporarily, client shows loading skeleton
2. **Fetch URL** — Server fetches the page with SSRF protections (see Security section). Runs URL pattern matching to determine `contentType`
3. **Extract metadata** — Parse OG tags (title, description, image), extract favicon, compute display domain
4. **Extract body** (articles only) — Run `@mozilla/readability` + `jsdom` on the HTML, convert to markdown, store in `contentBody` (truncate at 500KB)
5. **oEmbed calls** (tweets, videos) — Call provider oEmbed APIs for embed HTML/metadata, store in `contentMetadata`. See fallback strategy table above.
6. **Embed URL construction** (podcasts) — Construct Spotify/Apple embed URLs from source URL, store in `contentMetadata`
7. **PDF download** (if PDF URL) — Download file (max 50MB), upload to S3 via attachment system
8. **Update item** — Set all content fields, update `title` from extracted title (if user hasn't manually edited it), set `contentStatus: extracted`
9. **SSE notification** — Push `content-extracted` event with `{ itemId, contentStatus }`. Client invalidates the thing-detail query cache for that item.

On extraction failure: set `contentStatus: failed`, preserve the `sourceUrl`. UI shows error card with retry button.

### Retry Behavior

`POST /things/:id/extract` triggers extraction. Rules:
- Only callable on items with `contentStatus: failed` or `contentStatus: pending` (stuck). Returns 400 for already-extracted items.
- Sets `contentStatus: pending` before starting, so double-clicks are idempotent (second call sees `pending` and returns 409).
- No rate limiting needed in v1 — extraction is per-item and user-initiated.

### Dependencies

- `@mozilla/readability` — article text extraction (Mozilla's Reader View lib)
- `jsdom` — DOM parsing for Readability (server-side only, ~2MB, acceptable for API Docker image)
- No new third-party services

## Security

### SSRF Protection

The extraction pipeline fetches arbitrary user-provided URLs. Mitigations:

- **Block private IP ranges:** Resolve DNS before connecting. Reject if resolved IP falls in private/reserved ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`
- **Protocol allowlist:** Only `http://` and `https://` — reject `file://`, `ftp://`, etc.
- **Timeout:** 10-second timeout per fetch
- **Response size limit:** 5MB max for HTML pages, 50MB max for PDFs
- **Redirect limit:** Follow max 5 redirects, re-check IP on each redirect
- **User-Agent:** Set a descriptive User-Agent header (e.g., `Brett/1.0 (+https://brett.app)`)

### Embed Isolation

All third-party embeds render in sandboxed iframes. No third-party JavaScript loaded in the Electron renderer. CSP headers on the Electron app do not need to allow third-party script domains.

## Detail Panel Layout

Content items use the same 550px detail panel as tasks. The content preview section is inserted between the schedule row and Brett's Take:

```
┌─────────────────────────┐
│ Header + Complete        │
│ Editable Title           │
│ Metadata badges          │
│   (List, Source domain)  │
│ Schedule Row             │
│   (Due / Reminder / Rec) │
├─────────────────────────┤
│ Content Preview          │
│   (type-specific render) │
├─────────────────────────┤
│ Brett's Take             │
│ Notes (rich text)        │
│ Attachments              │
│ Linked Items             │
├─────────────────────────┤
│ Brett Thread (pinned)    │
└─────────────────────────┘
```

For task items (no content), the panel is unchanged — the content preview section simply doesn't render.

### Loading States

- `contentStatus: pending` — Skeleton shimmer matching expected content shape (wide rectangle for video, text lines for article, compact card for tweet). Subtle "Extracting content..." label.
- `contentStatus: failed` — Compact error card: "Couldn't load preview" + raw URL as clickable link + "Retry" button.
- `contentStatus: extracted` — Full preview renders.

## List & Inbox Integration

Content items appear alongside tasks in all views:

### Visual Distinction

Content items show a type icon instead of the task checkbox:
- Tweet: Twitter/X icon
- Article: document icon
- Video: play icon
- PDF: file icon
- Podcast: headphones icon
- Web page: globe icon

Clicking the icon area toggles completion (same as task checkbox).

### List Item Subtitle

- Tasks: due date label (existing)
- Content: domain (e.g., "medium.com") + content type badge

### Type Filtering

Simple pill/toggle in list view headers:
- All (default)
- Tasks only
- Content only

Uses the existing `GET /things?type=content` API filter.

### No Separate Page

No dedicated "Reading List" page in v1. Users who want one create a List called "Reading" and add content there. Type filtering on existing views covers the browsing need.

## API Changes

### Create Content Item

Extend `POST /things` to accept:
- `sourceUrl` (required for content type — reuses existing field)
- `contentType` (optional — auto-detected if not provided)

On successful creation with a `sourceUrl`, automatically trigger the extraction pipeline (fire-and-forget).

### Extraction Endpoint

`POST /things/:id/extract` — Retry content extraction. Only works on `contentStatus: failed` or stuck `pending` items. Returns 400 for already-extracted items, 409 if extraction is already in progress.

### Update Item

Extend `PATCH /things/:id` to accept content field updates (used internally by extraction pipeline, and for manual corrections).

### SSE Events

New event type on the existing SSE connection:

```typescript
// Event name: "content-extracted"
// Payload:
{ itemId: string, contentStatus: 'extracted' | 'failed' }
```

Client handles by invalidating the `thing-detail` and `things` query caches for the affected item.

## Deferred (Not v1)

- Email forwarding (deferred to browser extension phase)
- Browser extension / mobile share extension
- YouTube transcript extraction for richer Brett context
- Podcast transcript extraction
- Dedicated "Reading List" page
- Content-specific search (full-text search within extracted articles)
