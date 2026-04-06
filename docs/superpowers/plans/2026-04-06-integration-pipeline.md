# Integration Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automated CI/CD pipeline for dogfooding — tests gate every deploy, desktop auto-updates atomically with the API, and the update UX lives inside the product as a system task.

**Architecture:** GitHub Actions workflow runs typecheck + integration tests, then deploys API to Railway and builds + uploads desktop DMG to S3. The Electron auto-updater (already wired) creates a system task in Today view when an update downloads. A new Settings `#updates` tab with badge dot provides a second surface.

**Tech Stack:** GitHub Actions, electron-updater, electron-store, Vitest, Hono test helpers, @brett/types contract types

**Working directory:** `/Users/brentbarkman/code/brett/.worktrees/feat/integration-pipeline`

---

## File Map

### New Files
- `.github/workflows/release.yml` — CI/CD pipeline
- `apps/desktop/src/hooks/useAutoUpdate.ts` — auto-update hook (IPC + system task lifecycle)
- `apps/desktop/src/settings/UpdatesSection.tsx` — Settings #updates tab
- `apps/api/src/__tests__/omnibar.test.ts` — integration test
- `apps/api/src/__tests__/ai-config.test.ts` — integration test
- `apps/api/src/__tests__/ai-usage.test.ts` — integration test
- `apps/api/src/__tests__/suggestions.test.ts` — integration test
- `apps/api/src/__tests__/config.test.ts` — integration test

### Modified Files
- `apps/desktop/electron/updater.ts` — add `updateReady` guard, expose `getDownloadedUpdateVersion()`
- `apps/desktop/electron/main.ts` — guard `install-update` handler, add `get-update-version` IPC, extend electron-store type
- `apps/desktop/electron/preload.ts` — expose `getDownloadedUpdateVersion()`
- `apps/desktop/src/settings/SettingsLayout.tsx` — add `#updates` tab with badge dot
- `apps/desktop/src/views/TodayView.tsx` — render update system task action
- `packages/ui/src/ThingCard.tsx` — add update action button (alongside reconnect pattern)
- `packages/ui/src/ThingsList.tsx` — pass `onInstallUpdate` prop
- `turbo.json` — add `test` task
- `package.json` (root) — add `test:ci` and `test:all` scripts

---

## Task 1: Harden the Electron Updater (updateReady guard + state persistence)

**Files:**
- Modify: `apps/desktop/electron/updater.ts`
- Modify: `apps/desktop/electron/main.ts:34,78-80`
- Modify: `apps/desktop/electron/preload.ts:3-17`

- [ ] **Step 1: Add `updateReady` flag and `getDownloadedUpdateVersion()` to updater.ts**

Replace the full contents of `apps/desktop/electron/updater.ts`:

```typescript
import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";
import Store from "electron-store";
import path from "path";

// Main-process source of truth for update state
let updateReady = false;
let downloadedVersion: string | null = null;

function getUpdateFeedUrl(): string | null {
  let endpoint = "";
  let bucket = "brett";

  // In production, read from build-time config (same as API URL pattern)
  try {
    const fs = require("fs");
    const configPath = path.join(__dirname, "api-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.storageEndpoint) endpoint = config.storageEndpoint;
    if (config.storageBucket) bucket = config.storageBucket;
  } catch {
    // Fall through to env vars (dev mode)
  }

  // Dev fallback
  if (!endpoint) endpoint = process.env.STORAGE_ENDPOINT || "";
  if (!endpoint) return null;

  return `${endpoint}/${bucket}/releases`;
}

export function initAutoUpdater(store: Store): void {
  const feedUrl = getUpdateFeedUrl();

  if (!feedUrl) {
    console.log("[Updater] No storage endpoint configured — skipping auto-update");
    return;
  }

  if (!feedUrl.startsWith("https://")) {
    console.warn("[Updater] Feed URL is not HTTPS — skipping auto-update for security");
    return;
  }

  autoUpdater.setFeedURL({
    provider: "generic",
    url: feedUrl,
  });

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = store.get("autoInstallOnQuit", true) as boolean;

  autoUpdater.on("update-available", (info) => {
    console.log(`[Updater] Update available: v${info.version}`);
    autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App is up to date");
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[Updater] Update downloaded: v${info.version}`);
    updateReady = true;
    downloadedVersion = info.version;
    store.set("pendingUpdateVersion", info.version);

    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send("update-downloaded", info.version);
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[Updater] Error:", err.message);
  });

  // Check after a short delay to not block startup
  setTimeout(() => {
    console.log("[Updater] Checking for updates...");
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] Check failed:", err.message);
    });
  }, 5000);
}

