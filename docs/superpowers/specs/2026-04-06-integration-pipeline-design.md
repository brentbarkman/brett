# Integration Pipeline Design Spec

**Date:** 2026-04-06
**Branch:** `feat/integration-pipeline`
**Goal:** Automated CI/CD pipeline for dogfooding — tests gate every deploy, desktop auto-updates atomically with the API, no manual `pnpm release`.

---

## 1. CI/CD Pipeline

### Trigger

Single GitHub Actions workflow (`.github/workflows/release.yml`) triggered on every push to `main`. Easily switchable to tagged releases later by changing the trigger to `on: push: tags: ['v*']`.

### Stages (sequential, fail-fast)

```
push to main
  1. Install dependencies (pnpm)
  2. Bump patch version in apps/desktop/package.json, commit with [skip ci], push
  3. Typecheck (pnpm typecheck)
  4. Run integration tests (Postgres service container) — deploy-gating tests only
  5. Deploy API to Railway (railway CLI)
  6. Build desktop (electron-builder, cross-compile macOS DMG on Linux)
  7. Upload DMG + latest-mac.yml + latest.json to Railway Object Storage (S3)
```

**Version bump happens first (step 2)** so the build uses the new version. If a concurrent push causes a non-fast-forward rejection on the bump commit, the workflow fails cleanly before any deploy — no half-published artifacts.

### Runner

`ubuntu-latest` — cheapest option. electron-builder supports cross-compiling macOS DMG from Linux.

**Unsigned build limitation:** The resulting DMG is unsigned and unnotarized. macOS Gatekeeper will block the first install — dogfooders must right-click → Open or run `xattr -cr Brett.dmg` once. Subsequent auto-updates bypass Gatekeeper because `electron-updater` replaces the app bundle programmatically. This is acceptable for internal dogfooding only. Code signing is required before any external distribution.

### Postgres Service Container

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    env:
      POSTGRES_USER: brett
      POSTGRES_PASSWORD: brett_dev
      POSTGRES_DB: brett_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Matches the local Docker Compose setup. Tests connect to `postgresql://brett:brett_dev@localhost:5432/brett_test`.

### Secrets Required

| Secret | Purpose | Scope |
|--------|---------|-------|
| `RAILWAY_TOKEN` | Deploy API via `railway up` | Railway project-scoped |
| `STORAGE_ACCESS_KEY` | S3 write credentials for release uploads | **Dedicated write-only credential** — not the same key used by the API at runtime |
| `STORAGE_SECRET_KEY` | S3 write credentials for release uploads | Same as above |
| `STORAGE_ENDPOINT` | S3 endpoint URL | Not sensitive, but stored as secret for consistency |
| `STORAGE_BUCKET` | S3 bucket name (default: `brett`) | Not sensitive |

### Security: S3 Credential Isolation

**Treat S3 write credentials as "code execution on every user's machine."** A leaked `STORAGE_ACCESS_KEY` allows overwriting the DMG and `latest-mac.yml`, which every running app will auto-download and install.

Mitigations:
- Use a **dedicated IAM identity** for CI uploads, separate from the API's runtime credentials
- Apply a bucket policy restricting `s3:PutObject` and `s3:DeleteObject` on the `releases/` prefix to only this CI identity
- Enable S3 object versioning so compromised artifacts can be rolled back
- The `GITHUB_TOKEN` used for the version bump commit must be a **fine-grained PAT** scoped to `contents: write` on this repo only — not the default `GITHUB_TOKEN` with broad permissions

### Version Bumping

**Happens at the start of the workflow** (before build), not after upload:
1. Pull latest `main` (handles concurrent pushes)
2. Increment the patch version in `apps/desktop/package.json` (e.g., `0.1.5` → `0.1.6`)
3. Commit with message `chore: bump desktop version to 0.1.6 [skip ci]`
4. Push to `main`

If the push fails (concurrent push race), the workflow exits cleanly. No build, no deploy, no partial state. The next push to main picks it up.

The commit message is a **hard-coded template** with no external interpolation to prevent workflow injection.

### Update Integrity

`electron-builder` generates a SHA512 hash of the DMG and embeds it in `latest-mac.yml`. `electron-updater` validates this hash before applying the update. This is the **only integrity check** until code signing is added. The CI workflow must not strip or modify `latest-mac.yml` after electron-builder generates it.

### API Backwards Compatibility

The pipeline deploys API before building the desktop. This means dogfooders may briefly run an older desktop against the new API. **API changes must be additive only** — no removing or renaming fields. This is enforced by discipline and contract types (Section 4), not by tooling.

---

## 2. Auto-Update UX

### Flow

