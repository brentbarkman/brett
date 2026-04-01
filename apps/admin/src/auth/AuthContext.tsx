import React, { createContext, useContext, useCallback } from "react";
import { authClient, clearStoredToken } from "./auth-client";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string;
}

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: sessionData, isPending: loading, refetch } = authClient.useSession();

  const user: AdminUser | null = sessionData?.user
    ? {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
        image: sessionData.user.image ?? null,
        role: (sessionData.user as any).role ?? "user",
      }
    : null;

  const signOut = useCallback(async () => {
    await authClient.signOut();
    await clearStoredToken();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refetchUser: refetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