export function isUpdateReady(): boolean {
  return updateReady;
}

export function getDownloadedVersion(): string | null {
  return downloadedVersion;
}

let installTriggered = false;

export function quitAndInstall(): void {
  if (installTriggered) return;
  if (!updateReady) {
    throw new Error("No update downloaded — cannot install");
  }
  installTriggered = true;
  autoUpdater.quitAndInstall();
}
```

- [ ] **Step 2: Update main.ts — extend store type, guard IPC, add new IPC handlers**

In `apps/desktop/electron/main.ts`, make these changes:

Change the import on line 8:
```typescript
import { initAutoUpdater, quitAndInstall, isUpdateReady, getDownloadedVersion } from "./updater";
```

Change the store type on line 34:
```typescript
const store = new Store<{
  encryptedToken?: string;
  pendingUpdateVersion?: string;
  pendingUpdateTaskId?: string;
  autoInstallOnQuit?: boolean;
}>();
```

Replace the `install-update` handler at lines 78-80:
```typescript
ipcMain.handle("install-update", () => {
  if (!isUpdateReady()) {
    throw new Error("No update downloaded");
  }
  quitAndInstall();
});

ipcMain.handle("get-update-version", () => {
  return getDownloadedVersion() || store.get("pendingUpdateVersion") || null;
});

ipcMain.handle("get-update-task-id", () => {
  return store.get("pendingUpdateTaskId") || null;
});

ipcMain.handle("set-update-task-id", (_event, taskId: string | null) => {
  if (taskId) {
    store.set("pendingUpdateTaskId", taskId);
  } else {
    store.delete("pendingUpdateTaskId");
  }
});

ipcMain.handle("clear-pending-update", () => {
  store.delete("pendingUpdateVersion");
  store.delete("pendingUpdateTaskId");
});

ipcMain.handle("get-auto-install-on-quit", () => {
  return store.get("autoInstallOnQuit", true);
});

ipcMain.handle("set-auto-install-on-quit", (_event, enabled: boolean) => {
  store.set("autoInstallOnQuit", enabled);
});
```

Change the `initAutoUpdater()` call on line 286:
```typescript
initAutoUpdater(store);
```

- [ ] **Step 3: Update preload.ts — expose new IPC methods**

Replace `apps/desktop/electron/preload.ts`:

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  storeToken: (token: string) => ipcRenderer.invoke("store-token", token),
  getToken: () => ipcRenderer.invoke("get-token"),
  clearToken: () => ipcRenderer.invoke("clear-token"),
  startGoogleOAuth: () => ipcRenderer.invoke("start-google-oauth"),
  things3Scan: () => ipcRenderer.invoke("things3:scan"),
  things3Import: () => ipcRenderer.invoke("things3:import"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getDownloadedUpdateVersion: () => ipcRenderer.invoke("get-update-version"),
  getUpdateTaskId: () => ipcRenderer.invoke("get-update-task-id"),
  setUpdateTaskId: (taskId: string | null) => ipcRenderer.invoke("set-update-task-id", taskId),
  clearPendingUpdate: () => ipcRenderer.invoke("clear-pending-update"),
  getAutoInstallOnQuit: () => ipcRenderer.invoke("get-auto-install-on-quit"),
  setAutoInstallOnQuit: (enabled: boolean) => ipcRenderer.invoke("set-auto-install-on-quit", enabled),
  onUpdateDownloaded: (callback: (version: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, version: string) => callback(version);
    ipcRenderer.on("update-downloaded", handler);
    return () => ipcRenderer.removeListener("update-downloaded", handler);
  },
});
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (all 18 tasks)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/updater.ts apps/desktop/electron/main.ts apps/desktop/electron/preload.ts
git commit -m "feat: harden auto-updater — updateReady guard, state persistence in electron-store"
```

