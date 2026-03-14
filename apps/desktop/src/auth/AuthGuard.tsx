import React from "react";
import { useAuth } from "./AuthContext";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white/40">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
