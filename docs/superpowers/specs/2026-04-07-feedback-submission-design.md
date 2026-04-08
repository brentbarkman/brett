# Feedback Submission Feature Design

## Overview

A keyboard-shortcut-triggered modal that auto-captures rich diagnostic context, lets the user describe the issue (bug, feature request, or enhancement), preview/redact the payload, and submits it through the API to create a GitHub Issue. Designed so Claude Code can autonomously fix reported bugs with full context.

## Entry Point

- `Cmd+Shift+F` opens the feedback modal
- Registered as a global shortcut in the renderer (alongside existing shortcuts in App.tsx)
- On trigger: the renderer awaits `captureScreenshot()` IPC call first, then sets modal open state — this guarantees the screenshot captures the actual app state, not the modal itself. The modal must not render until the screenshot promise resolves.

## Auto-Captured Diagnostics

All collected at modal open time, before the modal renders:

| Data | Source | Notes |
|---|---|---|
| Screenshot | `capturePage()` via IPC to main process | PNG, resized to max 1280px wide before base64 encoding |
| App version | `electronAPI.getVersion()` or `import.meta.env` | Already available |
| OS + version | `navigator.userAgent` or IPC to `os.platform()/release()` | |
| Electron/Chrome version | `process.versions` via IPC | |
| Current route | `window.location.hash` / React Router | |
| User ID | Auth context (already in-memory) | Email is NOT captured — see Security section |
| Recent console errors | Ring buffer intercepting `console.error` | Last 50 entries, token-scrubbed on write |
| Recent console logs | Ring buffer intercepting `console.log/warn/info` | Last 100 entries, token-scrubbed on write |
| Failed API calls | Intercept in `apiFetch` wrapper | Last 20 — path + method + status + timestamp only (no response bodies, no query params) |
| Action breadcrumbs | Event listener on clicks + route changes | Last 20 events — element selector + `data-action`/`aria-label` only (no `innerText`) |

### Ring Buffer / Diagnostics Module

A module initialized once at app startup that:

- Wraps `console.error`, `console.warn`, `console.log` to tee output into fixed-size circular buffers (originals still fire normally)
- Scrubs sensitive patterns on write: redacts strings matching `Bearer [A-Za-z0-9._-]+`, `token=[...]`, and other known credential patterns before storing in the buffer
- Excludes log entries originating from auth-related routes (`/auth`, `/calendar-accounts`, `/granola`) from the buffer entirely
- Hooks into `apiFetch` to record failed requests — captures only the URL path (no query params), HTTP method, status code, and timestamp. Response bodies are NOT recorded.
- Listens for click events and route changes as breadcrumbs — captures element tag, className, and `data-action`/`aria-label` attributes only. Never captures `innerText` or other element content to avoid leaking user data (task titles, notes, AI responses).
- Exposes a `collectDiagnostics()` function that snapshots all buffers at call time

## Modal UI

Centered modal, ~600px wide.

1. **Type selector** — segmented control: Bug | Feature Request | Enhancement
2. **Title** — text input (required, max 200 characters)
3. **Description** — textarea (max 4000 characters). Placeholder varies by type:
   - Bug: "What happened? What did you expect?"
   - Feature Request: "What would you like to see?"
   - Enhancement: "What could be better?"
4. **Diagnostics preview** — collapsible section showing all auto-captured data:
   - Screenshot thumbnail (click to expand) with "Remove" button
   - Each diagnostic category as a collapsible row with "Remove" button
   - User can remove any item they don't want submitted
5. **Submit button** — disabled until title + description are filled

## Submission Flow

1. User fills in type, title, description
2. Reviews diagnostics in preview section, removes anything sensitive
3. Hits Submit
4. Desktop sends `POST /feedback` to the API:

```ts
{
  type: "bug" | "feature" | "enhancement",
  title: string,
  description: string,
  diagnostics: {
    screenshot?: string,       // base64 PNG, max 1280px wide
    appVersion: string,
    os: string,
    electronVersion: string,
    currentRoute: string,
    consoleErrors: string[],   // max 50 entries
    consoleLogs: string[],     // max 100 entries
    failedApiCalls: Array<{ path: string, method: string, status: number, timestamp: string }>,  // max 20
    breadcrumbs: Array<{ selector: string, action?: string, label?: string, route?: string, timestamp: string }>,  // max 20
    userId: string,
  }
}
```

5. API validates, creates GitHub Issue with labels
6. API returns `{ issueUrl: string, issueNumber: number }`
7. Modal shows success state with link to the created issue

## API Route

`POST /feedback` in `apps/api/src/routes/feedback.ts`

