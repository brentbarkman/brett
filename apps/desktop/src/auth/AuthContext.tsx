import React, {
  createContext,
  useContext,
  useCallback,
} from "react";
import type { AuthUser } from "@brett/types";
import { authClient, clearStoredToken } from "./auth-client";

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: sessionData, isPending: loading } =
    authClient.useSession();

  const user: AuthUser | null = sessionData?.user
    ? {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
        avatarUrl: sessionData.user.image ?? null,
      }
    : null;

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        throw new Error(error.message || "Sign in failed");
      }
    },
    []
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, name: string) => {
      const { error } = await authClient.signUp.email({
        email,
        password,
        name,
      });
      if (error) {
        throw new Error(error.message || "Sign up failed");
      }
    },
    []
  );

  const signInWithGoogle = useCallback(async () => {
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: window.location.origin,
    });
    if (error) {
      throw new Error(error.message || "Google sign in failed");
    }
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    await clearStoredToken();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
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