1. App launches → checks for updates after 5s delay (already implemented)
2. Downloads update silently in background (already implemented, `autoDownload` triggers after `update-available`)
3. When download completes → main process stores version in `electron-store`, sends IPC to renderer
4. Renderer creates a system task in **Today view**: _"Update Brett to v1.2.3"_
5. User clicks the task → app calls `quitAndInstall()`
6. On restart → the update task is **deleted** (not completed — no history pollution)
7. If user ignores the task and quits normally → auto-installs if the setting is enabled

### System Task

- **View:** Today (not Inbox — no triage needed)
- **Type:** `system:update` — distinct from normal tasks, renders with a specific action
- **Action:** "Install & Restart" — clicking the task triggers the update
- **Single instance:** If a newer version downloads while an update task exists, the existing task is updated (new title/version), not duplicated
- **Cleanup on launch:** On app start, delete any lingering update tasks (handles the case where the update was installed via quit or the task is stale)

### Settings Badge

When there's a pending update task, the Settings icon in the left nav gets a **badge dot** — same pattern as broken integration reconnect prompts. Clicking through lands on `Settings#updates`.

### Settings `#updates` Section

- **"Automatically install updates when quitting"** toggle — on by default
- Shows current version and pending update version (if any)
- "Install & Restart" button — same action as clicking the Today task

### Implementation

- **Main process is the source of truth for update state.** The downloaded version is stored in `electron-store` (key: `pendingUpdateVersion`). This survives renderer reloads, app restarts, and renderer crashes.
- **`getDownloadedUpdateVersion()` IPC call** — synchronous query exposed via preload so the renderer can check on mount whether an update is pending, without waiting for the `update-downloaded` event to re-fire.
- **`useAutoUpdate` hook** — on mount, calls `getDownloadedUpdateVersion()` to check for pending updates. Also subscribes to `onUpdateDownloaded()` for new downloads. Manages the system task lifecycle via API. Exposes `{ updateReady, version, install }`.
- System task is a **real database record** created/updated via the existing Things API with a `type: "system:update"` discriminator. This ensures it survives app restarts and renders in Today like any other task. It is deleted (hard delete, not soft) when the update installs.
- **System task ID is stored in `electron-store`** (key: `pendingUpdateTaskId`) at creation time. Cleanup on launch is a single `DELETE /things/:id` call — no need for a new API query path for type-based filtering.
- Settings badge driven by the `pendingUpdateVersion` in electron-store (same badge dot pattern as connection health).

### IPC Security: `updateReady` Guard

The existing `install-update` IPC handler in `main.ts` has **no guard** — any renderer code can trigger `quitAndInstall()` unconditionally. This is a security issue: a compromised renderer (via XSS, malicious dependency, or injected UI) could force-install whatever binary was last downloaded.

**Fix:** Add an `updateReady` flag in the main process (`updater.ts`), set to `true` only inside the `update-downloaded` event handler. The `install-update` IPC handler checks this flag before calling `quitAndInstall()`. If `updateReady` is false, the handler rejects with an error.

```typescript
// updater.ts
let updateReady = false;

autoUpdater.on("update-downloaded", () => {
  updateReady = true;
  // ... send IPC to renderer
});

export function isUpdateReady(): boolean {
  return updateReady;
}

// main.ts
ipcMain.handle("install-update", () => {
  if (!isUpdateReady()) {
    throw new Error("No update downloaded");
  }
  quitAndInstall();
});
```

### Placeholder URL Note

`apps/desktop/package.json` has `publish.url` set to `https://placeholder.invalid/releases`. electron-builder bakes this into `app-update.yml` at build time, but `updater.ts` always overrides it via `setFeedURL()` at runtime before `checkForUpdates()`. The placeholder is never used in practice. **Do not "fix" this URL** — it is intentionally invalid as a safety net.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| New version while old update task exists | Update the existing task's title/version via stored task ID |
| App restarts after successful update | Delete task by stored ID, clear `pendingUpdateVersion` and `pendingUpdateTaskId` from electron-store |
| Renderer reloads mid-session | Hook calls `getDownloadedUpdateVersion()` on mount, recovers state |
| No internet / download fails | No task created, silent retry next launch |
| User dismisses task | Task reappears on next update check (or stays if not dismissed) |
| Auto-install on quit disabled | Update only installs when user clicks the task |

---

## 3. Integration Tests

### Approach

Expand the existing Vitest integration test suite. No new framework — same patterns as the 38 existing tests (real Postgres, `createTestUser()`, `authRequest()` helpers).

### Priority Routes (Currently Untested)

