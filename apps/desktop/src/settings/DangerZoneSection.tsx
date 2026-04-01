import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { authClient } from "../auth/auth-client";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

export function DangerZoneSection() {
  const { signOut } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function handleDeleteAccount() {
    const { error } = await authClient.deleteUser();
    if (error) {
      throw new Error(error.message || "Failed to delete account");
    }
    await signOut();
  }

  return (
    <>
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-red-500/30 p-6">
        <h3 className="text-xs uppercase tracking-wider text-red-400/60 font-semibold mb-4">Danger Zone</h3>
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/60">
            Permanently delete your account and all data
          </p>
          <button
            onClick={() => setDialogOpen(true)}
            className="bg-transparent text-red-400 border border-red-500/40 rounded-lg px-4 py-1.5 text-sm hover:bg-red-500/10 transition-colors flex-shrink-0"
          >
            Delete account
          </button>
        </div>
      </div>

      <DeleteAccountDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleDeleteAccount}
      />
    </>
  );
}
