# Desktop App Download & Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable distributing the Brett desktop app via a public download page, with an upload script to publish releases and in-app auto-update.

**Architecture:** A self-contained HTML page served from the Hono API at `/download` (no auth). A release script builds the `.dmg`, uploads it + `latest-mac.yml` to Railway Object Storage under `releases/`. The desktop app uses `electron-updater` with the `generic` provider pointing at that same S3 prefix to check for updates on startup.

**Tech Stack:** Hono (HTML route), AWS SDK S3 (upload script), electron-updater (auto-update), electron-builder (packaging)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/api/src/routes/download.ts` | Create | Hono route serving self-contained download page HTML |
| `apps/api/src/app.ts` | Modify | Register `/download` route (public, no auth) |
| `scripts/release.ts` | Create | Build desktop app + upload artifacts to S3 |
| `apps/desktop/electron/updater.ts` | Create | electron-updater setup and lifecycle |
| `apps/desktop/electron/main.ts` | Modify | Import and init updater after window ready |
| `apps/desktop/package.json` | Modify | Add electron-updater dep, publish config |
| `package.json` (root) | Modify | Add `release` script |

---

### Task 1: Public Download Page Route

**Files:**
- Create: `apps/api/src/routes/download.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create the download route**

Create `apps/api/src/routes/download.ts`:

```typescript
import { Hono } from "hono";
import { html } from "hono/html";

const download = new Hono();

// No auth middleware — this is a public page

function getDownloadUrl(): string {
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  const bucket = process.env.STORAGE_BUCKET || "brett";
  return `${endpoint}/${bucket}/releases`;
}

function getVideoBaseUrl(): string {
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  const bucket = process.env.STORAGE_BUCKET || "brett";
  return `${endpoint}/${bucket}/public/videos`;
}

download.get("/", (c) => {
  const baseUrl = getDownloadUrl();
  const videoBase = getVideoBaseUrl();
  const version = process.env.APP_VERSION || "0.0.1";

  return c.html(/* full HTML string — see Step 2 */);
});

export { download };
```

- [ ] **Step 2: Write the full download page HTML**

Replace the `c.html(...)` call with the complete self-contained HTML page. The page includes:

```typescript
download.get("/", (c) => {
  const baseUrl = getDownloadUrl();
  const videoBase = getVideoBaseUrl();
  const version = process.env.APP_VERSION || "0.0.1";

  const videoFiles = Array.from({ length: 9 }, (_, i) => `${videoBase}/login-bg-${i + 1}.mp4`);

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brett — Download</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    /* Video background */
    .video-bg {
      position: fixed;
      inset: 0;
      z-index: 0;
    }
    .video-bg video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: opacity 1200ms ease-out;
    }

    /* Glass card */
    .download-card {
      position: relative;
      z-index: 10;
      text-align: center;
      padding: 48px 40px;
      border-radius: 16px;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(48px);
      -webkit-backdrop-filter: blur(48px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 420px;
      width: 90%;
      animation: cardEnter 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      opacity: 0;
    }
    @keyframes cardEnter {
      from { opacity: 0; transform: translateY(16px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .logo {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 800;
      color: white;
      box-shadow: 0 0 40px rgba(245, 158, 11, 0.25);
    }

    .app-name {
      font-size: 32px;
      font-weight: 700;
      color: white;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .tagline {
      color: rgba(255, 255, 255, 0.5);
      font-size: 16px;
      margin-bottom: 32px;
    }

    .download-btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 14px 32px;
      background: #3b82f6;
      border: none;
      border-radius: 10px;
      color: white;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 200ms ease;
      text-decoration: none;
    }
    .download-btn:hover {
      background: #2563eb;
      transform: translateY(-1px);
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
    }
    .download-btn svg {
      width: 18px;
      height: 18px;
    }

    .version-info {
      color: rgba(255, 255, 255, 0.3);
      font-size: 12px;
      margin-top: 16px;
    }

    .platform-note {
      color: rgba(255, 255, 255, 0.35);
      font-size: 13px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
  </style>
</head>
<body>

<div class="video-bg">
  <video id="vid-a" muted playsinline preload="auto" autoplay></video>
  <video id="vid-b" muted playsinline preload="auto" style="opacity:0"></video>
</div>

<div class="download-card">
  <div class="logo">B</div>
  <div class="app-name">Brett</div>
  <div class="tagline">Your day, handled.</div>

  <a href="${baseUrl}/Brett-${version}.dmg" class="download-btn" id="download-link">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    <span id="download-text">Download for macOS</span>
  </a>
  <div class="version-info">v${version} · macOS 12+</div>

  <div class="platform-note" id="platform-note" style="display:none">
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style="display:inline-block;vertical-align:-2px;margin-right:4px;opacity:0.5"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
    Brett is currently available for macOS
  </div>
</div>

<script>
  // Video rotation — same crossfade pattern as the desktop login
  const videos = ${JSON.stringify(videoFiles)};
  let current = Math.floor(Math.random() * videos.length);
  const vidA = document.getElementById('vid-a');
  const vidB = document.getElementById('vid-b');
  let activeSlot = vidA;

  vidA.src = videos[current];
  vidA.play().catch(() => {});

  function nextVideo() {
    current = (current + 1) % videos.length;
    const inactive = activeSlot === vidA ? vidB : vidA;
    inactive.src = videos[current];
    inactive.play().catch(() => {});
    inactive.style.opacity = '1';
    activeSlot.style.opacity = '0';
    activeSlot = inactive;
  }

  vidA.addEventListener('ended', nextVideo);
  vidB.addEventListener('ended', nextVideo);

  // Platform detection
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  if (!isMac) {
    document.getElementById('platform-note').style.display = 'block';
  }
</script>

</body>
</html>`);
});
```

- [ ] **Step 3: Register the route in app.ts**

In `apps/api/src/app.ts`, add the import and route registration:

```typescript
// Add import at top with other route imports:
import { download } from "./routes/download.js";

