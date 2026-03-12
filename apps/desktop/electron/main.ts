import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } from "electron";
import path from "path";
import { pathToFileURL } from "url";
import Store from "electron-store";

// Register as handler for brett:// deep links
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("brett", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("brett");
}

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

// Open URL in system browser (for OAuth)
ipcMain.handle("open-external", (_event, url: string) => {
  shell.openExternal(url);
});

// Register custom app:// protocol for production
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

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
  } else {
    win.loadURL("app://./index.html");
  }

  win.webContents.openDevTools();
}

// Handle brett:// deep link (macOS)
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "auth" && parsed.pathname === "/callback") {
      const token = parsed.searchParams.get("token");
      if (token) {
        // Store the token
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(token);
          store.set("encryptedToken", encrypted.toString("base64"));
        } else {
          store.set("encryptedToken", token);
        }
        // Notify the renderer to refresh session
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.webContents.send("auth-callback", token);
          win.focus();
        }
      }
    }
  } catch {
    // Invalid URL, ignore
  }
}

app.whenReady().then(() => {
  // Serve renderer files via app:// protocol
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let filePath = url.pathname;
    if (filePath === "/" || filePath === "") filePath = "/index.html";
    const fullPath = path.join(__dirname, "../renderer", filePath);
    return net.fetch(pathToFileURL(fullPath).toString());
  });

  createWindow();
});

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
