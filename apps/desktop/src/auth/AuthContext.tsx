import React, {
  createContext,
  useContext,
} from "react";
import type { AuthUser } from "@brett/types";
import type { QueryClient } from "@tanstack/react-query";
import { authClient, clearStoredToken, startGoogleOAuth } from "./auth-client";
import { diagnostics } from "../lib/diagnostics";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    name: string
  ) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The QueryClient is registered by main.tsx on module init. signOut() uses
// it to wipe all user-scoped cached data on the way out so a subsequent
// sign-in as a different account can't briefly render the previous user's
// lists / inbox / calendar before refetches complete.
let registeredQueryClient: QueryClient | null = null;
export function setQueryClient(qc: QueryClient): void {
  registeredQueryClient = qc;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: sessionData, isPending: loading, refetch } =
    authClient.useSession();

  const user: AuthUser | null = sessionData?.user
    ? {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
        avatarUrl: sessionData.user.image ?? null,
        assistantName: (sessionData.user as any).assistantName ?? "Brett",
      }
    : null;

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      throw new Error(error.message || "Sign in failed");
    }
  };

  const signUpWithEmail = async (email: string, password: string, name: string) => {
    const { error } = await authClient.signUp.email({
      email,
      password,
      name,
    });
    if (error) {
      throw new Error(error.message || "Sign up failed");
    }
  };

  const signInWithGoogle = async () => {
    await startGoogleOAuth();
    refetch();
  };

  const signOut = async () => {
    await authClient.signOut();
    await clearStoredToken();
    // Wipe in-memory state that outlives the AuthGuard unmount — the query
    // cache (so user A's data can't flash on user B's sign-in) and the
    // diagnostics ring buffer (which would otherwise attach one user's
    // recent failed API calls to another user's next feedback submission).
    registeredQueryClient?.clear();
    diagnostics.clear();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
        refetchUser: refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
