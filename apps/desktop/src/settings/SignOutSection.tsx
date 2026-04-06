import React from "react";
import { useAuth } from "../auth/AuthContext";
import { SettingsCard, SettingsHeader } from "./SettingsComponents";

export function SignOutSection() {
  const { signOut } = useAuth();

  return (
    <SettingsCard>
      <SettingsHeader>Sign Out</SettingsHeader>
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
    </SettingsCard>
  );
}
