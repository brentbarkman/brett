import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  storeToken: (token: string) => ipcRenderer.invoke("store-token", token),
  getToken: () => ipcRenderer.invoke("get-token"),
  clearToken: () => ipcRenderer.invoke("clear-token"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  onAuthCallback: (callback: (token: string) => void) => {
    ipcRenderer.on("auth-callback", (_event, token: string) => callback(token));
  },
});