// Add route registration after the health check (line 45), before other routes:
app.route("/download", download);
```

This places it alongside `/health` as a public route — no `authMiddleware` applied.

- [ ] **Step 4: Update CORS to allow browser access to the download page**

The download page is visited directly in a browser (not from an Electron origin), so it doesn't need CORS changes — it serves HTML, not an API response. No changes needed.

- [ ] **Step 5: Verify the route works**

Run: `cd /Users/brentbarkman/code/brett-desktop-download && pnpm --filter @brett/api dev`

Then: `curl http://localhost:3001/download`

Expected: Full HTML page returned with the download card markup, video script, and correct version interpolated.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/download.ts apps/api/src/app.ts
git commit -m "feat(download): add public download page served from /download"
```

---

### Task 2: Upload Videos to S3

The 9 login background videos need to be accessible from the public download page. Create a one-time upload script.

**Files:**
- Create: `scripts/upload-videos.ts`

- [ ] **Step 1: Create the video upload script**

Create `scripts/upload-videos.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

const BUCKET = process.env.STORAGE_BUCKET || "brett";
const VIDEO_DIR = path.resolve(__dirname, "../apps/desktop/public/videos");

async function uploadVideos() {
  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".mp4"));
  console.log(`Found ${files.length} videos to upload...\n`);

  for (const file of files) {
    const filePath = path.join(VIDEO_DIR, file);
    const key = `public/videos/${file}`;
    const body = fs.readFileSync(filePath);

    console.log(`Uploading ${file} (${(body.length / 1024 / 1024).toFixed(1)} MB)...`);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "video/mp4",
        ACL: "public-read",
      })
    );

    console.log(`  ✓ ${key}`);
  }

  console.log("\nAll videos uploaded.");
}

uploadVideos().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to root package.json**

In the root `package.json`, add to scripts:

```json
"upload:videos": "npx tsx scripts/upload-videos.ts"
```

- [ ] **Step 3: Test the upload**

Run: `cd /Users/brentbarkman/code/brett-desktop-download && pnpm upload:videos`

Expected: All 9 videos upload to `public/videos/` prefix in the S3 bucket. Verify one is accessible via browser at `{STORAGE_ENDPOINT}/{BUCKET}/public/videos/login-bg-1.mp4`.

Note: If Railway Object Storage doesn't support `ACL: "public-read"`, the objects may need to be made public through the Railway dashboard or by configuring a bucket policy. Test and adjust accordingly.

- [ ] **Step 4: Commit**

```bash
git add scripts/upload-videos.ts package.json
git commit -m "feat(download): add video upload script for S3"
```

---

### Task 3: Release Upload Script

**Files:**
- Create: `scripts/release.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Create the release script**

Create `scripts/release.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

