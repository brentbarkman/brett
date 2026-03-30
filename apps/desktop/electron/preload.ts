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
  onUpdateDownloaded: (callback: (version: string) => void) => {
    ipcRenderer.on("update-downloaded", (_event, version) => callback(version));
  },
});
