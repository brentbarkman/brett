# Feedback Submission Feature Design

## Overview

A keyboard-shortcut-triggered modal that auto-captures rich diagnostic context, lets the user describe the issue (bug, feature request, or enhancement), preview/redact the payload, and submits it through the API to create a GitHub Issue. Designed so Claude Code can autonomously fix reported bugs with full context.

## Entry Point

- `Cmd+Shift+F` opens the feedback modal
- Registered as a global shortcut in the renderer (alongside existing shortcuts in App.tsx)
- On trigger: immediately capture screenshot via `webContents.capturePage()` before the modal renders, so the screenshot shows the actual app state, not the modal itself

## Auto-Captured Diagnostics

All collected at modal open time, before the modal renders:

| Data | Source | Notes |
|---|---|---|
| Screenshot | `capturePage()` via IPC to main process | PNG, taken before modal mounts |
| App version | `electronAPI.getVersion()` or `import.meta.env` | Already available |
| OS + version | `navigator.userAgent` or IPC to `os.platform()/release()` | |
| Electron/Chrome version | `process.versions` via IPC | |
| Current route | `window.location.hash` / React Router | |
| User ID + email | Auth context (already in-memory) | |
| Recent console errors | Ring buffer intercepting `console.error` | Last 50 entries |
| Recent console logs | Ring buffer intercepting `console.log/warn/info` | Last 100 entries |
| Failed API calls | Intercept in `apiFetch` wrapper | Last 20, includes URL + status + response body |
| Action breadcrumbs | Event listener on clicks + route changes | Last 20 events with timestamps |

### Ring Buffer / Diagnostics Module

A module initialized once at app startup that:

- Wraps `console.error`, `console.warn`, `console.log` to tee output into fixed-size circular buffers (originals still fire normally)
- Hooks into `apiFetch` to record failed requests (URL, method, status, response body, timestamp)
- Listens for click events (captures target element selector + innerText) and route changes as breadcrumbs
- Exposes a `collectDiagnostics()` function that snapshots all buffers at call time

## Modal UI

Centered modal, ~600px wide.

1. **Type selector** — segmented control: Bug | Feature Request | Enhancement
2. **Title** — text input (required)
3. **Description** — textarea. Placeholder varies by type:
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
    screenshot?: string,       // base64 PNG
    appVersion: string,
    os: string,
    electronVersion: string,
    currentRoute: string,
    consoleErrors: string[],
    consoleLogs: string[],
    failedApiCalls: object[],
    breadcrumbs: object[],
    userId: string,
    userEmail: string,
  }
}
```

5. API validates, creates GitHub Issue with labels
6. API returns `{ issueUrl: string, issueNumber: number }`
7. Modal shows success state with link to the created issue

## API Route

`POST /feedback` in `apps/api/src/routes/feedback.ts`

- Requires auth (existing `authMiddleware`)
- Validates payload shape and required fields
- Creates GitHub Issue via `POST /repos/{owner}/{repo}/issues`:
  - **Title:** `[Bug] User title` / `[Feature] User title` / `[Enhancement] User title`
  - **Labels:** auto-applied (`bug`, `enhancement`, `feature-request`)
  - **Body:** User description at top, then diagnostics in collapsible `<details>` blocks:
    - System info (app version, OS, Electron version, route)
    - Screenshot (uploaded via GitHub's API, embedded as `![screenshot](url)` in the body)
    - Console errors
    - Console logs
    - Failed API calls (JSON)
    - Breadcrumbs (JSON)
    - User info (ID, email)
- GitHub PAT stored as `GITHUB_FEEDBACK_PAT` env var (Railway in prod, `.env` in dev)
- PAT permissions: fine-grained, single repo, `Issues: Read and write` only

## Screenshot via IPC

`capturePage()` lives on the main process's `BrowserWindow.webContents`:

1. **Main process** (`electron/main.ts`): add IPC handler `handle('capture-screenshot')` that calls `mainWindow.webContents.capturePage()` and returns the NativeImage as base64 PNG
2. **Preload** (`electron/preload.ts`): expose `captureScreenshot(): Promise<string>` on `electronAPI`
3. **Renderer**: calls `window.electronAPI.captureScreenshot()` before mounting the modal

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `apps/desktop/src/lib/diagnostics.ts` | Create | Ring buffers, breadcrumb tracking, `collectDiagnostics()` |
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
- No rate limiting (only authed users, primarily just you)
