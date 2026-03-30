# Desktop App Download & Auto-Update

**Date:** 2026-03-30
**Branch:** `feat/desktop-download`
**Scope:** Public download page, release upload script, in-app auto-update

---

## Overview

Three pieces that enable distributing the Brett desktop app:

1. **Public download page** — self-contained HTML page served from the API at `/download`
2. **Release upload script** — `pnpm release` builds the `.dmg` and uploads it + `latest-mac.yml` to Railway Object Storage
3. **Auto-update** — electron-updater checks Railway Object Storage on app startup for new versions

---

## 1. Public Download Page

### Route

- **Path:** `GET /download`
- **Auth:** None — fully public, no middleware
- **Served from:** Hono route in `apps/api/src/routes/download.ts`
- **Response:** Self-contained HTML (inline CSS, inline JS, no external dependencies)

### Design

Minimal, centered layout matching the login page aesthetic:

- **Background:** Rotating video backgrounds (same 9 videos as login page, crossfading)
- **Card:** Glassmorphic card (`bg-black/40 backdrop-blur-2xl border border-white/10`) centered on the page
- **Content:**
  - Brett logo (crystal prism SVG)
  - "Brett" app name
  - "Your day, handled." tagline
  - Download button (blue, `#3b82f6`) with download icon and "Download for macOS" label
  - Version info: `v{version} · macOS 12+`
  - Apple logo icon next to platform text
- **Animation:** Card entrance animation (fade in + translateY + scale, 600ms, cubic-bezier)

### Video Hosting

The 9 login background videos (currently in `apps/desktop/public/videos/`, ~454MB total) need to be accessible from the public download page. Since the API server doesn't serve static files:

- **Upload videos to Railway Object Storage** under a `public/videos/` prefix with public read access
- The download page HTML references these via the storage endpoint URL
- One-time manual upload (or include in the release script)

### Platform Detection

- Page detects the user's OS via `navigator.platform` / `navigator.userAgent`
- macOS users see "Download for macOS" as the primary button
- Non-macOS users see a note: "Brett is currently available for macOS" with a dimmed download link still accessible

### Download URL

The download button links directly to the `.dmg` file in Railway Object Storage:
`{STORAGE_ENDPOINT}/{STORAGE_BUCKET}/releases/Brett-{version}.dmg`

The version and download URL are embedded in the HTML at serve time by the Hono route (reads from a config value or environment variable).

---

## 2. Release Upload Script

### Command

```bash
pnpm release
```

Defined in the root `package.json`, runs a script at `scripts/release.ts` (or `scripts/release.sh`).

### Flow

1. **Build the desktop app:** Runs `pnpm --filter @brett/desktop electron:build`
2. **Locate artifacts:** Finds the `.dmg` and `latest-mac.yml` in `apps/desktop/dist/`
3. **Read version:** Extracts version from `apps/desktop/package.json`
4. **Upload to S3:** Uploads both files to Railway Object Storage under the `releases/` prefix:
   - `releases/Brett-{version}.dmg`
   - `releases/latest-mac.yml`
5. **Print summary:** Outputs the download URL and version

### S3 Key Structure

```
releases/
  Brett-{version}.dmg          # The installer
  latest-mac.yml                # electron-updater manifest
```

### Implementation

Use the existing S3 client configuration from `apps/api/src/lib/storage.ts`. The script runs as a standalone Node/tsx script that imports the S3 client setup, so it needs access to the same `STORAGE_*` environment variables.

### Prerequisites

- macOS machine (electron-builder builds `.dmg` only on macOS)
- `STORAGE_*` env vars set (same as API)

---

## 3. Auto-Update (electron-updater)

### Setup

Add `electron-updater` to `apps/desktop/` dependencies. Configure it to check a generic S3-compatible endpoint.

### Configuration

In `apps/desktop/electron/main.ts` (or a new `updater.ts` module):

```typescript
import { autoUpdater } from 'electron-updater'

autoUpdater.setFeedURL({
  provider: 'generic',
  url: '{STORAGE_ENDPOINT}/{STORAGE_BUCKET}/releases'
})
```

The `generic` provider points electron-updater at the `releases/` prefix where `latest-mac.yml` lives. It compares the version in the manifest against `app.getVersion()`.

### Behavior

- **Check on startup:** After the main window loads, check for updates (with a short delay to not block startup)
- **Background download:** If an update is available, download it silently in the background
- **Notify user:** Show a notification/dialog: "A new version of Brett is available. Restart to update?"
- **Install on restart:** When the user confirms, quit and install the update
- **No forced updates:** The user can dismiss and update later

### Update Flow

1. App starts → waits 5 seconds → calls `autoUpdater.checkForUpdates()`
2. electron-updater fetches `latest-mac.yml` from S3
3. Compares remote version with local `app.getVersion()`
4. If newer: downloads the `.dmg` in the background
5. Emits `update-downloaded` event → app shows a toast/dialog
6. User clicks "Restart" → `autoUpdater.quitAndInstall()`

### Error Handling

- Network errors during update check: silently ignore (not critical)
- Download failures: log and retry on next app launch
- No update available: no-op, no UI shown

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/routes/download.ts` | Hono route serving the download page HTML |
| `scripts/release.ts` | Build + upload release script |
| `apps/desktop/electron/updater.ts` | electron-updater configuration and lifecycle |

### Modified Files

| File | Change |
|------|--------|
| `apps/api/src/index.ts` | Register the `/download` route (public, no auth middleware) |
| `apps/desktop/package.json` | Add `electron-updater` dependency, add `publish` config for generic provider |
| `apps/desktop/electron/main.ts` | Import and initialize updater after window loads |
| `package.json` (root) | Add `release` script |

---

## Environment Variables

No new env vars needed. The release script and download page both use existing `STORAGE_*` variables:

- `STORAGE_ENDPOINT`
- `STORAGE_BUCKET`
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`

The download page URL is constructed at serve time from these.

---

## Security Considerations

- **Public route:** The `/download` route has no auth — intentional. It only serves static HTML and links to a public S3 object.
- **S3 permissions:** The `.dmg` and `latest-mac.yml` must be publicly readable. Videos under `public/videos/` must also be publicly readable. Other S3 objects (user attachments) remain private.
- **Code signing:** Not in scope for this work. macOS will show a Gatekeeper warning on first launch. Code signing can be added later with an Apple Developer certificate.
- **No user data exposed:** The download page contains no user-specific information.

---

## Out of Scope

- **Windows build** — electron-builder config for `.exe` (future work)
- **CI/CD pipeline** — GitHub Actions for automated builds on tag push (future work)
- **Code signing** — Apple Developer certificate + notarization (future work)
- **Custom domain** — e.g., `download.brett.app` (future work)
- **Analytics** — download counts, platform breakdown (future work)

---

## Open Questions

None — all decisions resolved during brainstorming.
