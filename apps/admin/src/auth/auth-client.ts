import { createAuthClient } from "better-auth/react";

const API_URL = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:3002";

const TOKEN_KEY = `brett_admin_token_${API_URL}`;

let currentToken: string | null = null;

const tokenReady = (async () => {
  currentToken = localStorage.getItem(TOKEN_KEY);
})();

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: async () => {
        await tokenReady;
        return currentToken ?? undefined;
      },
    },
    onSuccess(context) {
      const body = context.data as Record<string, unknown> | null;
      if (body && typeof body === "object" && "token" in body && typeof body.token === "string") {
        currentToken = body.token;
        localStorage.setItem(TOKEN_KEY, body.token);
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
  localStorage.removeItem(TOKEN_KEY);
}
