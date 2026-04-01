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

  if (user.role !== "admin") {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-white/10 bg-black/40 p-8 backdrop-blur-2xl text-center">
          <h2 className="text-lg font-semibold text-white">Insufficient Permissions</h2>
          <p className="text-sm text-white/50">
            You are signed in as <span className="text-white/80">{user.email}</span>, but this panel
            requires admin access.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
