import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import path from "path";
import Store from "electron-store";

const store = new Store<{ encryptedToken?: string }>();

// Token storage IPC handlers
ipcMain.handle("store-token", (_event, token: string) => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token);
    store.set("encryptedToken", encrypted.toString("base64"));
  } else {
    // Fallback: store unencrypted (dev only)
    store.set("encryptedToken", token);
  }
});

ipcMain.handle("get-token", () => {
  const stored = store.get("encryptedToken");
  if (!stored) return null;

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(stored, "base64");
      return safeStorage.decryptString(buffer);
    } catch {
      store.delete("encryptedToken");
      return null;
    }
  }

  return stored;
});

ipcMain.handle("clear-token", () => {
  store.delete("encryptedToken");
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
