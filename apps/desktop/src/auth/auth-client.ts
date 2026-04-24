import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const electronAPI = (window as any).electronAPI as
  | {
      storeToken: (token: string) => Promise<void>;
      getToken: () => Promise<string | null>;
      clearToken: () => Promise<void>;
      startGoogleOAuth: () => Promise<string>;
    }
  | undefined;

// localStorage key scoped by API URL so multiple worktrees don't collide
const BROWSER_TOKEN_KEY = `brett_token_${API_URL}`;

// In-memory token for the current session
let currentToken: string | null = null;

// Load token from secure storage (Electron) or localStorage (browser) on startup
const tokenReady = (async () => {
  if (electronAPI) {
    currentToken = await electronAPI.getToken();
  } else {
    currentToken = localStorage.getItem(BROWSER_TOKEN_KEY);
  }
})();

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [passkeyClient()],
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: async () => {
        await tokenReady;
        return currentToken ?? undefined;
      },
    },
    onSuccess(context) {
      // Capture token from sign-in/sign-up responses
      const body = context.data as Record<string, unknown> | null;
      if (body && typeof body === "object" && "token" in body && typeof body.token === "string") {
        currentToken = body.token;
        if (electronAPI) {
          electronAPI.storeToken(body.token);
        } else {
          localStorage.setItem(BROWSER_TOKEN_KEY, body.token);
        }
      }
    },
  },
});

export async function getToken(): Promise<string | null> {
  await tokenReady;
  return currentToken;
}

export async function clearStoredToken(): Promise<void> {
  currentToken = null;
  if (electronAPI) {
    await electronAPI.clearToken();
  } else {
    localStorage.removeItem(BROWSER_TOKEN_KEY);
  }
}

/**
 * Handle a 401 surfaced by any data fetch. Clears the bearer AND forces
 * better-auth's client-side session store to drop the cached user so the
 * `useSession()` subscribers (AuthGuard, AuthContext) flip to the login
 * screen on the next render. Just clearing the bearer isn't enough —
 * `useSession()` reads cached session state, not the stored token, so
 * without the signOut the shell would stay rendered while every
 * subsequent data fetch silently 401'd.
 *
 * The `signOut()` server call is best-effort: if the token is already
 * dead the POST itself will 401, but better-auth still drops the local
 * session cache on any outcome, which is what we need.
 */
export async function handleUnauthorized(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // Expected if the session is already dead on the server.
  }
  await clearStoredToken();
}

// Start Google OAuth via system browser with secure localhost callback
export async function startGoogleOAuth(): Promise<void> {
  if (!electronAPI) return;
  const token = await electronAPI.startGoogleOAuth();
  currentToken = token;
  await electronAPI.storeToken(token);
}
