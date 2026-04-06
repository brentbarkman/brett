import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";
import Store from "electron-store";
import path from "path";

// Main-process source of truth for update state
let updateReady = false;
let downloadedVersion: string | null = null;

function getUpdateFeedUrl(): string | null {
  let endpoint = "";
  let bucket = "brett-releases";

  try {
    const fs = require("fs");
    const configPath = path.join(__dirname, "api-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.releaseStorageEndpoint) endpoint = config.releaseStorageEndpoint;
    else if (config.storageEndpoint) endpoint = config.storageEndpoint;
    if (config.releaseStorageBucket) bucket = config.releaseStorageBucket;
    else if (config.storageBucket) bucket = config.storageBucket;
  } catch {
    // Fall through to env vars (dev mode)
  }

  if (!endpoint) endpoint = process.env.RELEASE_STORAGE_ENDPOINT || process.env.STORAGE_ENDPOINT || "";
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

export function setAutoInstallOnQuit(enabled: boolean): void {
  autoUpdater.autoInstallOnAppQuit = enabled;
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
