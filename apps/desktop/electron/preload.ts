import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  storeToken: (token: string) => ipcRenderer.invoke("store-token", token),
  getToken: () => ipcRenderer.invoke("get-token"),
  clearToken: () => ipcRenderer.invoke("clear-token"),
  startGoogleOAuth: (apiURL: string) => ipcRenderer.invoke("start-google-oauth", apiURL),
});
