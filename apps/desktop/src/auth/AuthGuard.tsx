import React from "react";
import { useAuth } from "./AuthContext";
import { BrettMark } from "../components/BrettMark";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <BrettMark
          size={40}
          className="animate-pulse drop-shadow-[0_0_20px_rgba(232,185,49,0.4)]"
        />
      </div>
    );
  }

  if (!user) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
