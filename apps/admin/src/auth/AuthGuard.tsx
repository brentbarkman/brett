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
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center animate-pulse shadow-[0_0_20px_rgba(59,130,246,0.4)]">
          <span className="text-white font-bold text-xl">B</span>
        </div>
      </div>
    );
  }

  if (!user) return <>{fallback}</>;

  // Non-admin users see the same screen as unauthenticated users —
  // don't leak that the account exists or has insufficient permissions
  if (user.role !== "admin") return <>{fallback}</>;

  return <>{children}</>;
}
