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
  2. Typecheck (pnpm typecheck)
  3. Run all integration tests (Postgres service container)
  4. Deploy API to Railway (railway CLI)
  5. Build desktop (electron-builder, cross-compile macOS DMG on Linux)
  6. Upload DMG + latest-mac.yml + latest.json to Railway Object Storage (S3)
  7. Auto-increment patch version in apps/desktop/package.json, commit with [skip ci]
```

### Runner

`ubuntu-latest` — cheapest option. electron-builder supports cross-compiling macOS DMG from Linux. No code signing (deferred).

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

| Secret | Purpose |
|--------|---------|
| `RAILWAY_TOKEN` | Deploy API via `railway up` |
| `STORAGE_ENDPOINT` | S3 endpoint for desktop build uploads |
| `STORAGE_ACCESS_KEY` | S3 credentials |
| `STORAGE_SECRET_KEY` | S3 credentials |
| `STORAGE_BUCKET` | S3 bucket (default: `brett`) |

### Version Bumping

After successful desktop upload, the workflow:
1. Increments the patch version in `apps/desktop/package.json` (e.g., `0.1.5` → `0.1.6`)
2. Commits with message `chore: bump desktop version to 0.1.6 [skip ci]`
3. Pushes to `main`

The `[skip ci]` prevents an infinite loop. The version bump ensures the auto-updater sees a new version on the next release.

### API Backwards Compatibility

The pipeline deploys API before building the desktop. This means dogfooders may briefly run an older desktop against the new API. **API changes must be additive only** — no removing or renaming fields. This is enforced by discipline and contract types (Section 4), not by tooling.

---

## 2. Auto-Update UX

### Flow

1. App launches → checks for updates after 5s delay (already implemented)
2. Downloads update silently in background (already implemented, `autoDownload` triggers after `update-available`)
3. When download completes → creates a system task in **Today view**: _"Update Brett to v1.2.3"_
4. User clicks the task → app calls `quitAndInstall()`
5. On restart → the update task is **deleted** (not completed — no history pollution)
6. If user ignores the task and quits normally → auto-installs if the setting is enabled

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

- **`useAutoUpdate` hook** — listens to `electronAPI.onUpdateDownloaded()`, manages system task lifecycle via API, exposes `{ updateReady, version, install }`
- System task is a **real database record** created/updated via the existing Things API with a `type: "system:update"` discriminator. This ensures it survives app restarts and renders in Today like any other task. It is deleted (hard delete, not soft) when the update installs.
- Settings badge driven by querying for pending system update tasks (same pattern as connection health)

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| New version while old update task exists | Update the existing task's title/version |
| App restarts after successful update | Delete any lingering update tasks |
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

### CI Integration

- All tests run in GitHub Actions with Postgres service container
- Tests must pass before API deploy or desktop build begins
- Existing `pnpm test` command expanded to run all packages: `turbo run test`

### Test Infrastructure Changes

- Add `test` task to `turbo.json` so all packages' tests run via `turbo run test`
- Root `pnpm test` updated to run `turbo run test` instead of only `@brett/api`
- Each package with tests gets a consistent `vitest run` script

---

## 4. Contract Types for Drift Protection

### Approach

Formalize API response shapes as shared types in `@brett/types`. Both the API route handlers and the desktop API client import the same types.

### How It Works

1. **API side:** Route handlers use contract types for response serialization (e.g., `ThingResponse`, `ListResponse`)
2. **Desktop side:** API client functions use the same types for deserialization
3. **Typecheck gate:** If either side changes a shape without updating the shared type, `pnpm typecheck` fails in CI
4. **Test assertion:** Integration tests assert response bodies match contract types

### Scope

This formalizes an existing pattern — `@brett/types` already shares interfaces. The work is:
- Audit API route handlers for inline response types that should be in `@brett/types`
- Ensure the desktop API client imports from `@brett/types` rather than defining its own shapes
- Add contract type assertions to integration tests

### What This Catches

- API returns a field the desktop doesn't expect → typecheck fails
- Desktop expects a field the API removed → typecheck fails
- Response shape drifts between what tests assert and what the desktop consumes → typecheck fails

### What This Doesn't Catch

- Runtime serialization bugs (field is typed correctly but value is wrong) — caught by integration tests
- Version skew between deployed API and older desktop builds — mitigated by atomic deploy + auto-update + backwards-compatible API changes

---

## 5. Summary

| Concern | Solution | Gate |
|---------|----------|------|
| Manual releases | GitHub Actions on push to main | N/A |
| Bugs shipping | Integration tests in CI | Tests must pass before deploy |
| Desktop ↔ API drift | Contract types in `@brett/types` | `pnpm typecheck` in CI |
| Version skew | Atomic deploy (API + desktop in same workflow) | Sequential stages |
| User gets updates | System task in Today + auto-install on quit setting | N/A |
| Update discoverability | Settings badge (same as connection health) | N/A |
| API breaking changes | Additive-only discipline + contract types | Typecheck + review |

### Deferred

- **Code signing + notarization** — add when distributing beyond the team
- **Windows/Linux builds** — macOS only for now
- **Tagged releases** — one-line trigger change when ready
- **E2E tests (Playwright + Electron)** — layer in later if needed; integration tests + contract types sufficient for dogfooding
