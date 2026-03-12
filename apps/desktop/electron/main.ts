import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } from "electron";
import http from "http";
import crypto from "crypto";
import path from "path";
import { pathToFileURL } from "url";
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

// Start Google OAuth via system browser with localhost callback
ipcMain.handle("start-google-oauth", (_event, apiURL: string) => {
  return new Promise<string>((resolve, reject) => {
    const state = crypto.randomBytes(32).toString("hex");
    let settled = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://127.0.0.1`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get("token");
      const returnedState = url.searchParams.get("state");

      if (returnedState !== state) {
        res.writeHead(403);
        res.end("Invalid state parameter. Please try again.");
        return;
      }

      if (!token) {
        res.writeHead(400);
        res.end("No token received. Please try again.");
        return;
      }

      // Send a response that closes the browser tab
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family: system-ui; text-align: center; padding: 60px;">
          <h2>Sign-in successful!</h2>
          <p>You can close this tab and return to Brett.</p>
          <script>window.close();</script>
        </body></html>
      `);

      settled = true;
      server.close();

      // Focus the app window
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.focus();

      resolve(token);
    });

    // Listen on random port on localhost only
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to start OAuth callback server"));
        return;
      }

      const port = address.port;
      const oauthURL = `${apiURL}/api/auth/desktop/google?port=${port}&state=${state}`;
      shell.openExternal(oauthURL);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("OAuth timed out"));
      }
    }, 5 * 60 * 1000);
  });
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
