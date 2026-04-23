import { authClient, clearStoredToken, getToken } from "../auth/auth-client";
import { recordFailedApiCall } from "../lib/diagnostics";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function getApiUrl(): string {
  return API_URL;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  // Try bearer token first (works in Electron + browser after sign-in)
  const authHeaders = await getAuthHeaders();

  // If we have a token, use bearer auth. Otherwise fall back to cookies
  // (browser dev mode where better-auth session is cookie-based).
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
    ...authHeaders,
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include", // send cookies as fallback
  });

  if (!res.ok) {
    recordFailedApiCall(
      `${API_URL}${path}`,
      init?.method || "GET",
      res.status,
    );
    // The stored bearer is dead (revoked or expired). Clearing it flips
    // AuthGuard to LoginPage on the next render instead of letting every
    // subsequent request hammer the API with an invalid token. Skip for
    // auth routes themselves so a wrong-password 401 doesn't nuke the
    // session before the user sees the error message.
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      await clearStoredToken().catch(() => {});
    }
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || (body as any).error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}
