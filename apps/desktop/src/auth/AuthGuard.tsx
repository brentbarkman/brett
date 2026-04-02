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
        <div className="w-10 h-10 rounded-lg bg-brett-gold flex items-center justify-center animate-pulse shadow-[0_0_20px_rgba(232,185,49,0.4)]">
          <span className="text-white font-bold text-xl">B</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
