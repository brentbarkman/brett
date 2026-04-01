import React from "react";
import { useAuth } from "../auth/AuthContext";

export function SignOutSection() {
  const { signOut } = useAuth();

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">Sign Out</h3>
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/60">
          Sign out of your account on this device
        </p>
        <button
          onClick={signOut}
          className="bg-transparent text-white/70 border border-white/20 rounded-lg px-4 py-1.5 text-sm hover:bg-white/5 hover:text-white transition-colors flex-shrink-0"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
