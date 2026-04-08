import { getToken, clearToken } from "../auth/token-storage";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";

const API_URL = Constants.expoConfig?.extra?.apiUrl ?? "http://localhost:3001";
const DEFAULT_TIMEOUT = 30_000;

export class OfflineError extends Error {
  constructor() {
    super("Device is offline");
    this.name = "OfflineError";
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "AuthExpiredError";
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  init?: RequestInit & { timeout?: number },
): Promise<{ status: number; data: T }> {
  // Check network connectivity before attempting the request
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) throw new OfflineError();

  const token = await getToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init?.timeout ?? DEFAULT_TIMEOUT,
  );

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    // On 401: clear token and throw — no refresh (R6: bearer plugin has no refresh tokens)
    if (res.status === 401 && token) {
      await clearToken();
      throw new AuthExpiredError();
    }

    const data = res.headers.get("content-type")?.includes("json")
      ? await res.json()
      : null;
    return { status: res.status, data: data as T };
  } finally {
    clearTimeout(timeout);
  }
}

export function getApiUrl(): string {
  return API_URL;
}
