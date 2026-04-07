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
  captureScreenshot: () => ipcRenderer.invoke("capture-screenshot"),
});
