import React from "react";
import { useAuth } from "../auth/AuthContext";

export function SignOutSection() {
  const { signOut } = useAuth();

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 px-6 py-5 flex items-center justify-between">
      <div>
        <div className="text-sm text-white">Sign out</div>
        <div className="text-xs text-white/40">
          Sign out of your account on this device
        </div>
      </div>
      <button
        onClick={signOut}
        className="bg-transparent text-white/70 border border-white/20 rounded-lg px-4 py-1.5 text-sm hover:bg-white/5 hover:text-white transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