| Route | Test Focus |
|-------|------------|
| `/brett/omnibar` | Query parsing, result shape, auth |
| `/brett/chat` | Streaming response, auth, input validation |
| `/brett/intelligence` | Response shape, auth |
| `/brett/memory` | CRUD, auth |
| `/scouts` | Full CRUD lifecycle, run triggers, auth (large surface — 26KB route file) |
| `/suggestions` | Response shape, auth |
| `/webhooks` | Payload validation, auth |
| `/ai/config` | Provider config CRUD, auth |
| `/ai/usage` | Usage tracking, auth |
| `/config` | Public health/config endpoint |

### Test Categories

For each route:

1. **Happy path** — create, read, update, delete (as applicable)
2. **Auth enforcement** — every route rejects requests without a valid bearer token (401)
3. **Input validation** — malformed payloads return proper error responses (400/422)
4. **Response shape** — response bodies conform to contract types from `@brett/types` (Section 4)

### CI Integration: Separate `test:ci` from `test:all`

**Do not conflate deploy-gating tests with all monorepo tests.** Some packages may have tests that aren't CI-ready (missing native deps, flaky in headless environments, etc.).

- **`pnpm test:ci`** — runs only the deploy-gating test suites: `@brett/api`, `@brett/business`, `@brett/utils`. These are the tests that must pass before any deploy. Used in the GitHub Actions workflow.
- **`pnpm test:all`** — runs `turbo run test` across all packages. Used locally for comprehensive checks.
- **Root `pnpm test`** — unchanged, still points to `@brett/api` tests for backwards compatibility.

### Test Infrastructure Changes

- Add `test` task to `turbo.json` with `"dependsOn": []` (tests don't need build outputs)
- Add `test:ci` script to root `package.json` targeting the deploy-gating packages
- Add `test:all` script to root `package.json` running `turbo run test`
- Each package with tests gets a consistent `vitest run` script

---

## 4. Contract Types for Drift Protection

### Approach

Formalize API response shapes as shared types in `@brett/types`. Both the API route handlers and the desktop API client import the same types.

### How It Works

1. **API side:** Route handlers use contract types for response serialization (e.g., `ThingResponse`, `ListResponse`)
2. **Desktop side:** API client functions cast at the fetch boundary: `await res.json() as ThingResponse`. The cast must happen at the `res.json()` call site, not just as a return type annotation on the wrapper function — otherwise it's documentation, not enforcement.
3. **Typecheck gate:** If either side changes a shape without updating the shared type, `pnpm typecheck` fails in CI
4. **Test assertion:** Integration tests assert response bodies match contract types — exact shape checks, not just `toBeDefined()`

### Scope

This formalizes an existing pattern — `@brett/types` already shares interfaces. The work is:
- Audit API route handlers for inline response types that should be in `@brett/types`
- Ensure the desktop API client imports from `@brett/types` rather than defining its own shapes
- Enforce `as ContractType` at every `res.json()` boundary in the desktop API client
- Add contract type assertions to integration tests

### What This Catches

- API returns a field the desktop doesn't expect → typecheck fails
- Desktop expects a field the API removed → typecheck fails
- Response shape drifts between what tests assert and what the desktop consumes → typecheck fails

### What This Doesn't Catch

- Runtime serialization bugs (field is typed correctly but value is wrong) — caught by integration tests
- Extra fields added by the API that the desktop ignores — TypeScript structural typing allows this. For dogfooding, this is acceptable. For stricter enforcement later, add zod schema validation at the boundary.
- Version skew between deployed API and older desktop builds — mitigated by atomic deploy + auto-update + backwards-compatible API changes

---

## 5. Summary

| Concern | Solution | Gate |
|---------|----------|------|
| Manual releases | GitHub Actions on push to main | N/A |
| Bugs shipping | Integration tests in CI | `test:ci` must pass before deploy |
| Desktop ↔ API drift | Contract types in `@brett/types` | `pnpm typecheck` in CI |
| Version skew | Atomic deploy (API + desktop in same workflow) | Sequential stages |
| User gets updates | System task in Today + auto-install on quit setting | N/A |
| Update discoverability | Settings badge (same as connection health) | N/A |
| API breaking changes | Additive-only discipline + contract types | Typecheck + review |
| Update integrity | SHA512 hash in `latest-mac.yml` validated by electron-updater | Automated |
| IPC security | `updateReady` guard on `install-update` handler | Enforced in main process |
| S3 credential isolation | Dedicated write-only CI credential, bucket policy | Operational |

### Deferred

- **Code signing + notarization** — required before distributing beyond the team. Must use macOS runner (`macos-latest`) when added.
- **Windows/Linux builds** — macOS only for now
- **Tagged releases** — one-line trigger change when ready
- **E2E tests (Playwright + Electron)** — layer in later if needed; integration tests + contract types sufficient for dogfooding
- **Zod schema validation at fetch boundary** — stricter runtime contract enforcement; `as ContractType` casts are sufficient for now
