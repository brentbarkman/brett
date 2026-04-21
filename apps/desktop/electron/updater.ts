import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";
import Store from "electron-store";
import path from "path";

// Main-process source of truth for update state
let updateReady = false;
let downloadedVersion: string | null = null;
let initialized = false;
let intervalTimer: NodeJS.Timeout | null = null;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function getUpdateFeedUrl(): string | null {
  // The API proxies release artifacts at /releases/* since Railway
  // Object Storage doesn't support public buckets.
  let apiUrl = "";

  try {
    const fs = require("fs");
    const configPath = path.join(__dirname, "api-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.apiURL) apiUrl = config.apiURL;
  } catch {
    // Fall through to env vars (dev mode)
  }

  if (!apiUrl) apiUrl = process.env.VITE_API_URL || "";
  if (!apiUrl) return null;

  return `${apiUrl}/releases`;
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

  initialized = true;

  setTimeout(() => {
    console.log("[Updater] Checking for updates...");
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] Check failed:", err.message);
    });
  }, 5000);

  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = setInterval(() => {
    console.log("[Updater] Periodic check for updates...");
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[Updater] Periodic check failed:", err.message);
    });
  }, FOUR_HOURS_MS);
}

export type ManualCheckResult =
  | { status: "update-available"; version: string }
  | { status: "up-to-date" };

export function checkForUpdatesNow(): Promise<ManualCheckResult> {
  if (!initialized) {
    return Promise.reject(new Error("Auto-updater not initialized"));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      autoUpdater.removeListener("update-available", onAvailable);
      autoUpdater.removeListener("update-not-available", onNotAvailable);
      autoUpdater.removeListener("error", onError);
    };
    const onAvailable = (info: { version: string }) => {
      cleanup();
      resolve({ status: "update-available", version: info.version });
    };
    const onNotAvailable = () => {
      cleanup();
      resolve({ status: "up-to-date" });
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    autoUpdater.once("update-available", onAvailable);
    autoUpdater.once("update-not-available", onNotAvailable);
    autoUpdater.once("error", onError);

    autoUpdater.checkForUpdates().catch((err) => {
      cleanup();
      reject(err);
    });
  });
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
