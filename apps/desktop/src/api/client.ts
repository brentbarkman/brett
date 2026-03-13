import { authClient, getToken } from "../auth/auth-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  // Try bearer token first (works in Electron + browser after sign-in)
  const token = await getToken();

  // If we have a token, use bearer auth. Otherwise fall back to cookies
  // (browser dev mode where better-auth session is cookie-based).
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include", // send cookies as fallback
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}