- Requires auth (existing `authMiddleware`)
- Rate limited: `rateLimiter(10, 60_000)` — 10 submissions per minute per user
- Body size limit: Hono `bodyLimit` middleware set to 5MB
- Validates payload:
  - Required fields: type, title, description
  - Title: max 200 characters
  - Description: max 4000 characters
  - Array lengths enforced: consoleErrors ≤ 50, consoleLogs ≤ 100, failedApiCalls ≤ 20, breadcrumbs ≤ 20
- Sanitizes all user-supplied text before embedding in GitHub markdown:
  - Escapes backticks and HTML tags in description and log entries
  - Wraps all diagnostic data in fenced code blocks to prevent markdown injection
- Creates GitHub Issue via `POST /repos/{owner}/{repo}/issues`:
  - **Title:** `[Bug] User title` / `[Feature] User title` / `[Enhancement] User title`
  - **Labels:** auto-applied (`bug`, `enhancement`, `feature-request`)
  - **Body:** User description at top, then diagnostics in collapsible `<details>` blocks:
    - System info (app version, OS, Electron version, route)
    - Screenshot (uploaded via GitHub's API, embedded as `![screenshot](url)` in the body)
    - Console errors (in fenced code block)
    - Console logs (in fenced code block)
    - Failed API calls (JSON in fenced code block)
    - Breadcrumbs (JSON in fenced code block)
    - User ID (for internal cross-referencing only — no email or PII in the issue body)
  - Total issue body truncated to 65,000 characters with `[truncated]` marker if exceeded
- Handles GitHub API errors explicitly (422, rate limit, etc.) and returns meaningful error messages to the client
- GitHub PAT stored as `GITHUB_FEEDBACK_PAT` env var (Railway in prod, `.env` in dev)
- PAT permissions: fine-grained, single repo, `Issues: Read and write` only

## Screenshot via IPC

`capturePage()` lives on the main process's `BrowserWindow.webContents`:

1. **Main process** (`electron/main.ts`): add IPC handler `handle('capture-screenshot')` that calls `mainWindow.webContents.capturePage()`, resizes the NativeImage to max 1280px wide, and returns it as base64 PNG
2. **Preload** (`electron/preload.ts`): expose `captureScreenshot(): Promise<string>` on `electronAPI`
3. **Renderer**: `await window.electronAPI.captureScreenshot()` must resolve BEFORE setting modal open state — this is a sequential async flow, not two separate effects

## Security Considerations

- **No PII in GitHub Issues:** User identity is cross-referenced server-side by userId only. Email addresses are never sent in the payload or written to the issue body.
- **Token scrubbing:** The diagnostics ring buffer scrubs auth tokens and credential patterns on write, not just before submission. This prevents accidental leakage even if the buffer is accessed by other code.
- **No response bodies:** Failed API call logging captures request metadata only (path, method, status, timestamp). Response bodies are excluded to prevent leaking AI content, task data, or server-side errors.
- **No element text content:** Breadcrumbs capture element selectors and data attributes only, never `innerText`, to prevent leaking task titles, notes, or AI responses.
- **Auth route exclusion:** Console log entries from auth-related routes are excluded from the buffer entirely.
- **Server-side validation:** All array lengths and string lengths are validated server-side to prevent abuse via crafted payloads bypassing the UI.
- **Rate limiting:** Applied even for personal use to prevent accidental retry-loop spam that could exhaust the GitHub API rate limit.
- **Screenshot size:** Capped at 1280px wide to limit payload size. Combined with 5MB body limit on the route.

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `apps/desktop/src/lib/diagnostics.ts` | Create | Ring buffers, token scrubbing, breadcrumb tracking, `collectDiagnostics()` |
| `apps/desktop/src/components/FeedbackModal.tsx` | Create | Modal UI component |
| `apps/desktop/src/api/feedback.ts` | Create | `useSubmitFeedback` React Query mutation hook |
| `apps/api/src/routes/feedback.ts` | Create | POST /feedback route with GitHub Issues integration |
| `apps/desktop/src/App.tsx` | Modify | Register `Cmd+Shift+F`, mount FeedbackModal, init diagnostics at startup |
| `apps/desktop/electron/main.ts` | Modify | Add `capture-screenshot` IPC handler |
| `apps/desktop/electron/preload.ts` | Modify | Expose `captureScreenshot` on electronAPI |
| `apps/api/src/app.ts` | Modify | Mount `/feedback` route |

## Out of Scope (v1)

- No database table — GitHub Issues is the sole source of truth
- No in-app report history or status tracking
- No file attachments beyond the auto-screenshot
- No mobile client (same API route will work when mobile is ready)
