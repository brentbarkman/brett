import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } from "electron";
import http from "http";
import crypto from "crypto";
import path from "path";
import { pathToFileURL } from "url";
import Store from "electron-store";

// #3: Load API URL from main process config — never accept from renderer
// Reads from api-config.json generated at build time, falls back to env var
function getApiURL(): string {
  try {
    const fs = require("fs");
    const configPath = path.join(__dirname, "api-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.apiURL) return config.apiURL;
  } catch {
    // Fall through — config file doesn't exist in dev
  }
  return process.env.VITE_API_URL || "http://localhost:3001";
}
const API_URL = getApiURL();

const isDev = process.env.NODE_ENV === "development";

// In dev, give each worktree its own userData directory so multiple instances
// don't share Chromium sessions, cookies, or electron-store data
if (isDev) {
  const cwdHash = crypto.createHash("md5").update(process.cwd()).digest("hex").slice(0, 8);
  app.setPath("userData", path.join(app.getPath("userData"), `dev-${cwdHash}`));
}

const store = new Store<{ encryptedToken?: string }>();

// Token storage IPC handlers
ipcMain.handle("store-token", (_event, token: string) => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token);
    store.set("encryptedToken", encrypted.toString("base64"));
  } else if (isDev) {
    // #6: Only allow unencrypted storage in dev
    store.set("encryptedToken", token);
  } else {
    throw new Error("Secure storage is not available");
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

  if (isDev) return stored;

  // #6: Production without encryption — clear stale unencrypted data
  store.delete("encryptedToken");
  return null;
});

ipcMain.handle("clear-token", () => {
  store.delete("encryptedToken");
});

// #5: Track in-progress OAuth to prevent concurrent flows
let oauthInProgress = false;

// Start Google OAuth via system browser with localhost callback
// #3: API URL is read from main process env, not from renderer
ipcMain.handle("start-google-oauth", () => {
  if (oauthInProgress) {
    throw new Error("OAuth flow already in progress");
  }
  oauthInProgress = true;

  return new Promise<string>((resolve, reject) => {
    const state = crypto.randomBytes(32).toString("hex");
    let settled = false;

    function settle() {
      if (!settled) {
        settled = true;
        oauthInProgress = false;
      }
    }

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
      // No external resources loaded — prevents token leaking via Referer
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Referrer-Policy": "no-referrer",
      });
      res.end(`
        <html><body style="font-family: system-ui; text-align: center; padding: 60px;">
          <h2>Sign-in successful!</h2>
          <p>You can close this tab and return to Brett.</p>
          <script>window.close();</script>
        </body></html>
      `);

      settle();
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
        settle();
        reject(new Error("Failed to start OAuth callback server"));
        return;
      }

      const port = address.port;
      const oauthURL = `${API_URL}/api/auth/desktop/google?port=${port}&state=${state}`;
      shell.openExternal(oauthURL);
    });

    // #10: Timeout after 2 minutes (reduced from 5)
    setTimeout(() => {
      if (!settled) {
        settle();
        server.close();
        reject(new Error("OAuth timed out"));
      }
    }, 2 * 60 * 1000);
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

// #4: Pre-compute renderer root for path traversal check
const rendererRoot = path.resolve(__dirname, "../renderer");

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

  if (isDev) {
    win.loadURL("http://localhost:5173");
    // #8: Only open DevTools in development
    win.webContents.openDevTools();
  } else {
    win.loadURL("app://./index.html");
  }
}

app.whenReady().then(() => {
  // Serve renderer files via app:// protocol
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let filePath = url.pathname;
    if (filePath === "/" || filePath === "") filePath = "/index.html";

    // #4: Prevent path traversal — resolve and verify within renderer root
    const fullPath = path.resolve(rendererRoot, filePath.replace(/^\//, ""));
    if (!fullPath.startsWith(rendererRoot + path.sep) && fullPath !== rendererRoot) {
      return new Response("Forbidden", { status: 403 });
    }

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
