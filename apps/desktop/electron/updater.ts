import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";
import path from "path";

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

export function initAutoUpdater(): void {
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
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log(`[Updater] Update available: v${info.version}`);
    autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App is up to date");
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

let installTriggered = false;

export function quitAndInstall(): void {
  if (installTriggered) return;
  installTriggered = true;
  autoUpdater.quitAndInstall();
}