const BUCKET = process.env.STORAGE_BUCKET || "brett";
const DESKTOP_DIR = path.resolve(__dirname, "../apps/desktop");

async function release() {
  // 1. Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, "package.json"), "utf-8"));
  const version = pkg.version;
  console.log(`Building Brett v${version}...\n`);

  // 2. Build the desktop app
  console.log("Running electron:build...");
  execSync("pnpm --filter @brett/desktop electron:build", {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });

  // 3. Find the .dmg and latest-mac.yml
  const distDir = path.join(DESKTOP_DIR, "dist");
  const dmgFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(".dmg"));
  if (dmgFiles.length === 0) {
    throw new Error("No .dmg file found in dist/. Build may have failed.");
  }
  const dmgFile = dmgFiles[0];
  const dmgPath = path.join(distDir, dmgFile);

  const ymlPath = path.join(distDir, "latest-mac.yml");
  if (!fs.existsSync(ymlPath)) {
    throw new Error("latest-mac.yml not found in dist/. electron-builder may not have generated it.");
  }

  // 4. Upload .dmg
  const dmgKey = `releases/Brett-${version}.dmg`;
  const dmgBody = fs.readFileSync(dmgPath);
  console.log(`\nUploading ${dmgFile} (${(dmgBody.length / 1024 / 1024).toFixed(1)} MB) → ${dmgKey}`);
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

  // 5. Upload latest-mac.yml
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

  // 6. Summary
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  console.log(`\n✓ Release v${version} published!`);
  console.log(`  Download: ${endpoint}/${BUCKET}/${dmgKey}`);
  console.log(`  Manifest: ${endpoint}/${BUCKET}/${ymlKey}`);
}

