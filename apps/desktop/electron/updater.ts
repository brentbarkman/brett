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

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App is up to date");
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