---

## Task 2: useAutoUpdate Hook

**Files:**
- Create: `apps/desktop/src/hooks/useAutoUpdate.ts`

- [ ] **Step 1: Create the hook**

Create `apps/desktop/src/hooks/useAutoUpdate.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api/client";

declare global {
  interface Window {
    electronAPI?: {
      installUpdate: () => Promise<void>;
      getDownloadedUpdateVersion: () => Promise<string | null>;
      getUpdateTaskId: () => Promise<string | null>;
      setUpdateTaskId: (taskId: string | null) => Promise<void>;
      clearPendingUpdate: () => Promise<void>;
      getAutoInstallOnQuit: () => Promise<boolean>;
      setAutoInstallOnQuit: (enabled: boolean) => Promise<void>;
      onUpdateDownloaded: (callback: (version: string) => void) => () => void;
    };
  }
}

interface UseAutoUpdateReturn {
  updateReady: boolean;
  version: string | null;
  install: () => void;
}

export function useAutoUpdate(): UseAutoUpdateReturn {
  const [version, setVersion] = useState<string | null>(null);
  const api = window.electronAPI;

  // On mount: check if an update was already downloaded (survives renderer reloads)
  useEffect(() => {
    if (!api) return;

    api.getDownloadedUpdateVersion().then((v) => {
      if (v) {
        setVersion(v);
        ensureUpdateTask(v);
      } else {
        // No pending update — clean up any stale task from a previous update
        cleanupStaleTask();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to new update downloads
  useEffect(() => {
    if (!api) return;

    const unsubscribe = api.onUpdateDownloaded((v) => {
      setVersion(v);
      ensureUpdateTask(v);
    });

    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function ensureUpdateTask(newVersion: string) {
    if (!api) return;

    try {
      const existingTaskId = await api.getUpdateTaskId();

      if (existingTaskId) {
        // Update existing task with new version
        try {
          await apiFetch(`/things/${existingTaskId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: `Update Brett to v${newVersion}` }),
          });
          return;
        } catch {
          // Task may have been deleted — create a new one
        }
      }

      // Create new system task in Today
      const today = new Date().toISOString().split("T")[0] + "T00:00:00.000Z";
      const task = await apiFetch<{ id: string }>("/things", {
        method: "POST",
        body: JSON.stringify({
          type: "task",
          title: `Update Brett to v${newVersion}`,
          sourceId: "system:update",
          dueDate: today,
          dueDatePrecision: "day",
        }),
      });

      await api.setUpdateTaskId(task.id);
    } catch (err) {
      console.error("[AutoUpdate] Failed to create update task:", err);
    }
  }

  async function cleanupStaleTask() {
    if (!api) return;

    try {
      const taskId = await api.getUpdateTaskId();
      if (taskId) {
        await apiFetch(`/things/${taskId}`, { method: "DELETE" }).catch(() => {});
        await api.setUpdateTaskId(null);
        await api.clearPendingUpdate();
      }
    } catch {
      // Cleanup is best-effort
    }
  }

  const install = useCallback(() => {
    if (!api) return;
    api.installUpdate().catch((err) => {
      console.error("[AutoUpdate] Install failed:", err);
    });
  }, [api]);

  return {
    updateReady: version !== null,
    version,
    install,
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useAutoUpdate.ts
git commit -m "feat: useAutoUpdate hook — system task lifecycle, IPC state recovery"
```

---

## Task 3: Update UX in ThingCard + ThingsList + TodayView

**Files:**
- Modify: `packages/ui/src/ThingCard.tsx` — add update action button
- Modify: `packages/ui/src/ThingsList.tsx` — pass `onInstallUpdate` prop
- Modify: `apps/desktop/src/views/TodayView.tsx` — wire up useAutoUpdate

- [ ] **Step 1: Add update button to ThingCard**

In `packages/ui/src/ThingCard.tsx`, add to the props interface (around line 13-14):

```typescript
  onInstallUpdate?: () => void;
```

Update the function signature to include the new prop:

```typescript
export function ThingCard({ thing, onClick, onToggle, onFocus, isFocused, onReconnect, reconnectPending, onInstallUpdate }: ThingCardProps) {
```

In the JSX, right before the reconnect button block (around line 183), add:

```typescript
        {/* Install update button for system update tasks */}
        {onInstallUpdate && thing.sourceId === "system:update" && (
          <button
            onClick={(e) => { e.stopPropagation(); onInstallUpdate(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-brett-gold/15 text-brett-gold hover:bg-brett-gold/25 transition-colors"
          >
            <Download size={11} />
            Install & Restart
          </button>
        )}
```

Add `Download` to the lucide-react import at the top of the file.

- [ ] **Step 2: Pass onInstallUpdate through ThingsList Section**

In `packages/ui/src/ThingsList.tsx`, add `onInstallUpdate?: () => void;` to the `ThingsListProps` interface and destructure it in the function signature. Then pass it to `Section`, and in `Section`'s props and its `ThingCard` render:

```typescript
onInstallUpdate={onInstallUpdate}
```

In the `Section` component's `ThingCard` render (where `onReconnect` is already passed), add:

```typescript
onInstallUpdate={onInstallUpdate}
```

- [ ] **Step 3: Wire up in TodayView**

In `apps/desktop/src/views/TodayView.tsx`, add the import:

```typescript
import { useAutoUpdate } from "../hooks/useAutoUpdate";
```

Inside the `TodayView` function, add:

```typescript
const { install: installUpdate } = useAutoUpdate();
```

Pass `onInstallUpdate={installUpdate}` to every `<ThingsList>` instance in TodayView (there are 3 — lines 135, 144, 151).

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ThingCard.tsx packages/ui/src/ThingsList.tsx apps/desktop/src/views/TodayView.tsx
git commit -m "feat: update task in Today view — Install & Restart action on system:update tasks"
```

---

## Task 4: Settings #updates Tab with Badge

**Files:**
- Create: `apps/desktop/src/settings/UpdatesSection.tsx`
- Modify: `apps/desktop/src/settings/SettingsLayout.tsx`

- [ ] **Step 1: Create UpdatesSection**

Create `apps/desktop/src/settings/UpdatesSection.tsx`:

```typescript
import React, { useState, useEffect } from "react";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { Download, Check } from "lucide-react";

export function UpdatesSection() {
  const { updateReady, version, install } = useAutoUpdate();
  const [autoInstall, setAutoInstall] = useState(true);
  const api = window.electronAPI;

  useEffect(() => {
    api?.getAutoInstallOnQuit().then(setAutoInstall);
  }, [api]);

  const handleToggle = () => {
    const next = !autoInstall;
    setAutoInstall(next);
    api?.setAutoInstallOnQuit(next);
  };

  // Read current app version from package.json (injected by Vite)
  const currentVersion = __APP_VERSION__;

  return (
    <div className="space-y-5">
      {/* Current version */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <h3 className="text-sm font-medium text-white mb-3">Version</h3>
        <p className="text-sm text-white/60">
          Brett v{currentVersion}
        </p>
      </div>

      {/* Pending update */}
      {updateReady && (
        <div className="bg-white/5 rounded-xl border border-white/10 p-5">
          <h3 className="text-sm font-medium text-white mb-3">Update Available</h3>
          <p className="text-sm text-white/60 mb-4">
            Version {version} is ready to install. Brett will restart to apply the update.
          </p>
          <button
            onClick={install}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brett-gold/15 text-brett-gold hover:bg-brett-gold/25 transition-colors"
          >
            <Download size={14} />
            Install & Restart
          </button>
        </div>
      )}

      {!updateReady && (
        <div className="bg-white/5 rounded-xl border border-white/10 p-5">
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-400" />
            <p className="text-sm text-white/60">You're up to date.</p>
          </div>
        </div>
      )}

      {/* Auto-install setting */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white">Auto-install on quit</h3>
            <p className="text-xs text-white/40 mt-1">
              Automatically install downloaded updates when you quit Brett.
            </p>
          </div>
          <button
            onClick={handleToggle}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              autoInstall ? "bg-brett-gold" : "bg-white/20"
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                autoInstall ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `__APP_VERSION__` define to Vite config**

In `apps/desktop/vite.config.ts`, add to the defineConfig:

```typescript
define: {
  __APP_VERSION__: JSON.stringify(require("./package.json").version),
},
```

And add the type declaration in `apps/desktop/src/vite-env.d.ts`:

```typescript
declare const __APP_VERSION__: string;
```

- [ ] **Step 3: Add #updates tab to SettingsLayout**

In `apps/desktop/src/settings/SettingsLayout.tsx`:

Add the import:
```typescript
import { UpdatesSection } from "./UpdatesSection";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
```

Update the `SettingsTab` type (line 18):
```typescript
type SettingsTab =
  | "profile"
  | "security"
  | "calendar"
  | "ai-providers"
  | "timezone-location"
  | "import"
  | "updates"
  | "account";
```

Add the tab to the `TABS` array (before "account"):
```typescript
  { id: "updates", label: "Updates" },
```

Inside `SettingsLayout()`, add:
```typescript
const { updateReady } = useAutoUpdate();
```

In `renderContent()`, add the case before `"account"`:
```typescript
      case "updates":
        return <UpdatesSection />;
```

In the badge dot logic (around line 145), extend the condition:
```typescript
            const hasBrokenDot =
              (tab.id === "calendar" && brokenTypes.some((t) => t === "google-calendar" || t === "granola")) ||
              (tab.id === "ai-providers" && brokenTypes.includes("ai")) ||
              (tab.id === "updates" && updateReady);
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/UpdatesSection.tsx apps/desktop/src/settings/SettingsLayout.tsx apps/desktop/vite.config.ts apps/desktop/src/vite-env.d.ts
git commit -m "feat: Settings #updates tab — version display, install button, auto-install toggle, badge dot"
```

---

## Task 5: Test Infrastructure — turbo.json + test scripts

**Files:**
- Modify: `turbo.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Add test task to turbo.json**

Add to the `"tasks"` object in `turbo.json`:

```json
    "test": {
      "dependsOn": [],
      "cache": false
    }
```

- [ ] **Step 2: Add test:ci and test:all scripts to root package.json**

Add these scripts:

```json
    "test:ci": "pnpm --filter @brett/api run test && pnpm --filter @brett/business run test && pnpm --filter @brett/utils run test",
    "test:all": "turbo run test"
```

- [ ] **Step 3: Run test:ci to verify it works**

Run: `pnpm test:ci`
Expected: All tests pass (requires Postgres running)

- [ ] **Step 4: Commit**

```bash
git add turbo.json package.json
git commit -m "feat: test infrastructure — turbo test task, separate test:ci from test:all"
```

---

## Task 6: Integration Tests — Untested Routes

**Files:**
- Create: `apps/api/src/__tests__/config.test.ts`
- Create: `apps/api/src/__tests__/omnibar.test.ts`
- Create: `apps/api/src/__tests__/ai-config.test.ts`
- Create: `apps/api/src/__tests__/ai-usage.test.ts`
- Create: `apps/api/src/__tests__/suggestions.test.ts`

- [ ] **Step 1: Write config endpoint test**

Create `apps/api/src/__tests__/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { app } from "../app.js";

describe("Config routes", () => {
  it("GET /config returns public config", async () => {
    const res = await app.request("/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
```

- [ ] **Step 2: Write omnibar test**

Create `apps/api/src/__tests__/omnibar.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("Brett Omnibar routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Omnibar User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/brett/omnibar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /brett/omnibar with empty query returns results", async () => {
    const res = await authRequest("/brett/omnibar", token, {
      method: "POST",
      body: JSON.stringify({ query: "" }),
    });
    // May return 200 with empty results or 400 depending on validation
    expect([200, 400]).toContain(res.status);
  });

  it("POST /brett/omnibar with valid query returns 200", async () => {
    const res = await authRequest("/brett/omnibar", token, {
      method: "POST",
      body: JSON.stringify({ query: "test search" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
```

- [ ] **Step 3: Write AI config test**

Create `apps/api/src/__tests__/ai-config.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("AI Config routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("AI Config User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/ai/config");
    expect(res.status).toBe(401);
  });

  it("GET /ai/config returns provider config", async () => {
    const res = await authRequest("/ai/config", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
```

- [ ] **Step 4: Write AI usage test**

Create `apps/api/src/__tests__/ai-usage.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("AI Usage routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("AI Usage User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/ai/usage");
    expect(res.status).toBe(401);
  });

  it("GET /ai/usage returns usage data", async () => {
    const res = await authRequest("/ai/usage", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
```

- [ ] **Step 5: Write suggestions test**

Create `apps/api/src/__tests__/suggestions.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("Suggestions routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Suggestions User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/api/suggestions");
    expect(res.status).toBe(401);
  });

  it("GET /api/suggestions returns suggestions", async () => {
    const res = await authRequest("/api/suggestions", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
```

- [ ] **Step 6: Run the new tests**

Run: `pnpm --filter @brett/api run test`
Expected: All tests pass (existing + new)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/__tests__/config.test.ts apps/api/src/__tests__/omnibar.test.ts apps/api/src/__tests__/ai-config.test.ts apps/api/src/__tests__/ai-usage.test.ts apps/api/src/__tests__/suggestions.test.ts
git commit -m "test: integration tests for config, omnibar, ai-config, ai-usage, suggestions routes"
```

---

## Task 7: GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

# Prevent concurrent releases
concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest

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

    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.RELEASE_PAT }}

      - uses: pnpm/action-setup@v4
        with:
          version: 8.15.6

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Version bump — happens first so the build uses the new version
      - name: Bump version
        run: |
          cd apps/desktop
          CURRENT=$(node -p "require('./package.json').version")
          IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
          NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
          node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
            pkg.version = '$NEW_VERSION';
            fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
          "
          echo "VERSION=$NEW_VERSION" >> $GITHUB_ENV
          cd ../..
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add apps/desktop/package.json
          git commit -m "chore: bump desktop version to $NEW_VERSION [skip ci]"
          git push

      - name: Typecheck
        run: pnpm typecheck

      - name: Run integration tests
        run: pnpm test:ci
        env:
          DATABASE_URL: postgresql://brett:brett_dev@localhost:5432/brett_test
          BETTER_AUTH_SECRET: test-secret-at-least-32-characters-long
          BETTER_AUTH_URL: http://localhost:3001
          GOOGLE_CLIENT_ID: test-google-client-id
          GOOGLE_CLIENT_SECRET: test-google-client-secret

      - name: Generate Prisma client
        run: pnpm --filter @brett/api exec prisma generate

      - name: Run migrations on test DB
        run: pnpm --filter @brett/api exec prisma migrate deploy
        env:
          DATABASE_URL: postgresql://brett:brett_dev@localhost:5432/brett_test

      - name: Deploy API to Railway
        run: npx @railway/cli deploy --service api
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

      - name: Build desktop
        run: pnpm --filter @brett/desktop electron:build
        env:
          VITE_API_URL: https://api.brett.brentbarkman.com
          STORAGE_ENDPOINT: ${{ secrets.STORAGE_ENDPOINT }}
          STORAGE_BUCKET: ${{ secrets.STORAGE_BUCKET }}

      - name: Upload release artifacts to S3
        run: npx tsx scripts/upload-release.ts
        env:
          STORAGE_ENDPOINT: ${{ secrets.STORAGE_ENDPOINT }}
          STORAGE_ACCESS_KEY: ${{ secrets.STORAGE_ACCESS_KEY }}
          STORAGE_SECRET_KEY: ${{ secrets.STORAGE_SECRET_KEY }}
          STORAGE_BUCKET: ${{ secrets.STORAGE_BUCKET }}
```

- [ ] **Step 2: Create the upload-release script (CI-only, no build step)**

Create `scripts/upload-release.ts`:

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { s3, BUCKET } from "./s3";

const DESKTOP_DIR = path.resolve(__dirname, "../apps/desktop");

async function uploadRelease() {
  if (!process.env.STORAGE_ENDPOINT) {
    throw new Error("STORAGE_ENDPOINT not set");
  }

  // Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf-8"));
  const version = pkg.version;
  console.log(`Uploading Brett v${version} release artifacts...\n`);

  // Find the .dmg
  const distDir = path.join(DESKTOP_DIR, "dist");
  const dmgFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".dmg"));
  if (dmgFiles.length === 0) {
    throw new Error("No .dmg found in dist/. Build may have failed.");
  }
  const dmgFile = dmgFiles[0];
  const dmgPath = path.join(distDir, dmgFile);

  // Find latest-mac.yml
  const ymlPath = path.join(distDir, "latest-mac.yml");
  if (!fs.existsSync(ymlPath)) {
    throw new Error("latest-mac.yml not found in dist/.");
  }

  // Upload .dmg
  const dmgKey = `releases/Brett-${version}.dmg`;
  const dmgBody = fs.readFileSync(dmgPath);
  console.log(`Uploading ${dmgFile} (${(dmgBody.length / 1024 / 1024).toFixed(1)} MB) → ${dmgKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: dmgKey,
      Body: dmgBody,
      ContentType: "application/octet-stream",
      ACL: "public-read",
    })
  );
  console.log("  ✓ DMG uploaded");

  // Upload latest-mac.yml (contains SHA512 hash — do not modify)
  const ymlKey = "releases/latest-mac.yml";
  const ymlBody = fs.readFileSync(ymlPath);
  console.log(`Uploading latest-mac.yml → ${ymlKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: ymlKey,
      Body: ymlBody,
      ContentType: "text/yaml",
      ACL: "public-read",
    })
  );
  console.log("  ✓ latest-mac.yml uploaded");

  // Upload latest.json
  const latestKey = "releases/latest.json";
  const latestBody = JSON.stringify({ version, dmg: dmgKey });
  console.log(`Uploading latest.json → ${latestKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: latestKey,
      Body: latestBody,
      ContentType: "application/json",
      ACL: "public-read",
    })
  );
  console.log("  ✓ latest.json uploaded");

  const endpoint = process.env.STORAGE_ENDPOINT;
  console.log(`\n✓ Release v${version} uploaded!`);
  console.log(`  Download: ${endpoint}/${BUCKET}/${dmgKey}`);
}

uploadRelease().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/release.yml scripts/upload-release.ts
git commit -m "feat: GitHub Actions release pipeline — typecheck, test, deploy API, build + upload desktop"
```

---

## Task 8: Final Typecheck + Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS (all 18 tasks)

- [ ] **Step 2: Run tests**

Run: `pnpm test:ci` (requires Postgres)
Expected: All tests pass

- [ ] **Step 3: Verify git status is clean**

Run: `git status`
Expected: Clean working tree

- [ ] **Step 4: Commit any remaining changes**

Only if needed.
