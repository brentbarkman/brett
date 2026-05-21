import { getToken, handleUnauthorized } from "../auth/auth-client";
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

/**
 * Extended fetch options understood by `apiFetch`.
 *
 * - `timeoutMs`: optional per-request timeout. When set, an AbortController
 *   aborts the request after that many milliseconds and the call rejects
 *   with a `TimeoutError` (a regular `Error` whose `name === 'TimeoutError'`).
 *   Useful for endpoints where a hang is worse than a fast failure
 *   (`/feedback`, `/health`) — Railway's gateway responds at ~15s anyway, so
 *   a 5s client timeout fails before the gateway does, keeping the UI
 *   responsive.
 *
 *   The caller's own `signal` (if any) is chained, so cancellation still
 *   works in addition to the timeout.
 */
export type ApiFetchInit = RequestInit & { timeoutMs?: number };

export async function apiFetch<T = unknown>(
  path: string,
  init?: ApiFetchInit
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

  // Per-request timeout via AbortController. If the caller supplied their
  // own `signal`, we chain it so cancelling the caller's controller also
  // aborts our timeout-driven controller.
  const { timeoutMs, signal: callerSignal, ...restInit } = init ?? {};
  let signal = callerSignal;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (timeoutMs != null) {
    const controller = new AbortController();
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    if (callerSignal) {
      // If the caller cancels first, mirror it into our controller so
      // the fetch tears down promptly. Already-aborted signals abort
      // synchronously on .abort(); the event listener handles the
      // pre-fetch case.
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    signal = controller.signal;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...restInit,
      headers,
      signal,
      credentials: "include", // send cookies as fallback
    });
  } catch (err) {
    if (timedOut) {
      const timeoutErr = new Error(`Request to ${path} timed out after ${timeoutMs}ms`);
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    recordFailedApiCall(
      `${API_URL}${path}`,
      init?.method || "GET",
      res.status,
    );
    // The stored bearer is dead (revoked or expired). handleUnauthorized
    // clears the bearer AND drops better-auth's cached session so AuthGuard
    // actually flips to LoginPage on the next render — just nuking the
    // token isn't enough because useSession() doesn't watch the token.
    // Skip for auth routes themselves so a wrong-password 401 doesn't nuke
    // the session before the user sees the error message.
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      await handleUnauthorized().catch(() => {});
    }
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || (body as any).error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}