release().catch((err) => {
  console.error("Release failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the release script to root package.json**

In the root `package.json`, add to scripts:

```json
"release": "npx tsx scripts/release.ts"
```

- [ ] **Step 3: Configure electron-builder to generate latest-mac.yml**

In `apps/desktop/package.json`, update the `build` config to add `publish` so electron-builder generates the update manifest:

```json
"build": {
  "appId": "com.brett.app",
  "productName": "Brett",
  "files": [
    "dist/electron/**/*",
    "dist/renderer/**/*"
  ],
  "mac": {
    "target": "dmg"
  },
  "publish": {
    "provider": "generic",
    "url": "${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET || 'brett'}/releases"
  }
}
```

Wait — `package.json` can't interpolate env vars. The `publish` field for electron-builder with the `generic` provider just needs a placeholder URL. electron-builder uses it to generate `latest-mac.yml` with the correct file info. The actual URL where files are hosted is what matters at runtime.

Update `apps/desktop/package.json` build config to:

```json
"build": {
  "appId": "com.brett.app",
  "productName": "Brett",
  "files": [
    "dist/electron/**/*",
    "dist/renderer/**/*"
  ],
  "mac": {
    "target": "dmg"
  },
  "publish": {
    "provider": "generic",
    "url": "https://placeholder.invalid/releases"
  }
}
```

The URL in `publish` is written into `latest-mac.yml` but electron-updater in the app overrides it at runtime (see Task 4). The `publish` config's main purpose here is to make electron-builder generate the `latest-mac.yml` file.

- [ ] **Step 4: Verify the build produces expected artifacts**

Run: `cd /Users/brentbarkman/code/brett-desktop-download && pnpm --filter @brett/desktop electron:build`

Expected: `apps/desktop/dist/` contains:
- `Brett-0.0.1.dmg` (or similar)
- `latest-mac.yml`

Check `latest-mac.yml` contents — it should contain version, file name, sha512, and size.

- [ ] **Step 5: Commit**

```bash
git add scripts/release.ts package.json apps/desktop/package.json
git commit -m "feat(release): add release script to build and upload desktop app to S3"
```

---

### Task 4: Auto-Update with electron-updater

**Files:**
- Create: `apps/desktop/electron/updater.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install electron-updater**

```bash
cd /Users/brentbarkman/code/brett-desktop-download && pnpm --filter @brett/desktop add electron-updater
```

- [ ] **Step 2: Create the updater module**

Create `apps/desktop/electron/updater.ts`:

```typescript
import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";

export function initAutoUpdater(): void {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET || "brett";

  if (!endpoint) {
    console.log("[Updater] STORAGE_ENDPOINT not set — skipping auto-update");
    return;
  }

  autoUpdater.setFeedURL({
    provider: "generic",
    url: `${endpoint}/${bucket}/releases`,
  });

  // Don't auto-download — let us control the flow
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log(`[Updater] Update available: v${info.version}`);
    autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[Updater] Update downloaded: v${info.version}`);
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

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
```

- [ ] **Step 3: Wire updater into main.ts**

In `apps/desktop/electron/main.ts`, add the import at the top with other imports:

```typescript
import { initAutoUpdater, quitAndInstall } from "./updater";
```

Add the IPC handler for installing updates (after the existing IPC handlers, around line 75):

```typescript
ipcMain.handle("install-update", () => {
  quitAndInstall();
});
```

Initialize the updater inside the `app.whenReady().then(...)` callback, after `createWindow()` is called (around line 259):

```typescript
  createWindow();
  initAutoUpdater();
```

- [ ] **Step 4: Expose update IPC in the preload script**

Find the preload script and add the update-related IPC channels. Check if there's a preload file:

Look for `apps/desktop/electron/preload.ts` (or `.js`). Add to the exposed API:

```typescript
// Add to the contextBridge.exposeInMainWorld block:
installUpdate: () => ipcRenderer.invoke("install-update"),
onUpdateDownloaded: (callback: (version: string) => void) => {
  ipcRenderer.on("update-downloaded", (_event, version) => callback(version));
},
```

- [ ] **Step 5: Add update notification UI in the renderer**

This is a minimal toast/banner. Create a hook or add to the existing app shell. In the main App component or layout, add a listener:

```typescript
const [updateVersion, setUpdateVersion] = useState<string | null>(null);

useEffect(() => {
  window.electron?.onUpdateDownloaded?.((version: string) => {
    setUpdateVersion(version);
  });
}, []);
```

And render a simple banner when available:

```tsx
{updateVersion && (
  <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-white/10 bg-black/60 backdrop-blur-2xl px-4 py-3 text-sm text-white/80">
    <span>Brett v{updateVersion} is ready</span>
    <button
      onClick={() => window.electron?.installUpdate?.()}
      className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
    >
      Restart to update
    </button>
    <button
      onClick={() => setUpdateVersion(null)}
      className="text-white/40 hover:text-white/60 transition-colors"
    >
      ✕
    </button>
  </div>
)}
```

- [ ] **Step 6: Verify typecheck passes**

Run: `cd /Users/brentbarkman/code/brett-desktop-download && pnpm typecheck`

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/updater.ts apps/desktop/electron/main.ts apps/desktop/package.json
git commit -m "feat(desktop): add auto-update via electron-updater with S3 generic provider"
```

---

### Task 5: Add APP_VERSION Environment Variable to API

The download page needs to know the current version to construct the download URL. The simplest approach: read it from the desktop app's `package.json` at build time and inject it as an env var.

**Files:**
- Modify: `apps/api/src/routes/download.ts`

- [ ] **Step 1: Update the download route to read version dynamically**

Rather than relying on an env var that needs manual updating, read the version from a simple approach: embed it at deploy time or use a static config. For now, use `APP_VERSION` env var with a fallback.

The download route already has `const version = process.env.APP_VERSION || "0.0.1"` — this is sufficient. When running `pnpm release`, the script could also update the API's env var, but that's a Railway config concern, not a code change.

No code changes needed — this is a deployment configuration step. Document it:

**Deployment note:** After running `pnpm release`, set `APP_VERSION` in the Railway API service environment to match the desktop app version.

- [ ] **Step 2: Commit** (skip if no changes)

---

### Task 6: Final Integration Test

- [ ] **Step 1: Start the API and verify the download page**

```bash
cd /Users/brentbarkman/code/brett-desktop-download && pnpm dev:api
```

Open `http://localhost:3001/download` in a browser. Verify:
- Page loads without auth
- Video background plays (will fail locally if videos aren't in S3 yet — that's expected)
- Card displays with logo, tagline, download button
- Version info shows
- Non-macOS users see the platform note

- [ ] **Step 2: Run typecheck across the monorepo**

```bash
cd /Users/brentbarkman/code/brett-desktop-download && pnpm typecheck
```

Expected: All packages pass.

- [ ] **Step 3: Run existing tests**

```bash
cd /Users/brentbarkman/code/brett-desktop-download && pnpm test
```

Expected: All existing tests still pass (no regressions).

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for desktop download feature"
```
