# Content Reading System — Design Spec

## Overview

Add content consumption tracking to Brett. Users can save tweets, articles, videos, PDFs, and podcasts alongside their tasks. Content items share all task features (due dates, reminders, notes, attachments, linked items, completion, Brett thread) and add inline content preview in the detail panel.

Content is added by pasting/typing a URL into the existing quick-add input (auto-detected) or by dragging a PDF onto the app. The system auto-detects content type from the URL and extracts metadata + body content server-side. Content items live alongside tasks in all views, with type filtering to narrow by tasks or content.

## Content Types

Six rendering strategies, auto-detected from URL patterns:

| contentType | Detection | Rendering |
|------------|-----------|-----------|
| `tweet` | `x.com/*/status/*`, `twitter.com/*/status/*` | Twitter embed script inline. Fallback: blockquote + "View on X" link |
| `article` | `x.com/*/article/*`, `medium.com/*`, `*.substack.com/*`, pages with `<article>` tag or OG `type: article` | Reader-mode markdown via Readability extraction. Source bar (favicon + domain + date). "Open original" link |
| `video` | `youtube.com/watch*`, `youtu.be/*` | YouTube iframe embed (16:9). Title, channel, duration below |
| `pdf` | URL ending in `.pdf`, Content-Type `application/pdf`, or drag-dropped PDF file | Upload to S3, render in embedded PDF viewer (`<iframe>`). Title from filename |
| `podcast` | `open.spotify.com/episode/*` → Spotify embed. `podcasts.apple.com/*/podcast/*` → Apple Podcasts embed | Native embed player (Spotify or Apple). Fallback: episode metadata + "Open in app" link |
| `web_page` | Everything else | OG card: image + title + description + favicon + domain. "Open in browser" link |

## Data Model

No new tables. Content fields added to the existing `Item` model:

```
contentUrl         String?   — source URL
contentType        String?   — tweet | article | video | pdf | podcast | web_page
contentStatus      String?   — pending | extracted | failed
contentTitle       String?   — extracted original title (separate from user-editable title)
contentDescription String?   — OG description / article summary
contentImageUrl    String?   — OG image / thumbnail URL
contentBody        String?   — extracted article text as markdown (articles, X articles)
contentFavicon     String?   — source site favicon URL
contentDomain      String?   — display domain (e.g., "medium.com")
contentMetadata    Json?     — type-specific data (video duration, podcast episode, author, publish date, embed HTML, etc.)
```

Content items use `type: 'content'` on the existing Item type field. All existing relations (attachments, links, Brett messages, list membership) work automatically with no changes.

PDF storage: drag-dropped PDFs upload to S3 via the existing attachment system. `contentUrl` points to the attachment's presigned URL.

## Adding Content

### Quick-Add (URL Auto-Detection)

The existing quick-add input gains URL detection:

1. User types/pastes into quick-add, hits enter
2. If starts with `http://` or `https://` → definitely content
3. If looks like a URL (contains a dot, no spaces, matches domain-like patterns like `x.com/...`, `medium.com/...`, `youtube.com/watch...`, or `something.com/whatever`) → optimistically create as content
4. Plain text with spaces and no URL patterns → task (existing behavior)
5. Extraction pipeline kicks off (see below). If URL resolution fails (HEAD request 4xx/5xx or DNS failure) → auto-convert to task with original text as title, subtle notification to user

### PDF Drag & Drop

1. User drags a PDF anywhere onto the app window
2. Full-window drop zone overlay appears (similar to existing attachment drop zone, but app-level)
3. On drop: create content item with `contentType: pdf`, upload file to S3 via existing attachment system
4. Title set to cleaned filename (strip extension, replace hyphens/underscores with spaces, title-case)

## Extraction Pipeline

Async server-side processing after item creation:

1. **Item created** — `contentStatus: pending`, title set to URL temporarily, client shows loading skeleton
2. **Fetch URL** — Server fetches the page, runs URL pattern matching to determine `contentType`
3. **Extract metadata** — Parse OG tags (title, description, image), extract favicon, compute display domain
4. **Extract body** (articles only) — Run `@mozilla/readability` + `jsdom` on the HTML, convert to markdown, store in `contentBody`
5. **oEmbed calls** (tweets, videos, podcasts) — Call provider oEmbed APIs for embed HTML/metadata, store in `contentMetadata`
6. **PDF download** (if PDF URL) — Download file, upload to S3 via attachment system
7. **Update item** — Set all content fields, `contentStatus: extracted`
8. **SSE notification** — Push event so client refreshes the item

On extraction failure: set `contentStatus: failed`, preserve the URL. UI shows error card with retry button.

### Dependencies

- `@mozilla/readability` — article text extraction (Mozilla's Reader View lib)
- `jsdom` — DOM parsing for Readability
- No new third-party services. oEmbed APIs are free public endpoints.

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

Extend `POST /things` to accept content fields:
- `contentUrl` (required for content type)
- Other content fields optional (populated by extraction pipeline)

### Extraction Endpoint

`POST /things/:id/extract` — Trigger or retry content extraction. Called automatically on creation, and manually via the retry button on failed items.

### Update Item

Extend `PATCH /things/:id` to accept content field updates (for when extraction completes).

### Types Package

Add to `ThingDetail`:
- All content fields (`contentUrl`, `contentType`, `contentStatus`, etc.)

Add `ContentType` enum type and `ContentStatus` enum type.

## Deferred (Not v1)

- Email forwarding (deferred to browser extension phase)
- Browser extension / mobile share extension
- YouTube transcript extraction for richer Brett context
- Podcast transcript extraction
- Dedicated "Reading List" page
- Content-specific search (full-text search within extracted articles)
