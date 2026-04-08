import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  getToken,
  setToken,
  setUserId,
  clearToken,
  getUserId,
} from "./token-storage";
import { apiRequest } from "../api/client";
import { wipeDatabase } from "../db";

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface SignInResponse {
  token: string;
  user: { id: string; email: string; name: string };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserIdState] = useState<string | null>(null);

  // On mount: check for existing token in Keychain
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const storedUserId = await getUserId();
        if (token && storedUserId) {
          setIsAuthenticated(true);
          setUserIdState(storedUserId);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { status, data } = await apiRequest<SignInResponse & { message?: string }>(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );

    if (status !== 200 || !data?.token || !data?.user?.id) {
      throw new Error(data?.message ?? `Sign-in failed (HTTP ${status})`);
    }

    await setToken(data.token);
    await setUserId(data.user.id);
    setUserIdState(data.user.id);
    setIsAuthenticated(true);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    wipeDatabase();
    setIsAuthenticated(false);
    setUserIdState(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ isLoading, isAuthenticated, userId, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
